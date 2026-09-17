/**
 * Context engine tests.
 *
 * Three things matter here and none were covered before: that retrieval is
 * planned sensibly, that a provider failure is recorded rather than swallowed,
 * and that derived values carry honest provenance and a real portfolio
 * denominator.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  assembleContext,
  buildContextCards,
  extractTicker,
  planRetrieval,
} from "../contextEngine";
import { __setProvidersForTest } from "@/lib/providers/registry";
import {
  FakeBrokerage,
  FakeMarket,
  FakeNews,
  FakeOptions,
  fakePortfolio,
  fakePosition,
  fakeProviders,
} from "./fakes";

afterEach(() => __setProvidersForTest(null));

describe("extractTicker", () => {
  const known = ["SPY", "QQQ", "NVDA", "GOOGL", "GOOG"];

  it("prefers an explicit $TICKER", () => {
    expect(extractTicker("what about $tsla", known)).toBe("TSLA");
  });

  it("matches a known symbol in prose", () => {
    expect(extractTicker("what are you seeing in NVDA?", known)).toBe("NVDA");
  });

  it("prefers the longest match so a shorter symbol does not shadow it", () => {
    expect(extractTicker("thoughts on GOOGL", known)).toBe("GOOGL");
  });

  it("returns null when no ticker is present", () => {
    expect(extractTicker("what matters right now?", known)).toBeNull();
  });

  it("does not match a symbol embedded in a longer word", () => {
    expect(extractTicker("inspyred by the market", known)).toBeNull();
  });
});

describe("planRetrieval", () => {
  it("pulls the full picture for a bare ticker question, per the §3 example", () => {
    const plan = planRetrieval("What is SPY doing?", "SPY");
    expect(plan.snapshot).toBe(true);
    expect(plan.flow).toBe(true);
    expect(plan.gex).toBe(true);
  });

  it("stays narrow for an explicit price-only question", () => {
    const plan = planRetrieval("what is the price of SPY", "SPY");
    expect(plan.snapshot).toBe(true);
    expect(plan.gex).toBe(false);
  });

  it("pulls news, flow and events for a 'why' question even without those words", () => {
    const plan = planRetrieval("Why did QQQ just drop?", "QQQ");
    expect(plan.news).toBe(true);
    expect(plan.flow).toBe(true);
    expect(plan.events).toBe(true);
  });

  it("falls back to the broad tape when no ticker is named", () => {
    const plan = planRetrieval("what matters right now?", null);
    expect(plan.indexes).toBe(true);
    expect(plan.regime).toBe(true);
  });

  it("pulls the position for a risk question", () => {
    expect(planRetrieval("what risks am I missing?", null).position).toBe(true);
  });

  it("never returns an all-false plan", () => {
    const plan = planRetrieval("hello", null);
    expect(Object.values(plan).some(Boolean)).toBe(true);
  });
});

describe("assembleContext — retrieval logging", () => {
  it("records each retrieval with its data state", async () => {
    __setProvidersForTest(fakeProviders());
    const pkg = await assembleContext({ question: "What is SPY doing?", ticker: "SPY", userId: "u" });
    const keys = pkg.retrievalLog.map((r) => r.key);
    expect(keys).toContain("snapshot");
    expect(pkg.retrievalLog.every((r) => typeof r.ms === "number")).toBe(true);
  });

  it("records a provider failure as UNAVAILABLE instead of throwing", async () => {
    __setProvidersForTest(fakeProviders({ options: new FakeOptions(true) }));
    const pkg = await assembleContext({ question: "options flow in SPY", ticker: "SPY", userId: "u" });
    const flow = pkg.retrievalLog.find((r) => r.key === "flow");
    expect(flow?.state).toBe("UNAVAILABLE");
    expect(flow?.note).toContain("down");
    // The rest of the package still assembled.
    expect(pkg.snapshot).not.toBeNull();
  });

  it("survives every provider failing at once", async () => {
    __setProvidersForTest({
      market: new FakeMarket("LIVE", true),
      options: new FakeOptions(true),
      news: new FakeNews(true),
      brokerage: new FakeBrokerage("LIVE", { fail: true }),
    });
    const pkg = await assembleContext({ question: "What is SPY doing?", ticker: "SPY", userId: "u" });
    expect(pkg.snapshot).toBeNull();
    expect(pkg.retrievalLog.every((r) => r.state === "UNAVAILABLE")).toBe(true);
  });
});

describe("assembleContext — portfolio and risk", () => {
  it("uses the real portfolio total, not the position's own size", async () => {
    // The regression: portfolioSize was the position size, so weight was 100%.
    const position = fakePosition({ kind: "equity", markPrice: 100, quantity: 100, exposure: 10_000 });
    __setProvidersForTest(
      fakeProviders({
        brokerage: new FakeBrokerage("MOCK", {
          portfolio: fakePortfolio({ totalValue: 100_000, positions: [position] }),
        }),
      }),
    );

    const pkg = await assembleContext({ question: "what risk am I carrying?", ticker: "SPY", userId: "u" });
    expect(pkg.risk).not.toBeNull();
    // $10,000 market value in a $100,000 portfolio.
    expect(pkg.risk!.data.positionWeight).toBeCloseTo(0.1, 6);
    expect(pkg.risk!.data.positionWeight).not.toBe(1);
  });

  it("computes weight from market value for an option, not notional exposure", async () => {
    // 10 contracts at a 6.00 mark = $6,000 of value, against $330,000 notional.
    const position = fakePosition({ markPrice: 6, quantity: 10, exposure: 330_000 });
    __setProvidersForTest(
      fakeProviders({
        brokerage: new FakeBrokerage("MOCK", {
          portfolio: fakePortfolio({ totalValue: 100_000, positions: [position] }),
        }),
      }),
    );
    const pkg = await assembleContext({ question: "my risk", ticker: "SPY", userId: "u" });
    expect(pkg.risk!.data.positionWeight).toBeCloseTo(0.06, 6);
  });

  it("produces no risk at all when the brokerage is unavailable", async () => {
    __setProvidersForTest(
      fakeProviders({ brokerage: new FakeBrokerage("LIVE", { fail: true }) }),
    );
    const pkg = await assembleContext({ question: "what risk am I carrying?", ticker: "SPY", userId: "u" });
    expect(pkg.portfolio).toBeNull();
    expect(pkg.risk).toBeNull();
    expect(pkg.retrievalLog.find((r) => r.key === "portfolio")?.state).toBe("UNAVAILABLE");
  });

  it("selects no position when the portfolio holds nothing for that ticker", async () => {
    __setProvidersForTest(
      fakeProviders({
        brokerage: new FakeBrokerage("MOCK", {
          portfolio: fakePortfolio({ positions: [fakePosition({ ticker: "AAPL" })] }),
        }),
      }),
    );
    const pkg = await assembleContext({ question: "my SPY risk", ticker: "SPY", userId: "u" });
    expect(pkg.position).toBeNull();
    expect(pkg.risk).toBeNull();
  });
});

describe("buildContextCards — provenance is inherited, never invented", () => {
  async function cardsWith(brokerageState: "LIVE" | "DELAYED" | "MOCK") {
    __setProvidersForTest(
      fakeProviders({
        market: new FakeMarket(brokerageState),
        brokerage: new FakeBrokerage(brokerageState),
      }),
    );
    const pkg = await assembleContext({ question: "what risk am I carrying?", ticker: "SPY", userId: "u" });
    return buildContextCards(pkg);
  }

  it("labels a position card with the brokerage's actual state", async () => {
    for (const state of ["LIVE", "DELAYED", "MOCK"] as const) {
      const card = (await cardsWith(state)).find((c) => c.kind === "position");
      expect(card?.provenance.state).toBe(state);
    }
  });

  it("labels risk derived from MOCK inputs as MOCK, not LIVE", async () => {
    // The regression: risk cards were hardcoded LIVE because the arithmetic
    // is deterministic. Determinism does not upgrade the inputs.
    const card = (await cardsWith("MOCK")).find((c) => c.kind === "risk");
    expect(card?.provenance.state).toBe("MOCK");
  });

  it("labels risk derived from DELAYED inputs as DELAYED", async () => {
    const card = (await cardsWith("DELAYED")).find((c) => c.kind === "risk");
    expect(card?.provenance.state).toBe("DELAYED");
  });

  it("takes the weakest state when inputs disagree", async () => {
    // Live quote, mock brokerage: the derived risk is mock.
    __setProvidersForTest(
      fakeProviders({ market: new FakeMarket("LIVE"), brokerage: new FakeBrokerage("MOCK") }),
    );
    const pkg = await assembleContext({ question: "what risk am I carrying?", ticker: "SPY", userId: "u" });
    expect(pkg.risk!.provenance.state).toBe("MOCK");
  });

  it("names riskEngine as the source while keeping the inputs' state", async () => {
    __setProvidersForTest(
      fakeProviders({ market: new FakeMarket("DELAYED"), brokerage: new FakeBrokerage("DELAYED") }),
    );
    const pkg = await assembleContext({ question: "my risk", ticker: "SPY", userId: "u" });
    // The source names the engine; the state still belongs to the inputs.
    expect(pkg.risk!.provenance.source).toBe("riskEngine");
    expect(pkg.risk!.provenance.state).toBe("DELAYED");
  });

  it("does not stamp a fresh observation time on derived values", async () => {
    __setProvidersForTest(fakeProviders({ brokerage: new FakeBrokerage("MOCK") }));
    const pkg = await assembleContext({ question: "my risk", ticker: "SPY", userId: "u" });
    // observedAt is inherited from the oldest input, not generated at render.
    expect(pkg.risk!.provenance.observedAt <= pkg.risk!.provenance.retrievedAt).toBe(true);
  });
});
