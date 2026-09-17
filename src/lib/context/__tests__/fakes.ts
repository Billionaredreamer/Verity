/**
 * Fake providers for context-engine tests.
 *
 * These implement the real interfaces rather than being mocked at the module
 * boundary, so a change to a provider interface breaks these too — which is
 * the point. Each can be told to fail, so outage handling is testable.
 */

import type {
  BrokerageProvider,
  MarketDataProvider,
  NewsProvider,
  OptionsProvider,
  ProviderSet,
} from "@/lib/providers/types";
import type {
  DataState,
  PortfolioSummary,
  Position,
  Sourced,
  TickerSnapshot,
} from "@/lib/schema/core";
import { provenance, sourced } from "@/lib/providers/provenance";

export class FailingError extends Error {}

function p(state: DataState, source = "fake") {
  return provenance(state, source);
}

export function fakeSnapshot(over: Partial<TickerSnapshot> = {}): TickerSnapshot {
  return {
    ticker: "SPY",
    price: 660.68,
    change: -1.32,
    changePercent: -0.2,
    volume: 58_000_000,
    relativeVolume: 0.81,
    bid: 660.6,
    ask: 660.72,
    iv: 0.108,
    timestamp: "2026-09-17T18:00:00.000Z",
    open: 661.4,
    high: 663.1,
    low: 659.2,
    previousClose: 662,
    vwap: 660.83,
    dayRangePercent: 0.59,
    ...over,
  };
}

export function fakePosition(over: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    ticker: "SPY",
    kind: "option",
    quantity: 10,
    entryPrice: 5,
    markPrice: 6,
    strike: 660,
    expiration: "2026-09-18",
    side: "call",
    unrealizedPnl: 1000,
    unrealizedPnlPercent: 20,
    exposure: 330_000,
    delta: 500,
    gamma: 12,
    theta: -80,
    vega: 40,
    openedAt: "2026-09-10T14:00:00.000Z",
    ...over,
  };
}

export function fakePortfolio(over: Partial<PortfolioSummary> = {}): PortfolioSummary {
  const positions = over.positions ?? [fakePosition()];
  return {
    totalValue: 100_000,
    cash: 40_000,
    unrealizedPnl: 1000,
    unrealizedPnlPercent: 1,
    positions,
    largestConcentration: 1,
    correlatedClusters: [],
    upcomingExpirations: [],
    accessMode: "read_only",
    ...over,
  };
}

export class FakeMarket implements MarketDataProvider {
  readonly id = "fake";
  readonly label = "Fake market";
  readonly capabilities = { realtime: true, relativeVolume: true, vwap: true, breadth: true };
  constructor(
    private readonly state: DataState = "MOCK",
    private readonly fail = false,
  ) {}

  private guard() {
    if (this.fail) throw new FailingError("market provider is down");
  }
  async getSnapshot(ticker: string): Promise<Sourced<TickerSnapshot>> {
    this.guard();
    return sourced(fakeSnapshot({ ticker }), p(this.state));
  }
  async getSnapshots(tickers: string[]) {
    this.guard();
    return sourced(tickers.map((t) => fakeSnapshot({ ticker: t })), p(this.state));
  }
  async getIndexes() {
    this.guard();
    return sourced(
      [
        { symbol: "SPY", name: "SPY", price: 660.68, change: -1.32, changePercent: -0.2 },
        { symbol: "VIX", name: "VIX", price: 15.3, change: 0.8, changePercent: 5.5 },
      ],
      p(this.state),
    );
  }
  async getSectors() {
    this.guard();
    return sourced([], p(this.state));
  }
  async getBreadth() {
    this.guard();
    return sourced(
      {
        advancers: 200,
        decliners: 300,
        newHighs: 10,
        newLows: 20,
        percentAbove50dma: 0.4,
        percentAbove200dma: 0.5,
        upVolumeShare: 0.45,
      },
      p(this.state),
    );
  }
}

export class FakeOptions implements OptionsProvider {
  readonly id = "fake";
  readonly label = "Fake options";
  readonly capabilities = { greeks: true, sweepClassification: true, executionSide: true };
  constructor(private readonly fail = false) {}

  private guard() {
    if (this.fail) throw new FailingError("options provider is down");
  }
  async getExpirations() {
    this.guard();
    return sourced(["2026-09-18"], p("MOCK"));
  }
  async getChain(ticker: string) {
    this.guard();
    return sourced(
      {
        ticker,
        spot: 660.68,
        asOf: "2026-09-17T18:00:00.000Z",
        contracts: [
          {
            ticker,
            strike: 665,
            expiration: "2026-09-18",
            side: "call" as const,
            openInterest: 5000,
            volume: 1000,
            gamma: 0.02,
            delta: null,
            theta: null,
            vega: null,
            impliedVolatility: 0.12,
            bid: null,
            ask: null,
            lastPrice: null,
          },
          {
            ticker,
            strike: 655,
            expiration: "2026-09-18",
            side: "put" as const,
            openInterest: 6000,
            volume: 1200,
            gamma: 0.02,
            delta: null,
            theta: null,
            vega: null,
            impliedVolatility: 0.13,
            bid: null,
            ask: null,
            lastPrice: null,
          },
        ],
      },
      p("MOCK"),
    );
  }
  async getFlow() {
    this.guard();
    return sourced([], p("MOCK"));
  }
}

export class FakeNews implements NewsProvider {
  readonly id = "fake";
  readonly label = "Fake news";
  constructor(private readonly fail = false) {}
  async getNews() {
    if (this.fail) throw new FailingError("news provider is down");
    return sourced([], p("MOCK"));
  }
  async getEconomicCalendar() {
    if (this.fail) throw new FailingError("news provider is down");
    return sourced([], p("MOCK"));
  }
}

export class FakeBrokerage implements BrokerageProvider {
  readonly id = "fake";
  readonly label = "Fake brokerage";
  readonly accessMode = "read_only" as const;
  constructor(
    private readonly state: DataState = "MOCK",
    private readonly options: { fail?: boolean; portfolio?: PortfolioSummary } = {},
  ) {}

  async isConnected() {
    return !this.options.fail;
  }
  async getPortfolio(): Promise<Sourced<PortfolioSummary>> {
    if (this.options.fail) throw new FailingError("brokerage is unreachable");
    return sourced(this.options.portfolio ?? fakePortfolio(), p(this.state, "brokerage"));
  }
}

export function fakeProviders(over: Partial<ProviderSet> = {}): ProviderSet {
  return {
    market: new FakeMarket(),
    options: new FakeOptions(),
    news: new FakeNews(),
    brokerage: new FakeBrokerage(),
    ...over,
  };
}
