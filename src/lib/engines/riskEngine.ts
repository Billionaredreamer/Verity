/**
 * riskEngine — deterministic position risk.
 *
 * Handover §7, verbatim: "Risk calculations must be deterministic backend
 * logic. The AI can explain the result, but should not invent the numbers."
 *
 * Every output is a pure function of the input. Nothing here is advice: the
 * engine reports exposure and flags thresholds, and the §10 compliance
 * position means it must not tell anyone what to do about them.
 */

import type { RiskAssessment, RiskInput } from "@/lib/schema/core";

const CONTRACT_MULTIPLIER = 100;

/** Concentration thresholds, named so the numbers aren't magic at the call site. */
const CONCENTRATION_ELEVATED = 0.15;
const CONCENTRATION_HIGH = 0.25;
/** Risking more than this share of the portfolio on one position is flagged. */
const RISK_PERCENT_FLAG = 0.02;
/** Trading days per year, for scaling annualized volatility to a daily move. */
const TRADING_DAYS = 252;

export function assessRisk(input: RiskInput): RiskAssessment {
  const warnings: string[] = [];

  // null portfolio ⇒ null weight. Returning 0 would read as "no exposure" and
  // deriving it from the position's own size would read as 100%; both are
  // confident answers to a question the data cannot answer.
  const hasPortfolio = input.portfolioSize !== null && input.portfolioSize > 0;
  const positionWeight = hasPortfolio ? input.positionSize / input.portfolioSize! : null;

  // --- Stop-based risk ------------------------------------------------------
  let dollarRisk: number | null = null;
  let riskPercent: number | null = null;

  if (input.stop !== null && input.entry > 0) {
    const moveToStop = Math.abs(input.entry - input.stop);
    if (input.optionPremium !== null && input.delta !== null) {
      // For an option, the loss at the underlying's stop is approximated
      // through delta, and capped at the premium paid — an option cannot lose
      // more than it cost. Ignoring that cap overstates risk badly on far OTM
      // contracts.
      const contracts = input.optionPremium > 0
        ? input.positionSize / (input.optionPremium * CONTRACT_MULTIPLIER)
        : 0;
      const deltaLoss = moveToStop * Math.abs(input.delta) * contracts * CONTRACT_MULTIPLIER;
      dollarRisk = Math.min(deltaLoss, input.positionSize);
      if (deltaLoss > input.positionSize) {
        warnings.push(
          "Loss at the stop exceeds the premium paid, so risk is capped at the full position value.",
        );
      }
    } else {
      // Equity: shares x move.
      const shares = input.entry > 0 ? input.positionSize / input.entry : 0;
      dollarRisk = moveToStop * shares;
    }
    riskPercent = hasPortfolio ? dollarRisk / input.portfolioSize! : null;
  } else {
    warnings.push("No stop defined — downside is not bounded by a predetermined exit.");
  }

  // --- Greeks-derived exposure ---------------------------------------------
  let dollarsPerPercentMove: number | null = null;
  if (input.delta !== null && input.entry > 0) {
    if (input.optionPremium !== null && input.optionPremium > 0) {
      const contracts = input.positionSize / (input.optionPremium * CONTRACT_MULTIPLIER);
      dollarsPerPercentMove =
        input.delta * contracts * CONTRACT_MULTIPLIER * input.entry * 0.01;
    } else {
      const shares = input.positionSize / input.entry;
      dollarsPerPercentMove = input.delta * shares * input.entry * 0.01;
    }
  }

  let dailyThetaCost: number | null = null;
  if (input.theta !== null && input.optionPremium !== null && input.optionPremium > 0) {
    const contracts = input.positionSize / (input.optionPremium * CONTRACT_MULTIPLIER);
    dailyThetaCost = input.theta * contracts * CONTRACT_MULTIPLIER;
  }

  let oneSigmaDailyMove: number | null = null;
  if (input.volatility !== null && input.volatility > 0 && input.entry > 0) {
    oneSigmaDailyMove = input.entry * (input.volatility / Math.sqrt(TRADING_DAYS));
  }

  // --- Flags ----------------------------------------------------------------
  // Concentration prefers the caller's explicit figure (share of gross
  // exposure) and falls back to position weight. With neither, it stays
  // unknown: "ok" is reported only when something was actually measured.
  const concentration = input.concentration ?? positionWeight;
  let concentrationFlag: RiskAssessment["concentrationFlag"] = "ok";

  if (concentration === null) {
    warnings.push(
      "Portfolio total is unavailable, so concentration and portfolio-relative risk could not be assessed.",
    );
  } else {
    if (concentration >= CONCENTRATION_HIGH) concentrationFlag = "high";
    else if (concentration >= CONCENTRATION_ELEVATED) concentrationFlag = "elevated";

    if (concentrationFlag === "high") {
      warnings.push(
        `This position is ${(concentration * 100).toFixed(1)}% of the portfolio — a single-name move dominates the account.`,
      );
    } else if (concentrationFlag === "elevated") {
      warnings.push(
        `This position is ${(concentration * 100).toFixed(1)}% of the portfolio.`,
      );
    }
  }

  if (riskPercent !== null && riskPercent > RISK_PERCENT_FLAG) {
    warnings.push(
      `Risk to the stop is ${(riskPercent * 100).toFixed(2)}% of the portfolio.`,
    );
  }

  if (input.daysToExpiration !== null && input.daysToExpiration <= 2 && input.optionPremium !== null) {
    warnings.push(
      `${input.daysToExpiration} day${input.daysToExpiration === 1 ? "" : "s"} to expiration — decay and gamma risk accelerate sharply.`,
    );
  }

  if (dailyThetaCost !== null && input.positionSize > 0) {
    const dailyDrag = Math.abs(dailyThetaCost) / input.positionSize;
    if (dailyDrag > 0.05) {
      warnings.push(
        `Time decay is running about ${(dailyDrag * 100).toFixed(1)}% of position value per day.`,
      );
    }
  }

  if (
    oneSigmaDailyMove !== null &&
    input.stop !== null &&
    Math.abs(input.entry - input.stop) < oneSigmaDailyMove
  ) {
    warnings.push(
      "The stop is inside a typical one-day move, so ordinary volatility may trigger it.",
    );
  }

  if (input.gamma !== null && input.gamma !== 0 && input.daysToExpiration !== null && input.daysToExpiration <= 5) {
    warnings.push("Gamma is elevated near expiration — delta will shift quickly with price.");
  }

  return {
    riskPercent,
    dollarRisk,
    positionWeight,
    dollarsPerPercentMove,
    dailyThetaCost,
    oneSigmaDailyMove,
    concentrationFlag,
    warnings,
  };
}

/**
 * Position size for a target risk. Returns null when the inputs cannot
 * determine one — notably when entry and stop are equal, which implies
 * infinite size and must never be silently rendered as a number.
 */
export function positionSizeForRisk(args: {
  portfolioSize: number | null;
  riskPercent: number;
  entry: number;
  stop: number;
}): number | null {
  const perShareRisk = Math.abs(args.entry - args.stop);
  if (perShareRisk <= 0 || args.entry <= 0 || args.portfolioSize === null || args.portfolioSize <= 0) {
    return null;
  }
  const dollarRisk = args.portfolioSize * args.riskPercent;
  const shares = dollarRisk / perShareRisk;
  return Math.round(shares * args.entry * 100) / 100;
}
