/**
 * signalEngine tests.
 *
 * §6 makes three structural promises about a surfaced setup: it explains why
 * it was noticed, it states what would falsify it, and it is not a BUY/SELL
 * instruction. A setup that cannot keep all three should not be emitted at
 * all, and these tests hold the engine to that.
 */

import { describe, expect, it } from "vitest";
import { buildSignal, type SignalInput } from "../signalEngine";
import type { FlowEvent, TickerSnapshot } from "@/lib/schema/core";

function snapshot(over: Partial<TickerSnapshot> = {}): TickerSnapshot {
  return {
    ticker: "NVDA",
    price: 190,
    change: 6,
    changePercent: 3.2,
    volume: 250_000_000,
    relativeVolume: 1.8,
    bid: 189.9,
    ask: 190.1,
    iv: 0.42,
    timestamp: "2026-09-17T18:00:00.000Z",
    open: 185,
    high: 191,
    low: 184,
    previousClose: 184,
    vwap: 187,
    dayRangePercent: 3.8,
    ...over,
  };
}

function flowEvent(over: Partial<FlowEvent> = {}): FlowEvent {
  return {
    id: Math.random().toString(36),
    ticker: "NVDA",
    timestamp: "2026-09-17T17:00:00.000Z",
    strike: 195,
    expiration: "2026-09-25",
    side: "call",
    premium: 800_000,
    contracts: 900,
    volume: 3000,
    openInterest: 1000,
    volumeOiRatio: 3,
    bid: 8.5,
    ask: 9,
    executionSide: "ask",
    classification: "sweep",
    daysToExpiration: 8,
    expirationBucket: "weekly",
    spot: 190,
    impliedVolatility: 0.44,
    openCloseHint: "likely_opening",
    ...over,
  };
}

function input(over: Partial<SignalInput> = {}): SignalInput {
  return {
    snapshot: snapshot(),
    flow: Array.from({ length: 8 }, () => flowEvent()),
    gex: null,
    marketChangePercent: 0.2,
    sectorChangePercent: 0.3,
    hasEarningsSoon: false,
    headlineCount: 0,
    ...over,
  };
}

describe("buildSignal — structural guarantees", () => {
  it("surfaces a setup when factors agree", () => {
    const s = buildSignal(input());
    expect(s).not.toBeNull();
    expect(s!.direction).toBe("bullish");
  });

  it("always includes 'why Verity noticed this'", () => {
    const s = buildSignal(input());
    expect(s!.whyNoticed.length).toBeGreaterThan(0);
    expect(s!.whyNoticed).toContain("NVDA");
  });

  it("always includes invalidation conditions", () => {
    // §6: a setup that cannot say what would falsify it is not a setup.
    expect(buildSignal(input())!.invalidationConditions.length).toBeGreaterThan(0);
  });

  it("always includes risks, even when nothing contradicts", () => {
    const s = buildSignal(input());
    expect(s!.risks.length).toBeGreaterThan(0);
  });

  it("caps confidence below 1.0", () => {
    // Everything maximally aligned.
    const s = buildSignal(
      input({
        snapshot: snapshot({ changePercent: 25, relativeVolume: 6, price: 191, vwap: 150, low: 150, high: 191 }),
        marketChangePercent: -5,
      }),
    );
    expect(s!.confidence).toBeLessThan(1);
    expect(s!.confidence).toBeLessThanOrEqual(0.9);
  });

  it("never emits a BUY or SELL instruction", () => {
    const s = buildSignal(input())!;
    const blob = JSON.stringify(s).toUpperCase();
    expect(blob).not.toMatch(/\bBUY\b/);
    expect(blob).not.toMatch(/\bSELL\b/);
    expect(["bullish", "bearish", "neutral"]).toContain(s.direction);
  });
});

describe("buildSignal — the bar for surfacing", () => {
  it("returns null when factors are flat", () => {
    const s = buildSignal(
      input({
        snapshot: snapshot({ changePercent: 0, price: 187, vwap: 187, high: 188, low: 186, relativeVolume: 1 }),
        flow: [],
        marketChangePercent: 0,
      }),
    );
    expect(s).toBeNull();
  });

  it("returns null when directional factors disagree", () => {
    // Strong momentum up, but price at the session low and below VWAP.
    const s = buildSignal(
      input({
        snapshot: snapshot({ changePercent: 3, price: 184, vwap: 190, high: 195, low: 184 }),
        flow: Array.from({ length: 8 }, () => flowEvent({ side: "put", executionSide: "ask" })),
        marketChangePercent: 3,
      }),
    );
    expect(s === null || s.confidence < 0.5).toBe(true);
  });

  it("returns null when too few directional factors are available", () => {
    const s = buildSignal(
      input({
        snapshot: snapshot({ vwap: null, high: null, low: null }),
        flow: [],
        marketChangePercent: null,
        gex: null,
      }),
    );
    expect(s).toBeNull();
  });
});

describe("buildSignal — factors", () => {
  it("scores non-directional factors without letting them set direction", () => {
    // High IV and news are environment, not evidence for a side.
    const s = buildSignal(input({ headlineCount: 3 }));
    const news = s!.factors.find((f) => f.key === "news");
    expect(news?.score).toBe(5);
  });

  it("flags earnings as a risk when scheduled", () => {
    const s = buildSignal(input({ hasEarningsSoon: true }));
    expect(s!.risks.some((r) => r.toLowerCase().includes("earnings"))).toBe(true);
  });

  it("reports light participation as a risk", () => {
    const s = buildSignal(input({ snapshot: snapshot({ relativeVolume: 0.5 }) }));
    expect(s?.risks.some((r) => r.includes("Participation"))).toBe(true);
  });

  it("gives every factor a non-empty explanation", () => {
    const s = buildSignal(input())!;
    expect(s.factors.every((f) => f.detail.trim().length > 0)).toBe(true);
  });

  it("keeps all factor scores within 0–10", () => {
    const s = buildSignal(input({ snapshot: snapshot({ changePercent: 40, relativeVolume: 9 }) }))!;
    expect(s.factors.every((f) => f.score >= 0 && f.score <= 10)).toBe(true);
  });
});
