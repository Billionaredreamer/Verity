/**
 * Reasoner tests.
 *
 * The behaviour under test is the whole safety story of the AI layer: when a
 * model answers with something it should not have, the trader must not see it,
 * and must be told the answer was replaced.
 *
 * `fetch` is stubbed rather than the class being subclassed, so the real
 * parse → validate → ground → fall back path runs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DeterministicReasoner, ModelReasoner, SYSTEM_PROMPT } from "../reasoner";
import type { VerityContextPackage } from "@/lib/schema/core";
import { provenance, sourced } from "@/lib/providers/provenance";

function pkg(over: Partial<VerityContextPackage> = {}): VerityContextPackage {
  const prov = provenance("MOCK", "test");
  return {
    question: "What is SPY doing?",
    ticker: "SPY",
    snapshot: sourced(
      {
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
      },
      prov,
    ),
    indexes: null,
    flow: null,
    gex: null,
    news: null,
    events: null,
    regime: null,
    portfolio: null,
    position: null,
    risk: null,
    assembledAt: "2026-09-17T18:00:00.000Z",
    retrievalLog: [{ key: "snapshot", state: "MOCK", ms: 2 }],
    ...over,
  };
}

/** Stub the Anthropic endpoint with a raw text body. */
function stubModel(text: string, ok = true) {
  const spy = vi.fn(async (_url: string, init?: { body?: string }) => {
    void _url;
    void init;
    return {
      ok,
      status: ok ? 200 : 503,
      json: async () => ({ content: [{ type: "text", text }] }),
    };
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The request body the stub last received, parsed. */
function lastRequestBody(spy: ReturnType<typeof stubModel>): Record<string, unknown> {
  const call = spy.mock.calls.at(0);
  if (!call) throw new Error("the model endpoint was never called");
  return JSON.parse(call[1]?.body ?? "{}") as Record<string, unknown>;
}

afterEach(() => vi.unstubAllGlobals());

describe("DeterministicReasoner", () => {
  it("produces only grounded facts", async () => {
    const answer = await new DeterministicReasoner().answer(pkg());
    expect(answer.engine).toBe("deterministic");
    expect(answer.facts.some((f) => f.includes("660.68"))).toBe(true);
  });

  it("names mock data as mock", async () => {
    const answer = await new DeterministicReasoner().answer(pkg());
    expect(answer.uncertainty.some((u) => u.includes("MOCK"))).toBe(true);
  });

  it("reports failed retrievals under uncertainty", async () => {
    const answer = await new DeterministicReasoner().answer(
      pkg({
        retrievalLog: [{ key: "gex", state: "UNAVAILABLE", ms: 5, note: "chain provider down" }],
      }),
    );
    expect(answer.uncertainty.some((u) => u.includes("Could not retrieve gex"))).toBe(true);
  });

  it("says so plainly when nothing was retrieved", async () => {
    const answer = await new DeterministicReasoner().answer(
      pkg({ snapshot: null, retrievalLog: [] }),
    );
    expect(answer.facts[0]).toContain("No market data");
  });
});

describe("ModelReasoner — accepting a good answer", () => {
  it("accepts a grounded, well-formed response", async () => {
    stubModel(
      JSON.stringify({
        text: "SPY is at 660.68 and below VWAP.",
        facts: ["SPY is at 660.68."],
        analysis: ["Price is below VWAP."],
        uncertainty: ["Quote data is MOCK."],
      }),
    );
    const answer = await new ModelReasoner("key").answer(pkg());
    expect(answer.engine).toBe("model");
    expect(answer.facts).toEqual(["SPY is at 660.68."]);
  });

  it("sends the system prompt and does not give the model any tools", async () => {
    const spy = stubModel(
      JSON.stringify({ text: "Price is below VWAP.", facts: [], analysis: [], uncertainty: [] }),
    );
    await new ModelReasoner("key").answer(pkg());
    const body = lastRequestBody(spy);
    expect(body.system).toBe(SYSTEM_PROMPT);
    // §8: the model reasons over the package and has no market endpoints.
    expect(body.tools).toBeUndefined();
  });
});

describe("ModelReasoner — rejecting a bad answer", () => {
  it("REJECTS an invented price and answers deterministically instead", async () => {
    stubModel(
      JSON.stringify({
        text: "SPY just printed 712.45 on heavy volume.",
        facts: ["SPY is at 712.45."],
        analysis: [],
        uncertainty: [],
      }),
    );
    const answer = await new ModelReasoner("key").answer(pkg());

    expect(answer.engine).toBe("deterministic");
    // The invented figure must not survive anywhere in the output.
    expect(JSON.stringify(answer)).not.toContain("712.45");
  });

  it("tells the user the answer was rejected, and why", async () => {
    stubModel(
      JSON.stringify({ text: "The call wall is at 999.99.", facts: [], analysis: [], uncertainty: [] }),
    );
    const answer = await new ModelReasoner("key").answer(pkg());
    expect(answer.uncertainty[0]).toContain("rejected");
    expect(answer.engineLabel).toContain("rejected");
  });

  it("rejects malformed JSON", async () => {
    stubModel("this is not JSON at all");
    const answer = await new ModelReasoner("key").answer(pkg());
    expect(answer.engine).toBe("deterministic");
  });

  it("rejects a response with the wrong field types", async () => {
    stubModel(JSON.stringify({ text: "ok", facts: "not an array", analysis: [], uncertainty: [] }));
    const answer = await new ModelReasoner("key").answer(pkg());
    expect(answer.engine).toBe("deterministic");
    expect(answer.uncertainty[0]).toContain("malformed");
  });

  it("rejects a response missing required fields", async () => {
    stubModel(JSON.stringify({ text: "ok" }));
    const answer = await new ModelReasoner("key").answer(pkg());
    expect(answer.engine).toBe("deterministic");
  });

  it("distinguishes an outage from a rejection", async () => {
    stubModel("", false);
    const answer = await new ModelReasoner("key").answer(pkg());
    expect(answer.engineLabel).toContain("unavailable");
    expect(answer.uncertainty[0]).not.toContain("rejected");
  });

  it("does not leak the raw model response into the user-facing reason", async () => {
    stubModel(
      JSON.stringify({
        text: "SPY at 712.45 per internal-source-xyz.",
        facts: [],
        analysis: [],
        uncertainty: [],
      }),
    );
    const answer = await new ModelReasoner("key").answer(pkg());
    expect(JSON.stringify(answer)).not.toContain("internal-source-xyz");
  });

  it("still returns a usable answer after rejecting", async () => {
    stubModel(JSON.stringify({ text: "SPY at 712.45.", facts: [], analysis: [], uncertainty: [] }));
    const answer = await new ModelReasoner("key").answer(pkg());
    // Degradation is not the same as failure: the grounded facts still arrive.
    expect(answer.facts.some((f) => f.includes("660.68"))).toBe(true);
  });
});
