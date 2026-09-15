/**
 * Provider adapter interfaces.
 *
 * Handover §9: "Provider names are candidates, not hard dependencies.
 * Architecture must permit replacement without rewriting the product."
 * §12: "Keep providers replaceable behind adapters/interfaces."
 *
 * Everything above this boundary speaks only the internal schemas in
 * src/lib/schema/core.ts. A new provider means a new file in this directory
 * and one line in registry.ts — no changes to engines, routes or UI.
 */

import type {
  EconomicEvent,
  FlowEvent,
  FlowFilters,
  IndexQuote,
  MarketBreadth,
  NewsItem,
  OptionsChain,
  PortfolioSummary,
  SectorPerformance,
  Sourced,
  TickerSnapshot,
} from "@/lib/schema/core";

/**
 * Adapters never throw for an upstream failure. They return an UNAVAILABLE
 * `Provenance` with a note, because §10 requires provider outages to be
 * handled explicitly and forbids silently substituting stale data. A thrown
 * error is reserved for programmer mistakes (bad arguments, missing config).
 */

export interface MarketDataProvider {
  readonly id: string;
  /** Human label for the UI's data-source panel. */
  readonly label: string;
  /** What this adapter can actually deliver, for capability checks. */
  readonly capabilities: {
    realtime: boolean;
    relativeVolume: boolean;
    vwap: boolean;
    breadth: boolean;
  };

  getSnapshot(ticker: string): Promise<Sourced<TickerSnapshot>>;
  getSnapshots(tickers: string[]): Promise<Sourced<TickerSnapshot[]>>;
  getIndexes(): Promise<Sourced<IndexQuote[]>>;
  getSectors(): Promise<Sourced<SectorPerformance[]>>;
  getBreadth(): Promise<Sourced<MarketBreadth>>;
}

export interface OptionsProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: {
    /** Provider supplies per-contract greeks (otherwise gammaEngine models them). */
    greeks: boolean;
    /** Provider distinguishes sweeps from blocks. */
    sweepClassification: boolean;
    /** Provider reports the execution side of a print. */
    executionSide: boolean;
  };

  getChain(ticker: string, expirations?: string[]): Promise<Sourced<OptionsChain>>;
  getExpirations(ticker: string): Promise<Sourced<string[]>>;
  /**
   * Filtering happens provider-side where supported and in flowEngine
   * otherwise, so callers get identical results either way.
   */
  getFlow(filters: FlowFilters, limit: number): Promise<Sourced<FlowEvent[]>>;
}

export interface NewsProvider {
  readonly id: string;
  readonly label: string;

  getNews(tickers: string[], limit: number): Promise<Sourced<NewsItem[]>>;
  getEconomicCalendar(fromIso: string, toIso: string): Promise<Sourced<EconomicEvent[]>>;
}

/**
 * Read-only by contract. §12: "No brokerage execution in V1" — there is
 * deliberately no order-placement method here, so execution cannot be added
 * by accident; it would require changing this interface.
 */
export interface BrokerageProvider {
  readonly id: string;
  readonly label: string;
  readonly accessMode: "read_only";

  getPortfolio(userId: string): Promise<Sourced<PortfolioSummary>>;
  isConnected(userId: string): Promise<boolean>;
}

export interface ProviderSet {
  market: MarketDataProvider;
  options: OptionsProvider;
  news: NewsProvider;
  brokerage: BrokerageProvider;
}
