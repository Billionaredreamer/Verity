/**
 * Verity internal schemas.
 *
 * Handover §8: "Create internal schemas so the frontend and AI are not
 * tightly coupled to a single provider."
 *
 * RULE: no provider-shaped field ever crosses into this file. Provider
 * responses are translated into these types inside the adapter, and the
 * adapter is the only place that knows a provider's vocabulary. If a new
 * field is needed, add it here first and then teach each adapter how to
 * populate it (or return `null`, which means "this provider cannot tell us").
 */

// ---------------------------------------------------------------------------
// Data provenance
// ---------------------------------------------------------------------------

/**
 * Handover §2 and §10: every market-derived value must declare what it is.
 * `MOCK` is never silently substituted for `LIVE` — the UI renders the state
 * verbatim wherever the value appears.
 */
export type DataState = "LIVE" | "DELAYED" | "MOCK" | "UNAVAILABLE";

/**
 * Attached to every market-derived payload. §10: "Timestamp all
 * market-derived data" and "Store enough source context and timestamps to
 * explain where a result came from."
 */
export interface Provenance {
  state: DataState;
  /** Adapter id that produced the value, e.g. "mock", "polygon". */
  source: string;
  /** When the provider observed the data. ISO 8601. */
  observedAt: string;
  /** When Verity retrieved it. ISO 8601. */
  retrievedAt: string;
  /** Provider-stated delay in seconds, when the provider declares one. */
  delaySeconds: number | null;
  /** Populated when state is UNAVAILABLE — surfaced in the UI, not swallowed. */
  note?: string;
}

/** A value that always travels with its provenance. */
export interface Sourced<T> {
  data: T;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

/** Handover §8 names this object explicitly. */
export interface TickerSnapshot {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  /** Today's volume vs the trailing average. `null` if unknown. */
  relativeVolume: number | null;
  bid: number | null;
  ask: number | null;
  /** Implied volatility of the near-term ATM option, as a decimal (0.24 = 24%). */
  iv: number | null;
  timestamp: string;
  // Extensions beyond the handover's example, needed by Flow/GEX/Signals.
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  vwap: number | null;
  dayRangePercent: number | null;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export type SectorKey =
  | "technology"
  | "financials"
  | "energy"
  | "healthcare"
  | "industrials"
  | "consumer_discretionary"
  | "consumer_staples"
  | "utilities"
  | "real_estate"
  | "materials"
  | "communications";

export interface SectorPerformance {
  sector: SectorKey;
  label: string;
  changePercent: number;
  relativeVolume: number | null;
}

export interface MarketBreadth {
  advancers: number | null;
  decliners: number | null;
  newHighs: number | null;
  newLows: number | null;
  /** Share of constituents above their 50-day moving average, 0–1. */
  percentAbove50dma: number | null;
  percentAbove200dma: number | null;
  /** Up-volume share of total volume, 0–1. */
  upVolumeShare: number | null;
}

export type MarketRegime =
  | "risk_on"
  | "risk_off"
  | "neutral"
  | "volatility_expansion"
  | "volatility_compression";

export interface MarketRegimeAssessment {
  regime: MarketRegime;
  /** 0–1. Derived deterministically by marketRegimeEngine, never by the model. */
  confidence: number;
  /** Human-readable inputs that produced the label. §12 explainability. */
  drivers: string[];
}

export type EconomicEventKind =
  | "earnings"
  | "cpi"
  | "ppi"
  | "fomc"
  | "jobs"
  | "gdp"
  | "other";

export interface EconomicEvent {
  id: string;
  kind: EconomicEventKind;
  title: string;
  /** ISO 8601. */
  scheduledFor: string;
  importance: "high" | "medium" | "low";
  tickers: string[];
}

export interface NewsItem {
  id: string;
  ticker: string | null;
  headline: string;
  summary: string | null;
  url: string | null;
  publisher: string;
  publishedAt: string;
}

// ---------------------------------------------------------------------------
// Options flow — handover §4
// ---------------------------------------------------------------------------

export type OptionSide = "call" | "put";

/**
 * Where the trade printed relative to the quoted spread. This is the field
 * that makes the §4 interpretation rule possible: a large call bought on the
 * ask reads very differently from one sold on the bid, and `midpoint` or
 * `unknown` must not be laundered into either.
 */
export type ExecutionSide = "ask" | "bid" | "midpoint" | "unknown";

/** §4 "Sweep/block classification". */
export type FlowClassification = "sweep" | "block" | "split" | "single" | "unknown";

/** §4 filter group "0DTE / weekly / monthly". */
export type ExpirationBucket = "0dte" | "weekly" | "monthly" | "leaps";

/**
 * A single unusual-options-activity print. Every field listed under §4
 * "Required event fields" is present; fields a provider cannot supply are
 * `null` rather than guessed.
 */
export interface FlowEvent {
  id: string;
  ticker: string;
  timestamp: string;
  strike: number;
  /** ISO date, YYYY-MM-DD. */
  expiration: string;
  side: OptionSide;
  /** Total dollar premium of the print. */
  premium: number;
  contracts: number;
  /** Contract volume for the day, on this strike/expiration. */
  volume: number;
  openInterest: number;
  /** volume / openInterest. `null` when OI is zero or unknown. */
  volumeOiRatio: number | null;
  bid: number | null;
  ask: number | null;
  executionSide: ExecutionSide;
  classification: FlowClassification;
  daysToExpiration: number;
  expirationBucket: ExpirationBucket;
  /** Underlying spot at print time (§4 "Underlying spot price"). */
  spot: number;
  /** Contract implied volatility as a decimal. */
  impliedVolatility: number | null;
  /**
   * Opening-vs-closing is rarely knowable from a single print. `null` means
   * "no evidence", which is different from "closing". §4 says to use
   * "opening-vs-closing clues when available" — so this is a clue, not a fact.
   */
  openCloseHint: "likely_opening" | "likely_closing" | null;
}

/** §4 "Required filters", one field per listed filter. */
export interface FlowFilters {
  tickers: string[];
  sides: OptionSide[];
  minPremium: number | null;
  maxPremium: number | null;
  /** Exact expiration dates, YYYY-MM-DD. */
  expirations: string[];
  buckets: ExpirationBucket[];
  classifications: FlowClassification[];
  minVolumeOiRatio: number | null;
  executionSides: ExecutionSide[];
}

export const EMPTY_FLOW_FILTERS: FlowFilters = {
  tickers: [],
  sides: [],
  minPremium: null,
  maxPremium: null,
  expirations: [],
  buckets: [],
  classifications: [],
  minVolumeOiRatio: null,
  executionSides: [],
};

// ---------------------------------------------------------------------------
// Options chain — the raw input to gammaEngine
// ---------------------------------------------------------------------------

export interface OptionContract {
  ticker: string;
  strike: number;
  expiration: string;
  side: OptionSide;
  openInterest: number;
  volume: number;
  /** Per-contract gamma from the provider, if supplied. */
  gamma: number | null;
  delta: number | null;
  theta: number | null;
  vega: number | null;
  impliedVolatility: number | null;
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
}

export interface OptionsChain {
  ticker: string;
  spot: number;
  contracts: OptionContract[];
  asOf: string;
}

// ---------------------------------------------------------------------------
// Gamma exposure — handover §5
// ---------------------------------------------------------------------------

export interface GammaByStrike {
  strike: number;
  callGamma: number;
  putGamma: number;
  netGamma: number;
  callOpenInterest: number;
  putOpenInterest: number;
}

export interface GammaByExpiration {
  expiration: string;
  netGamma: number;
  daysToExpiration: number;
}

/** §5 "Dealer gamma regime". */
export type DealerGammaRegime = "long_gamma" | "short_gamma" | "transitional";

export interface GexSnapshot {
  ticker: string;
  spot: number;
  /** Dollar gamma per 1% move in the underlying. */
  totalGamma: number;
  positiveGamma: number;
  negativeGamma: number;
  /** Strike where net gamma crosses zero. `null` when no crossing exists. */
  zeroGamma: number | null;
  /**
   * Distinct from zeroGamma: the interpolated price at which dealer
   * positioning flips sign, computed from the cumulative profile.
   */
  gammaFlip: number | null;
  /** Strike with the largest positive call gamma concentration. */
  callWall: number | null;
  /** Strike with the largest negative put gamma concentration. */
  putWall: number | null;
  byStrike: GammaByStrike[];
  byExpiration: GammaByExpiration[];
  regime: DealerGammaRegime;
  /** Expirations included in this snapshot. A 0DTE snapshot holds exactly one. */
  expirationsIncluded: string[];
  asOf: string;
}

// ---------------------------------------------------------------------------
// Signals — handover §6
// ---------------------------------------------------------------------------

export type SignalFactorKey =
  | "flow"
  | "relative_volume"
  | "momentum"
  | "price_structure"
  | "vwap"
  | "gamma"
  | "volatility"
  | "sector_context"
  | "news"
  | "earnings";

export interface SignalFactor {
  key: SignalFactorKey;
  label: string;
  /** 0–10, per the §6 example ("Flow 8/10"). */
  score: number;
  /** Why this factor scored as it did. Deterministic text from signalEngine. */
  detail: string;
}

export interface Signal {
  id: string;
  ticker: string;
  /** §6: "no simplistic BUY/SELL output" — a direction with evidence, not an order. */
  direction: "bullish" | "bearish" | "neutral";
  factors: SignalFactor[];
  /** 0–1. */
  confidence: number;
  /** §6 "Every setup includes 'Why Verity noticed this.'" */
  whyNoticed: string;
  supportingEvidence: string[];
  risks: string[];
  /** What would falsify the setup. Required — a setup with no invalidation is not a setup. */
  invalidationConditions: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Portfolio & risk — handover §7
// ---------------------------------------------------------------------------

export type InstrumentKind = "equity" | "option";

export interface Position {
  id: string;
  ticker: string;
  kind: InstrumentKind;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  /** Option legs only. */
  strike: number | null;
  expiration: string | null;
  side: OptionSide | null;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  /** Notional exposure in dollars. */
  exposure: number;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  openedAt: string | null;
}

export interface PortfolioSummary {
  totalValue: number;
  cash: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  positions: Position[];
  /** Largest single-ticker share of gross exposure, 0–1. */
  largestConcentration: number;
  /** Tickers whose combined exposure is flagged as correlated. */
  correlatedClusters: Array<{ label: string; tickers: string[]; share: number }>;
  /** Positions expiring within the next 7 calendar days. */
  upcomingExpirations: Position[];
  /** Read-only in V1 — handover §7, §12 "No brokerage execution in V1". */
  accessMode: "read_only";
}

/**
 * Inputs to riskEngine. §7: "Risk calculations must be deterministic backend
 * logic. The AI can explain the result, but should not invent the numbers."
 */
export interface RiskInput {
  positionSize: number;
  portfolioSize: number;
  entry: number;
  stop: number | null;
  optionPremium: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  daysToExpiration: number | null;
  /** Annualized volatility as a decimal. */
  volatility: number | null;
  /** Share of the portfolio in this ticker, 0–1. */
  concentration: number | null;
}

export interface RiskAssessment {
  /** Share of the portfolio at stake if the stop is hit, 0–1. */
  riskPercent: number | null;
  dollarRisk: number | null;
  /** Position size as a share of the portfolio, 0–1. */
  positionWeight: number;
  /** Dollar P/L per 1% move in the underlying, from delta. */
  dollarsPerPercentMove: number | null;
  /** Premium decay per day, from theta. */
  dailyThetaCost: number | null;
  /** 1-day move at one standard deviation, in dollars. */
  oneSigmaDailyMove: number | null;
  concentrationFlag: "ok" | "elevated" | "high";
  /** Ordered, human-readable warnings. Deterministic — the model only relays these. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Trade monitoring — handover §7
// ---------------------------------------------------------------------------

/** The §7 monitored-condition list, one member per bullet. */
export type MonitorDimension =
  | "price_and_levels"
  | "volume"
  | "options_flow"
  | "gamma"
  | "implied_volatility"
  | "index_and_sector"
  | "news_catalysts"
  | "technical_levels"
  | "position_pnl";

export interface TradeMonitor {
  id: string;
  ticker: string;
  /** Set when the monitor watches a specific position rather than a ticker. */
  positionId: string | null;
  dimensions: MonitorDimension[];
  /** Free-text instruction the user gave, kept verbatim for explainability. */
  instruction: string;
  status: "active" | "paused" | "expired";
  createdAt: string;
  lastEvaluatedAt: string | null;
}

export type AlertSeverity = "info" | "notable" | "urgent";

export interface Alert {
  id: string;
  monitorId: string | null;
  ticker: string;
  severity: AlertSeverity;
  /** §7 alert examples are single sentences — keep them that way. */
  message: string;
  /** Which dimension changed. */
  dimension: MonitorDimension;
  /** The values that tripped it, for audit (§10). */
  evidence: string[];
  createdAt: string;
  acknowledgedAt: string | null;
}

// ---------------------------------------------------------------------------
// Terminal conversation — handover §3
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "verity";

/**
 * A context card rendered alongside a Terminal answer. §2 "Dynamic context":
 * ticker, price, daily change, relative volume, IV, flow, gamma, news,
 * position, and risk.
 */
export type ContextCardKind =
  | "quote"
  | "relative_volume"
  | "implied_volatility"
  | "flow"
  | "gamma"
  | "news"
  | "position"
  | "risk";

export interface ContextCard {
  kind: ContextCardKind;
  title: string;
  /** Primary value, pre-formatted by the server so the client never recomputes. */
  value: string;
  /** Secondary line. */
  detail: string | null;
  /** Directional tint, when meaningful. */
  tone: "up" | "down" | "neutral" | "warn";
  provenance: Provenance;
}

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  text: string;
  /** Cards Verity attached to this answer. */
  cards: ContextCard[];
  /**
   * §2 response style: "Clearly distinguish data, analysis, and uncertainty."
   * The model is required to populate these separately.
   */
  facts: string[];
  analysis: string[];
  uncertainty: string[];
  /** Ticker in focus when the message was sent. */
  tickerContext: string | null;
  createdAt: string;
}

/**
 * The structured package the context engine hands the model (§8). The model
 * interprets this and nothing else — it has no market endpoints of its own.
 */
export interface VerityContextPackage {
  question: string;
  ticker: string | null;
  snapshot: Sourced<TickerSnapshot> | null;
  indexes: Sourced<IndexQuote[]> | null;
  flow: Sourced<FlowEvent[]> | null;
  gex: Sourced<GexSnapshot> | null;
  news: Sourced<NewsItem[]> | null;
  events: Sourced<EconomicEvent[]> | null;
  regime: Sourced<MarketRegimeAssessment> | null;
  position: Position | null;
  risk: RiskAssessment | null;
  assembledAt: string;
  /** Which retrievals were attempted and what happened. §10 debuggability. */
  retrievalLog: Array<{ key: string; state: DataState; ms: number; note?: string }>;
}
