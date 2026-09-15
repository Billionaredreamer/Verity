/**
 * Markets screen (§6): "Broad market regime, index, volatility, sector,
 * breadth, events, and catalysts."
 *
 * A server component — it reads providers directly, so no market data round
 * trips through the browser and no key is exposed.
 */

import { providers } from "@/lib/providers/registry";
import { assessRegime, REGIME_LABELS } from "@/lib/engines/marketRegimeEngine";
import { DataStateBadge } from "@/components/ui/DataStateBadge";
import {
  Card,
  Empty,
  Pill,
  SectionHeading,
  Stat,
  cn,
  formatSignedPercent,
  toneClass,
  toneOf,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Markets — Verity" };

export default async function MarketsPage() {
  const p = providers();

  const [indexes, sectors, breadth, events] = await Promise.all([
    p.market.getIndexes(),
    p.market.getSectors(),
    p.market.getBreadth(),
    p.news.getEconomicCalendar(
      new Date().toISOString(),
      new Date(Date.now() + 14 * 86_400_000).toISOString(),
    ),
  ]);

  const vix = indexes.data.find((i) => i.symbol === "VIX");
  const regime = assessRegime({
    indexes: indexes.data,
    breadth: breadth.data,
    vixChangePercent: vix?.changePercent ?? null,
    vixLevel: vix?.price ?? null,
  });

  const b = breadth.data;
  const advTotal = (b.advancers ?? 0) + (b.decliners ?? 0);

  return (
    <div className="space-y-4">
      <SectionHeading detail={<DataStateBadge provenance={indexes.provenance} showAge />}>
        Markets
      </SectionHeading>

      <Card
        title="Market regime"
        action={
          <Pill tone={regime.regime === "risk_off" ? "down" : regime.regime === "risk_on" ? "up" : "neutral"}>
            {REGIME_LABELS[regime.regime]} · {(regime.confidence * 100).toFixed(0)}%
          </Pill>
        }
      >
        <ul className="space-y-1">
          {regime.drivers.map((d, i) => (
            <li key={i} className="text-sm text-ink/90">
              {d}
            </li>
          ))}
        </ul>
        {regime.confidence < 0.4 && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-warn">
            Confidence is low — the inputs do not strongly agree, so treat this label as
            provisional.
          </p>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Indexes" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {indexes.data.map((q) => (
              <Stat
                key={q.symbol}
                label={q.symbol}
                value={q.price.toFixed(2)}
                detail={formatSignedPercent(q.changePercent)}
                tone={q.symbol === "VIX" ? (q.price >= 20 ? "warn" : "neutral") : toneOf(q.changePercent)}
              />
            ))}
          </div>
        </Card>

        <Card title="Breadth" action={<DataStateBadge provenance={breadth.provenance} />}>
          {advTotal === 0 ? (
            <Empty title="Breadth data unavailable." />
          ) : (
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-2xs text-faint">
                  <span>Advancers {b.advancers}</span>
                  <span>Decliners {b.decliners}</span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded bg-raised">
                  <div
                    className="bg-up"
                    style={{ width: `${((b.advancers ?? 0) / advTotal) * 100}%` }}
                  />
                  <div
                    className="bg-down"
                    style={{ width: `${((b.decliners ?? 0) / advTotal) * 100}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Metric label="New highs" value={b.newHighs} />
                <Metric label="New lows" value={b.newLows} />
                <Metric label="Above 50DMA" value={b.percentAbove50dma} percent />
                <Metric label="Above 200DMA" value={b.percentAbove200dma} percent />
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Sectors" action={<DataStateBadge provenance={sectors.provenance} />}>
          <ul className="space-y-1">
            {[...sectors.data]
              .sort((a, b2) => b2.changePercent - a.changePercent)
              .map((s) => (
                <li key={s.sector} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate text-xs text-muted">{s.label}</span>
                  <div className="relative h-3 flex-1 rounded bg-raised">
                    {/* Bars diverge from a centre line so sign is visible without reading the number. */}
                    <div
                      className={cn(
                        "absolute top-0 h-3 rounded",
                        s.changePercent >= 0 ? "bg-up/70 left-1/2" : "bg-down/70 right-1/2",
                      )}
                      style={{ width: `${Math.min(50, Math.abs(s.changePercent) * 14)}%` }}
                    />
                    <div className="absolute left-1/2 top-0 h-3 w-px bg-line" />
                  </div>
                  <span
                    className={cn("tnum w-16 shrink-0 text-right text-xs", toneClass(toneOf(s.changePercent)))}
                  >
                    {formatSignedPercent(s.changePercent)}
                  </span>
                </li>
              ))}
          </ul>
        </Card>

        <Card
          title="Events & catalysts"
          action={<DataStateBadge provenance={events.provenance} />}
        >
          {events.data.length === 0 ? (
            <Empty title="No scheduled events in the next two weeks." />
          ) : (
            <ul className="space-y-1.5">
              {events.data.slice(0, 12).map((e) => (
                <li key={e.id} className="flex items-baseline gap-3 text-xs">
                  <span className="tnum w-20 shrink-0 text-faint">
                    {e.scheduledFor.slice(5, 10)}
                  </span>
                  <span className="flex-1 truncate text-ink/90">{e.title}</span>
                  {e.tickers.length > 0 && (
                    <span className="shrink-0 text-muted">{e.tickers.join(", ")}</span>
                  )}
                  <Pill tone={e.importance === "high" ? "warn" : "neutral"}>{e.importance}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  percent = false,
}: {
  label: string;
  value: number | null;
  percent?: boolean;
}) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-faint">{label}</div>
      <div className="tnum text-sm text-ink">
        {value === null ? (
          <span className="text-faint" title="Not reported by the provider">
            —
          </span>
        ) : percent ? (
          `${(value * 100).toFixed(0)}%`
        ) : (
          value
        )}
      </div>
    </div>
  );
}
