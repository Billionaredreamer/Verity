/**
 * signalEngine — explainable setups.
 *
 * Handover §6: "Signals should surface explainable setups, not simplistic
 * buy/sell commands. The signal engine should combine multiple dimensions and
 * always show why the setup was surfaced." Every Signal therefore carries
 * factor scores, evidence, risks, and invalidation conditions — a setup that
 * cannot say what would falsify it is not emitted.
 */

import type {
  FlowEvent,
  GexSnapshot,
  Signal,
  SignalFactor,
  TickerSnapshot,
} from "@/lib/schema/core";
import { aggregateFlow, formatPremium } from "./flowEngine";

export interface SignalInput {
  snapshot: TickerSnapshot;
  flow: FlowEvent[];
  gex: GexSnapshot | null;
  /** Average change across the major indexes, for context scoring. */
  marketChangePercent: number | null;
  /** The ticker's sector performance on the day, when known. */
  sectorChangePercent: number | null;
  hasEarningsSoon: boolean;
  headlineCount: number;
}

/** Scores run 0–10 per the §6 example ("Flow 8/10"). 5 is neutral. */
const NEUTRAL = 5;

export function buildSignal(input: SignalInput): Signal | null {
  const { snapshot: s } = input;
  const factors: SignalFactor[] = [];

  // --- Flow ----------------------------------------------------------------
  const flowAgg = aggregateFlow(input.flow, s.ticker);
  let flowScore = NEUTRAL;
  if (flowAgg.lean === "bullish") flowScore = NEUTRAL + flowAgg.confidence * 5;
  else if (flowAgg.lean === "bearish") flowScore = NEUTRAL - flowAgg.confidence * 5;
  factors.push({
    key: "flow",
    label: "Options flow",
    score: round1(clamp(flowScore, 0, 10)),
    detail: flowAgg.summary,
  });

  // --- Relative volume -----------------------------------------------------
  const rv = s.relativeVolume;
  factors.push({
    key: "relative_volume",
    label: "Relative volume",
    // Relative volume is non-directional: it scores participation, not side.
    score: rv === null ? NEUTRAL : round1(clamp(NEUTRAL + (rv - 1) * 3.2, 0, 10)),
    detail:
      rv === null
        ? "Relative volume unavailable."
        : rv >= 1.5
          ? `Trading at ${rv.toFixed(2)}x average volume — unusually active.`
          : rv <= 0.7
            ? `Trading at ${rv.toFixed(2)}x average volume — participation is light.`
            : `Trading at ${rv.toFixed(2)}x average volume — normal participation.`,
  });

  // --- Momentum ------------------------------------------------------------
  factors.push({
    key: "momentum",
    label: "Momentum",
    score: round1(clamp(NEUTRAL + s.changePercent * 1.6, 0, 10)),
    detail: `${s.changePercent >= 0 ? "Up" : "Down"} ${Math.abs(s.changePercent).toFixed(2)}% on the session.`,
  });

  // --- VWAP ----------------------------------------------------------------
  if (s.vwap !== null) {
    const vwapGap = ((s.price - s.vwap) / s.vwap) * 100;
    factors.push({
      key: "vwap",
      label: "VWAP",
      score: round1(clamp(NEUTRAL + vwapGap * 2.4, 0, 10)),
      detail: `Price is ${Math.abs(vwapGap).toFixed(2)}% ${vwapGap >= 0 ? "above" : "below"} VWAP (${s.vwap.toFixed(2)}).`,
    });
  }

  // --- Price structure -----------------------------------------------------
  if (s.high !== null && s.low !== null && s.high > s.low) {
    // Position within the day's range: closing near the high is strength.
    const position = (s.price - s.low) / (s.high - s.low);
    factors.push({
      key: "price_structure",
      label: "Range position",
      score: round1(clamp(position * 10, 0, 10)),
      detail: `Trading in the ${describeRangePosition(position)} of the day's range.`,
    });
  }

  // --- Gamma ---------------------------------------------------------------
  if (input.gex) {
    factors.push(gammaFactor(input.gex, s.price));
  }

  // --- Volatility ----------------------------------------------------------
  if (s.iv !== null) {
    factors.push({
      key: "volatility",
      label: "Implied volatility",
      // Non-directional: high IV raises the stakes either way.
      score: round1(clamp(NEUTRAL + (s.iv - 0.3) * 8, 0, 10)),
      detail: `Implied volatility at ${(s.iv * 100).toFixed(1)}%.`,
    });
  }

  // --- Sector / index context ---------------------------------------------
  if (input.marketChangePercent !== null) {
    const relative = s.changePercent - input.marketChangePercent;
    factors.push({
      key: "sector_context",
      label: "Relative strength",
      score: round1(clamp(NEUTRAL + relative * 1.8, 0, 10)),
      detail: `${relative >= 0 ? "Outperforming" : "Underperforming"} the broad market by ${Math.abs(relative).toFixed(2)}pp.`,
    });
  }

  // --- News / earnings -----------------------------------------------------
  if (input.headlineCount > 0) {
    factors.push({
      key: "news",
      label: "News",
      score: NEUTRAL,
      detail: `${input.headlineCount} recent headline${input.headlineCount === 1 ? "" : "s"} — read before acting on the setup.`,
    });
  }
  if (input.hasEarningsSoon) {
    factors.push({
      key: "earnings",
      label: "Earnings",
      score: NEUTRAL,
      detail: "Earnings are scheduled soon — a technical setup can be overridden by the print.",
    });
  }

  // --- Direction and confidence -------------------------------------------
  // Only directional factors vote. Volume, IV, news and earnings describe the
  // environment; letting them push direction would be a category error.
  const directionalKeys = new Set(["flow", "momentum", "vwap", "price_structure", "sector_context", "gamma"]);
  const directional = factors.filter((f) => directionalKeys.has(f.key));
  if (directional.length < 3) return null;

  const avg = directional.reduce((sum, f) => sum + f.score, 0) / directional.length;
  const tilt = avg - NEUTRAL;

  // Agreement matters as much as average: five factors mildly aligned beats
  // one extreme factor dragging four neutral ones.
  const agreeing = directional.filter((f) => Math.sign(f.score - NEUTRAL) === Math.sign(tilt) && f.score !== NEUTRAL);
  const agreement = agreeing.length / directional.length;

  const direction: Signal["direction"] =
    Math.abs(tilt) < 0.9 || agreement < 0.5 ? "neutral" : tilt > 0 ? "bullish" : "bearish";

  // No setup below the bar — §6 wants surfaced setups to mean something.
  if (direction === "neutral") return null;

  const confidence = round2(clamp((Math.abs(tilt) / 5) * agreement * 1.15, 0, 0.9));
  if (confidence < 0.35) return null;

  const supporting = agreeing
    .sort((a, b) => Math.abs(b.score - NEUTRAL) - Math.abs(a.score - NEUTRAL))
    .slice(0, 4)
    .map((f) => f.detail);

  const risks = buildRisks(input, factors, direction);
  const invalidation = buildInvalidation(input, direction);

  return {
    id: `sig-${s.ticker}-${Date.parse(s.timestamp)}`,
    ticker: s.ticker,
    direction,
    factors,
    confidence,
    whyNoticed: buildWhyNoticed(s.ticker, direction, agreeing, flowAgg.totalPremium),
    supportingEvidence: supporting,
    risks,
    invalidationConditions: invalidation,
    createdAt: new Date().toISOString(),
  };
}

function gammaFactor(gex: GexSnapshot, price: number): SignalFactor {
  // Proximity to a wall is the directional content here: price pinned under a
  // call wall behaves differently from price breaking through it.
  let score = NEUTRAL;
  const notes: string[] = [];

  if (gex.callWall !== null) {
    const gap = ((gex.callWall - price) / price) * 100;
    if (gap > 0 && gap < 1) {
      score -= 1.2;
      notes.push(`Call wall at ${gex.callWall} is ${gap.toFixed(2)}% overhead and may cap upside.`);
    } else if (gap < 0 && gap > -1) {
      score += 1.5;
      notes.push(`Price has cleared the call wall at ${gex.callWall}.`);
    }
  }
  if (gex.putWall !== null) {
    const gap = ((price - gex.putWall) / price) * 100;
    if (gap > 0 && gap < 1) {
      score += 1.2;
      notes.push(`Put wall at ${gex.putWall} is ${gap.toFixed(2)}% below and may act as support.`);
    } else if (gap < 0) {
      score -= 1.5;
      notes.push(`Price has broken below the put wall at ${gex.putWall}.`);
    }
  }
  if (gex.regime === "short_gamma") {
    notes.push("Dealers are modeled short gamma, which tends to amplify moves in either direction.");
  }
  if (notes.length === 0) {
    notes.push("Price is not near a major gamma level.");
  }

  return {
    key: "gamma",
    label: "Gamma positioning",
    score: round1(clamp(score, 0, 10)),
    detail: notes.join(" "),
  };
}

function buildWhyNoticed(
  ticker: string,
  direction: Signal["direction"],
  agreeing: SignalFactor[],
  totalPremium: number,
): string {
  const names = agreeing
    .sort((a, b) => Math.abs(b.score - NEUTRAL) - Math.abs(a.score - NEUTRAL))
    .slice(0, 3)
    .map((f) => f.label.toLowerCase());
  const premiumNote = totalPremium > 0 ? ` alongside ${formatPremium(totalPremium)} in options premium` : "";
  return `${ticker} was surfaced because ${joinList(names)} are aligned ${direction}${premiumNote}.`;
}

function buildRisks(
  input: SignalInput,
  factors: SignalFactor[],
  direction: Signal["direction"],
): string[] {
  const risks: string[] = [];

  if (input.hasEarningsSoon) {
    risks.push("Earnings are scheduled soon and can override the setup entirely.");
  }
  if (input.snapshot.relativeVolume !== null && input.snapshot.relativeVolume < 0.8) {
    risks.push("Participation is below average, so the move may not hold.");
  }
  if (input.gex?.regime === "short_gamma") {
    risks.push("Modeled short dealer gamma can accelerate a move against the position as readily as with it.");
  }
  if (input.snapshot.iv !== null && input.snapshot.iv > 0.5) {
    risks.push(`Implied volatility at ${(input.snapshot.iv * 100).toFixed(0)}% makes options expensive and decay fast.`);
  }

  const disagreeing = factors.filter(
    (f) =>
      f.score !== NEUTRAL &&
      Math.sign(f.score - NEUTRAL) !== (direction === "bullish" ? 1 : -1) &&
      ["flow", "momentum", "vwap", "price_structure", "gamma", "sector_context"].includes(f.key),
  );
  for (const f of disagreeing.slice(0, 2)) {
    risks.push(`${f.label} disagrees with the setup: ${f.detail}`);
  }

  if (input.headlineCount > 0) {
    risks.push("Recent headlines may explain the move for reasons the factors do not capture.");
  }

  if (risks.length === 0) {
    risks.push("No specific contradicting factor was identified, which is not the same as low risk.");
  }
  return risks;
}

function buildInvalidation(input: SignalInput, direction: Signal["direction"]): string[] {
  const out: string[] = [];
  const s = input.snapshot;

  if (s.vwap !== null) {
    out.push(
      direction === "bullish"
        ? `Loses VWAP at ${s.vwap.toFixed(2)}.`
        : `Reclaims VWAP at ${s.vwap.toFixed(2)}.`,
    );
  }
  if (direction === "bullish" && s.low !== null) {
    out.push(`Breaks the session low at ${s.low.toFixed(2)}.`);
  }
  if (direction === "bearish" && s.high !== null) {
    out.push(`Breaks the session high at ${s.high.toFixed(2)}.`);
  }
  if (input.gex) {
    const level = direction === "bullish" ? input.gex.putWall : input.gex.callWall;
    if (level !== null) {
      out.push(
        direction === "bullish"
          ? `Closes below the put wall at ${level}.`
          : `Closes above the call wall at ${level}.`,
      );
    }
  }
  out.push(
    direction === "bullish"
      ? "Opposing put flow arrives on the ask in size."
      : "Opposing call flow arrives on the ask in size.",
  );
  return out;
}

function describeRangePosition(p: number): string {
  if (p >= 0.8) return "top fifth";
  if (p >= 0.6) return "upper third";
  if (p <= 0.2) return "bottom fifth";
  if (p <= 0.4) return "lower third";
  return "middle";
}

function joinList(items: string[]): string {
  if (items.length === 0) return "several factors";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
