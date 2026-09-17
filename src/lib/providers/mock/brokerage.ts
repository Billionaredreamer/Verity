/**
 * MOCK brokerage adapter — read-only by contract.
 *
 * Handover §7 (portfolio: read-only connection, positions, P/L, exposure,
 * concentration, upcoming expirations) and §12 ("No brokerage execution in
 * V1"). The BrokerageProvider interface has no order method, so this adapter
 * has nothing to implement on that front and neither will a real one until
 * the interface itself changes.
 */

import type { PortfolioSummary, Position, Sourced } from "@/lib/schema/core";
import type { BrokerageProvider } from "@/lib/providers/types";
import { provenance, sourced } from "@/lib/providers/provenance";
import { lookupOrSynthesize } from "./universe";
import { mockSpot } from "./marketData";
import { hashSeed, rng, timeBucket, between } from "./random";
import { daysToExpiration, upcomingExpirations } from "@/lib/util/dates";
import { signedMarketValue } from "@/lib/engines/positionEngine";
import { delta as bsDelta, gamma as bsGamma, theta as bsTheta, vega as bsVega, price as bsPrice, yearsToExpiration } from "@/lib/math/blackScholes";

const SOURCE = "mock";
const CONTRACT_MULTIPLIER = 100;

/** A fixed book, so the Portfolio screen is stable to look at and reason about. */
const BOOK: ReadonlyArray<{
  ticker: string;
  kind: "equity" | "option";
  quantity: number;
  entryOffset: number;
  strikeOffset?: number;
  expirationIndex?: number;
  side?: "call" | "put";
}> = [
  { ticker: "NVDA", kind: "option", quantity: 12, entryOffset: -0.03, strikeOffset: 0.02, expirationIndex: 3, side: "call" },
  { ticker: "SPY", kind: "option", quantity: -8, entryOffset: 0.01, strikeOffset: -0.015, expirationIndex: 1, side: "put" },
  { ticker: "AAPL", kind: "equity", quantity: 220, entryOffset: -0.055 },
  { ticker: "TSLA", kind: "option", quantity: 6, entryOffset: 0.04, strikeOffset: 0.05, expirationIndex: 5, side: "call" },
  { ticker: "MSFT", kind: "equity", quantity: 90, entryOffset: -0.02 },
  { ticker: "QQQ", kind: "option", quantity: 10, entryOffset: -0.01, strikeOffset: 0.01, expirationIndex: 0, side: "call" },
];

function buildPositions(bucket: number): Position[] {
  const expirations = upcomingExpirations(8);
  return BOOK.map((row, i) => {
    const entry = lookupOrSynthesize(row.ticker);
    const spot = mockSpot(row.ticker, bucket);
    const r = rng(hashSeed("position", row.ticker, i));

    if (row.kind === "equity") {
      const entryPrice = round2(spot * (1 + row.entryOffset));
      const unrealizedPnl = round2((spot - entryPrice) * row.quantity);
      return {
        id: `mock-pos-${i}`,
        ticker: row.ticker,
        kind: "equity" as const,
        quantity: row.quantity,
        entryPrice,
        markPrice: spot,
        strike: null,
        expiration: null,
        side: null,
        unrealizedPnl,
        unrealizedPnlPercent: round2((unrealizedPnl / (entryPrice * Math.abs(row.quantity))) * 100),
        exposure: round2(spot * row.quantity),
        delta: row.quantity,
        gamma: 0,
        theta: 0,
        vega: 0,
        openedAt: new Date(Date.now() - between(r, 3, 40) * 86_400_000).toISOString(),
      };
    }

    const expiration = expirations[row.expirationIndex ?? 2] ?? expirations[0]!;
    const dte = daysToExpiration(expiration);
    const t = yearsToExpiration(dte);
    const strike =
      Math.round((spot * (1 + (row.strikeOffset ?? 0))) / entry.strikeIncrement) *
      entry.strikeIncrement;
    const side = row.side ?? "call";
    const iv = entry.ivAnchor * (dte <= 2 ? 1.2 : 1);

    const mark = round2(bsPrice({ spot, strike, t, vol: iv }, side));
    const entryPrice = round2(Math.max(0.05, mark * (1 + row.entryOffset * 4)));
    const contractDelta = bsDelta({ spot, strike, t, vol: iv }, side);

    const unrealizedPnl = round2((mark - entryPrice) * row.quantity * CONTRACT_MULTIPLIER);
    const cost = entryPrice * Math.abs(row.quantity) * CONTRACT_MULTIPLIER;

    return {
      id: `mock-pos-${i}`,
      ticker: row.ticker,
      kind: "option" as const,
      quantity: row.quantity,
      entryPrice,
      markPrice: mark,
      strike,
      expiration,
      side,
      unrealizedPnl,
      unrealizedPnlPercent: cost > 0 ? round2((unrealizedPnl / cost) * 100) : 0,
      // Exposure for an option is delta-equivalent notional, not premium —
      // premium understates what the position actually does to the account.
      exposure: round2(contractDelta * row.quantity * CONTRACT_MULTIPLIER * spot),
      delta: round4(contractDelta * row.quantity * CONTRACT_MULTIPLIER),
      gamma: round4(bsGamma({ spot, strike, t, vol: iv }) * row.quantity * CONTRACT_MULTIPLIER),
      theta: round2(bsTheta({ spot, strike, t, vol: iv }, side) * row.quantity * CONTRACT_MULTIPLIER),
      vega: round2(bsVega({ spot, strike, t, vol: iv }) * row.quantity * CONTRACT_MULTIPLIER),
      openedAt: new Date(Date.now() - between(r, 1, 18) * 86_400_000).toISOString(),
    };
  });
}

/** Tickers that tend to move together, so concentration isn't read per-symbol only. */
const CORRELATION_GROUPS: ReadonlyArray<{ label: string; tickers: string[] }> = [
  { label: "Mega-cap technology", tickers: ["NVDA", "AAPL", "MSFT", "AMD", "META", "GOOGL", "AMZN"] },
  { label: "Broad index exposure", tickers: ["SPY", "QQQ", "IWM", "DIA"] },
];

export function summarize(positions: Position[], cash: number): PortfolioSummary {
  // Concentration uses exposure, because what matters for concentration is how
  // much the position moves the account, not what it cost.
  const grossExposure = positions.reduce((s, p) => s + Math.abs(p.exposure), 0);
  const unrealizedPnl = round2(positions.reduce((s, p) => s + p.unrealizedPnl, 0));
  // signedMarketValue, not exposure: a short option is a liability, and
  // exposure is delta-equivalent notional rather than what the position is
  // worth. Summing exposure here inflated the account roughly threefold.
  const totalValue = round2(cash + positions.reduce((s, p) => s + signedMarketValue(p), 0));

  const byTicker = new Map<string, number>();
  for (const p of positions) {
    byTicker.set(p.ticker, (byTicker.get(p.ticker) ?? 0) + Math.abs(p.exposure));
  }
  const largestConcentration =
    grossExposure > 0 ? Math.max(...[...byTicker.values()]) / grossExposure : 0;

  const correlatedClusters = CORRELATION_GROUPS.map((g) => {
    const share =
      grossExposure > 0
        ? positions
            .filter((p) => g.tickers.includes(p.ticker))
            .reduce((s, p) => s + Math.abs(p.exposure), 0) / grossExposure
        : 0;
    return { label: g.label, tickers: g.tickers.filter((t) => byTicker.has(t)), share: round4(share) };
  }).filter((c) => c.tickers.length > 1);

  const weekOut = Date.now() + 7 * 86_400_000;
  const upcomingExpirations = positions.filter(
    (p) => p.expiration !== null && new Date(`${p.expiration}T20:00:00Z`).getTime() <= weekOut,
  );

  return {
    totalValue,
    cash,
    unrealizedPnl,
    unrealizedPnlPercent: totalValue > 0 ? round2((unrealizedPnl / totalValue) * 100) : 0,
    positions,
    largestConcentration: round4(largestConcentration),
    correlatedClusters,
    upcomingExpirations,
    accessMode: "read_only",
  };
}

export class MockBrokerageProvider implements BrokerageProvider {
  readonly id = SOURCE;
  readonly label = "Mock brokerage";
  readonly accessMode = "read_only" as const;

  async isConnected(userId: string): Promise<boolean> {
    void userId;
    return true;
  }

  async getPortfolio(userId: string): Promise<Sourced<PortfolioSummary>> {
    void userId;
    const positions = buildPositions(timeBucket(30));
    return sourced(
      summarize(positions, 48_500),
      provenance("MOCK", SOURCE, {
        note: "Synthetic portfolio. Not a real brokerage account.",
      }),
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
