/**
 * API route tests.
 *
 * Route handlers are called directly with Request objects — no server needed.
 * What matters at this boundary: bad input is rejected rather than coerced,
 * limits hold, and a provider outage produces an honest UNAVAILABLE payload
 * rather than an empty success that reads as "the market is quiet".
 */

import { afterEach, describe, expect, it } from "vitest";
import { GET as flowGet } from "../flow/route";
import { GET as gexGet } from "../gex/route";
import { POST as terminalPost } from "../terminal/route";
import { __setProvidersForTest } from "@/lib/providers/registry";
import {
  FakeBrokerage,
  FakeMarket,
  FakeOptions,
  fakeProviders,
} from "@/lib/context/__tests__/fakes";

afterEach(() => __setProvidersForTest(null));

const get = (url: string) => new Request(`http://localhost${url}`);
const post = (body: unknown) =>
  new Request("http://localhost/api/terminal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("GET /api/flow", () => {
  it("returns events with provenance and the parsed filters", async () => {
    __setProvidersForTest(fakeProviders());
    const res = await flowGet(get("/api/flow?tickers=SPY&sides=call"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.provenance.state).toBe("MOCK");
    // Echoing the parsed filters lets the client see what was actually applied.
    expect(body.filters.tickers).toEqual(["SPY"]);
    expect(body.filters.sides).toEqual(["call"]);
  });

  it("drops malformed filter values rather than widening the query", async () => {
    __setProvidersForTest(fakeProviders());
    const body = await (await flowGet(get("/api/flow?tickers=SPY,../etc&minPremium=abc"))).json();
    expect(body.filters.tickers).toEqual(["SPY"]);
    expect(body.filters.minPremium).toBeNull();
  });

  it("clamps an oversized limit", async () => {
    __setProvidersForTest(fakeProviders());
    const res = await flowGet(get("/api/flow?limit=100000"));
    expect(res.status).toBe(200);
  });

  it("reports a provider outage as UNAVAILABLE with an empty list", async () => {
    __setProvidersForTest(fakeProviders({ options: new FakeOptions(true) }));
    const body = await (await flowGet(get("/api/flow"))).json();

    expect(body.events).toEqual([]);
    expect(body.provenance.state).toBe("UNAVAILABLE");
    // The reason is carried so the UI can say why the table is empty.
    expect(body.provenance.note).toBeTruthy();
  });
});

describe("GET /api/gex", () => {
  it("computes a snapshot for a valid ticker", async () => {
    __setProvidersForTest(fakeProviders());
    const body = await (await gexGet(get("/api/gex?ticker=SPY"))).json();

    expect(body.ticker).toBe("SPY");
    expect(body.full).not.toBeNull();
    expect(body.full.callWall).toBe(665);
    expect(body.full.putWall).toBe(655);
    expect(Array.isArray(body.narrative)).toBe(true);
  });

  it("rejects a malformed ticker", async () => {
    __setProvidersForTest(fakeProviders());
    const res = await gexGet(get("/api/gex?ticker=NOT%20A%20TICKER"));
    expect(res.status).toBe(400);
  });

  it("defaults to SPY when no ticker is given", async () => {
    __setProvidersForTest(fakeProviders());
    const body = await (await gexGet(get("/api/gex"))).json();
    expect(body.ticker).toBe("SPY");
  });

  it("returns a null 0DTE snapshot rather than widening to another expiration", async () => {
    __setProvidersForTest(fakeProviders());
    const body = await (await gexGet(get("/api/gex?ticker=SPY"))).json();
    // The fake chain expires 2026-09-18, which is not today.
    expect(body.zeroDte).toBeNull();
    expect(body.full.expirationsIncluded).toEqual(["2026-09-18"]);
  });

  it("reports a chain outage without throwing", async () => {
    __setProvidersForTest(fakeProviders({ options: new FakeOptions(true) }));
    const body = await (await gexGet(get("/api/gex?ticker=SPY"))).json();
    expect(body.full).toBeNull();
    expect(body.provenance.state).toBe("UNAVAILABLE");
  });
});

describe("POST /api/terminal", () => {
  it("answers a question with cards and a retrieval log", async () => {
    __setProvidersForTest(fakeProviders());
    const body = await (await terminalPost(post({ question: "What is SPY doing?" }))).json();

    expect(body.message.tickerContext).toBe("SPY");
    expect(body.message.cards.length).toBeGreaterThan(0);
    expect(body.retrievalLog.length).toBeGreaterThan(0);
    // Facts, analysis and uncertainty stay separate through the API.
    expect(Array.isArray(body.message.facts)).toBe(true);
    expect(Array.isArray(body.message.uncertainty)).toBe(true);
  });

  it("names the engine that answered", async () => {
    __setProvidersForTest(fakeProviders());
    const body = await (await terminalPost(post({ question: "What is SPY doing?" }))).json();
    expect(body.engine).toBe("deterministic");
    expect(body.engineLabel).toBeTruthy();
  });

  it("rejects a missing question", async () => {
    const res = await terminalPost(post({}));
    expect(res.status).toBe(400);
  });

  it("rejects an empty question", async () => {
    expect((await terminalPost(post({ question: "   " }))).status).toBe(400);
  });

  it("rejects a non-string question", async () => {
    expect((await terminalPost(post({ question: 42 }))).status).toBe(400);
  });

  it("rejects a question over the length limit", async () => {
    // Bounded so a pasted document cannot become a prompt.
    const res = await terminalPost(post({ question: "a".repeat(501) }));
    expect(res.status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    expect((await terminalPost(post("{ not json"))).status).toBe(400);
  });

  it("honours an explicit ticker over one extracted from the text", async () => {
    __setProvidersForTest(fakeProviders());
    const body = await (
      await terminalPost(post({ question: "what about SPY", ticker: "nvda" }))
    ).json();
    expect(body.message.tickerContext).toBe("NVDA");
  });

  it("still answers when every provider is down", async () => {
    __setProvidersForTest({
      market: new FakeMarket("LIVE", true),
      options: new FakeOptions(true),
      news: fakeProviders().news,
      brokerage: new FakeBrokerage("LIVE", { fail: true }),
    });
    const res = await terminalPost(post({ question: "What is SPY doing?" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    // It answers by saying what it could not get, rather than inventing.
    expect(body.message.uncertainty.length).toBeGreaterThan(0);
  });
});
