/**
 * Black–Scholes greeks.
 *
 * Handover §12: "Keep deterministic calculations outside the language model."
 * This module is pure and unit-tested — it is the fallback used whenever a
 * provider does not supply per-contract greeks (§9 capability flags).
 *
 * Conventions: `t` is time to expiration in YEARS, `vol` and `r` are decimals
 * (0.24 = 24%). All functions are per single contract on a per-share basis;
 * the 100x contract multiplier is applied by callers so the multiplier is
 * visible at the site where dollar amounts are formed.
 */

/** Standard normal PDF. */
export function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal CDF via Abramowitz & Stegun 7.1.26 applied to erf.
 * Absolute error < 1.5e-7, which is far tighter than any input precision here.
 */
export function cdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export interface GreekInput {
  spot: number;
  strike: number;
  /** Time to expiration in years. */
  t: number;
  /** Annualized volatility, decimal. */
  vol: number;
  /** Risk-free rate, decimal. */
  r?: number;
  /** Continuous dividend yield, decimal. */
  q?: number;
}

function d1d2(i: GreekInput): { d1: number; d2: number; sqrtT: number } {
  const r = i.r ?? 0.04;
  const q = i.q ?? 0;
  const sqrtT = Math.sqrt(i.t);
  const d1 =
    (Math.log(i.spot / i.strike) + (r - q + 0.5 * i.vol * i.vol) * i.t) / (i.vol * sqrtT);
  return { d1, d2: d1 - i.vol * sqrtT, sqrtT };
}

/** True when the inputs make the model meaningless (expiry, zero vol, zero price). */
function degenerate(i: GreekInput): boolean {
  return !(i.t > 0) || !(i.vol > 0) || !(i.spot > 0) || !(i.strike > 0);
}

/**
 * Gamma — identical for calls and puts. Units: change in delta per $1 move in
 * the underlying, per share.
 */
export function gamma(i: GreekInput): number {
  if (degenerate(i)) return 0;
  const { d1, sqrtT } = d1d2(i);
  const q = i.q ?? 0;
  return (Math.exp(-q * i.t) * pdf(d1)) / (i.spot * i.vol * sqrtT);
}

export function delta(i: GreekInput, side: "call" | "put"): number {
  if (degenerate(i)) {
    // At expiry delta collapses to the payoff indicator.
    const itm = side === "call" ? i.spot > i.strike : i.spot < i.strike;
    if (!itm) return 0;
    return side === "call" ? 1 : -1;
  }
  const { d1 } = d1d2(i);
  const q = i.q ?? 0;
  const nd1 = cdf(d1);
  return side === "call" ? Math.exp(-q * i.t) * nd1 : Math.exp(-q * i.t) * (nd1 - 1);
}

/** Vega per 1.00 (100 percentage points) of volatility, per share. */
export function vega(i: GreekInput): number {
  if (degenerate(i)) return 0;
  const { d1, sqrtT } = d1d2(i);
  const q = i.q ?? 0;
  return i.spot * Math.exp(-q * i.t) * pdf(d1) * sqrtT;
}

/** Theta per CALENDAR DAY, per share. Negative for long options. */
export function theta(i: GreekInput, side: "call" | "put"): number {
  if (degenerate(i)) return 0;
  const { d1, d2, sqrtT } = d1d2(i);
  const r = i.r ?? 0.04;
  const q = i.q ?? 0;
  const decay = (-i.spot * Math.exp(-q * i.t) * pdf(d1) * i.vol) / (2 * sqrtT);
  const annual =
    side === "call"
      ? decay - r * i.strike * Math.exp(-r * i.t) * cdf(d2) + q * i.spot * Math.exp(-q * i.t) * cdf(d1)
      : decay + r * i.strike * Math.exp(-r * i.t) * cdf(-d2) - q * i.spot * Math.exp(-q * i.t) * cdf(-d1);
  return annual / 365;
}

export function price(i: GreekInput, side: "call" | "put"): number {
  const r = i.r ?? 0.04;
  const q = i.q ?? 0;
  if (degenerate(i)) {
    return side === "call" ? Math.max(0, i.spot - i.strike) : Math.max(0, i.strike - i.spot);
  }
  const { d1, d2 } = d1d2(i);
  if (side === "call") {
    return i.spot * Math.exp(-q * i.t) * cdf(d1) - i.strike * Math.exp(-r * i.t) * cdf(d2);
  }
  return i.strike * Math.exp(-r * i.t) * cdf(-d2) - i.spot * Math.exp(-q * i.t) * cdf(-d1);
}

/** Calendar days to expiration, expressed in years, floored just above zero. */
export function yearsToExpiration(days: number): number {
  return Math.max(days, 0.5) / 365;
}
