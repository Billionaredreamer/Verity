"use client";

/**
 * Flow screen (§4): "Real-time unusual options activity feed with filters and
 * interpretation."
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlowEvent, FlowFilters, Provenance } from "@/lib/schema/core";
import { EMPTY_FLOW_FILTERS } from "@/lib/schema/core";
import { FlowFiltersBar } from "@/components/flow/FlowFiltersBar";
import { FlowTable } from "@/components/flow/FlowTable";
import { DataStateBadge, UnavailableNote } from "@/components/ui/DataStateBadge";
import { Empty, SectionHeading, Stat } from "@/components/ui/primitives";
import { aggregateAll, formatPremium } from "@/lib/engines/flowEngine";
import { upcomingExpirations } from "@/lib/util/dates";

function toQuery(f: FlowFilters, limit: number): string {
  const p = new URLSearchParams();
  if (f.tickers.length) p.set("tickers", f.tickers.join(","));
  if (f.sides.length) p.set("sides", f.sides.join(","));
  if (f.minPremium !== null) p.set("minPremium", String(f.minPremium));
  if (f.maxPremium !== null) p.set("maxPremium", String(f.maxPremium));
  if (f.expirations.length) p.set("expirations", f.expirations.join(","));
  if (f.buckets.length) p.set("buckets", f.buckets.join(","));
  if (f.classifications.length) p.set("classifications", f.classifications.join(","));
  if (f.minVolumeOiRatio !== null) p.set("minVolumeOiRatio", String(f.minVolumeOiRatio));
  if (f.executionSides.length) p.set("executionSides", f.executionSides.join(","));
  p.set("limit", String(limit));
  return p.toString();
}

export default function FlowPage() {
  const [filters, setFilters] = useState<FlowFilters>({
    ...EMPTY_FLOW_FILTERS,
    minPremium: 50_000,
  });
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [provenance, setProvenance] = useState<Provenance | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/flow?${toQuery(filters, 150)}`);
      const data = await res.json();
      setEvents(data.events ?? []);
      setProvenance(data.provenance ?? null);
    } catch {
      setEvents([]);
      setProvenance({
        state: "UNAVAILABLE",
        source: "client",
        observedAt: new Date().toISOString(),
        retrievedAt: new Date().toISOString(),
        delaySeconds: null,
        note: "Could not reach the flow endpoint.",
      });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const calls = events.filter((e) => e.side === "call").reduce((s, e) => s + e.premium, 0);
    const puts = events.filter((e) => e.side === "put").reduce((s, e) => s + e.premium, 0);
    const unreadable = events
      .filter((e) => e.executionSide === "midpoint" || e.executionSide === "unknown")
      .reduce((s, e) => s + e.premium, 0);
    return { calls, puts, total: calls + puts, unreadable };
  }, [events]);

  const leaders = useMemo(() => aggregateAll(events).slice(0, 5), [events]);

  return (
    <div className="space-y-4">
      <SectionHeading
        detail={
          provenance && (
            <span className="flex items-center gap-2">
              <DataStateBadge provenance={provenance} showAge />
              <button onClick={() => void load()} className="hover:text-ink">
                Refresh
              </button>
            </span>
          )
        }
      >
        Options Flow
      </SectionHeading>

      <FlowFiltersBar
        filters={filters}
        onChange={setFilters}
        expirations={upcomingExpirations(8)}
      />

      {provenance && <UnavailableNote provenance={provenance} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total premium" value={formatPremium(totals.total)} detail={`${events.length} prints`} />
        <Stat label="Call premium" value={formatPremium(totals.calls)} />
        <Stat label="Put premium" value={formatPremium(totals.puts)} />
        <Stat
          label="Direction unknown"
          value={formatPremium(totals.unreadable)}
          detail={
            totals.total > 0
              ? `${Math.round((totals.unreadable / totals.total) * 100)}% printed mid or unreported`
              : null
          }
          tone={totals.unreadable / Math.max(1, totals.total) > 0.4 ? "warn" : "neutral"}
        />
      </div>

      {leaders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {leaders.map((l) => (
            <div
              key={l.ticker}
              title={l.summary}
              className="rounded border border-line bg-surface px-2.5 py-1.5 text-xs"
            >
              <span className="font-medium">{l.ticker}</span>{" "}
              <span className="tnum text-muted">{formatPremium(l.totalPremium)}</span>{" "}
              <span
                className={
                  l.lean === "bullish"
                    ? "text-up"
                    : l.lean === "bearish"
                      ? "text-down"
                      : "text-faint"
                }
              >
                {l.lean}
              </span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <Empty title="Loading flow…" />
      ) : events.length === 0 ? (
        <Empty
          title="No prints match these filters."
          detail="Widen the premium range or clear a filter. An empty result means nothing matched — not that the market is quiet."
        />
      ) : (
        <FlowTable events={events} />
      )}
    </div>
  );
}
