/**
 * flowEngine tests.
 *
 * The interpretation rule in handover §4 is the single most likely thing to
 * regress in this codebase, because "big call = bullish" is the intuitive
 * shortcut and it is wrong. These tests pin that behaviour down.
 */

import { describe, expect, it } from "vitest";
import { aggregateFlow, applyFlowFilters, matchesFilters, readEvent } from "../flowEngine";
import { EMPTY_FLOW_FILTERS, type FlowEvent, type FlowFilters } from "@/lib/schema/core";

function event(over: Partial<FlowEvent> = {}): FlowEvent {
  return {
    id: "e1",
    ticker: "NVDA",
    timestamp: "2026-09-15T14:30:00.000Z",
    strike: 185,
    expiration: "2026-09-18",
    side: "call",
    premium: 500_000,
    contracts: 500,
    volume: 2000,
    openInterest: 1000,
    volumeOiRatio: 2,
    bid: 9.8,
    ask: 10.2,
    executionSide: "ask",
    classification: "sweep",
    daysToExpiration: 3,
    expirationBucket: "weekly",
    spot: 184,
    impliedVolatility: 0.42,
    openCloseHint: "likely_opening",
    ...over,
  };
}

describe("readEvent — the §4 interpretation rule", () => {
  it("reads a call bought on the ask as bullish", () => {
    expect(readEvent(event({ side: "call", executionSide: "ask" })).lean).toBe("bullish");
  });

  it("reads a call SOLD on the bid as bearish, not bullish", () => {
    // The whole point of the rule: contract type does not set direction.
    expect(readEvent(event({ side: "call", executionSide: "bid" })).lean).toBe("bearish");
  });

  it("reads a put bought on the ask as bearish", () => {
    expect(readEvent(event({ side: "put", executionSide: "ask" })).lean).toBe("bearish");
  });

  it("reads a put SOLD on the bid as bullish", () => {
    expect(readEvent(event({ side: "put", executionSide: "bid" })).lean).toBe("bullish");
  });

  it("returns unclear for a midpoint print, with zero confidence", () => {
    const r = readEvent(event({ executionSide: "midpoint" }));
    expect(r.lean).toBe("unclear");
    expect(r.confidence).toBe(0);
  });

  it("returns unclear when the feed reported no execution side", () => {
    expect(readEvent(event({ executionSide: "unknown" })).lean).toBe("unclear");
  });

  it("never returns full confidence on a single print", () => {
    const r = readEvent(
      event({ premium: 50_000_000, classification: "sweep", volumeOiRatio: 12 }),
    );
    expect(r.confidence).toBeLessThan(1);
  });

  it("discounts a likely-closing print relative to a likely-opening one", () => {
    const opening = readEvent(event({ openCloseHint: "likely_opening" }));
    const closing = readEvent(event({ openCloseHint: "likely_closing" }));
    expect(closing.confidence).toBeLessThan(opening.confidence);
  });

  it("discounts 0DTE contracts as potential hedges", () => {
    const weekly = readEvent(event({ daysToExpiration: 7 }));
    const zeroDte = readEvent(event({ daysToExpiration: 0 }));
    expect(zeroDte.confidence).toBeLessThan(weekly.confidence);
  });

  it("always attaches at least one caveat to a directional read", () => {
    expect(readEvent(event()).caveats.length).toBeGreaterThan(0);
  });
});

describe("matchesFilters", () => {
  const base: FlowFilters = { ...EMPTY_FLOW_FILTERS };

  it("passes everything when no filter is set", () => {
    expect(matchesFilters(event(), base)).toBe(true);
  });

  it("filters by ticker, side and premium bounds", () => {
    expect(matchesFilters(event(), { ...base, tickers: ["SPY"] })).toBe(false);
    expect(matchesFilters(event(), { ...base, sides: ["put"] })).toBe(false);
    expect(matchesFilters(event({ premium: 10_000 }), { ...base, minPremium: 50_000 })).toBe(false);
    expect(matchesFilters(event({ premium: 900_000 }), { ...base, maxPremium: 100_000 })).toBe(false);
  });

  it("excludes an event with unknown volume/OI from a volume/OI floor", () => {
    // Including it would imply a ratio the data does not have.
    expect(
      matchesFilters(event({ volumeOiRatio: null }), { ...base, minVolumeOiRatio: 1 }),
    ).toBe(false);
  });

  it("filters by expiration bucket, classification and execution side", () => {
    expect(matchesFilters(event(), { ...base, buckets: ["0dte"] })).toBe(false);
    expect(matchesFilters(event(), { ...base, classifications: ["block"] })).toBe(false);
    expect(matchesFilters(event(), { ...base, executionSides: ["bid"] })).toBe(false);
  });

  it("combines filters conjunctively", () => {
    const f = { ...base, tickers: ["NVDA"], sides: ["call"] as const, minPremium: 100_000 };
    expect(matchesFilters(event(), { ...f, sides: ["call"] })).toBe(true);
    expect(matchesFilters(event({ ticker: "SPY" }), { ...f, sides: ["call"] })).toBe(false);
  });

  it("applyFlowFilters keeps only matching events", () => {
    const events = [event({ id: "a" }), event({ id: "b", ticker: "SPY" })];
    const kept = applyFlowFilters(events, { ...base, tickers: ["SPY"] });
    expect(kept.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("aggregateFlow", () => {
  it("reports unclear when there are too few prints to read", () => {
    const agg = aggregateFlow([event(), event({ id: "e2" })], "NVDA");
    expect(agg.lean).toBe("unclear");
    expect(agg.summary).toContain("too little");
  });

  it("leans bullish when initiated call buying dominates", () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      event({ id: `e${i}`, side: "call", executionSide: "ask" }),
    );
    const agg = aggregateFlow(events, "NVDA");
    expect(agg.lean).toBe("bullish");
    expect(agg.confidence).toBeGreaterThan(0);
  });

  it("stays unclear when most premium printed at the midpoint", () => {
    const events = [
      ...Array.from({ length: 8 }, (_, i) =>
        event({ id: `m${i}`, executionSide: "midpoint", premium: 1_000_000 }),
      ),
      event({ id: "a1", executionSide: "ask", premium: 50_000 }),
    ];
    const agg = aggregateFlow(events, "NVDA");
    expect(agg.lean).toBe("unclear");
    expect(agg.readableShare).toBeLessThan(0.4);
  });

  it("stays unclear when buying and selling roughly offset", () => {
    const events = [
      ...Array.from({ length: 5 }, (_, i) =>
        event({ id: `b${i}`, side: "call", executionSide: "ask" }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        event({ id: `s${i}`, side: "call", executionSide: "bid" }),
      ),
    ];
    expect(aggregateFlow(events, "NVDA").lean).toBe("unclear");
  });

  it("ignores events for other tickers", () => {
    const agg = aggregateFlow([event({ ticker: "SPY" })], "NVDA");
    expect(agg.eventCount).toBe(0);
    expect(agg.totalPremium).toBe(0);
  });

  it("splits call and put premium correctly", () => {
    const agg = aggregateFlow(
      [event({ side: "call", premium: 300 }), event({ id: "p", side: "put", premium: 700 })],
      "NVDA",
    );
    expect(agg.callPremium).toBe(300);
    expect(agg.putPremium).toBe(700);
    expect(agg.totalPremium).toBe(1000);
  });
});
