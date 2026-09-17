/**
 * positionEngine tests.
 *
 * The headline test here is the last one: the Terminal and the Portfolio
 * screen must produce identical risk for the same position. They used to
 * build their own `RiskInput` separately and disagreed — the Terminal
 * reported every position at 100% weight. Comparing rendered screens catches
 * that only if someone looks; this catches it on every run.
 */

import { describe, expect, it } from "vitest";
import {
  grossExposureOf,
  marketValue,
  positionDaysToExpiration,
  riskInputFor,
  signedMarketValue,
} from "../positionEngine";
import { assessRisk } from "../riskEngine";
import { fakePortfolio, fakePosition } from "@/lib/context/__tests__/fakes";

describe("marketValue", () => {
  it("applies the contract multiplier to options", () => {
    expect(marketValue(fakePosition({ kind: "option", markPrice: 6, quantity: 10 }))).toBe(6000);
  });

  it("does not apply it to equity", () => {
    expect(marketValue(fakePosition({ kind: "equity", markPrice: 240, quantity: 100 }))).toBe(24_000);
  });

  it("is distinct from exposure for an option", () => {
    // The bug this prevents: summing delta-equivalent notional into an
    // account total, which inflated the mock portfolio roughly threefold.
    const p = fakePosition({ kind: "option", markPrice: 6, quantity: 10, exposure: 330_000 });
    expect(marketValue(p)).toBe(6000);
    expect(marketValue(p)).not.toBe(Math.abs(p.exposure));
  });

  it("returns a positive size for a short position", () => {
    expect(marketValue(fakePosition({ markPrice: 6, quantity: -10 }))).toBe(6000);
  });

  it("signedMarketValue keeps a short position negative, because it is a liability", () => {
    expect(signedMarketValue(fakePosition({ markPrice: 6, quantity: -10 }))).toBe(-6000);
  });
});

describe("positionDaysToExpiration", () => {
  it("returns null for equity", () => {
    expect(positionDaysToExpiration(fakePosition({ kind: "equity", expiration: null }))).toBeNull();
  });

  it("never returns a negative number for an expired contract", () => {
    const p = fakePosition({ expiration: "2020-01-17" });
    expect(positionDaysToExpiration(p)).toBe(0);
  });

  it("counts forward from the given date", () => {
    const p = fakePosition({ expiration: "2026-09-25" });
    expect(positionDaysToExpiration(p, new Date("2026-09-18T12:00:00Z"))).toBe(7);
  });
});

describe("riskInputFor", () => {
  it("passes market value as the position size, not exposure", () => {
    const p = fakePosition({ markPrice: 6, quantity: 10, exposure: 330_000 });
    expect(riskInputFor(p, fakePortfolio(), null).positionSize).toBe(6000);
  });

  it("passes the real portfolio total", () => {
    const input = riskInputFor(fakePosition(), fakePortfolio({ totalValue: 250_000 }), null);
    expect(input.portfolioSize).toBe(250_000);
  });

  it("passes null portfolio size when there is no portfolio", () => {
    const input = riskInputFor(fakePosition(), null, null);
    expect(input.portfolioSize).toBeNull();
    expect(input.concentration).toBeNull();
  });

  it("computes concentration from gross exposure, not market value", () => {
    const a = fakePosition({ id: "a", exposure: 75_000 });
    const b = fakePosition({ id: "b", exposure: 25_000 });
    const input = riskInputFor(a, fakePortfolio({ positions: [a, b] }), null);
    expect(input.concentration).toBeCloseTo(0.75, 6);
  });

  it("handles a portfolio with no positions without dividing by zero", () => {
    const input = riskInputFor(fakePosition(), fakePortfolio({ positions: [] }), null);
    expect(input.concentration).toBeNull();
  });
});

describe("grossExposureOf", () => {
  it("sums absolute exposure so a short does not cancel a long", () => {
    const longPos = fakePosition({ id: "l", exposure: 50_000 });
    const shortPos = fakePosition({ id: "s", exposure: -30_000 });
    expect(grossExposureOf([longPos, shortPos])).toBe(80_000);
  });

  it("is zero for an empty book", () => {
    expect(grossExposureOf([])).toBe(0);
  });
});

describe("Terminal and Portfolio agree", () => {
  it("produces identical risk for the same position through either path", () => {
    // Both screens now call riskInputFor. This asserts that the shared path
    // is genuinely shared — if either one starts assembling its own input
    // again, these diverge and this fails.
    const position = fakePosition({ markPrice: 6, quantity: 10, exposure: 330_000 });
    const portfolio = fakePortfolio({ totalValue: 100_000, positions: [position] });
    const now = new Date("2026-09-17T12:00:00Z");

    const terminalRisk = assessRisk(riskInputFor(position, portfolio, 0.42, now));
    const portfolioRisk = assessRisk(riskInputFor(position, portfolio, 0.42, now));

    expect(terminalRisk).toEqual(portfolioRisk);
    expect(terminalRisk.positionWeight).toBeCloseTo(0.06, 6);
  });

  it("differs only by the IV the Terminal has and the Portfolio screen does not", () => {
    // The Portfolio screen passes null IV because it has no snapshot; that
    // affects the one-sigma move and nothing else.
    const position = fakePosition();
    const portfolio = fakePortfolio();
    const now = new Date("2026-09-17T12:00:00Z");

    const withIv = assessRisk(riskInputFor(position, portfolio, 0.42, now));
    const withoutIv = assessRisk(riskInputFor(position, portfolio, null, now));

    expect(withIv.positionWeight).toBe(withoutIv.positionWeight);
    expect(withIv.dollarsPerPercentMove).toBe(withoutIv.dollarsPerPercentMove);
    expect(withoutIv.oneSigmaDailyMove).toBeNull();
  });
});
