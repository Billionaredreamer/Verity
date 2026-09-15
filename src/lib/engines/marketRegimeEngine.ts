/**
 * marketRegimeEngine — deterministic regime classification.
 *
 * Handover §6 (Markets) and §8 (analytics modules). The output feeds the
 * context engine so the model can describe the tape without inventing a
 * characterization of it.
 */

import type {
  IndexQuote,
  MarketBreadth,
  MarketRegime,
  MarketRegimeAssessment,
} from "@/lib/schema/core";

export interface RegimeInput {
  indexes: IndexQuote[];
  breadth: MarketBreadth | null;
  /** VIX change on the day, in percent. */
  vixChangePercent: number | null;
  vixLevel: number | null;
}

/**
 * Classification is a scored vote rather than a decision tree, so a single
 * noisy input cannot flip the label on its own. Every contributing input is
 * recorded in `drivers` — §6 requires setups to explain themselves, and the
 * regime label is the broadest such claim the product makes.
 */
export function assessRegime(input: RegimeInput): MarketRegimeAssessment {
  const drivers: string[] = [];
  let riskScore = 0;
  let volScore = 0;
  let evidence = 0;

  const equityIndexes = input.indexes.filter((i) => i.symbol !== "VIX");
  if (equityIndexes.length > 0) {
    const avg =
      equityIndexes.reduce((s, i) => s + i.changePercent, 0) / equityIndexes.length;
    evidence++;
    if (Math.abs(avg) >= 0.15) {
      riskScore += avg > 0 ? 1 : -1;
      drivers.push(
        `Major indexes average ${avg > 0 ? "+" : ""}${avg.toFixed(2)}% on the day.`,
      );
    } else {
      drivers.push("Major indexes are close to unchanged.");
    }

    // Dispersion between indexes says whether the move is broad or narrow.
    const spread =
      Math.max(...equityIndexes.map((i) => i.changePercent)) -
      Math.min(...equityIndexes.map((i) => i.changePercent));
    if (spread > 1.2) {
      drivers.push(
        `Index performance is dispersed (${spread.toFixed(2)}pp between best and worst), so the move is not broad-based.`,
      );
      // Narrow moves are weaker evidence for a risk regime.
      riskScore *= 0.6;
    }
  }

  if (input.vixChangePercent !== null) {
    evidence++;
    if (input.vixChangePercent >= 7) {
      volScore += 1;
      riskScore -= 0.6;
      drivers.push(`VIX is up ${input.vixChangePercent.toFixed(1)}% — volatility is being bid.`);
    } else if (input.vixChangePercent <= -6) {
      volScore -= 1;
      riskScore += 0.4;
      drivers.push(`VIX is down ${Math.abs(input.vixChangePercent).toFixed(1)}% — volatility is being sold.`);
    }
  }

  if (input.vixLevel !== null) {
    if (input.vixLevel >= 25) {
      volScore += 1;
      drivers.push(`VIX at ${input.vixLevel.toFixed(1)} is in an elevated absolute range.`);
    } else if (input.vixLevel <= 13) {
      volScore -= 0.5;
      drivers.push(`VIX at ${input.vixLevel.toFixed(1)} is in a compressed absolute range.`);
    }
  }

  const b = input.breadth;
  if (b && b.advancers !== null && b.decliners !== null) {
    const total = b.advancers + b.decliners;
    if (total > 0) {
      evidence++;
      const advShare = b.advancers / total;
      if (advShare >= 0.62) {
        riskScore += 0.8;
        drivers.push(`Breadth is positive — ${Math.round(advShare * 100)}% of constituents advancing.`);
      } else if (advShare <= 0.38) {
        riskScore -= 0.8;
        drivers.push(`Breadth is negative — ${Math.round((1 - advShare) * 100)}% of constituents declining.`);
      } else {
        drivers.push("Breadth is mixed.");
      }
    }
  }

  // Volatility regime takes precedence: a sharp vol expansion is the more
  // consequential description of the tape even when direction is unclear.
  let regime: MarketRegime;
  if (volScore >= 1.5) regime = "volatility_expansion";
  else if (volScore <= -1) regime = "volatility_compression";
  else if (riskScore >= 1.2) regime = "risk_on";
  else if (riskScore <= -1.2) regime = "risk_off";
  else regime = "neutral";

  // Confidence reflects how much agreeing evidence there was, and is capped
  // well below 1 — a regime label is an interpretation, not a fact.
  const strength = Math.min(1, Math.max(Math.abs(riskScore), Math.abs(volScore)) / 2.2);
  const coverage = evidence / 3;
  const confidence = Math.round(Math.min(0.85, strength * coverage * 1.2) * 100) / 100;

  if (evidence < 2) {
    drivers.push("Limited inputs available — treat this classification as provisional.");
  }

  return { regime, confidence, drivers };
}

export const REGIME_LABELS: Record<MarketRegime, string> = {
  risk_on: "Risk-on",
  risk_off: "Risk-off",
  neutral: "Neutral",
  volatility_expansion: "Volatility expansion",
  volatility_compression: "Volatility compression",
};
