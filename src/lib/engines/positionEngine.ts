/**
 * positionEngine — position valuation and risk-input assembly.
 *
 * Listed in handover §8's analytics modules. It exists for one reason beyond
 * tidiness: the Terminal and the Portfolio screen must report the SAME risk
 * numbers for the same position. Previously each built its own `RiskInput`,
 * and they disagreed — the Terminal passed the position's exposure as the
 * portfolio total, so every position came back at 100% weight.
 *
 * Both callers now go through `riskInputFor`. Agreement is structural rather
 * than a thing to remember.
 */

import type { PortfolioSummary, Position, RiskInput } from "@/lib/schema/core";

export const CONTRACT_MULTIPLIER = 100;

/**
 * What the position is worth in the account.
 *
 * Deliberately NOT `exposure`. Exposure for an option is delta-equivalent
 * notional — what the position behaves like — which is correct for
 * concentration and badly wrong for value: twelve calls worth $3,456 of
 * premium can carry $83,000 of notional.
 *
 * Absolute value: a short option is a liability, but its SIZE is what risk
 * math needs.
 */
export function marketValue(p: Position): number {
  return Math.abs(
    p.kind === "option"
      ? p.markPrice * p.quantity * CONTRACT_MULTIPLIER
      : p.markPrice * p.quantity,
  );
}

/** Signed market value — negative for a short option, which is a liability. */
export function signedMarketValue(p: Position): number {
  return p.kind === "option"
    ? p.markPrice * p.quantity * CONTRACT_MULTIPLIER
    : p.markPrice * p.quantity;
}

/** Calendar days to expiration, or null for an equity position. */
export function positionDaysToExpiration(p: Position, now: Date = new Date()): number | null {
  if (!p.expiration) return null;
  const expiry = new Date(`${p.expiration}T20:00:00Z`).getTime();
  return Math.max(0, Math.round((expiry - now.getTime()) / 86_400_000));
}

/**
 * Build the risk input for a position.
 *
 * `portfolio` may be null — an unconnected brokerage, or a question about a
 * position we know without knowing the account around it. In that case the
 * portfolio total and concentration are passed as null, and riskEngine
 * suppresses the portfolio-relative outputs rather than inventing them.
 */
export function riskInputFor(
  position: Position,
  portfolio: PortfolioSummary | null,
  iv: number | null,
  now: Date = new Date(),
): RiskInput {
  const grossExposure =
    portfolio && portfolio.positions.length > 0
      ? portfolio.positions.reduce((sum, p) => sum + Math.abs(p.exposure), 0)
      : null;

  return {
    positionSize: marketValue(position),
    portfolioSize: portfolio ? portfolio.totalValue : null,
    entry: position.entryPrice,
    // V1 has no stored stops. null means "no stop", which riskEngine reports
    // as unbounded downside — the honest reading, not a missing field.
    stop: null,
    optionPremium: position.kind === "option" ? position.entryPrice : null,
    delta: position.delta,
    gamma: position.gamma,
    theta: position.theta,
    vega: position.vega,
    daysToExpiration: positionDaysToExpiration(position, now),
    volatility: iv,
    // Concentration uses EXPOSURE, because what matters for concentration is
    // how much the position moves the account, not what it cost.
    concentration:
      grossExposure !== null && grossExposure > 0
        ? Math.abs(position.exposure) / grossExposure
        : null,
  };
}

/** Gross exposure across a book — the denominator for concentration. */
export function grossExposureOf(positions: Position[]): number {
  return positions.reduce((sum, p) => sum + Math.abs(p.exposure), 0);
}
