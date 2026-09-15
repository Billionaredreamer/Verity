/**
 * MOCK news and economic-calendar adapter.
 *
 * Headlines here are obviously synthetic by construction — they describe
 * generic corporate and macro events with no invented specifics, so nobody
 * mistakes a fixture for a real story (§12: every mock must be labeled).
 */

import type { EconomicEvent, NewsItem, Sourced } from "@/lib/schema/core";
import type { NewsProvider } from "@/lib/providers/types";
import { provenance, sourced } from "@/lib/providers/provenance";
import { hashSeed, intBetween, pick, rng, timeBucket } from "./random";
import { lookupOrSynthesize } from "./universe";

const SOURCE = "mock";

const HEADLINE_TEMPLATES = [
  "{T} sets date for next quarterly results",
  "Analyst updates price target on {T}",
  "{T} announces leadership change in its operations unit",
  "Options activity in {T} draws attention from desks",
  "{T} discloses routine filing with the SEC",
  "Sector peers move in sympathy with {T}",
  "{T} reaffirms prior full-year outlook",
  "Institutional holder adjusts stake in {T}",
] as const;

const PUBLISHERS = ["Mock Newswire", "Fixture Financial", "Sample Markets Desk"] as const;

function buildNews(ticker: string, index: number, bucket: number): NewsItem {
  const r = rng(hashSeed("news", ticker, index, bucket));
  const template = pick(r, HEADLINE_TEMPLATES);
  const minutesAgo = intBetween(r, 5, 600);
  return {
    id: `mock-news-${hashSeed(ticker, index, bucket).toString(36)}`,
    ticker,
    headline: template.replace("{T}", ticker),
    summary:
      "Placeholder summary from the mock news adapter. Replace this provider to receive licensed headlines.",
    url: null,
    publisher: pick(r, PUBLISHERS),
    publishedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

/**
 * The macro calendar is built from fixed weekday slots rather than random
 * dates, so the Markets screen shows a plausible-looking schedule.
 */
function buildCalendar(fromIso: string, toIso: string): EconomicEvent[] {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const out: EconomicEvent[] = [];
  const cursor = new Date(from);

  while (cursor <= to && out.length < 25) {
    const day = cursor.getUTCDay();
    const dateKey = cursor.toISOString().slice(0, 10);
    const r = rng(hashSeed("calendar", dateKey));

    if (day === 3 && r() > 0.5) {
      out.push(macro("cpi", "Consumer Price Index", dateKey, "13:30", "high"));
    }
    if (day === 5 && r() > 0.55) {
      out.push(macro("jobs", "Nonfarm Payrolls", dateKey, "13:30", "high"));
    }
    if (day === 2 && r() > 0.72) {
      out.push(macro("ppi", "Producer Price Index", dateKey, "13:30", "medium"));
    }
    if (day === 3 && r() > 0.85) {
      out.push(macro("fomc", "FOMC Rate Decision", dateKey, "19:00", "high"));
    }
    if (day === 4 && r() > 0.8) {
      out.push(macro("gdp", "GDP (Second Estimate)", dateKey, "13:30", "medium"));
    }
    // A couple of earnings prints per week, on liquid names.
    if ((day === 2 || day === 4) && r() > 0.6) {
      const ticker = pick(r, ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN", "META"] as const);
      out.push({
        id: `mock-earn-${dateKey}-${ticker}`,
        kind: "earnings",
        title: `${lookupOrSynthesize(ticker).name} quarterly results`,
        scheduledFor: `${dateKey}T21:00:00Z`,
        importance: "high",
        tickers: [ticker],
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
}

function macro(
  kind: EconomicEvent["kind"],
  title: string,
  dateKey: string,
  time: string,
  importance: EconomicEvent["importance"],
): EconomicEvent {
  return {
    id: `mock-${kind}-${dateKey}`,
    kind,
    title,
    scheduledFor: `${dateKey}T${time}:00Z`,
    importance,
    tickers: [],
  };
}

export class MockNewsProvider implements NewsProvider {
  readonly id = SOURCE;
  readonly label = "Mock news";

  private prov() {
    return provenance("MOCK", SOURCE, {
      note: "Synthetic headlines. Not real news.",
    });
  }

  async getNews(tickers: string[], limit: number): Promise<Sourced<NewsItem[]>> {
    const bucket = timeBucket(300);
    const list = tickers.length > 0 ? tickers : ["SPY", "QQQ", "NVDA"];
    const items: NewsItem[] = [];
    for (const ticker of list) {
      const r = rng(hashSeed("newscount", ticker, bucket));
      const count = intBetween(r, 0, 3);
      for (let i = 0; i < count; i++) items.push(buildNews(ticker, i, bucket));
    }
    items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return sourced(items.slice(0, limit), this.prov());
  }

  async getEconomicCalendar(fromIso: string, toIso: string): Promise<Sourced<EconomicEvent[]>> {
    return sourced(buildCalendar(fromIso, toIso), this.prov());
  }
}
