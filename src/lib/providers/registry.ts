/**
 * Provider registry — the single place where a concrete provider is chosen.
 *
 * Handover §9: "Architecture must permit replacement without rewriting the
 * product." Adding Polygon means writing a MarketDataProvider implementation
 * and adding one entry to MARKET_PROVIDERS below. Nothing else in the app
 * refers to a provider by name.
 *
 * SERVER ONLY. This module reads secrets from the environment, so it must
 * never be imported from a client component (§10).
 */

import "server-only";

import type {
  BrokerageProvider,
  MarketDataProvider,
  NewsProvider,
  OptionsProvider,
  ProviderSet,
} from "./types";
import { MockMarketDataProvider } from "./mock/marketData";
import { MockOptionsProvider } from "./mock/options";
import { MockNewsProvider } from "./mock/news";
import { MockBrokerageProvider } from "./mock/brokerage";

type Factory<T> = () => T;

/**
 * Registered implementations. Real adapters are added here as they are built;
 * the entries are intentionally absent rather than stubbed, so selecting an
 * unbuilt provider fails loudly at startup instead of silently serving mocks.
 */
const MARKET_PROVIDERS: Record<string, Factory<MarketDataProvider>> = {
  mock: () => new MockMarketDataProvider(),
};

const OPTIONS_PROVIDERS: Record<string, Factory<OptionsProvider>> = {
  mock: () => new MockOptionsProvider(),
};

const NEWS_PROVIDERS: Record<string, Factory<NewsProvider>> = {
  mock: () => new MockNewsProvider(),
};

const BROKERAGE_PROVIDERS: Record<string, Factory<BrokerageProvider>> = {
  mock: () => new MockBrokerageProvider(),
};

function resolve<T>(
  registry: Record<string, Factory<T>>,
  requested: string | undefined,
  envVar: string,
): T {
  const key = (requested ?? "mock").toLowerCase();
  const factory = registry[key];
  if (!factory) {
    const available = Object.keys(registry).join(", ");
    throw new Error(
      `${envVar}="${key}" is not a registered provider. Available: ${available}. ` +
        `Add an adapter in src/lib/providers/ and register it in registry.ts.`,
    );
  }
  return factory();
}

let cached: ProviderSet | null = null;

/** The provider set for this process. Built once. */
export function providers(): ProviderSet {
  if (cached) return cached;
  cached = {
    market: resolve(MARKET_PROVIDERS, process.env.VERITY_MARKET_PROVIDER, "VERITY_MARKET_PROVIDER"),
    options: resolve(OPTIONS_PROVIDERS, process.env.VERITY_OPTIONS_PROVIDER, "VERITY_OPTIONS_PROVIDER"),
    news: resolve(NEWS_PROVIDERS, process.env.VERITY_NEWS_PROVIDER, "VERITY_NEWS_PROVIDER"),
    brokerage: resolve(BROKERAGE_PROVIDERS, process.env.VERITY_BROKERAGE_PROVIDER, "VERITY_BROKERAGE_PROVIDER"),
  };
  return cached;
}

/** Test seam — lets a test swap in a fake without touching the environment. */
export function __setProvidersForTest(set: ProviderSet | null): void {
  cached = set;
}

/** Shown in the UI's data-source panel so the trader knows what is feeding the screen. */
export function providerSummary(): Array<{ role: string; id: string; label: string }> {
  const p = providers();
  return [
    { role: "Market data", id: p.market.id, label: p.market.label },
    { role: "Options", id: p.options.id, label: p.options.label },
    { role: "News", id: p.news.id, label: p.news.label },
    { role: "Brokerage", id: p.brokerage.id, label: p.brokerage.label },
  ];
}
