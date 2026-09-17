/**
 * Flow query parsing tests.
 *
 * This is the API's input boundary. The property that matters is that a
 * malformed value is DROPPED rather than coerced — a filter that silently
 * widens shows the trader more than they asked for, which is a quiet failure.
 */

import { describe, expect, it } from "vitest";
import { MAX_FLOW_LIMIT, parseFlowFilters, parseLimit } from "../flowQuery";

const parse = (qs: string) => parseFlowFilters(new URLSearchParams(qs));

describe("parseFlowFilters — tickers", () => {
  it("uppercases and splits a comma list", () => {
    expect(parse("tickers=spy,nvda").tickers).toEqual(["SPY", "NVDA"]);
  });

  it("drops values that are not symbol-shaped", () => {
    // This value reaches a provider query; anything odd is discarded.
    expect(parse("tickers=SPY,DROP TABLE,../etc,NVDA").tickers).toEqual(["SPY", "NVDA"]);
  });

  it("drops symbols that are too long", () => {
    expect(parse("tickers=ABCDEFGH").tickers).toEqual([]);
  });

  it("returns an empty list when absent", () => {
    expect(parse("").tickers).toEqual([]);
  });
});

describe("parseFlowFilters — enums", () => {
  it("accepts known values and drops unknown ones", () => {
    expect(parse("sides=call,put,sideways").sides).toEqual(["call", "put"]);
    expect(parse("buckets=0dte,weekly,forever").buckets).toEqual(["0dte", "weekly"]);
    expect(parse("classifications=sweep,rumour").classifications).toEqual(["sweep"]);
    expect(parse("executionSides=ask,telepathy").executionSides).toEqual(["ask"]);
  });

  it("is case-insensitive", () => {
    expect(parse("sides=CALL").sides).toEqual(["call"]);
  });
});

describe("parseFlowFilters — numbers", () => {
  it("parses valid bounds", () => {
    const f = parse("minPremium=50000&maxPremium=250000");
    expect(f.minPremium).toBe(50_000);
    expect(f.maxPremium).toBe(250_000);
  });

  it("returns null for a non-numeric value rather than 0", () => {
    // 0 would be a real filter meaning "at least nothing"; null means unset.
    expect(parse("minPremium=abc").minPremium).toBeNull();
  });

  it("rejects negatives", () => {
    expect(parse("minPremium=-5").minPremium).toBeNull();
  });

  it("treats an empty value as unset", () => {
    expect(parse("minPremium=").minPremium).toBeNull();
  });

  it("accepts a fractional volume/OI floor", () => {
    expect(parse("minVolumeOiRatio=1.5").minVolumeOiRatio).toBe(1.5);
  });
});

describe("parseFlowFilters — expirations", () => {
  it("keeps well-formed ISO dates", () => {
    expect(parse("expirations=2026-09-18,2026-09-25").expirations).toEqual([
      "2026-09-18",
      "2026-09-25",
    ]);
  });

  it("drops anything that is not an ISO date", () => {
    expect(parse("expirations=next friday,2026-09-18").expirations).toEqual(["2026-09-18"]);
  });
});

describe("parseLimit", () => {
  it("defaults when absent or unparseable", () => {
    expect(parseLimit(null)).toBe(100);
    expect(parseLimit("not a number")).toBe(100);
  });

  it("clamps to the maximum", () => {
    expect(parseLimit("99999")).toBe(MAX_FLOW_LIMIT);
  });

  it("clamps to at least 1", () => {
    expect(parseLimit("0")).toBe(1);
    expect(parseLimit("-10")).toBe(1);
  });

  it("floors fractional values", () => {
    expect(parseLimit("10.9")).toBe(10);
  });
});
