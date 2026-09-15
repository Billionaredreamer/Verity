/**
 * Signals screen (§6).
 *
 * "Signals should surface explainable setups, not simplistic buy/sell
 * commands." So every card leads with "Why Verity noticed this" and carries
 * factor scores, risks and invalidation conditions. There is no BUY badge
 * anywhere on this page, and adding one would be a spec violation, not a
 * design choice.
 */

import { providers } from "@/lib/providers/registry";
import { buildSignal } from "@/lib/engines/signalEngine";
import { computeGex } from "@/lib/engines/gammaEngine";
import { EMPTY_FLOW_FILTERS, type Signal } from "@/lib/schema/core";
import { DataStateBadge } from "@/components/ui/DataStateBadge";
import { Card, Empty, Pill, SectionHeading, cn } from "@/components/ui/primitives";
import { upcomingExpirations } from "@/lib/util/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signals — Verity" };

/** Candidates scanned each load. A real implementation scans the watchlist. */
const CANDIDATES = ["NVDA", "TSLA", "AAPL", "AMD", "META", "SPY", "QQQ", "AMZN"] as const;

export default async function SignalsPage() {
  const p = providers();

  const [snapshots, flow, indexes, sectors] = await Promise.all([
    p.market.getSnapshots([...CANDIDATES]),
    p.options.getFlow({ ...EMPTY_FLOW_FILTERS, minPremium: 50_000 }, 400),
    p.market.getIndexes(),
    p.market.getSectors(),
  ]);

  const equityIndexes = indexes.data.filter((i) => i.symbol !== "VIX");
  const marketChange =
    equityIndexes.length > 0
      ? equityIndexes.reduce((s, i) => s + i.changePercent, 0) / equityIndexes.length
      : null;

  // Gamma is fetched only for candidates with flow, since a chain request per
  // ticker is the expensive call on this page.
  const withFlow = new Set(flow.data.map((e) => e.ticker));
  const chains = await Promise.all(
    snapshots.data
      .filter((s) => withFlow.has(s.ticker))
      .map(async (s) => {
        try {
          const chain = await p.options.getChain(s.ticker, upcomingExpirations(2));
          return [s.ticker, computeGex(chain.data)] as const;
        } catch {
          // A missing chain degrades the signal rather than failing the page.
          return [s.ticker, null] as const;
        }
      }),
  );
  const gexByTicker = new Map(chains);

  const signals = snapshots.data
    .map((snapshot) =>
      buildSignal({
        snapshot,
        flow: flow.data,
        gex: gexByTicker.get(snapshot.ticker) ?? null,
        marketChangePercent: marketChange,
        sectorChangePercent: sectors.data[0]?.changePercent ?? null,
        hasEarningsSoon: false,
        headlineCount: 0,
      }),
    )
    .filter((s): s is Signal => s !== null)
    .sort((a, b) => b.confidence - a.confidence);

  return (
    <div className="space-y-4">
      <SectionHeading
        detail={
          <span className="flex items-center gap-2">
            <span>Scanned {CANDIDATES.length} tickers</span>
            <DataStateBadge provenance={snapshots.provenance} showAge />
          </span>
        }
      >
        Signals
      </SectionHeading>

      <p className="max-w-3xl text-xs text-muted">
        Setups are surfaced when several independent factors agree. Each one states why it was
        noticed, what would falsify it, and how confident the engine is. None of them is an
        instruction to trade.
      </p>

      {signals.length === 0 ? (
        <Empty
          title="No setups meet the threshold right now."
          detail="Factors are not aligned enough on any scanned ticker. An empty feed is a real result — the engine does not lower its bar to fill the screen."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SignalCard({ signal: s }: { signal: Signal }) {
  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{s.ticker}</span>
          <Pill tone={s.direction === "bullish" ? "up" : "down"}>
            {s.direction === "bullish" ? "Bullish setup" : "Bearish setup"}
          </Pill>
        </div>
      }
      action={
        <span className="tnum text-xs text-muted" title="Confidence is capped — nothing here is certain.">
          Confidence {(s.confidence * 100).toFixed(0)}%
        </span>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink/90">{s.whyNoticed}</p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {s.factors.map((f) => (
            <div key={f.key} className="flex items-center gap-2" title={f.detail}>
              <span className="w-28 shrink-0 truncate text-2xs uppercase tracking-wider text-faint">
                {f.label}
              </span>
              <div className="h-1 flex-1 rounded bg-raised">
                <div
                  className={cn(
                    "h-1 rounded",
                    f.score > 5 ? "bg-up/70" : f.score < 5 ? "bg-down/70" : "bg-faint/50",
                  )}
                  style={{ width: `${(f.score / 10) * 100}%` }}
                />
              </div>
              <span className="tnum w-8 shrink-0 text-right text-2xs text-muted">
                {f.score.toFixed(1)}
              </span>
            </div>
          ))}
        </div>

        <Detail label="Supporting evidence" items={s.supportingEvidence} />
        <Detail label="Risks" items={s.risks} tone="warn" />
        <Detail label="Invalidated if" items={s.invalidationConditions} tone="warn" />
      </div>
    </Card>
  );
}

function Detail({
  label,
  items,
  tone = "neutral",
}: {
  label: string;
  items: string[];
  tone?: "neutral" | "warn";
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-2xs uppercase tracking-wider text-faint">{label}</div>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className={cn("text-xs", tone === "warn" ? "text-warn/90" : "text-muted")}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
