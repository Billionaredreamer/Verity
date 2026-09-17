/**
 * Verity context engine.
 *
 * Handover §8, verbatim: "Before the model answers a market question, the
 * context engine retrieves only the relevant verified data: price, position,
 * P/L, flow, gamma, IV, volume, news, events, and market regime. The model
 * interprets this structured package instead of inventing market facts."
 *
 * And the architecture rule from the same section: "Do not connect the
 * language model directly to random market endpoints."
 *
 * Two consequences shape this file:
 *
 * 1. RELEVANCE. Retrieval is selective, not exhaustive. "What is SPY doing?"
 *    does not need the options chain, and fetching it anyway costs latency
 *    during market hours and buries the signal in the prompt.
 *
 * 2. HONESTY. Every retrieval outcome is recorded in `retrievalLog`, including
 *    failures. A package where gamma is missing says so, so the model can say
 *    "I couldn't retrieve gamma" instead of quietly answering without it.
 */

import "server-only";

import type { ContextCard, FlowEvent, VerityContextPackage } from "@/lib/schema/core";
import { providers } from "@/lib/providers/registry";
import { computeGex, formatGamma } from "@/lib/engines/gammaEngine";
import { aggregateFlow, formatPremium } from "@/lib/engines/flowEngine";
import { assessRegime } from "@/lib/engines/marketRegimeEngine";
import { assessRisk } from "@/lib/engines/riskEngine";
import { riskInputFor } from "@/lib/engines/positionEngine";
import { mergeProvenance, sourced } from "@/lib/providers/provenance";
import { EMPTY_FLOW_FILTERS } from "@/lib/schema/core";
import { upcomingExpirations } from "@/lib/util/dates";

/** Which slices of context a question actually needs. */
export interface RetrievalPlan {
  snapshot: boolean;
  indexes: boolean;
  flow: boolean;
  gex: boolean;
  news: boolean;
  events: boolean;
  regime: boolean;
  position: boolean;
  risk: boolean;
}

/**
 * Keyword patterns that decide what a question needs.
 *
 * Note the trailing-`\b` trap: `/\brisk\b/` does NOT match "risks", because
 * `s` is a word character. The handover's own §3 example query is "What risks
 * am I missing?", so that omission silently skipped risk retrieval on the
 * exact phrasing the spec calls representative. Patterns here end with an
 * explicit plural or a prefix match rather than a word boundary.
 */
const KEYWORDS: Record<keyof RetrievalPlan, RegExp> = {
  snapshot: /\b(price|doing|quote|trading|move[ds]?|drop|dropp|fell|rall|spik|up|down|seeing)\b/i,
  indexes: /\b(market|spy|qqq|iwm|dia|index|indices|tape|broad)\b/i,
  flow: /\b(flow|option|options|call|calls|put|puts|premium|sweep|block|unusual|positioning)\b/i,
  gex: /\b(gamma|gex|wall|walls|zero.?gamma|flip|dealer|0dte|level|levels|support|resistance)\b/i,
  news: /\b(news|headline|headlines|catalyst|catalysts|why|announce|report|happen)\b/i,
  events: /\b(earnings|cpi|ppi|fomc|fed|jobs|gdp|event|events|calendar|catalyst|catalysts)\b/i,
  regime: /\b(regime|risk.?on|risk.?off|environment|volatil|vix|breadth)\b/i,
  position: /\b(my|position|positions|i own|i'm in|entered|entry|p\/?l|profit|loss|holding|holdings)\b/i,
  risk: /\b(risk|risks|risky|exposure|size|stop|concentrat|missing|danger)\b/i,
};

/**
 * Decide what to retrieve. A question that mentions a ticker always gets the
 * snapshot, because every other slice is meaningless without a price.
 */
export function planRetrieval(question: string, ticker: string | null): RetrievalPlan {
  const plan = {} as RetrievalPlan;
  for (const key of Object.keys(KEYWORDS) as Array<keyof RetrievalPlan>) {
    plan[key] = KEYWORDS[key].test(question);
  }

  if (ticker) {
    plan.snapshot = true;
    // The handover's §3 example interaction is explicit about what a bare
    // ticker question should pull: "User: 'What is SPY doing?' → Verity checks
    // price, volume, flow, gamma, volatility, and major catalysts." So naming
    // a ticker requests the full picture unless the question is narrower than
    // that — a keyword-only plan would answer "what are you seeing in SPY?"
    // with a quote and nothing else, which is not what was asked.
    const narrow = /\b(price|quote|last|where is .* trading)\b/i.test(question) &&
      !/\b(flow|gamma|why|risk|position)\b/i.test(question);
    if (!narrow) {
      plan.flow = true;
      plan.gex = true;
      plan.news = true;
      plan.events = true;
      plan.regime = true;
      plan.indexes = true;
    }
    // "Why did X drop?" is unanswerable without news and flow, whether or not
    // the user used those words.
    if (/\bwhy\b/i.test(question)) {
      plan.news = true;
      plan.flow = true;
      plan.events = true;
    }
  } else {
    plan.indexes = true;
    plan.regime = true;
  }

  // "What matters right now?" and similar open questions get the broad tape.
  if (/\b(what matters|what'?s happening|anything|overview|brief)\b/i.test(question)) {
    plan.indexes = true;
    plan.regime = true;
    plan.news = true;
    plan.events = true;
  }

  // Risk questions need the position they are about.
  if (plan.risk) plan.position = true;

  // Nothing matched — answer against the broad market rather than nothing.
  const anything = Object.values(plan).some(Boolean);
  if (!anything) {
    plan.indexes = true;
    plan.regime = true;
    plan.snapshot = ticker !== null;
  }

  return plan;
}

/** Pull a ticker out of a question. Explicit $TICKER wins; otherwise a known symbol. */
export function extractTicker(question: string, known: string[]): string | null {
  const dollar = question.match(/\$([A-Za-z]{1,5})\b/);
  if (dollar?.[1]) return dollar[1].toUpperCase();

  const upper = question.toUpperCase();
  // Longest match first, so "GOOGL" is not shadowed by a shorter symbol.
  const sorted = [...known].sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    if (new RegExp(`\\b${t}\\b`).test(upper)) return t;
  }
  return null;
}

interface AssembleArgs {
  question: string;
  ticker: string | null;
  userId: string;
  /** Overrides the keyword plan — used by screens that know what they need. */
  plan?: Partial<RetrievalPlan>;
}

/**
 * Assemble the package. Independent retrievals run concurrently, because
 * during market hours latency is a product feature (§2: "serious, modern,
 * fast").
 */
export async function assembleContext(args: AssembleArgs): Promise<VerityContextPackage> {
  const p = providers();
  const plan = { ...planRetrieval(args.question, args.ticker), ...args.plan };
  const log: VerityContextPackage["retrievalLog"] = [];

  const pkg: VerityContextPackage = {
    question: args.question,
    ticker: args.ticker,
    snapshot: null,
    indexes: null,
    flow: null,
    gex: null,
    news: null,
    events: null,
    regime: null,
    portfolio: null,
    position: null,
    risk: null,
    assembledAt: new Date().toISOString(),
    retrievalLog: log,
  };

  /** Runs one retrieval, timing it and never letting a failure escape. */
  async function retrieve<T>(
    key: string,
    enabled: boolean,
    fn: () => Promise<T>,
    assign: (value: T) => void,
  ): Promise<void> {
    if (!enabled) return;
    const started = Date.now();
    try {
      const value = await fn();
      assign(value);
      const state =
        value && typeof value === "object" && "provenance" in value
          ? (value as { provenance: { state: VerityContextPackage["retrievalLog"][number]["state"] } })
              .provenance.state
          : "LIVE";
      log.push({ key, state, ms: Date.now() - started });
    } catch (err) {
      // §10: handle provider outages explicitly. The model is told the
      // retrieval failed rather than being left to fill the gap.
      log.push({
        key,
        state: "UNAVAILABLE",
        ms: Date.now() - started,
        note: err instanceof Error ? err.message : "retrieval failed",
      });
    }
  }

  const ticker = args.ticker;

  await Promise.all([
    retrieve("snapshot", plan.snapshot && ticker !== null, () => p.market.getSnapshot(ticker!), (v) => (pkg.snapshot = v)),
    retrieve("indexes", plan.indexes, () => p.market.getIndexes(), (v) => (pkg.indexes = v)),
    retrieve(
      "flow",
      plan.flow,
      () =>
        p.options.getFlow(
          { ...EMPTY_FLOW_FILTERS, tickers: ticker ? [ticker] : [], minPremium: 50_000 },
          ticker ? 60 : 30,
        ),
      (v) => (pkg.flow = v),
    ),
    retrieve(
      "gex",
      plan.gex && ticker !== null,
      async () => {
        const chain = await p.options.getChain(ticker!, upcomingExpirations(3));
        return {
          data: computeGex(chain.data),
          provenance: chain.provenance,
        };
      },
      (v) => (pkg.gex = v),
    ),
    retrieve("news", plan.news, () => p.news.getNews(ticker ? [ticker] : ["SPY", "QQQ"], 8), (v) => (pkg.news = v)),
    retrieve(
      "events",
      plan.events,
      () =>
        p.news.getEconomicCalendar(
          new Date().toISOString(),
          new Date(Date.now() + 14 * 86_400_000).toISOString(),
        ),
      (v) => (pkg.events = v),
    ),
    // The whole summary is retrieved, not just the matched position: risk
    // needs the portfolio total, and derived values need this provenance.
    retrieve(
      "portfolio",
      plan.position || plan.risk,
      () => p.brokerage.getPortfolio(args.userId),
      (v) => (pkg.portfolio = v),
    ),
  ]);

  // Regime depends on indexes and breadth, so it runs after them.
  if (plan.regime && pkg.indexes) {
    const started = Date.now();
    try {
      const breadth = await p.market.getBreadth();
      const vix = pkg.indexes.data.find((i) => i.symbol === "VIX");
      pkg.regime = {
        data: assessRegime({
          indexes: pkg.indexes.data,
          breadth: breadth.data,
          vixChangePercent: vix?.changePercent ?? null,
          vixLevel: vix?.price ?? null,
        }),
        provenance: breadth.provenance,
      };
      log.push({ key: "regime", state: breadth.provenance.state, ms: Date.now() - started });
    } catch (err) {
      log.push({
        key: "regime",
        state: "UNAVAILABLE",
        ms: Date.now() - started,
        note: err instanceof Error ? err.message : "regime assessment failed",
      });
    }
  }

  // Select the position the question is about, from the retrieved summary.
  if (pkg.portfolio) {
    pkg.position =
      pkg.portfolio.data.positions.find((x) => !ticker || x.ticker === ticker) ?? null;
  }

  // Risk is derived from the position, the portfolio total and the snapshot's
  // IV. Its provenance is the weakest of those inputs — a deterministic
  // calculation over mock data is mock, not live.
  if (plan.risk && pkg.position && pkg.portfolio) {
    const inputProvenances = [pkg.portfolio.provenance];
    if (pkg.snapshot) inputProvenances.push(pkg.snapshot.provenance);

    pkg.risk = sourced(
      assessRisk(
        riskInputFor(pkg.position, pkg.portfolio.data, pkg.snapshot?.data.iv ?? null),
      ),
      mergeProvenance(inputProvenances, "riskEngine"),
    );
    log.push({ key: "risk", state: pkg.risk.provenance.state, ms: 0 });
  }

  return pkg;
}

// ---------------------------------------------------------------------------
// Context cards
// ---------------------------------------------------------------------------

/**
 * Turn a package into the cards the Terminal renders (§2 "Dynamic context").
 * Formatting happens here, on the server, so the client never recomputes a
 * number and risks disagreeing with what the model was told.
 */
export function buildContextCards(pkg: VerityContextPackage): ContextCard[] {
  const cards: ContextCard[] = [];

  if (pkg.snapshot) {
    const s = pkg.snapshot.data;
    cards.push({
      kind: "quote",
      title: s.ticker,
      value: s.price.toFixed(2),
      detail: `${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)} (${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%)`,
      tone: s.changePercent > 0 ? "up" : s.changePercent < 0 ? "down" : "neutral",
      provenance: pkg.snapshot.provenance,
    });

    if (s.relativeVolume !== null) {
      cards.push({
        kind: "relative_volume",
        title: "Relative volume",
        value: `${s.relativeVolume.toFixed(2)}x`,
        detail: `${(s.volume / 1_000_000).toFixed(1)}M shares traded`,
        tone: s.relativeVolume >= 1.5 ? "warn" : "neutral",
        provenance: pkg.snapshot.provenance,
      });
    }

    if (s.iv !== null) {
      cards.push({
        kind: "implied_volatility",
        title: "Implied volatility",
        value: `${(s.iv * 100).toFixed(1)}%`,
        detail: s.vwap !== null ? `VWAP ${s.vwap.toFixed(2)}` : null,
        tone: "neutral",
        provenance: pkg.snapshot.provenance,
      });
    }
  }

  if (pkg.flow && pkg.ticker) {
    const agg = aggregateFlow(pkg.flow.data, pkg.ticker);
    cards.push({
      kind: "flow",
      title: "Options flow",
      value: formatPremium(agg.totalPremium),
      detail: agg.summary,
      tone: agg.lean === "bullish" ? "up" : agg.lean === "bearish" ? "down" : "neutral",
      provenance: pkg.flow.provenance,
    });
  }

  if (pkg.gex) {
    const g = pkg.gex.data;
    cards.push({
      kind: "gamma",
      title: "Net gamma",
      value: formatGamma(g.totalGamma),
      detail: [
        g.callWall !== null ? `Call wall ${g.callWall}` : null,
        g.putWall !== null ? `Put wall ${g.putWall}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      tone: g.regime === "short_gamma" ? "warn" : "neutral",
      provenance: pkg.gex.provenance,
    });
  }

  if (pkg.news && pkg.news.data.length > 0) {
    cards.push({
      kind: "news",
      title: "Recent headlines",
      value: `${pkg.news.data.length}`,
      detail: pkg.news.data[0]?.headline ?? null,
      tone: "neutral",
      provenance: pkg.news.provenance,
    });
  }

  // Position and risk cards inherit the provenance of what produced them.
  // They previously hardcoded MOCK and LIVE respectively, which was wrong in
  // both directions: the position card would keep saying MOCK after a real
  // brokerage was connected, and the risk card claimed LIVE while computing
  // over mock positions. Determinism makes arithmetic trustworthy; it does
  // not upgrade the data underneath it.
  if (pkg.position && pkg.portfolio) {
    const pos = pkg.position;
    cards.push({
      kind: "position",
      title: "Your position",
      value: `${pos.quantity > 0 ? "+" : ""}${pos.quantity} ${pos.kind === "option" ? `${pos.strike} ${pos.side}` : "shares"}`,
      detail: `${pos.unrealizedPnl >= 0 ? "+" : ""}$${Math.abs(pos.unrealizedPnl).toFixed(0)} (${pos.unrealizedPnlPercent >= 0 ? "+" : ""}${pos.unrealizedPnlPercent.toFixed(1)}%)`,
      tone: pos.unrealizedPnl >= 0 ? "up" : "down",
      provenance: pkg.portfolio.provenance,
    });
  }

  if (pkg.risk) {
    const r = pkg.risk.data;
    cards.push({
      kind: "risk",
      title: "Risk",
      value:
        r.dollarsPerPercentMove !== null
          ? `$${Math.abs(r.dollarsPerPercentMove).toFixed(0)}/1%`
          : "—",
      detail: r.warnings[0] ?? "No flags raised.",
      tone: r.concentrationFlag === "high" ? "warn" : "neutral",
      provenance: pkg.risk.provenance,
    });
  }

  return cards;
}

/** Flow events for the ticker in focus, newest first. */
export function focusedFlow(pkg: VerityContextPackage): FlowEvent[] {
  if (!pkg.flow) return [];
  const rows = pkg.ticker ? pkg.flow.data.filter((e) => e.ticker === pkg.ticker) : pkg.flow.data;
  return [...rows].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
