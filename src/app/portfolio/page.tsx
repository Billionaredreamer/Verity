/**
 * Portfolio screen (§7) — read-only.
 *
 * The handover's initial implementation list: read-only brokerage connection,
 * positions with entry and quantity, option strike and expiration, P/L and
 * exposure, concentration and correlated risk, upcoming expirations.
 *
 * There are no trade controls on this page and there will not be in V1 (§12).
 * The read-only status is stated in the UI rather than merely being true.
 */

import { providers } from "@/lib/providers/registry";
import { assessRisk } from "@/lib/engines/riskEngine";
import { riskInputFor } from "@/lib/engines/positionEngine";
import { DataStateBadge } from "@/components/ui/DataStateBadge";
import {
  Card,
  Empty,
  Pill,
  SectionHeading,
  Stat,
  cn,
  toneClass,
  toneOf,
} from "@/components/ui/primitives";
import { daysToExpiration } from "@/lib/util/dates";
import type { Position } from "@/lib/schema/core";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio — Verity" };

export default async function PortfolioPage() {
  const p = providers();
  const connected = await p.brokerage.isConnected("local-user");

  if (!connected) {
    return (
      <div className="space-y-4">
        <SectionHeading>Portfolio</SectionHeading>
        <Empty
          title="No brokerage account is connected."
          detail="Verity connects to brokerages with read-only scopes. It can see positions and P/L; it cannot place, modify or cancel orders."
        />
      </div>
    );
  }

  const { data: portfolio, provenance } = await p.brokerage.getPortfolio("local-user");

  // Risk is assessed against the real portfolio total, so concentration is a
  // measured share rather than a placeholder.
  // riskInputFor is shared with the context engine, so the Terminal and this
  // screen report identical risk for the same position by construction rather
  // than by two call sites happening to agree.
  const risks = new Map(
    portfolio.positions.map((pos) => [pos.id, assessRisk(riskInputFor(pos, portfolio, null))]),
  );

  const allWarnings = [...risks.values()].flatMap((r) => r.warnings);

  return (
    <div className="space-y-4">
      <SectionHeading
        detail={
          <span className="flex items-center gap-2">
            <Pill tone="neutral" title="Verity cannot place, modify or cancel orders.">
              Read-only
            </Pill>
            <DataStateBadge provenance={provenance} showAge />
          </span>
        }
      >
        Portfolio
      </SectionHeading>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Total value" value={`$${portfolio.totalValue.toLocaleString()}`} />
        <Stat label="Cash" value={`$${portfolio.cash.toLocaleString()}`} />
        <Stat
          label="Unrealized P/L"
          value={`${portfolio.unrealizedPnl >= 0 ? "+" : "-"}$${Math.abs(portfolio.unrealizedPnl).toLocaleString()}`}
          detail={`${portfolio.unrealizedPnlPercent >= 0 ? "+" : ""}${portfolio.unrealizedPnlPercent.toFixed(2)}%`}
          tone={toneOf(portfolio.unrealizedPnl)}
        />
        <Stat
          label="Largest position"
          value={`${(portfolio.largestConcentration * 100).toFixed(1)}%`}
          detail="of gross exposure"
          tone={portfolio.largestConcentration > 0.25 ? "warn" : "neutral"}
        />
        <Stat
          label="Expiring ≤7d"
          value={String(portfolio.upcomingExpirations.length)}
          tone={portfolio.upcomingExpirations.length > 0 ? "warn" : "neutral"}
        />
      </div>

      <Card title="Positions">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="text-2xs uppercase tracking-wider text-faint">
                <th className="pb-2 text-left font-medium">Ticker</th>
                <th className="pb-2 text-left font-medium">Instrument</th>
                <th className="pb-2 text-right font-medium">Qty</th>
                <th className="pb-2 text-right font-medium">Entry</th>
                <th className="pb-2 text-right font-medium">Mark</th>
                <th className="pb-2 text-right font-medium">P/L</th>
                <th className="pb-2 text-right font-medium">Exposure</th>
                <th className="pb-2 text-right font-medium">Delta</th>
                <th className="pb-2 text-right font-medium">Theta/day</th>
                <th className="pb-2 text-right font-medium">DTE</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.positions.map((pos) => (
                <PositionRow key={pos.id} position={pos} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Concentration & correlated risk">
          <div className="space-y-3">
            {portfolio.correlatedClusters.length === 0 ? (
              <p className="text-xs text-muted">No correlated clusters identified.</p>
            ) : (
              portfolio.correlatedClusters.map((c) => (
                <div key={c.label}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-ink/90">{c.label}</span>
                    <span
                      className={cn(
                        "tnum text-xs",
                        c.share > 0.5 ? "text-warn" : "text-muted",
                      )}
                    >
                      {(c.share * 100).toFixed(1)}% of exposure
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-raised">
                    <div
                      className={cn("h-1.5 rounded", c.share > 0.5 ? "bg-warn/70" : "bg-accent/60")}
                      style={{ width: `${Math.min(100, c.share * 100)}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-2xs text-faint">{c.tickers.join(", ")}</div>
                </div>
              ))
            )}
            <p className="border-t border-line pt-3 text-2xs text-faint">
              Correlated groupings are a static classification, not a measured correlation. A
              live implementation computes this from return history.
            </p>
          </div>
        </Card>

        <Card title="Risk flags">
          {allWarnings.length === 0 ? (
            <p className="text-xs text-muted">
              No thresholds were crossed. That is not the same as low risk.
            </p>
          ) : (
            <ul className="space-y-1">
              {[...new Set(allWarnings)].map((w, i) => (
                <li key={i} className="text-xs text-warn/90">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {portfolio.upcomingExpirations.length > 0 && (
        <Card title="Expiring within 7 days">
          <ul className="space-y-1">
            {portfolio.upcomingExpirations.map((pos) => (
              <li key={pos.id} className="flex items-baseline gap-3 text-xs">
                <span className="w-16 font-medium">{pos.ticker}</span>
                <span className="text-muted">
                  {pos.strike} {pos.side} · {pos.expiration}
                </span>
                <span className="tnum ml-auto text-warn">
                  {daysToExpiration(pos.expiration!)}d
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function PositionRow({ position: pos }: { position: Position }) {
  const dte = pos.expiration ? daysToExpiration(pos.expiration) : null;
  return (
    <tr className="border-t border-line/60">
      <td className="py-1.5 font-medium">{pos.ticker}</td>
      <td className="py-1.5 text-muted">
        {pos.kind === "option" ? `${pos.strike} ${pos.side} ${pos.expiration}` : "Shares"}
      </td>
      <td className="tnum py-1.5 text-right">{pos.quantity}</td>
      <td className="tnum py-1.5 text-right text-muted">{pos.entryPrice.toFixed(2)}</td>
      <td className="tnum py-1.5 text-right">{pos.markPrice.toFixed(2)}</td>
      <td className={cn("tnum py-1.5 text-right", toneClass(toneOf(pos.unrealizedPnl)))}>
        {pos.unrealizedPnl >= 0 ? "+" : "-"}${Math.abs(pos.unrealizedPnl).toLocaleString()}
        <span className="ml-1 opacity-60">
          ({pos.unrealizedPnlPercent >= 0 ? "+" : ""}
          {pos.unrealizedPnlPercent.toFixed(1)}%)
        </span>
      </td>
      <td className="tnum py-1.5 text-right text-muted">
        ${Math.abs(pos.exposure).toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </td>
      <td className="tnum py-1.5 text-right text-muted">
        {pos.delta === null ? "—" : pos.delta.toFixed(0)}
      </td>
      <td className="tnum py-1.5 text-right text-muted">
        {pos.theta === null ? "—" : pos.theta.toFixed(0)}
      </td>
      <td className="tnum py-1.5 text-right">
        {dte === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className={dte <= 7 ? "text-warn" : "text-muted"}>{dte}</span>
        )}
      </td>
    </tr>
  );
}
