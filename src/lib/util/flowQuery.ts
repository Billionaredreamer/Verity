/**
 * Flow filter query parsing.
 *
 * Lives outside the route file because Next.js route modules may only export
 * handlers — and because parsing is worth testing on its own.
 *
 * Unrecognized or malformed values are DROPPED rather than coerced. A typo in
 * a filter must not silently widen the query and show the trader more than
 * they asked for.
 */

import { EMPTY_FLOW_FILTERS } from "@/lib/schema/core";
import type {
  ExecutionSide,
  ExpirationBucket,
  FlowClassification,
  FlowFilters,
  OptionSide,
} from "@/lib/schema/core";

const SIDES: OptionSide[] = ["call", "put"];
const BUCKETS: ExpirationBucket[] = ["0dte", "weekly", "monthly", "leaps"];
const CLASSES: FlowClassification[] = ["sweep", "block", "split", "single", "unknown"];
const EXEC_SIDES: ExecutionSide[] = ["ask", "bid", "midpoint", "unknown"];

export const MAX_FLOW_LIMIT = 300;

function enumList<T extends string>(raw: string | null, allowed: T[]): T[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is T => (allowed as string[]).includes(s));
}

function positiveNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseFlowFilters(params: URLSearchParams): FlowFilters {
  const tickers = (params.get("tickers") ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    // Symbol shape only — this value reaches a provider query.
    .filter((t) => /^[A-Z]{1,6}$/.test(t));

  const expirations = (params.get("expirations") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

  return {
    ...EMPTY_FLOW_FILTERS,
    tickers,
    sides: enumList(params.get("sides"), SIDES),
    minPremium: positiveNumber(params.get("minPremium")),
    maxPremium: positiveNumber(params.get("maxPremium")),
    expirations,
    buckets: enumList(params.get("buckets"), BUCKETS),
    classifications: enumList(params.get("classifications"), CLASSES),
    minVolumeOiRatio: positiveNumber(params.get("minVolumeOiRatio")),
    executionSides: enumList(params.get("executionSides"), EXEC_SIDES),
  };
}

export function parseLimit(raw: string | null, fallback = 100): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_FLOW_LIMIT, Math.max(1, Math.floor(n)));
}
