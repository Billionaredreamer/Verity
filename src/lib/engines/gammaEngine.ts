/**
 * gammaEngine — dealer gamma exposure from an options chain.
 *
 * Handover §5 requires: total gamma, positive and negative gamma, zero
 * gamma / gamma flip, call wall, put wall, gamma by strike, gamma by
 * expiration, and a dealer gamma regime. §12: this math stays out of the
 * language model. The model may read and explain a GexSnapshot; it never
 * produces one.
 *
 * ---------------------------------------------------------------------------
 * The dealer-positioning assumption, stated plainly
 * ---------------------------------------------------------------------------
 * GEX rests on a convention: that dealers are net LONG calls and net SHORT
 * puts against customer activity. Under it, call open interest contributes
 * positive dealer gamma and put open interest contributes negative gamma.
 *
 * This is a convention, not a measurement. Real dealer books are not
 * observable from public data, and on any given day the assumption can simply
 * be wrong. It is used here because it is the industry-standard reading and
 * because the handover asks for "dealer gamma regime" — but `GEX_ASSUMPTION`
 * below is exported so the UI can state it to the user rather than presenting
 * the output as measured fact (§10: distinguish verified facts from analysis).
 */

import type {
  DealerGammaRegime,
  GammaByExpiration,
  GammaByStrike,
  GexSnapshot,
  OptionsChain,
} from "@/lib/schema/core";
import { gamma as bsGamma, yearsToExpiration } from "@/lib/math/blackScholes";
import { daysToExpiration, todayIso } from "@/lib/util/dates";

export const GEX_ASSUMPTION =
  "Assumes dealers are long call open interest and short put open interest. " +
  "Real dealer positioning is not publicly observable; treat this as a model, not a measurement.";

const CONTRACT_MULTIPLIER = 100;

/**
 * Gamma is expressed as dollars of delta change per 1% move in the underlying:
 *
 *   gamma (delta per $1) x contracts x 100 shares x spot x (spot x 1%)
 *
 * The two spot factors are deliberate — one converts share gamma to dollar
 * notional, the other scales from a $1 move to a 1% move. This is the
 * convention most published GEX figures use, so numbers here are comparable
 * to what a trader sees elsewhere.
 */
function dollarGamma(contractGamma: number, openInterest: number, spot: number): number {
  return contractGamma * openInterest * CONTRACT_MULTIPLIER * spot * (spot * 0.01);
}

export interface GammaOptions {
  /** Restrict to these expirations. Empty/undefined means the whole chain. */
  expirations?: string[];
  /** Risk-free rate for the greeks fallback. */
  riskFreeRate?: number;
  /** Fallback IV when a contract carries none. */
  fallbackIv?: number;
}

/**
 * Compute a GEX snapshot from a chain.
 *
 * Per-contract gamma is taken from the provider when supplied, and modeled
 * with Black–Scholes otherwise (§9 provider capability flags). Contracts with
 * neither a provider gamma nor an IV to model one are skipped rather than
 * assigned a guess — a skipped contract is better than a fabricated one.
 */
export function computeGex(chain: OptionsChain, opts: GammaOptions = {}): GexSnapshot {
  const { spot } = chain;
  const wanted = opts.expirations?.length ? new Set(opts.expirations) : null;
  const contracts = wanted
    ? chain.contracts.filter((c) => wanted.has(c.expiration))
    : chain.contracts;

  const byStrikeMap = new Map<number, GammaByStrike>();
  const byExpirationMap = new Map<number, number>();
  const expirationDates = new Map<number, string>();

  let positiveGamma = 0;
  let negativeGamma = 0;

  for (const c of contracts) {
    if (c.openInterest <= 0) continue;

    let g = c.gamma;
    if (g === null) {
      const iv = c.impliedVolatility ?? opts.fallbackIv ?? null;
      if (iv === null || iv <= 0) continue; // Not modelable — skip, don't guess.
      const dte = daysToExpiration(c.expiration);
      g = bsGamma({
        spot,
        strike: c.strike,
        t: yearsToExpiration(dte),
        vol: iv,
        r: opts.riskFreeRate ?? 0.04,
      });
    }
    if (!Number.isFinite(g) || g <= 0) continue;

    const magnitude = dollarGamma(g, c.openInterest, spot);
    // The dealer-positioning convention, applied in exactly one place.
    const signed = c.side === "call" ? magnitude : -magnitude;

    if (signed > 0) positiveGamma += signed;
    else negativeGamma += signed;

    const row = byStrikeMap.get(c.strike) ?? {
      strike: c.strike,
      callGamma: 0,
      putGamma: 0,
      netGamma: 0,
      callOpenInterest: 0,
      putOpenInterest: 0,
    };
    if (c.side === "call") {
      row.callGamma += magnitude;
      row.callOpenInterest += c.openInterest;
    } else {
      row.putGamma += magnitude;
      row.putOpenInterest += c.openInterest;
    }
    row.netGamma += signed;
    byStrikeMap.set(c.strike, row);

    const dte = daysToExpiration(c.expiration);
    byExpirationMap.set(dte, (byExpirationMap.get(dte) ?? 0) + signed);
    expirationDates.set(dte, c.expiration);
  }

  const byStrike = [...byStrikeMap.values()].sort((a, b) => a.strike - b.strike);
  const byExpiration: GammaByExpiration[] = [...byExpirationMap.entries()]
    .map(([dte, netGamma]) => ({
      expiration: expirationDates.get(dte)!,
      netGamma,
      daysToExpiration: dte,
    }))
    .sort((a, b) => a.daysToExpiration - b.daysToExpiration);

  const totalGamma = positiveGamma + negativeGamma;

  return {
    ticker: chain.ticker,
    spot,
    totalGamma,
    positiveGamma,
    negativeGamma,
    zeroGamma: findZeroGamma(byStrike),
    gammaFlip: findGammaFlip(byStrike, spot),
    callWall: findCallWall(byStrike),
    putWall: findPutWall(byStrike),
    byStrike,
    byExpiration,
    regime: classifyRegime(totalGamma, positiveGamma, negativeGamma),
    expirationsIncluded: [...new Set(contracts.map((c) => c.expiration))].sort(),
    asOf: chain.asOf,
  };
}

/**
 * Zero gamma: the strike at which per-strike net gamma changes sign,
 * linearly interpolated between the bracketing strikes.
 *
 * When several crossings exist (common in a chain with scattered OI) the one
 * with the largest gamma swing across it is returned, since that is the level
 * that actually matters to positioning.
 */
export function findZeroGamma(byStrike: GammaByStrike[]): number | null {
  if (byStrike.length < 2) return null;
  let best: { strike: number; swing: number } | null = null;

  for (let i = 1; i < byStrike.length; i++) {
    const prev = byStrike[i - 1]!;
    const curr = byStrike[i]!;
    const a = prev.netGamma;
    const b = curr.netGamma;
    if (a === 0) return prev.strike;
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const fraction = Math.abs(a) / (Math.abs(a) + Math.abs(b));
      const strike = prev.strike + fraction * (curr.strike - prev.strike);
      const swing = Math.abs(a) + Math.abs(b);
      if (!best || swing > best.swing) best = { strike: round2(strike), swing };
    }
  }
  return best?.strike ?? null;
}

/**
 * Gamma flip: the price at which CUMULATIVE gamma below that level crosses
 * zero. This is a different question from the per-strike crossing above —
 * it asks where aggregate dealer positioning changes sign, which is the level
 * traders mean when they talk about "flipping short gamma".
 */
export function findGammaFlip(byStrike: GammaByStrike[], spot: number): number | null {
  if (byStrike.length < 2) return null;
  let cumulative = 0;
  const points: Array<{ strike: number; cumulative: number }> = [];
  for (const row of byStrike) {
    cumulative += row.netGamma;
    points.push({ strike: row.strike, cumulative });
  }

  const crossings: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if ((a.cumulative > 0 && b.cumulative < 0) || (a.cumulative < 0 && b.cumulative > 0)) {
      const fraction = Math.abs(a.cumulative) / (Math.abs(a.cumulative) + Math.abs(b.cumulative));
      crossings.push(round2(a.strike + fraction * (b.strike - a.strike)));
    }
  }
  if (crossings.length === 0) return null;
  // The crossing nearest spot is the one with immediate relevance.
  return crossings.reduce((closest, c) =>
    Math.abs(c - spot) < Math.abs(closest - spot) ? c : closest,
  );
}

/** Call wall: the strike carrying the most call gamma — resistance under the convention. */
export function findCallWall(byStrike: GammaByStrike[]): number | null {
  let best: GammaByStrike | null = null;
  for (const row of byStrike) {
    if (row.callGamma > 0 && (!best || row.callGamma > best.callGamma)) best = row;
  }
  return best?.strike ?? null;
}

/** Put wall: the strike carrying the most put gamma — support under the convention. */
export function findPutWall(byStrike: GammaByStrike[]): number | null {
  let best: GammaByStrike | null = null;
  for (const row of byStrike) {
    if (row.putGamma > 0 && (!best || row.putGamma > best.putGamma)) best = row;
  }
  return best?.strike ?? null;
}

/**
 * Regime. "Transitional" exists because a near-zero net with large gross
 * exposure on both sides is genuinely ambiguous, and calling it long or short
 * would overstate what the data supports.
 */
export function classifyRegime(
  total: number,
  positive: number,
  negative: number,
): DealerGammaRegime {
  const gross = positive + Math.abs(negative);
  if (gross === 0) return "transitional";
  const ratio = total / gross;
  if (ratio > 0.08) return "long_gamma";
  if (ratio < -0.08) return "short_gamma";
  return "transitional";
}

/**
 * Handover §5: "A dedicated 0DTE view should prioritize today's expiration."
 * Returns null when nothing expires today rather than quietly widening to the
 * next expiration — a 0DTE view showing tomorrow's chain would be a lie.
 */
export function computeZeroDteGex(chain: OptionsChain, opts: GammaOptions = {}): GexSnapshot | null {
  const today = todayIso();
  const hasToday = chain.contracts.some((c) => c.expiration === today);
  if (!hasToday) return null;
  return computeGex(chain, { ...opts, expirations: [today] });
}

/**
 * Plain-language reading of a snapshot, for the Terminal and the GEX header.
 * Deterministic — the model relays these sentences rather than composing its
 * own account of the numbers.
 */
export function describeGex(g: GexSnapshot): string[] {
  const out: string[] = [];
  const pct = (level: number) => (((level - g.spot) / g.spot) * 100).toFixed(2);

  if (g.regime === "long_gamma") {
    out.push(
      "Net dealer gamma is positive. Under the standard assumption, hedging flows lean against price moves and tend to dampen volatility.",
    );
  } else if (g.regime === "short_gamma") {
    out.push(
      "Net dealer gamma is negative. Under the standard assumption, hedging flows move with price and tend to amplify volatility.",
    );
  } else {
    // "Balanced" here means net is small RELATIVE TO GROSS, which is not the
    // same as a small net number. Saying only "near balance" beside a headline
    // figure of -$641M reads as a contradiction, so the comparison is stated.
    const gross = g.positiveGamma + Math.abs(g.negativeGamma);
    const share = gross > 0 ? Math.abs(g.totalGamma) / gross : 0;
    out.push(
      `Net dealer gamma is only ${(share * 100).toFixed(0)}% of gross exposure (${formatGamma(gross)} on both sides combined), ` +
        "so positioning is close to balanced and no clear damping or amplifying regime applies.",
    );
  }

  if (g.callWall !== null) {
    out.push(`Largest call gamma concentration sits at ${g.callWall} (${pct(g.callWall)}% from spot).`);
  }
  if (g.putWall !== null) {
    out.push(`Largest put gamma concentration sits at ${g.putWall} (${pct(g.putWall)}% from spot).`);
  }
  if (g.gammaFlip !== null) {
    const side = g.spot > g.gammaFlip ? "above" : "below";
    out.push(`Spot is ${side} the gamma flip at ${g.gammaFlip} (${pct(g.gammaFlip)}% away).`);
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compact display for large gamma figures. */
export function formatGamma(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
