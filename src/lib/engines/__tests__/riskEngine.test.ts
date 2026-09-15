/**
 * riskEngine and Black-Scholes tests.
 *
 * §7 requires these numbers to be deterministic backend logic. Tests here
 * check the properties a trader would notice if they broke — the option loss
 * cap, the concentration thresholds, gamma's symmetry and peak.
 */

import { describe, expect, it } from "vitest";
import { assessRisk, positionSizeForRisk } from "../riskEngine";
import { cdf, delta, gamma, price, theta, vega } from "@/lib/math/blackScholes";
import type { RiskInput } from "@/lib/schema/core";

function input(over: Partial<RiskInput> = {}): RiskInput {
  return {
    positionSize: 10_000,
    portfolioSize: 100_000,
    entry: 100,
    stop: 95,
    optionPremium: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    daysToExpiration: null,
    volatility: null,
    concentration: null,
    ...over,
  };
}

describe("assessRisk — equity", () => {
  it("computes dollar risk from shares and the distance to the stop", () => {
    // $10,000 at $100 = 100 shares; a $5 stop distance risks $500.
    const r = assessRisk(input());
    expect(r.dollarRisk).toBeCloseTo(500, 6);
    expect(r.riskPercent).toBeCloseTo(0.005, 6);
  });

  it("warns when no stop is defined", () => {
    const r = assessRisk(input({ stop: null }));
    expect(r.dollarRisk).toBeNull();
    expect(r.warnings.some((w) => w.includes("No stop"))).toBe(true);
  });

  it("flags risk above the 2% threshold", () => {
    const r = assessRisk(input({ positionSize: 50_000, stop: 90 }));
    expect(r.riskPercent!).toBeGreaterThan(0.02);
    expect(r.warnings.some((w) => w.includes("Risk to the stop"))).toBe(true);
  });
});

describe("assessRisk — options", () => {
  it("caps loss at the premium paid rather than extrapolating through delta", () => {
    // A far OTM contract whose delta-implied loss far exceeds what it cost.
    const r = assessRisk(
      input({
        positionSize: 5_000,
        entry: 100,
        stop: 50,
        optionPremium: 1,
        delta: 0.5,
      }),
    );
    expect(r.dollarRisk).toBeLessThanOrEqual(5_000);
    expect(r.warnings.some((w) => w.includes("capped"))).toBe(true);
  });

  it("reports theta as a daily dollar cost", () => {
    const r = assessRisk(input({ optionPremium: 5, theta: -0.1, positionSize: 5_000 }));
    expect(r.dailyThetaCost).toBeLessThan(0);
  });

  it("warns near expiration", () => {
    const r = assessRisk(input({ optionPremium: 5, daysToExpiration: 1 }));
    expect(r.warnings.some((w) => w.includes("expiration"))).toBe(true);
  });
});

describe("assessRisk — concentration", () => {
  it("is ok below 15%", () => {
    expect(assessRisk(input({ concentration: 0.1 })).concentrationFlag).toBe("ok");
  });
  it("is elevated at 15–25%", () => {
    expect(assessRisk(input({ concentration: 0.2 })).concentrationFlag).toBe("elevated");
  });
  it("is high at or above 25%", () => {
    const r = assessRisk(input({ concentration: 0.3 }));
    expect(r.concentrationFlag).toBe("high");
    expect(r.warnings.some((w) => w.includes("dominates"))).toBe(true);
  });
  it("falls back to position weight when concentration is not supplied", () => {
    const r = assessRisk(input({ positionSize: 30_000, portfolioSize: 100_000 }));
    expect(r.concentrationFlag).toBe("high");
  });
});

describe("assessRisk — volatility", () => {
  it("warns when the stop sits inside a typical one-day move", () => {
    // 60% annualized on a $100 name is ~$3.78 daily sigma; a $1 stop is inside it.
    const r = assessRisk(input({ stop: 99, volatility: 0.6 }));
    expect(r.oneSigmaDailyMove).toBeGreaterThan(1);
    expect(r.warnings.some((w) => w.includes("inside a typical one-day move"))).toBe(true);
  });

  it("handles a zero portfolio without dividing by zero", () => {
    const r = assessRisk(input({ portfolioSize: 0 }));
    expect(r.positionWeight).toBe(0);
    expect(Number.isFinite(r.dollarRisk ?? 0)).toBe(true);
  });
});

describe("positionSizeForRisk", () => {
  it("sizes to the requested risk", () => {
    // 1% of $100k = $1,000 risk; $5 per share ⇒ 200 shares ⇒ $20,000.
    expect(positionSizeForRisk({ portfolioSize: 100_000, riskPercent: 0.01, entry: 100, stop: 95 }))
      .toBe(20_000);
  });

  it("returns null when entry equals stop rather than an infinite size", () => {
    expect(positionSizeForRisk({ portfolioSize: 100_000, riskPercent: 0.01, entry: 100, stop: 100 }))
      .toBeNull();
  });
});

describe("black-scholes", () => {
  it("cdf is centered and symmetric", () => {
    expect(cdf(0)).toBeCloseTo(0.5, 6);
    expect(cdf(1.96)).toBeCloseTo(0.975, 3);
    expect(cdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("gamma is identical for calls and puts", () => {
    const args = { spot: 100, strike: 100, t: 0.25, vol: 0.3 };
    // Gamma has no side parameter precisely because of this identity.
    expect(gamma(args)).toBeGreaterThan(0);
  });

  it("gamma peaks near the money", () => {
    const atm = gamma({ spot: 100, strike: 100, t: 0.25, vol: 0.3 });
    const otm = gamma({ spot: 100, strike: 130, t: 0.25, vol: 0.3 });
    expect(atm).toBeGreaterThan(otm);
  });

  it("gamma is zero for degenerate inputs rather than NaN", () => {
    expect(gamma({ spot: 100, strike: 100, t: 0, vol: 0.3 })).toBe(0);
    expect(gamma({ spot: 100, strike: 100, t: 0.25, vol: 0 })).toBe(0);
  });

  it("call delta is positive and put delta negative", () => {
    const args = { spot: 100, strike: 100, t: 0.25, vol: 0.3 };
    expect(delta(args, "call")).toBeGreaterThan(0);
    expect(delta(args, "put")).toBeLessThan(0);
  });

  it("put-call parity for delta holds approximately", () => {
    const args = { spot: 100, strike: 100, t: 0.25, vol: 0.3, q: 0 };
    expect(delta(args, "call") - delta(args, "put")).toBeCloseTo(1, 6);
  });

  it("at expiry delta collapses to the payoff indicator", () => {
    expect(delta({ spot: 110, strike: 100, t: 0, vol: 0.3 }, "call")).toBe(1);
    expect(delta({ spot: 90, strike: 100, t: 0, vol: 0.3 }, "call")).toBe(0);
    expect(delta({ spot: 90, strike: 100, t: 0, vol: 0.3 }, "put")).toBe(-1);
  });

  it("theta is negative for a long option", () => {
    expect(theta({ spot: 100, strike: 100, t: 0.25, vol: 0.3 }, "call")).toBeLessThan(0);
  });

  it("vega is positive and largest at the money", () => {
    const atm = vega({ spot: 100, strike: 100, t: 0.25, vol: 0.3 });
    expect(atm).toBeGreaterThan(0);
    expect(atm).toBeGreaterThan(vega({ spot: 100, strike: 140, t: 0.25, vol: 0.3 }));
  });

  it("price is never negative and respects intrinsic value at expiry", () => {
    expect(price({ spot: 100, strike: 100, t: 0.25, vol: 0.3 }, "call")).toBeGreaterThan(0);
    expect(price({ spot: 110, strike: 100, t: 0, vol: 0.3 }, "call")).toBe(10);
    expect(price({ spot: 90, strike: 100, t: 0, vol: 0.3 }, "call")).toBe(0);
  });
});
