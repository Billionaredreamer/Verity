/**
 * flowEngine — filtering and interpretation of options flow.
 *
 * Handover §4 interpretation rule, quoted in full because it governs this file:
 *
 *   "Do not treat every large call as bullish or every large put as bearish.
 *    Verity should consider execution side, opening-vs-closing clues when
 *    available, volume/OI, expiration, spot movement, volatility, and
 *    surrounding flow."
 *
 * So there is no `isBullish(event)` here. What this module produces is a
 * *reading* — a directional lean with an explicit confidence and the reasons
 * behind it — and a reading may legitimately come back "unclear". That is a
 * real answer, not a missing one.
 */

import type { FlowEvent, FlowFilters, OptionSide } from "@/lib/schema/core";

// ---------------------------------------------------------------------------
// Filtering — one branch per §4 "Required filters" entry
// ---------------------------------------------------------------------------

export function matchesFilters(e: FlowEvent, f: FlowFilters): boolean {
  if (f.tickers.length > 0 && !f.tickers.includes(e.ticker)) return false;
  if (f.sides.length > 0 && !f.sides.includes(e.side)) return false;
  if (f.minPremium !== null && e.premium < f.minPremium) return false;
  if (f.maxPremium !== null && e.premium > f.maxPremium) return false;
  if (f.expirations.length > 0 && !f.expirations.includes(e.expiration)) return false;
  if (f.buckets.length > 0 && !f.buckets.includes(e.expirationBucket)) return false;
  if (f.classifications.length > 0 && !f.classifications.includes(e.classification)) return false;
  if (f.minVolumeOiRatio !== null) {
    // An event with unknown OI cannot satisfy a volume/OI floor. Excluding it
    // is the honest choice: including it would imply a ratio we do not have.
    if (e.volumeOiRatio === null || e.volumeOiRatio < f.minVolumeOiRatio) return false;
  }
  if (f.executionSides.length > 0 && !f.executionSides.includes(e.executionSide)) return false;
  return true;
}

export function applyFlowFilters(events: FlowEvent[], f: FlowFilters): FlowEvent[] {
  return events.filter((e) => matchesFilters(e, f));
}

// ---------------------------------------------------------------------------
// Interpretation
// ---------------------------------------------------------------------------

export type FlowLean = "bullish" | "bearish" | "unclear";

export interface FlowReading {
  lean: FlowLean;
  /** 0–1. Low confidence with a lean is a hint; `unclear` carries no lean. */
  confidence: number;
  /** Plain-language reasons, in descending weight. Shown in the UI verbatim. */
  reasons: string[];
  /** What would make this read wrong. */
  caveats: string[];
}

/**
 * Direction of a single print.
 *
 * The chain of reasoning: a call bought at the ask is a bullish *position* for
 * whoever bought it; a call sold at the bid is the opposite. A midpoint print
 * or an unclassified one tells us nothing directional at all, and we say so
 * rather than defaulting to the contract type.
 */
export function readEvent(e: FlowEvent): FlowReading {
  const reasons: string[] = [];
  const caveats: string[] = [];

  // Step 1: execution side determines whether the print is initiated buying
  // or selling. Without it there is no directional read to make.
  if (e.executionSide === "midpoint" || e.executionSide === "unknown") {
    return {
      lean: "unclear",
      confidence: 0,
      reasons: [
        e.executionSide === "midpoint"
          ? "Printed at the midpoint — neither side clearly initiated."
          : "Execution side was not reported by the feed.",
      ],
      caveats: [
        "Contract type alone does not establish direction; a call can be sold and a put can be bought.",
      ],
    };
  }

  const initiatedBuy = e.executionSide === "ask";
  // call bought / put sold → bullish. put bought / call sold → bearish.
  const bullish = e.side === "call" ? initiatedBuy : !initiatedBuy;
  const lean: FlowLean = bullish ? "bullish" : "bearish";

  reasons.push(
    `${e.side === "call" ? "Calls" : "Puts"} ${initiatedBuy ? "bought on the ask" : "sold on the bid"}.`,
  );

  // Step 2: weight of evidence. Start low — a single print is weak evidence.
  let confidence = 0.35;

  // Size relative to resting open interest is the strongest single clue that
  // this is new positioning rather than a close or a roll.
  if (e.openCloseHint === "likely_opening") {
    confidence += 0.18;
    reasons.push("Size exceeds resting open interest, consistent with an opening position.");
  } else if (e.openCloseHint === "likely_closing") {
    confidence -= 0.15;
    caveats.push("May be closing an existing position rather than opening a new one.");
  } else {
    caveats.push("No opening-vs-closing evidence available.");
  }

  if (e.volumeOiRatio !== null && e.volumeOiRatio > 1) {
    confidence += 0.12;
    reasons.push(`Day volume is ${e.volumeOiRatio.toFixed(1)}x open interest.`);
  }

  // Sweeps cross multiple exchanges to get filled — urgency, not just size.
  if (e.classification === "sweep") {
    confidence += 0.1;
    reasons.push("Swept across exchanges, which suggests urgency.");
  } else if (e.classification === "block") {
    reasons.push("Printed as a block, which is often negotiated and may be hedged.");
    caveats.push("Blocks are frequently one leg of a spread or a hedge against stock.");
  }

  if (e.premium >= 1_000_000) {
    confidence += 0.08;
    reasons.push(`Premium of ${formatPremium(e.premium)} is large in absolute terms.`);
  }

  // Step 3: discounts. Short-dated contracts are as often hedges or lottery
  // tickets as they are conviction.
  if (e.daysToExpiration <= 1) {
    confidence -= 0.1;
    caveats.push("0DTE contracts are frequently short-term hedges rather than directional bets.");
  }

  const otmPercent = ((e.strike - e.spot) / e.spot) * 100;
  if (Math.abs(otmPercent) > 8) {
    confidence -= 0.05;
    caveats.push(
      `Strike is ${Math.abs(otmPercent).toFixed(1)}% ${otmPercent > 0 ? "above" : "below"} spot — far out of the money.`,
    );
  }

  caveats.push("A single print is not a position; the surrounding flow matters more.");

  return {
    lean,
    confidence: clamp01(confidence),
    reasons,
    caveats,
  };
}

export interface FlowAggregate {
  ticker: string;
  totalPremium: number;
  callPremium: number;
  putPremium: number;
  /** Premium initiated on the ask, i.e. bought. */
  askSidePremium: number;
  bidSidePremium: number;
  /** Premium with no directional read available. */
  unclearPremium: number;
  eventCount: number;
  sweepCount: number;
  blockCount: number;
  /** Net directional premium: bullish-initiated minus bearish-initiated. */
  netDirectionalPremium: number;
  /** Share of total premium that yielded any directional read, 0–1. */
  readableShare: number;
  lean: FlowLean;
  confidence: number;
  summary: string;
}

/**
 * Aggregate a ticker's flow. This is where a directional read actually earns
 * its keep — one print is noise, a session's worth of one-sided initiated
 * premium is a signal.
 */
export function aggregateFlow(events: FlowEvent[], ticker: string): FlowAggregate {
  const rows = events.filter((e) => e.ticker === ticker);
  const agg: FlowAggregate = {
    ticker,
    totalPremium: 0,
    callPremium: 0,
    putPremium: 0,
    askSidePremium: 0,
    bidSidePremium: 0,
    unclearPremium: 0,
    eventCount: rows.length,
    sweepCount: 0,
    blockCount: 0,
    netDirectionalPremium: 0,
    readableShare: 0,
    lean: "unclear",
    confidence: 0,
    summary: "",
  };

  if (rows.length === 0) {
    agg.summary = `No flow recorded for ${ticker} in this window.`;
    return agg;
  }

  for (const e of rows) {
    agg.totalPremium += e.premium;
    if (e.side === "call") agg.callPremium += e.premium;
    else agg.putPremium += e.premium;
    if (e.classification === "sweep") agg.sweepCount++;
    if (e.classification === "block") agg.blockCount++;

    const reading = readEvent(e);
    if (reading.lean === "unclear") {
      agg.unclearPremium += e.premium;
      continue;
    }
    if (e.executionSide === "ask") agg.askSidePremium += e.premium;
    if (e.executionSide === "bid") agg.bidSidePremium += e.premium;
    // Weight each print's contribution by the confidence of its own read.
    const signed = reading.lean === "bullish" ? 1 : -1;
    agg.netDirectionalPremium += signed * e.premium * reading.confidence;
  }

  const readablePremium = agg.totalPremium - agg.unclearPremium;
  agg.readableShare = agg.totalPremium > 0 ? readablePremium / agg.totalPremium : 0;

  // Conviction is the net directional premium as a share of what was readable.
  const tilt = readablePremium > 0 ? agg.netDirectionalPremium / readablePremium : 0;
  const absTilt = Math.abs(tilt);

  if (absTilt < 0.12 || agg.readableShare < 0.4 || rows.length < 4) {
    agg.lean = "unclear";
    agg.confidence = 0;
    agg.summary =
      rows.length < 4
        ? `Only ${rows.length} print${rows.length === 1 ? "" : "s"} for ${ticker} — too little to read.`
        : agg.readableShare < 0.4
          ? `Most ${ticker} premium printed at the midpoint or without a reported side, so direction is unclear.`
          : `${ticker} flow is roughly two-sided — no clear directional tilt.`;
    return agg;
  }

  agg.lean = tilt > 0 ? "bullish" : "bearish";
  // Scale conviction by how much of the tape we could actually read.
  agg.confidence = clamp01(absTilt * agg.readableShare * 1.3);
  agg.summary =
    `${formatPremium(readablePremium)} of readable ${ticker} premium leans ` +
    `${agg.lean} (${Math.round(absTilt * 100)}% net tilt` +
    (agg.readableShare < 0.8
      ? `, though ${Math.round((1 - agg.readableShare) * 100)}% of premium was unreadable).`
      : ").");

  return agg;
}

/** Aggregate every ticker present in the feed, busiest first. */
export function aggregateAll(events: FlowEvent[]): FlowAggregate[] {
  const tickers = [...new Set(events.map((e) => e.ticker))];
  return tickers
    .map((t) => aggregateFlow(events, t))
    .sort((a, b) => b.totalPremium - a.totalPremium);
}

/**
 * "Unusual" means large relative to the ticker's own norm, not large in
 * absolute dollars — a $400k print is routine in SPY and extraordinary in CAT.
 */
export function unusualScore(e: FlowEvent, peers: FlowEvent[]): number {
  const same = peers.filter((p) => p.ticker === e.ticker);
  if (same.length < 5) return 0;
  const premiums = same.map((p) => p.premium).sort((a, b) => a - b);
  const median = premiums[Math.floor(premiums.length / 2)] ?? 1;
  const ratio = e.premium / Math.max(1, median);
  const oiBoost = e.volumeOiRatio !== null && e.volumeOiRatio > 1.5 ? 1.25 : 1;
  const sweepBoost = e.classification === "sweep" ? 1.15 : 1;
  return Math.min(10, Math.log2(Math.max(1, ratio)) * 2 * oiBoost * sweepBoost);
}

export function sidesOf(events: FlowEvent[], side: OptionSide): FlowEvent[] {
  return events.filter((e) => e.side === side);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function formatPremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
