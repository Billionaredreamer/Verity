/**
 * Grounding tests.
 *
 * These pin the property the repository claims as non-negotiable: a model
 * cannot introduce a market figure that is not in the context package. Before
 * this layer existed the claim rested on the model following its prompt.
 */

import { describe, expect, it } from "vitest";
import { buildAllowlist, checkGrounding, extractNumbers, validateShape } from "../grounding";
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
    retrievalLog: [],
    ...over,
  };
}

describe("validateShape", () => {
  it("accepts a well-formed response", () => {
    const r = validateShape({ text: "ok", facts: ["a"], analysis: [], uncertainty: [] });
    expect("error" in r).toBe(false);
  });

  it("rejects a missing text field instead of coercing it", () => {
    // The bug being prevented: String(undefined) shipping "undefined" to a trader.
    const r = validateShape({ facts: [], analysis: [], uncertainty: [] });
    expect(r).toHaveProperty("error");
  });

  it("rejects empty text", () => {
    expect(validateShape({ text: "   ", facts: [], analysis: [], uncertainty: [] }))
      .toHaveProperty("error");
  });

  it("rejects a non-array facts field instead of substituting []", () => {
    // Silently emptying it would discard the evidence and keep the claim.
    const r = validateShape({ text: "x", facts: "not an array", analysis: [], uncertainty: [] });
    expect(r).toHaveProperty("error");
  });

  it("rejects arrays containing non-strings", () => {
    expect(validateShape({ text: "x", facts: [1, 2], analysis: [], uncertainty: [] }))
      .toHaveProperty("error");
  });

  it("rejects non-objects and arrays", () => {
    expect(validateShape(null)).toHaveProperty("error");
    expect(validateShape("a string")).toHaveProperty("error");
    expect(validateShape([])).toHaveProperty("error");
  });
});

describe("extractNumbers", () => {
  it("handles currency, separators and decimals", () => {
    const [n] = extractNumbers("Premium was $1,250,000.50 today");
    expect(n!.value).toBeCloseTo(1_250_000.5, 2);
  });

  it("scales K/M/B suffixes", () => {
    expect(extractNumbers("$59.0M")[0]!.scale).toBe(1e6);
    expect(extractNumbers("$2.4B")[0]!.scale).toBe(1e9);
    expect(extractNumbers("640K")[0]!.scale).toBe(1e3);
  });

  it("ignores digits inside ISO dates", () => {
    // Those are validated as dates, not as figures.
    expect(extractNumbers("expiring 2026-09-18")).toHaveLength(0);
  });

  it("records decimal places, which set the tolerance", () => {
    expect(extractNumbers("660.68")[0]!.decimals).toBe(2);
    expect(extractNumbers("660")[0]!.decimals).toBe(0);
  });
});

describe("buildAllowlist", () => {
  it("collects numbers from nested package values", () => {
    const list = buildAllowlist(pkg());
    expect(list.numbers).toContain(660.68);
    expect(list.numbers).toContain(0.81);
  });

  it("collects dates from ISO timestamps", () => {
    expect(buildAllowlist(pkg()).dates.has("2026-09-17")).toBe(true);
  });

  it("includes array lengths so counting the package is allowed", () => {
    const p = pkg({
      retrievalLog: [
        { key: "a", state: "MOCK", ms: 1 },
        { key: "b", state: "MOCK", ms: 1 },
        { key: "c", state: "MOCK", ms: 1 },
      ],
    });
    expect(buildAllowlist(p).numbers).toContain(3);
  });
});

describe("checkGrounding", () => {
  const answer = (over: Partial<Parameters<typeof checkGrounding>[0]> = {}) => ({
    text: "",
    facts: [],
    analysis: [],
    uncertainty: [],
    ...over,
  });

  it("accepts figures quoted from the package", () => {
    const r = checkGrounding(
      answer({ text: "SPY is at 660.68.", facts: ["Relative volume is 0.81x."] }),
      pkg(),
    );
    expect(r.ok).toBe(true);
  });

  it("REJECTS a price that is not in the package", () => {
    // The headline case: a plausible, invented level.
    const r = checkGrounding(answer({ text: "SPY is at 712.45." }), pkg());
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain("712.45");
  });

  it("rejects an invented figure anywhere in the response, not just in text", () => {
    for (const field of ["facts", "analysis", "uncertainty"] as const) {
      const r = checkGrounding(answer({ [field]: ["The call wall sits at 999.99."] }), pkg());
      expect(r.ok).toBe(false);
    }
  });

  it("rejects a date that is not in the package", () => {
    const r = checkGrounding(answer({ text: "Expiring 2031-01-17." }), pkg());
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toContain("2031-01-17");
  });

  it("accepts a figure written without its sign", () => {
    // Prose says "down 1.32" for a change of -1.32.
    expect(checkGrounding(answer({ text: "SPY is down 1.32 today." }), pkg()).ok).toBe(true);
  });

  it("accepts a percentage written from a stored decimal", () => {
    // iv is 0.108 in the package; "10.8%" is the same fact.
    expect(checkGrounding(answer({ text: "Implied volatility is 10.8%." }), pkg()).ok).toBe(true);
  });

  it("accepts a rounded large figure within its written precision", () => {
    const p = pkg({
      retrievalLog: [{ key: "flow", state: "MOCK", ms: 58_987_123 }],
    });
    // 58,987,123 rounds to $59.0M, and the tolerance scales with the suffix.
    expect(checkGrounding(answer({ text: "Premium was $59.0M." }), p).ok).toBe(true);
  });

  it("rejects a figure the model derived itself", () => {
    // price 660.68 and vwap 660.83 are both present, but their 0.02% gap is
    // not — §12 says the model does not calculate.
    const r = checkGrounding(answer({ text: "Price is 0.023% below VWAP." }), pkg());
    expect(r.ok).toBe(false);
  });

  it("accepts an answer with no figures at all", () => {
    expect(
      checkGrounding(answer({ text: "Price is below VWAP and volume is light." }), pkg()).ok,
    ).toBe(true);
  });

  it("reports every violation, not just the first", () => {
    const r = checkGrounding(
      answer({ text: "SPY at 712.45.", facts: ["Wall at 888.88.", "Flip at 777.77."] }),
      pkg(),
    );
    expect(r.violations.length).toBeGreaterThanOrEqual(3);
  });
});
