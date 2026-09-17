/**
 * Black-Scholes edge cases.
 *
 * The main test file covers ordinary behaviour. This one covers the inputs
 * that reach the model from real chains and break naive implementations:
 * expiry, zero and absurd volatility, deep moneyness, and tiny time values.
 * Every one of these must return a finite number or an explicit zero —
 * a NaN here would propagate silently into a gamma wall.
 */

import { describe, expect, it } from "vitest";
import { cdf, delta, gamma, pdf, price, theta, vega, yearsToExpiration } from "../blackScholes";

const base = { spot: 100, strike: 100, t: 0.25, vol: 0.3 };

describe("degenerate inputs never produce NaN", () => {
  const degenerate = [
    { label: "zero time", args: { ...base, t: 0 } },
    { label: "negative time", args: { ...base, t: -1 } },
    { label: "zero volatility", args: { ...base, vol: 0 } },
    { label: "negative volatility", args: { ...base, vol: -0.2 } },
    { label: "zero spot", args: { ...base, spot: 0 } },
    { label: "zero strike", args: { ...base, strike: 0 } },
  ];

  for (const { label, args } of degenerate) {
    it(`returns finite values for ${label}`, () => {
      for (const side of ["call", "put"] as const) {
        expect(Number.isFinite(gamma(args))).toBe(true);
        expect(Number.isFinite(delta(args, side))).toBe(true);
        expect(Number.isFinite(vega(args))).toBe(true);
        expect(Number.isFinite(theta(args, side))).toBe(true);
        expect(Number.isFinite(price(args, side))).toBe(true);
      }
    });
  }

  it("returns zero gamma at expiry rather than infinity", () => {
    // Gamma diverges at the money as t → 0 in the continuous model; the
    // implementation must not hand that divergence downstream.
    expect(gamma({ ...base, t: 0 })).toBe(0);
  });
});

describe("near-expiration behaviour", () => {
  it("gamma grows as expiry approaches for an ATM option", () => {
    const far = gamma({ ...base, t: 0.5 });
    const near = gamma({ ...base, t: 1 / 365 });
    expect(near).toBeGreaterThan(far);
    expect(Number.isFinite(near)).toBe(true);
  });

  it("theta becomes more negative as expiry approaches", () => {
    const far = theta({ ...base, t: 0.5 }, "call");
    const near = theta({ ...base, t: 2 / 365 }, "call");
    expect(near).toBeLessThan(far);
  });

  it("yearsToExpiration floors at half a day so 0DTE stays modelable", () => {
    // 0DTE is a headline feature; t = 0 would zero out the whole 0DTE chain.
    expect(yearsToExpiration(0)).toBeGreaterThan(0);
    expect(yearsToExpiration(0)).toBeCloseTo(0.5 / 365, 9);
  });

  it("produces non-zero gamma for a 0DTE contract", () => {
    expect(gamma({ ...base, t: yearsToExpiration(0) })).toBeGreaterThan(0);
  });
});

describe("deep moneyness", () => {
  it("gamma approaches zero far from the strike", () => {
    expect(gamma({ ...base, strike: 1000 })).toBeLessThan(1e-6);
    expect(gamma({ ...base, strike: 1 })).toBeLessThan(1e-6);
  });

  it("deep ITM call delta approaches 1 and deep OTM approaches 0", () => {
    expect(delta({ ...base, strike: 1 }, "call")).toBeGreaterThan(0.99);
    expect(delta({ ...base, strike: 1000 }, "call")).toBeLessThan(0.01);
  });

  it("put delta stays within [-1, 0]", () => {
    for (const strike of [1, 50, 100, 200, 1000]) {
      const d = delta({ ...base, strike }, "put");
      expect(d).toBeLessThanOrEqual(0);
      expect(d).toBeGreaterThanOrEqual(-1);
    }
  });

  it("price never goes negative", () => {
    for (const strike of [1, 50, 100, 200, 1000]) {
      for (const side of ["call", "put"] as const) {
        expect(price({ ...base, strike }, side)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("extreme volatility", () => {
  it("handles very high volatility without blowing up", () => {
    const g = gamma({ ...base, vol: 5 });
    expect(Number.isFinite(g)).toBe(true);
    expect(g).toBeGreaterThanOrEqual(0);
  });

  it("handles very low positive volatility", () => {
    const g = gamma({ ...base, vol: 0.0001 });
    expect(Number.isFinite(g)).toBe(true);
  });

  it("call price stays below spot even at absurd volatility", () => {
    // A call is worth at most the underlying.
    expect(price({ ...base, vol: 10 }, "call")).toBeLessThanOrEqual(base.spot);
  });
});

describe("numerical sanity of the normal functions", () => {
  it("pdf is symmetric and peaks at zero", () => {
    expect(pdf(0)).toBeCloseTo(0.3989423, 6);
    expect(pdf(1.5)).toBeCloseTo(pdf(-1.5), 12);
    expect(pdf(0)).toBeGreaterThan(pdf(0.5));
  });

  it("cdf is monotonic and bounded", () => {
    let previous = 0;
    for (let x = -5; x <= 5; x += 0.25) {
      const v = cdf(x);
      expect(v).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      previous = v;
    }
  });

  it("cdf is accurate at known quantiles", () => {
    expect(cdf(-3)).toBeCloseTo(0.0013499, 5);
    expect(cdf(-1)).toBeCloseTo(0.1586553, 5);
    expect(cdf(1)).toBeCloseTo(0.8413447, 5);
    expect(cdf(3)).toBeCloseTo(0.9986501, 5);
  });

  it("cdf saturates in the far tails without overshooting", () => {
    expect(cdf(-40)).toBeGreaterThanOrEqual(0);
    expect(cdf(40)).toBeLessThanOrEqual(1);
  });
});

describe("put-call parity", () => {
  it("holds for price with no dividend", () => {
    // C - P = S - K*e^(-rt)
    const args = { ...base, r: 0.04, q: 0 };
    const lhs = price(args, "call") - price(args, "put");
    const rhs = args.spot - args.strike * Math.exp(-0.04 * args.t);
    expect(lhs).toBeCloseTo(rhs, 6);
  });

  it("holds across a range of strikes", () => {
    for (const strike of [80, 95, 105, 130]) {
      const args = { ...base, strike, r: 0.04, q: 0 };
      const lhs = price(args, "call") - price(args, "put");
      const rhs = args.spot - strike * Math.exp(-0.04 * args.t);
      expect(lhs).toBeCloseTo(rhs, 6);
    }
  });
});
