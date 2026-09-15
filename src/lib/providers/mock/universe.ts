/**
 * The mock universe: reference prices and characteristics used to synthesize
 * plausible market data.
 *
 * These are fixtures, not quotes. Nothing here is a claim about a real price —
 * every value derived from this file carries `DataState = "MOCK"`.
 */

import type { SectorKey } from "@/lib/schema/core";

export interface UniverseEntry {
  ticker: string;
  name: string;
  /** Anchor price the mock walk oscillates around. */
  reference: number;
  /** Annualized IV anchor, as a decimal. */
  ivAnchor: number;
  /** Typical daily volume, in shares. */
  avgVolume: number;
  sector: SectorKey | null;
  isIndexProxy: boolean;
  /** Strike spacing on the listed chain. */
  strikeIncrement: number;
  /** Relative options-market liquidity, scales open interest in the mock chain. */
  optionLiquidity: number;
}

export const UNIVERSE: readonly UniverseEntry[] = [
  { ticker: "SPY", name: "SPDR S&P 500 ETF Trust", reference: 662, ivAnchor: 0.13, avgVolume: 72_000_000, sector: null, isIndexProxy: true, strikeIncrement: 1, optionLiquidity: 1 },
  { ticker: "QQQ", name: "Invesco QQQ Trust", reference: 592, ivAnchor: 0.17, avgVolume: 41_000_000, sector: null, isIndexProxy: true, strikeIncrement: 1, optionLiquidity: 0.85 },
  { ticker: "IWM", name: "iShares Russell 2000 ETF", reference: 238, ivAnchor: 0.19, avgVolume: 28_000_000, sector: null, isIndexProxy: true, strikeIncrement: 1, optionLiquidity: 0.5 },
  { ticker: "DIA", name: "SPDR Dow Jones Industrial Average ETF", reference: 451, ivAnchor: 0.12, avgVolume: 3_400_000, sector: null, isIndexProxy: true, strikeIncrement: 1, optionLiquidity: 0.2 },
  { ticker: "NVDA", name: "NVIDIA Corporation", reference: 184, ivAnchor: 0.42, avgVolume: 195_000_000, sector: "technology", isIndexProxy: false, strikeIncrement: 2.5, optionLiquidity: 0.95 },
  { ticker: "AAPL", name: "Apple Inc.", reference: 241, ivAnchor: 0.24, avgVolume: 54_000_000, sector: "technology", isIndexProxy: false, strikeIncrement: 2.5, optionLiquidity: 0.8 },
  { ticker: "MSFT", name: "Microsoft Corporation", reference: 511, ivAnchor: 0.22, avgVolume: 21_000_000, sector: "technology", isIndexProxy: false, strikeIncrement: 5, optionLiquidity: 0.7 },
  { ticker: "TSLA", name: "Tesla, Inc.", reference: 408, ivAnchor: 0.52, avgVolume: 98_000_000, sector: "consumer_discretionary", isIndexProxy: false, strikeIncrement: 5, optionLiquidity: 0.9 },
  { ticker: "AMZN", name: "Amazon.com, Inc.", reference: 229, ivAnchor: 0.28, avgVolume: 39_000_000, sector: "consumer_discretionary", isIndexProxy: false, strikeIncrement: 2.5, optionLiquidity: 0.7 },
  { ticker: "META", name: "Meta Platforms, Inc.", reference: 624, ivAnchor: 0.31, avgVolume: 14_000_000, sector: "communications", isIndexProxy: false, strikeIncrement: 5, optionLiquidity: 0.65 },
  { ticker: "GOOGL", name: "Alphabet Inc.", reference: 252, ivAnchor: 0.26, avgVolume: 27_000_000, sector: "communications", isIndexProxy: false, strikeIncrement: 2.5, optionLiquidity: 0.6 },
  { ticker: "AMD", name: "Advanced Micro Devices, Inc.", reference: 162, ivAnchor: 0.45, avgVolume: 48_000_000, sector: "technology", isIndexProxy: false, strikeIncrement: 2.5, optionLiquidity: 0.6 },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", reference: 297, ivAnchor: 0.21, avgVolume: 9_100_000, sector: "financials", isIndexProxy: false, strikeIncrement: 5, optionLiquidity: 0.35 },
  { ticker: "XOM", name: "Exxon Mobil Corporation", reference: 118, ivAnchor: 0.23, avgVolume: 16_000_000, sector: "energy", isIndexProxy: false, strikeIncrement: 1, optionLiquidity: 0.3 },
  { ticker: "UNH", name: "UnitedHealth Group Incorporated", reference: 343, ivAnchor: 0.29, avgVolume: 4_800_000, sector: "healthcare", isIndexProxy: false, strikeIncrement: 5, optionLiquidity: 0.25 },
  { ticker: "CAT", name: "Caterpillar Inc.", reference: 428, ivAnchor: 0.25, avgVolume: 2_600_000, sector: "industrials", isIndexProxy: false, strikeIncrement: 5, optionLiquidity: 0.2 },
];

const BY_TICKER = new Map(UNIVERSE.map((u) => [u.ticker, u]));

export function lookup(ticker: string): UniverseEntry | undefined {
  return BY_TICKER.get(ticker.toUpperCase());
}

/**
 * Unknown tickers still resolve, so the UI can be exercised with anything the
 * user types. The entry is synthetic and still labeled MOCK downstream.
 */
export function lookupOrSynthesize(ticker: string): UniverseEntry {
  const known = lookup(ticker);
  if (known) return known;
  const t = ticker.toUpperCase();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 100000;
  const reference = 20 + (h % 380);
  return {
    ticker: t,
    name: `${t} (unlisted in mock universe)`,
    reference,
    ivAnchor: 0.25 + ((h % 30) / 100),
    avgVolume: 500_000 + (h % 9_500_000),
    sector: null,
    isIndexProxy: false,
    strikeIncrement: reference > 300 ? 5 : reference > 100 ? 2.5 : 1,
    optionLiquidity: 0.15,
  };
}

export const SECTOR_LABELS: Record<SectorKey, string> = {
  technology: "Technology",
  financials: "Financials",
  energy: "Energy",
  healthcare: "Healthcare",
  industrials: "Industrials",
  consumer_discretionary: "Consumer Discretionary",
  consumer_staples: "Consumer Staples",
  utilities: "Utilities",
  real_estate: "Real Estate",
  materials: "Materials",
  communications: "Communications",
};

/** Handover §6: "Indexes | SPY, QQQ, DIA, IWM" plus VIX for volatility context. */
export const INDEX_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"] as const;

/** Tickers the mock flow feed emits, weighted toward liquid options names. */
export const FLOW_UNIVERSE = UNIVERSE.filter((u) => u.optionLiquidity >= 0.2).map((u) => u.ticker);
