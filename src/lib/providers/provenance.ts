/**
 * Provenance helpers. Handover §10 — every market-derived value declares its
 * state, source and timestamps, and stale data is never dressed up as live.
 */

import type { DataState, Provenance, Sourced } from "@/lib/schema/core";

export function provenance(
  state: DataState,
  source: string,
  opts: { observedAt?: string; delaySeconds?: number | null; note?: string } = {},
): Provenance {
  const now = new Date().toISOString();
  return {
    state,
    source,
    observedAt: opts.observedAt ?? now,
    retrievedAt: now,
    delaySeconds: opts.delaySeconds ?? null,
    ...(opts.note ? { note: opts.note } : {}),
  };
}

export function sourced<T>(data: T, p: Provenance): Sourced<T> {
  return { data, provenance: p };
}

/** An explicit outage result. Callers render the note rather than a blank. */
export function unavailable<T>(source: string, note: string, fallback: T): Sourced<T> {
  return sourced(fallback, provenance("UNAVAILABLE", source, { note }));
}

/**
 * When a derived value combines several inputs, its state is the weakest of
 * them: mixing LIVE flow with MOCK gamma yields MOCK, never LIVE.
 */
const SEVERITY: Record<DataState, number> = {
  LIVE: 0,
  DELAYED: 1,
  MOCK: 2,
  UNAVAILABLE: 3,
};

export function weakestState(states: DataState[]): DataState {
  if (states.length === 0) return "UNAVAILABLE";
  return states.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst), "LIVE");
}

/** Combine provenance from several inputs into one honest record. */
export function mergeProvenance(parts: Provenance[], source: string): Provenance {
  if (parts.length === 0) {
    return provenance("UNAVAILABLE", source, { note: "no inputs" });
  }
  const state = weakestState(parts.map((p) => p.state));
  // Oldest observation governs freshness.
  const observedAt = parts
    .map((p) => p.observedAt)
    .sort()
    .at(0)!;
  const delays = parts.map((p) => p.delaySeconds).filter((d): d is number => d !== null);
  const notes = parts.map((p) => p.note).filter((n): n is string => Boolean(n));
  return {
    state,
    source,
    observedAt,
    retrievedAt: new Date().toISOString(),
    delaySeconds: delays.length > 0 ? Math.max(...delays) : null,
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
  };
}

/** Seconds since the data was observed — drives the freshness readout. */
export function ageSeconds(p: Provenance, now: Date = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - new Date(p.observedAt).getTime()) / 1000));
}
