/**
 * MOCK options adapter: synthetic chains and an unusual-activity flow feed.
 *
 * The chain is generated with an open-interest profile that actually looks
 * like a real one — concentrated at round strikes, front-loaded in near
 * expirations, with a put skew below spot. gammaEngine is only interesting if
 * its input has structure, so the walls and the flip point here are emergent
 * rather than hard-coded.
 *
 * Every value is stamped MOCK (handover §12).
 */

import type {
  ExecutionSide,
  ExpirationBucket,
  FlowClassification,
  FlowEvent,
  FlowFilters,
  OptionContract,
  OptionsChain,
  OptionSide,
  Sourced,
} from "@/lib/schema/core";
import type { OptionsProvider } from "@/lib/providers/types";
import { provenance, sourced } from "@/lib/providers/provenance";
import { FLOW_UNIVERSE, lookupOrSynthesize } from "./universe";
import { mockSpot } from "./marketData";
import { between, gaussian, hashSeed, intBetween, pickWeighted, rng, timeBucket } from "./random";
import { gamma as bsGamma, delta as bsDelta, price as bsPrice, theta as bsTheta, vega as bsVega, yearsToExpiration } from "@/lib/math/blackScholes";
import { bucketForDte, daysBetween, toIsoDate, upcomingExpirations } from "@/lib/util/dates";
import { applyFlowFilters } from "@/lib/engines/flowEngine";

const SOURCE = "mock";

/** Contract multiplier. Kept named so dollar math is never a bare 100. */
const CONTRACT_MULTIPLIER = 100;

function strikeLadder(spot: number, increment: number, width = 0.14): number[] {
  const lo = spot * (1 - width);
  const hi = spot * (1 + width);
  const first = Math.ceil(lo / increment) * increment;
  const strikes: number[] = [];
  for (let k = first; k <= hi; k += increment) {
    strikes.push(Math.round(k * 100) / 100);
  }
  return strikes;
}

/**
 * Open interest profile: peaks near the money, decays with distance, and gets
 * a bump on round-number strikes where real positioning clusters.
 */
function openInterestFor(
  strike: number,
  spot: number,
  side: OptionSide,
  dte: number,
  liquidity: number,
  r: () => number,
): number {
  const moneyness = (strike - spot) / spot;
  const decay = Math.exp(-Math.pow(moneyness / 0.05, 2) / 2);
  // Calls cluster above spot, puts below — dealers are short the wings traders own.
  const sideSkew =
    side === "call"
      ? moneyness > 0
        ? 1.25
        : 0.7
      : moneyness < 0
        ? 1.45 // put skew is the heavier of the two
        : 0.6;
  const roundBump = strike % 10 === 0 ? 1.8 : strike % 5 === 0 ? 1.3 : 1;
  const termDecay = Math.exp(-dte / 45) * 0.8 + 0.2;
  const base = 9000 * liquidity * decay * sideSkew * roundBump * termDecay;
  return Math.max(0, Math.round(base * between(r, 0.55, 1.5)));
}

export function buildChain(ticker: string, expirations: string[], bucket: number): OptionsChain {
  const entry = lookupOrSynthesize(ticker);
  const spot = mockSpot(ticker, bucket);
  const strikes = strikeLadder(spot, entry.strikeIncrement);
  const contracts: OptionContract[] = [];
  const today = new Date();

  for (const expiration of expirations) {
    const dte = Math.max(0, daysBetween(today, new Date(`${expiration}T20:00:00Z`)));
    const t = yearsToExpiration(dte);
    for (const strike of strikes) {
      for (const side of ["call", "put"] as const) {
        const r = rng(hashSeed(ticker, expiration, strike, side, bucket));
        // Volatility smile: wings carry more IV than the body.
        const moneyness = Math.abs(strike - spot) / spot;
        const smile = 1 + Math.pow(moneyness / 0.1, 1.6) * 0.35;
        // Short-dated options trade at higher vol in stressed tape.
        const termPremium = dte <= 1 ? 1.25 : dte <= 7 ? 1.08 : 1;
        const iv = Math.max(0.05, entry.ivAnchor * smile * termPremium * between(r, 0.94, 1.06));

        const g = bsGamma({ spot, strike, t, vol: iv });
        const openInterest = openInterestFor(strike, spot, side, dte, entry.optionLiquidity, r);
        // Daily volume runs well under OI except on 0DTE, where it dominates.
        const volumeRatio = dte <= 1 ? between(r, 0.8, 4.5) : between(r, 0.02, 0.4);
        const theo = bsPrice({ spot, strike, t, vol: iv }, side);
        const spread = Math.max(0.01, theo * between(r, 0.01, 0.06));

        contracts.push({
          ticker: entry.ticker,
          strike,
          expiration,
          side,
          openInterest,
          volume: Math.round(openInterest * volumeRatio),
          gamma: g,
          delta: bsDelta({ spot, strike, t, vol: iv }, side),
          theta: bsTheta({ spot, strike, t, vol: iv }, side),
          vega: bsVega({ spot, strike, t, vol: iv }),
          impliedVolatility: Math.round(iv * 10000) / 10000,
          bid: Math.round(Math.max(0.01, theo - spread / 2) * 100) / 100,
          ask: Math.round((theo + spread / 2) * 100) / 100,
          lastPrice: Math.round(theo * 100) / 100,
        });
      }
    }
  }

  return { ticker: entry.ticker, spot, contracts, asOf: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Flow feed
// ---------------------------------------------------------------------------

const EXECUTION_SIDES: ReadonlyArray<[ExecutionSide, number]> = [
  ["ask", 36],
  ["bid", 30],
  ["midpoint", 26],
  // Real feeds genuinely can't classify some prints. Representing that is the
  // point — §4 forbids laundering an unknown into a directional read.
  ["unknown", 8],
];

const CLASSIFICATIONS: ReadonlyArray<[FlowClassification, number]> = [
  ["sweep", 30],
  ["block", 22],
  ["split", 20],
  ["single", 24],
  ["unknown", 4],
];

function buildFlowEvent(seedParts: Array<string | number>, bucket: number): FlowEvent {
  const r = rng(hashSeed(...seedParts));
  const ticker = FLOW_UNIVERSE[Math.floor(r() * FLOW_UNIVERSE.length)] ?? "SPY";
  const entry = lookupOrSynthesize(ticker);
  const spot = mockSpot(ticker, bucket);

  const expirations = upcomingExpirations(6);
  const expiration = expirations[Math.floor(r() * expirations.length)] ?? expirations[0]!;
  const dte = Math.max(0, daysBetween(new Date(), new Date(`${expiration}T20:00:00Z`)));

  const side: OptionSide = r() > 0.46 ? "call" : "put";
  // Strikes cluster near the money, with a tail out to the wings.
  const offset = gaussian(r, side === "call" ? 0.012 : -0.012, 0.03);
  const rawStrike = spot * (1 + offset);
  const strike = Math.round(rawStrike / entry.strikeIncrement) * entry.strikeIncrement;

  const t = yearsToExpiration(dte);
  const iv = entry.ivAnchor * between(r, 0.9, 1.35) * (dte <= 1 ? 1.2 : 1);
  const theo = Math.max(0.02, bsPrice({ spot, strike, t, vol: iv }, side));
  const spread = Math.max(0.01, theo * between(r, 0.015, 0.05));
  const bid = Math.round((theo - spread / 2) * 100) / 100;
  const ask = Math.round((theo + spread / 2) * 100) / 100;

  const classification = pickWeighted(r, CLASSIFICATIONS);
  const executionSide = pickWeighted(r, EXECUTION_SIDES);

  // Premium is log-distributed: many mid-size prints, a few very large ones.
  const contracts = Math.max(
    1,
    Math.round(Math.exp(between(r, Math.log(60), Math.log(9000))) * (classification === "block" ? 2.2 : 1)),
  );
  const fillPrice =
    executionSide === "ask" ? ask : executionSide === "bid" ? bid : Math.round(theo * 100) / 100;
  const premium = Math.round(contracts * fillPrice * CONTRACT_MULTIPLIER);

  const openInterest = openInterestFor(strike, spot, side, dte, entry.optionLiquidity, r);
  const volume = Math.max(contracts, Math.round(openInterest * between(r, 0.05, 1.6)));
  const volumeOiRatio = openInterest > 0 ? Math.round((volume / openInterest) * 100) / 100 : null;

  // An opening clue, not a determination: size well above resting OI is
  // suggestive, nothing more. Everything else stays null.
  const openCloseHint: FlowEvent["openCloseHint"] =
    openInterest > 0 && contracts > openInterest * 1.15
      ? "likely_opening"
      : openInterest > 0 && contracts > openInterest * 0.9 && r() > 0.7
        ? "likely_closing"
        : null;

  const minutesAgo = intBetween(r, 0, 240);
  const timestamp = new Date(Date.now() - minutesAgo * 60_000).toISOString();

  return {
    id: `mock-${hashSeed(...seedParts).toString(36)}`,
    ticker: entry.ticker,
    timestamp,
    strike,
    expiration,
    side,
    premium,
    contracts,
    volume,
    openInterest,
    volumeOiRatio,
    bid,
    ask,
    executionSide,
    classification,
    daysToExpiration: dte,
    expirationBucket: bucketForDte(dte, expiration),
    spot,
    impliedVolatility: Math.round(iv * 10000) / 10000,
    openCloseHint,
  };
}

export class MockOptionsProvider implements OptionsProvider {
  readonly id = SOURCE;
  readonly label = "Mock options";
  readonly capabilities = {
    greeks: true,
    sweepClassification: true,
    executionSide: true,
  };

  private prov() {
    return provenance("MOCK", SOURCE, {
      note: "Synthetic options data. Not real market activity.",
    });
  }

  async getExpirations(ticker: string): Promise<Sourced<string[]>> {
    void ticker;
    return sourced(upcomingExpirations(8), this.prov());
  }

  async getChain(ticker: string, expirations?: string[]): Promise<Sourced<OptionsChain>> {
    const exps = expirations?.length ? expirations : upcomingExpirations(4);
    return sourced(buildChain(ticker, exps, timeBucket(60)), this.prov());
  }

  async getFlow(filters: FlowFilters, limit: number): Promise<Sourced<FlowEvent[]>> {
    const bucket = timeBucket(30);
    // Generate a pool larger than the limit so filtering has something to bite
    // on, then let flowEngine do the filtering — identical code path to a real
    // provider that filters server-side and returns a superset.
    const pool: FlowEvent[] = [];
    for (let i = 0; i < 600; i++) {
      pool.push(buildFlowEvent(["flow", bucket, i], bucket));
    }
    const filtered = applyFlowFilters(pool, filters)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
    return sourced(filtered, this.prov());
  }
}

export function mockExpirationBucket(dte: number, expiration: string): ExpirationBucket {
  return bucketForDte(dte, expiration);
}

export { toIsoDate };
