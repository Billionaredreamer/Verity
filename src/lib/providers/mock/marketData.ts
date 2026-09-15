/**
 * MOCK market-data adapter.
 *
 * Handover §12: "Mock data is fine during interface development, but every
 * mock must be labeled and replaceable." Every value this adapter returns is
 * stamped `DataState = "MOCK"`, and nothing in the app special-cases this
 * adapter — swapping in Polygon means registering a different implementation
 * of MarketDataProvider.
 */

import type {
  IndexQuote,
  MarketBreadth,
  SectorPerformance,
  Sourced,
  TickerSnapshot,
} from "@/lib/schema/core";
import type { MarketDataProvider } from "@/lib/providers/types";
import { provenance, sourced } from "@/lib/providers/provenance";
import {
  INDEX_SYMBOLS,
  SECTOR_LABELS,
  lookupOrSynthesize,
  UNIVERSE,
  type UniverseEntry,
} from "./universe";
import { between, gaussian, hashSeed, rng, timeBucket } from "./random";

const SOURCE = "mock";

/**
 * A single market-wide drift term so tickers move together the way a real
 * tape does. Without it, a mock "market" shows SPY up and every constituent
 * down, which makes the Markets and Signals screens nonsense to look at.
 */
function marketDrift(bucket: number): number {
  const r = rng(hashSeed("market-drift", Math.floor(bucket / 45)));
  return gaussian(r, 0, 0.006);
}

function buildSnapshot(entry: UniverseEntry, bucket: number): TickerSnapshot {
  const r = rng(hashSeed(entry.ticker, bucket));
  const drift = marketDrift(bucket);
  // Beta-ish response to the market plus idiosyncratic noise, scaled by the
  // ticker's own volatility anchor.
  const beta = entry.isIndexProxy ? 1 : between(r, 0.7, 1.6);
  const idio = gaussian(r, 0, entry.ivAnchor / 18);
  const changePercent = (drift * beta + idio) * 100;

  const previousClose = entry.reference;
  const price = round2(previousClose * (1 + changePercent / 100));
  const change = round2(price - previousClose);

  const relativeVolume = round2(between(r, 0.55, 2.4));
  const volume = Math.round(entry.avgVolume * relativeVolume * sessionProgress());

  const spreadPct = entry.isIndexProxy ? 0.00005 : between(r, 0.0002, 0.0012);
  const bid = round2(price * (1 - spreadPct));
  const ask = round2(price * (1 + spreadPct));

  // IV rises when the move is large relative to what the anchor implies.
  const moveStress = Math.min(2, Math.abs(changePercent) / (entry.ivAnchor * 100 / 16));
  const iv = round4(entry.ivAnchor * between(r, 0.88, 1.12) * (1 + 0.18 * (moveStress - 1)));

  const range = Math.abs(changePercent) + between(r, 0.15, 1.1);
  const high = round2(Math.max(price, previousClose) * (1 + range / 300));
  const low = round2(Math.min(price, previousClose) * (1 - range / 300));
  const open = round2(previousClose * (1 + gaussian(r, 0, 0.002)));
  const vwap = round2((high + low + price + open) / 4);

  return {
    ticker: entry.ticker,
    price,
    change,
    changePercent: round2(changePercent),
    volume,
    relativeVolume,
    bid,
    ask,
    iv,
    timestamp: new Date().toISOString(),
    open,
    high,
    low,
    previousClose,
    vwap,
    dayRangePercent: round2(((high - low) / previousClose) * 100),
  };
}

/** Fraction of the regular session elapsed, so volume accrues through the day. */
function sessionProgress(now: Date = new Date()): number {
  // Regular session 09:30–16:00 ET. Mock uses UTC-4/5 loosely; precision here
  // is not meaningful for fixture data.
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const minutes = et.getHours() * 60 + et.getMinutes();
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  if (minutes <= open) return 0.02;
  if (minutes >= close) return 1;
  return Math.max(0.02, (minutes - open) / (close - open));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** VIX is synthesized from the index proxies' stress rather than drawn free-hand. */
function vixQuote(bucket: number): IndexQuote {
  const spy = buildSnapshot(lookupOrSynthesize("SPY"), bucket);
  const r = rng(hashSeed("vix", bucket));
  const base = 14.5;
  // VIX rises when SPY falls — the asymmetry is the point.
  const level = base - spy.changePercent * 2.6 + between(r, -0.8, 0.8);
  const price = round2(Math.max(9, level));
  const previous = base;
  return {
    symbol: "VIX",
    name: "CBOE Volatility Index",
    price,
    change: round2(price - previous),
    changePercent: round2(((price - previous) / previous) * 100),
  };
}

export class MockMarketDataProvider implements MarketDataProvider {
  readonly id = SOURCE;
  readonly label = "Mock market data";
  readonly capabilities = {
    realtime: false,
    relativeVolume: true,
    vwap: true,
    breadth: true,
  };

  private prov() {
    return provenance("MOCK", SOURCE, {
      note: "Synthetic fixture data. Not a real quote.",
    });
  }

  async getSnapshot(ticker: string): Promise<Sourced<TickerSnapshot>> {
    const entry = lookupOrSynthesize(ticker);
    return sourced(buildSnapshot(entry, timeBucket()), this.prov());
  }

  async getSnapshots(tickers: string[]): Promise<Sourced<TickerSnapshot[]>> {
    const bucket = timeBucket();
    const data = tickers.map((t) => buildSnapshot(lookupOrSynthesize(t), bucket));
    return sourced(data, this.prov());
  }

  async getIndexes(): Promise<Sourced<IndexQuote[]>> {
    const bucket = timeBucket();
    const quotes: IndexQuote[] = INDEX_SYMBOLS.map((symbol) => {
      const entry = lookupOrSynthesize(symbol);
      const s = buildSnapshot(entry, bucket);
      return {
        symbol,
        name: entry.name,
        price: s.price,
        change: s.change,
        changePercent: s.changePercent,
      };
    });
    quotes.push(vixQuote(bucket));
    return sourced(quotes, this.prov());
  }

  async getSectors(): Promise<Sourced<SectorPerformance[]>> {
    const bucket = timeBucket();
    const drift = marketDrift(bucket);
    const data: SectorPerformance[] = (
      Object.keys(SECTOR_LABELS) as Array<keyof typeof SECTOR_LABELS>
    ).map((sector) => {
      const r = rng(hashSeed("sector", sector, bucket));
      const beta = between(r, 0.6, 1.5);
      return {
        sector,
        label: SECTOR_LABELS[sector],
        changePercent: round2((drift * beta + gaussian(r, 0, 0.004)) * 100),
        relativeVolume: round2(between(r, 0.7, 1.6)),
      };
    });
    return sourced(data, this.prov());
  }

  async getBreadth(): Promise<Sourced<MarketBreadth>> {
    const bucket = timeBucket();
    const r = rng(hashSeed("breadth", bucket));
    const drift = marketDrift(bucket);
    // Breadth leans with the drift, so a green tape shows more advancers.
    const advShare = Math.min(0.92, Math.max(0.08, 0.5 + drift * 28 + gaussian(r, 0, 0.05)));
    const total = 503;
    const advancers = Math.round(total * advShare);
    return sourced(
      {
        advancers,
        decliners: total - advancers,
        newHighs: Math.round(between(r, 4, 90) * advShare * 2),
        newLows: Math.round(between(r, 4, 90) * (1 - advShare) * 2),
        percentAbove50dma: round2(Math.min(0.95, Math.max(0.1, advShare * 0.9 + 0.08))),
        percentAbove200dma: round2(Math.min(0.95, Math.max(0.1, advShare * 0.7 + 0.2))),
        upVolumeShare: round2(Math.min(0.95, Math.max(0.05, advShare + gaussian(r, 0, 0.04)))),
      },
      this.prov(),
    );
  }
}

/** Exported for the mock options adapter, which needs the same spot prices. */
export function mockSpot(ticker: string, bucket = timeBucket()): number {
  return buildSnapshot(lookupOrSynthesize(ticker), bucket).price;
}

export { UNIVERSE };
