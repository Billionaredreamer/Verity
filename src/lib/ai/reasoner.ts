/**
 * The AI reasoning layer (handover §8, step 5).
 *
 * Two implementations behind one interface:
 *
 *   ModelReasoner       — calls a language model with the context package.
 *   DeterministicReasoner — composes an answer from the package directly.
 *
 * The deterministic one is not a fake AI and is not presented as one. It is a
 * real, useful fallback: every sentence it produces is generated from a value
 * in the package, so it is trivially grounded. When it answers, the UI labels
 * the response "Deterministic (no model configured)" — §12 forbids building
 * fake functionality to complete the UI, and an LLM-shaped mock that invented
 * plausible market commentary would be exactly that, and dangerous besides.
 *
 * Both paths return the same shape, with facts, analysis and uncertainty kept
 * separate per §2: "Clearly distinguish data, analysis, and uncertainty."
 */

import "server-only";

import type { VerityContextPackage } from "@/lib/schema/core";
import { aggregateFlow, formatPremium } from "@/lib/engines/flowEngine";
import { describeGex, formatGamma, GEX_ASSUMPTION } from "@/lib/engines/gammaEngine";
import { REGIME_LABELS } from "@/lib/engines/marketRegimeEngine";
import { sessionState } from "@/lib/util/dates";

export interface ReasonedAnswer {
  text: string;
  facts: string[];
  analysis: string[];
  uncertainty: string[];
  /** Which reasoner produced this, surfaced in the UI. */
  engine: "model" | "deterministic";
  engineLabel: string;
}

export interface Reasoner {
  readonly kind: "model" | "deterministic";
  readonly label: string;
  answer(pkg: VerityContextPackage): Promise<ReasonedAnswer>;
}

/**
 * The instruction given to a language model. Written as the product's own
 * boundary, not as a suggestion: §10 positions Verity as analysis software,
 * not an adviser, and §2 forbids overconfidence and unsupported prediction.
 */
export const SYSTEM_PROMPT = `You are Verity, a market analyst working beside an active trader during the session.

You will be given a structured context package containing verified market data. That package is your ONLY source of market facts. You must not state any price, level, figure, or event that is not present in it.

Rules:
- Fact first, interpretation second. Say what the data shows before what you think it means.
- Separate what is measured from what is inferred. Never blur the two.
- If the package is missing something the question needs, say so plainly. Do not fill the gap.
- Every value in the package carries a data state. If a value is MOCK or DELAYED, say so when you use it.
- Do not predict prices. Do not express certainty the data does not support.
- Do not tell the trader what to do. Describe conditions and risks; the decision is theirs.
- Be concise. The trader is reading this mid-session.
- Gamma exposure figures rest on an assumption about dealer positioning that is modeled, not measured. Say so when you cite them.

Respond in JSON: {"text": string, "facts": string[], "analysis": string[], "uncertainty": string[]}`;

// ---------------------------------------------------------------------------
// Deterministic reasoner
// ---------------------------------------------------------------------------

export class DeterministicReasoner implements Reasoner {
  readonly kind = "deterministic" as const;
  readonly label = "Deterministic (no model configured)";

  async answer(pkg: VerityContextPackage): Promise<ReasonedAnswer> {
    const facts: string[] = [];
    const analysis: string[] = [];
    const uncertainty: string[] = [];

    const session = sessionState();
    if (session !== "open") {
      uncertainty.push(
        `The regular session is ${session === "closed" ? "closed" : session}; values reflect the most recent available data.`,
      );
    }

    if (pkg.snapshot) {
      const s = pkg.snapshot.data;
      facts.push(
        `${s.ticker} is at ${s.price.toFixed(2)}, ${s.change >= 0 ? "up" : "down"} ${Math.abs(s.change).toFixed(2)} (${s.changePercent.toFixed(2)}%) on the session.`,
      );
      if (s.relativeVolume !== null) {
        facts.push(`Volume is running at ${s.relativeVolume.toFixed(2)}x the average.`);
        if (s.relativeVolume >= 1.5) {
          analysis.push("Participation is well above normal, so the move has real volume behind it.");
        } else if (s.relativeVolume <= 0.7) {
          analysis.push("Participation is light, which makes the move less reliable.");
        }
      }
      if (s.vwap !== null) {
        const side = s.price >= s.vwap ? "above" : "below";
        facts.push(`Price is ${side} VWAP at ${s.vwap.toFixed(2)}.`);
      }
      if (s.iv !== null) {
        facts.push(`Implied volatility is ${(s.iv * 100).toFixed(1)}%.`);
      }
      if (pkg.snapshot.provenance.state !== "LIVE") {
        uncertainty.push(`Quote data is ${pkg.snapshot.provenance.state}, not live.`);
      }
    }

    if (pkg.indexes) {
      const equity = pkg.indexes.data.filter((i) => i.symbol !== "VIX");
      if (equity.length > 0) {
        facts.push(
          `Indexes: ${equity.map((i) => `${i.symbol} ${i.changePercent >= 0 ? "+" : ""}${i.changePercent.toFixed(2)}%`).join(", ")}.`,
        );
      }
      const vix = pkg.indexes.data.find((i) => i.symbol === "VIX");
      if (vix) {
        facts.push(`VIX is at ${vix.price.toFixed(2)}, ${vix.changePercent >= 0 ? "+" : ""}${vix.changePercent.toFixed(1)}%.`);
      }
    }

    if (pkg.regime) {
      const r = pkg.regime.data;
      analysis.push(
        `Market regime reads ${REGIME_LABELS[r.regime].toLowerCase()} (confidence ${(r.confidence * 100).toFixed(0)}%).`,
      );
      for (const d of r.drivers.slice(0, 3)) analysis.push(d);
      if (r.confidence < 0.4) {
        uncertainty.push("Regime confidence is low — the inputs do not strongly agree.");
      }
    }

    if (pkg.flow && pkg.ticker) {
      const agg = aggregateFlow(pkg.flow.data, pkg.ticker);
      if (agg.eventCount > 0) {
        facts.push(
          `${agg.eventCount} flow prints totaling ${formatPremium(agg.totalPremium)} (${formatPremium(agg.callPremium)} calls, ${formatPremium(agg.putPremium)} puts).`,
        );
        analysis.push(agg.summary);
        if (agg.readableShare < 0.7) {
          uncertainty.push(
            `${Math.round((1 - agg.readableShare) * 100)}% of premium printed at the midpoint or without a reported side, so its direction is unknown.`,
          );
        }
      } else {
        uncertainty.push(`No options flow was retrieved for ${pkg.ticker} in this window.`);
      }
    }

    if (pkg.gex) {
      const g = pkg.gex.data;
      facts.push(`Net dealer gamma is ${formatGamma(g.totalGamma)} per 1% move.`);
      for (const line of describeGex(g)) analysis.push(line);
      uncertainty.push(GEX_ASSUMPTION);
    }

    if (pkg.news && pkg.news.data.length > 0) {
      facts.push(`${pkg.news.data.length} recent headlines, most recent: "${pkg.news.data[0]!.headline}".`);
      if (pkg.news.provenance.state === "MOCK") {
        uncertainty.push("Headlines are mock fixtures, not real news.");
      }
    }

    if (pkg.events && pkg.events.data.length > 0) {
      const next = pkg.events.data[0]!;
      facts.push(
        `Next scheduled catalyst: ${next.title} on ${next.scheduledFor.slice(0, 10)}.`,
      );
    }

    if (pkg.position) {
      const p = pkg.position;
      facts.push(
        `You hold ${p.quantity > 0 ? "+" : ""}${p.quantity} ${p.kind === "option" ? `${p.ticker} ${p.strike} ${p.side} expiring ${p.expiration}` : `${p.ticker} shares`}, ` +
          `marked at ${p.markPrice.toFixed(2)} against an entry of ${p.entryPrice.toFixed(2)} (${p.unrealizedPnl >= 0 ? "+" : ""}$${p.unrealizedPnl.toFixed(0)}).`,
      );
    }

    if (pkg.risk) {
      for (const w of pkg.risk.warnings.slice(0, 3)) analysis.push(w);
    }

    // Report what could not be retrieved, so a gap is visible rather than silent.
    const failed = pkg.retrievalLog.filter((r) => r.state === "UNAVAILABLE");
    for (const f of failed) {
      uncertainty.push(`Could not retrieve ${f.key}${f.note ? `: ${f.note}` : "."}`);
    }

    if (facts.length === 0) {
      facts.push("No market data was retrieved for this question.");
      uncertainty.push(
        "Try naming a ticker, for example \"What are you seeing in SPY?\"",
      );
    }

    const mockKeys = pkg.retrievalLog.filter((r) => r.state === "MOCK").map((r) => r.key);
    if (mockKeys.length > 0) {
      uncertainty.push(
        `The following are mock fixtures, not real market data: ${mockKeys.join(", ")}.`,
      );
    }

    return {
      text: [...facts, ...analysis].join(" "),
      facts,
      analysis,
      uncertainty,
      engine: "deterministic",
      engineLabel: this.label,
    };
  }
}

// ---------------------------------------------------------------------------
// Model reasoner
// ---------------------------------------------------------------------------

/**
 * Calls a language model with the context package. Deliberately thin: the
 * model receives structured JSON and returns structured JSON, and has no tool
 * access to market endpoints of its own (§8 architecture rule).
 */
export class ModelReasoner implements Reasoner {
  readonly kind = "model" as const;
  readonly label = "Verity AI";

  constructor(
    private readonly apiKey: string,
    private readonly model = "claude-sonnet-4-5",
    private readonly fallback: Reasoner = new DeterministicReasoner(),
  ) {}

  async answer(pkg: VerityContextPackage): Promise<ReasonedAnswer> {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Question: ${pkg.question}\n\nContext package:\n${JSON.stringify(pkg, null, 2)}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) throw new Error(`model returned ${res.status}`);

      const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const raw = body.content?.find((c) => c.type === "text")?.text ?? "";
      const parsed = extractJson(raw);
      if (!parsed) throw new Error("model response was not parseable JSON");

      return {
        text: String(parsed.text ?? ""),
        facts: toStringArray(parsed.facts),
        analysis: toStringArray(parsed.analysis),
        uncertainty: toStringArray(parsed.uncertainty),
        engine: "model",
        engineLabel: this.label,
      };
    } catch (err) {
      // §10: handle failures explicitly. Falling back to deterministic output
      // is safe because that output is grounded by construction — and the UI
      // shows which engine answered, so the degradation is visible.
      const fallbackAnswer = await this.fallback.answer(pkg);
      fallbackAnswer.uncertainty.unshift(
        `The language model was unavailable (${err instanceof Error ? err.message : "unknown error"}); this answer was composed directly from the retrieved data.`,
      );
      return fallbackAnswer;
    }
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

let cachedReasoner: Reasoner | null = null;

export function reasoner(): Reasoner {
  if (cachedReasoner) return cachedReasoner;
  const key = process.env.ANTHROPIC_API_KEY;
  cachedReasoner = key ? new ModelReasoner(key) : new DeterministicReasoner();
  return cachedReasoner;
}
