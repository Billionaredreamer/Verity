/**
 * gammaEngine tests.
 *
 * The chains here are hand-built so the expected answer is knowable by
 * inspection. That is the point of testing this module: GEX output looks
 * plausible whatever it says, so a bug in the flip calculation would never be
 * caught by looking at the screen.
 */

import { describe, expect, it } from "vitest";
import {
  classifyRegime,
  computeGex,
  computeZeroDteGex,
  findCallWall,
  findGammaFlip,
  findPutWall,
  findZeroGamma,
} from "../gammaEngine";
import type { GammaByStrike, OptionContract, OptionsChain } from "@/lib/schema/core";
import { todayIso, upcomingExpirations } from "@/lib/util/dates";

function strike(s: number, call: number, put: number): GammaByStrike {
  return {
    strike: s,
    callGamma: call,
    putGamma: put,
    netGamma: call - put,
    callOpenInterest: 0,
    putOpenInterest: 0,
  };
}

function contract(over: Partial<OptionContract> & Pick<OptionContract, "strike" | "side">): OptionContract {
  return {
    ticker: "TEST",
    expiration: upcomingExpirations(2)[1]!,
    openInterest: 1000,
    volume: 100,
    gamma: 0.02,
    delta: null,
    theta: null,
    vega: null,
    impliedVolatility: 0.25,
    bid: null,
    ask: null,
    lastPrice: null,
    ...over,
  };
}

describe("findZeroGamma", () => {
  it("interpolates the crossing between two strikes", () => {
    // net goes +100 at 100 to -100 at 102 — crossing sits exactly halfway.
    const rows = [strike(100, 100, 0), strike(102, 0, 100)];
    expect(findZeroGamma(rows)).toBe(101);
  });

  it("weights the crossing toward the smaller magnitude", () => {
    // +25 to -75: the zero is a quarter of the way across.
    const rows = [strike(100, 25, 0), strike(104, 0, 75)];
    expect(findZeroGamma(rows)).toBe(101);
  });

  it("returns null when net gamma never changes sign", () => {
    const rows = [strike(100, 50, 0), strike(101, 60, 0), strike(102, 70, 0)];
    expect(findZeroGamma(rows)).toBeNull();
  });

  it("picks the crossing with the largest swing when several exist", () => {
    const rows = [
      strike(100, 5, 0), //  +5
      strike(101, 0, 5), //  -5   small swing (10)
      strike(102, 900, 0), // +900 large swing (905)
      strike(103, 0, 900), // -900
    ];
    // The 102–103 crossing has the far larger swing.
    expect(findZeroGamma(rows)).toBeGreaterThan(102);
  });

  it("returns null for a chain too short to have a crossing", () => {
    expect(findZeroGamma([])).toBeNull();
    expect(findZeroGamma([strike(100, 5, 0)])).toBeNull();
  });
});

describe("findGammaFlip", () => {
  it("finds where cumulative gamma crosses zero, not where per-strike does", () => {
    // Per-strike sign flips at every step, but the cumulative total only
    // crosses once. These are genuinely different levels.
    const rows = [
      strike(100, 100, 0), // net +100, cum +100
      strike(101, 0, 40), // net  -40, cum  +60
      strike(102, 0, 120), // net -120, cum  -60
    ];
    const flip = findGammaFlip(rows, 101);
    expect(flip).not.toBeNull();
    expect(flip!).toBeGreaterThan(101);
    expect(flip!).toBeLessThan(102);
    // The per-strike crossing sits earlier, between 100 and 101.
    expect(findZeroGamma(rows)!).toBeLessThan(101);
  });

  it("returns the crossing nearest spot when several exist", () => {
    const rows = [
      strike(100, 50, 0),
      strike(101, 0, 100), // cum crosses here
      strike(102, 100, 0), // and back here
      strike(103, 0, 100),
    ];
    const near = findGammaFlip(rows, 103);
    const far = findGammaFlip(rows, 100);
    expect(near).not.toBe(far);
  });

  it("returns null when cumulative gamma never crosses", () => {
    const rows = [strike(100, 10, 0), strike(101, 10, 0)];
    expect(findGammaFlip(rows, 100)).toBeNull();
  });
});

describe("walls", () => {
  const rows = [strike(95, 10, 400), strike(100, 250, 50), strike(105, 900, 5)];

  it("call wall is the strike with the most call gamma", () => {
    expect(findCallWall(rows)).toBe(105);
  });

  it("put wall is the strike with the most put gamma", () => {
    expect(findPutWall(rows)).toBe(95);
  });

  it("returns null when no gamma is present on that side", () => {
    expect(findCallWall([strike(100, 0, 500)])).toBeNull();
    expect(findPutWall([strike(100, 500, 0)])).toBeNull();
  });
});

describe("classifyRegime", () => {
  it("calls a strongly positive book long gamma", () => {
    expect(classifyRegime(800, 900, -100)).toBe("long_gamma");
  });

  it("calls a strongly negative book short gamma", () => {
    expect(classifyRegime(-800, 100, -900)).toBe("short_gamma");
  });

  it("calls a balanced book transitional rather than guessing a side", () => {
    // Large gross exposure, near-zero net — genuinely ambiguous.
    expect(classifyRegime(10, 5000, -4990)).toBe("transitional");
  });

  it("handles an empty book without dividing by zero", () => {
    expect(classifyRegime(0, 0, 0)).toBe("transitional");
  });
});

describe("computeGex", () => {
  const chain: OptionsChain = {
    ticker: "TEST",
    spot: 100,
    asOf: new Date().toISOString(),
    contracts: [
      contract({ strike: 105, side: "call", openInterest: 5000 }),
      contract({ strike: 95, side: "put", openInterest: 5000 }),
      contract({ strike: 100, side: "call", openInterest: 1000 }),
    ],
  };

  it("signs call gamma positive and put gamma negative", () => {
    const gex = computeGex(chain);
    expect(gex.positiveGamma).toBeGreaterThan(0);
    expect(gex.negativeGamma).toBeLessThan(0);
    expect(gex.totalGamma).toBeCloseTo(gex.positiveGamma + gex.negativeGamma, 6);
  });

  it("skips contracts with no open interest", () => {
    const withZero = {
      ...chain,
      contracts: [...chain.contracts, contract({ strike: 110, side: "call", openInterest: 0 })],
    };
    expect(computeGex(withZero).byStrike.find((r) => r.strike === 110)).toBeUndefined();
  });

  it("skips contracts it cannot model rather than guessing a gamma", () => {
    const unmodelable = {
      ...chain,
      contracts: [contract({ strike: 120, side: "call", gamma: null, impliedVolatility: null })],
    };
    const gex = computeGex(unmodelable);
    expect(gex.byStrike).toHaveLength(0);
    expect(gex.totalGamma).toBe(0);
  });

  it("models gamma from IV when the provider supplies none", () => {
    const modeled = {
      ...chain,
      contracts: [contract({ strike: 100, side: "call", gamma: null, impliedVolatility: 0.3 })],
    };
    expect(computeGex(modeled).totalGamma).toBeGreaterThan(0);
  });

  it("restricts to requested expirations", () => {
    const [near, far] = upcomingExpirations(2);
    const multi = {
      ...chain,
      contracts: [
        contract({ strike: 100, side: "call", expiration: near! }),
        contract({ strike: 101, side: "call", expiration: far! }),
      ],
    };
    const gex = computeGex(multi, { expirations: [near!] });
    expect(gex.expirationsIncluded).toEqual([near]);
    expect(gex.byStrike.map((r) => r.strike)).toEqual([100]);
  });
});

describe("computeZeroDteGex", () => {
  it("returns null when nothing expires today", () => {
    const chain: OptionsChain = {
      ticker: "TEST",
      spot: 100,
      asOf: new Date().toISOString(),
      contracts: [contract({ strike: 100, side: "call", expiration: "2099-12-18" })],
    };
    // Rather than silently widening to the next expiration.
    expect(computeZeroDteGex(chain)).toBeNull();
  });

  it("includes only today's expiration when one exists", () => {
    const today = todayIso();
    const chain: OptionsChain = {
      ticker: "TEST",
      spot: 100,
      asOf: new Date().toISOString(),
      contracts: [
        contract({ strike: 100, side: "call", expiration: today }),
        contract({ strike: 101, side: "call", expiration: "2099-12-18" }),
      ],
    };
    const gex = computeZeroDteGex(chain);
    expect(gex).not.toBeNull();
    expect(gex!.expirationsIncluded).toEqual([today]);
  });
});
