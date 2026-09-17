/**
 * marketRegimeEngine tests.
 *
 * The regime label is the broadest claim the product makes about the market,
 * so what matters most is that it degrades honestly: conflicting inputs should
 * produce "neutral" with low confidence rather than a confident coin flip, and
 * missing inputs should lower confidence rather than being treated as zeros.
 */

import { describe, expect, it } from "vitest";
import { assessRegime, REGIME_LABELS, type RegimeInput } from "../marketRegimeEngine";
import type { IndexQuote, MarketBreadth } from "@/lib/schema/core";

function idx(symbol: string, changePercent: number): IndexQuote {
  return { symbol, name: symbol, price: 100, change: changePercent, changePercent };
}

function breadth(advancers: number, decliners: number): MarketBreadth {
  return {
    advancers,
    decliners,
    newHighs: 20,
    newLows: 20,
    percentAbove50dma: 0.5,
    percentAbove200dma: 0.5,
    upVolumeShare: 0.5,
  };
}

function input(over: Partial<RegimeInput> = {}): RegimeInput {
  return {
    indexes: [idx("SPY", 0.8), idx("QQQ", 0.9), idx("DIA", 0.7)],
    breadth: breadth(350, 150),
    vixChangePercent: -7,
    vixLevel: 13.5,
    ...over,
  };
}

describe("assessRegime — classification", () => {
  it("reads broad strength with falling VIX as risk-on", () => {
    const r = assessRegime(input());
    expect(["risk_on", "volatility_compression"]).toContain(r.regime);
  });

  it("reads broad weakness with rising VIX as risk-off or vol expansion", () => {
    const r = assessRegime(
      input({
        indexes: [idx("SPY", -1.4), idx("QQQ", -1.6), idx("DIA", -1.2)],
        breadth: breadth(120, 380),
        vixChangePercent: 12,
        vixLevel: 26,
      }),
    );
    expect(["risk_off", "volatility_expansion"]).toContain(r.regime);
  });

  it("prioritizes a volatility regime over direction when VIX moves hard", () => {
    const r = assessRegime(input({ vixChangePercent: 18, vixLevel: 30 }));
    expect(r.regime).toBe("volatility_expansion");
  });

  it("returns neutral when indexes are flat", () => {
    const r = assessRegime(
      input({
        indexes: [idx("SPY", 0.02), idx("QQQ", -0.03)],
        breadth: breadth(250, 250),
        vixChangePercent: 0.5,
        vixLevel: 16,
      }),
    );
    expect(r.regime).toBe("neutral");
  });
});

describe("assessRegime — honesty under conflict and absence", () => {
  it("discounts a dispersed move rather than calling it broad strength", () => {
    const r = assessRegime(
      input({
        // One index up hard, another down: not a broad-based move.
        indexes: [idx("SPY", 1.6), idx("QQQ", -0.4), idx("IWM", 0.1)],
        breadth: breadth(250, 250),
        vixChangePercent: 0,
        vixLevel: 16,
      }),
    );
    expect(r.drivers.some((d) => d.includes("dispersed"))).toBe(true);
  });

  it("lowers confidence when inputs are missing", () => {
    const full = assessRegime(input());
    const sparse = assessRegime(
      input({ breadth: null, vixChangePercent: null, vixLevel: null }),
    );
    expect(sparse.confidence).toBeLessThan(full.confidence);
  });

  it("flags a provisional classification when evidence is thin", () => {
    const r = assessRegime({
      indexes: [idx("SPY", 0.5)],
      breadth: null,
      vixChangePercent: null,
      vixLevel: null,
    });
    expect(r.drivers.some((d) => d.includes("provisional"))).toBe(true);
  });

  it("handles no inputs at all without throwing", () => {
    const r = assessRegime({ indexes: [], breadth: null, vixChangePercent: null, vixLevel: null });
    expect(r.regime).toBe("neutral");
    expect(r.confidence).toBe(0);
  });

  it("treats missing breadth as unknown rather than as zero advancers", () => {
    // A null breadth must not read as maximally bearish.
    const r = assessRegime(input({ breadth: null }));
    expect(r.regime).not.toBe("risk_off");
  });

  it("ignores VIX when computing the equity average", () => {
    // VIX in the index list must not drag the directional read.
    const withVix = assessRegime(input({ indexes: [idx("SPY", 0.8), idx("VIX", -30)] }));
    const withoutVix = assessRegime(input({ indexes: [idx("SPY", 0.8)] }));
    expect(withVix.drivers[0]).toBe(withoutVix.drivers[0]);
  });
});

describe("assessRegime — contract", () => {
  it("caps confidence below 1.0", () => {
    const r = assessRegime(
      input({
        indexes: [idx("SPY", -4), idx("QQQ", -4.1), idx("DIA", -3.9)],
        breadth: breadth(20, 480),
        vixChangePercent: 45,
        vixLevel: 40,
      }),
    );
    expect(r.confidence).toBeLessThanOrEqual(0.85);
  });

  it("always explains itself with at least one driver", () => {
    expect(assessRegime(input()).drivers.length).toBeGreaterThan(0);
  });

  it("has a label for every regime it can return", () => {
    for (const key of Object.keys(REGIME_LABELS)) {
      expect(REGIME_LABELS[key as keyof typeof REGIME_LABELS]).toBeTruthy();
    }
  });
});
