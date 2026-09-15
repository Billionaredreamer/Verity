"use client";

/**
 * The flow table — every §4 "Required event field" as a column.
 *
 * The important design decision: there is no "sentiment" column. §4 forbids
 * treating every large call as bullish, so what the table shows instead is the
 * *execution side* — the fact from which direction is inferred — and a
 * per-row reading from flowEngine that is allowed to say "unclear".
 */

import { useMemo, useState } from "react";
import type { FlowEvent } from "@/lib/schema/core";
import { readEvent, formatPremium } from "@/lib/engines/flowEngine";
import { relativeTime } from "@/lib/util/dates";
import { Pill, cn, formatCompact } from "@/components/ui/primitives";

type SortKey = "timestamp" | "premium" | "volumeOiRatio" | "daysToExpiration" | "contracts";

export function FlowTable({ events }: { events: FlowEvent[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [descending, setDescending] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const rows = [...events];
    rows.sort((a, b) => {
      let cmp: number;
      if (sortKey === "timestamp") cmp = a.timestamp.localeCompare(b.timestamp);
      else {
        // Nulls sort last regardless of direction — an unknown ratio should
        // never lead the table just because the sort flipped.
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av === null && bv === null) cmp = 0;
        else if (av === null) return 1;
        else if (bv === null) return -1;
        else cmp = av - bv;
      }
      return descending ? -cmp : cmp;
    });
    return rows;
  }, [events, sortKey, descending]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(true);
    }
  };

  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[1100px] border-collapse text-xs">
        <thead className="sticky top-0 bg-raised">
          <tr className="text-2xs uppercase tracking-wider text-faint">
            <Th onClick={() => toggleSort("timestamp")} active={sortKey === "timestamp"} desc={descending}>
              Time
            </Th>
            <Th>Ticker</Th>
            <Th>Strike</Th>
            <Th>Exp</Th>
            <Th onClick={() => toggleSort("daysToExpiration")} active={sortKey === "daysToExpiration"} desc={descending}>
              DTE
            </Th>
            <Th>C/P</Th>
            <Th align="right" onClick={() => toggleSort("premium")} active={sortKey === "premium"} desc={descending}>
              Premium
            </Th>
            <Th align="right" onClick={() => toggleSort("contracts")} active={sortKey === "contracts"} desc={descending}>
              Contracts
            </Th>
            <Th align="right">Volume</Th>
            <Th align="right">OI</Th>
            <Th align="right" onClick={() => toggleSort("volumeOiRatio")} active={sortKey === "volumeOiRatio"} desc={descending}>
              Vol/OI
            </Th>
            <Th align="right">Bid/Ask</Th>
            <Th>Exec</Th>
            <Th>Type</Th>
            <Th align="right">Spot</Th>
            <Th align="right">IV</Th>
            <Th>Reading</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <Row
              key={e.id}
              event={e}
              expanded={expanded === e.id}
              onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  event: e,
  expanded,
  onToggle,
}: {
  event: FlowEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const reading = readEvent(e);
  const otm = ((e.strike - e.spot) / e.spot) * 100;

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-t border-line/60 hover:bg-raised/40"
        title="Click for the full reading"
      >
        <Td className="text-muted">{relativeTime(e.timestamp)}</Td>
        <Td className="font-medium">{e.ticker}</Td>
        <Td className="tnum">
          {e.strike}
          <span className="ml-1 text-faint">
            {otm >= 0 ? "+" : ""}
            {otm.toFixed(1)}%
          </span>
        </Td>
        <Td className="tnum text-muted">{e.expiration.slice(5)}</Td>
        <Td className="tnum">
          {e.daysToExpiration === 0 ? <Pill tone="warn">0DTE</Pill> : e.daysToExpiration}
        </Td>
        <Td>
          {/*
            Deliberately NOT color-coded. Tinting calls green and puts red is
            the visual form of the mistake §4 forbids — it tells the eye that
            contract type is direction. Direction lives in the Reading column,
            which is allowed to say "unclear".
          */}
          <span className="text-ink">{e.side === "call" ? "C" : "P"}</span>
        </Td>
        <Td align="right" className="tnum font-medium">
          {formatPremium(e.premium)}
        </Td>
        <Td align="right" className="tnum">
          {e.contracts.toLocaleString()}
        </Td>
        <Td align="right" className="tnum text-muted">
          {formatCompact(e.volume)}
        </Td>
        <Td align="right" className="tnum text-muted">
          {formatCompact(e.openInterest)}
        </Td>
        <Td align="right" className="tnum">
          {e.volumeOiRatio === null ? (
            <span className="text-faint" title="Open interest unknown">
              —
            </span>
          ) : (
            <span className={e.volumeOiRatio > 1 ? "text-warn" : undefined}>
              {e.volumeOiRatio.toFixed(2)}
            </span>
          )}
        </Td>
        <Td align="right" className="tnum text-muted">
          {e.bid?.toFixed(2) ?? "—"}/{e.ask?.toFixed(2) ?? "—"}
        </Td>
        <Td>
          <ExecutionPill side={e.executionSide} />
        </Td>
        <Td className="capitalize text-muted">{e.classification}</Td>
        <Td align="right" className="tnum text-muted">
          {e.spot.toFixed(2)}
        </Td>
        <Td align="right" className="tnum text-muted">
          {e.impliedVolatility === null ? "—" : `${(e.impliedVolatility * 100).toFixed(0)}%`}
        </Td>
        <Td>
          <ReadingPill lean={reading.lean} confidence={reading.confidence} />
        </Td>
      </tr>

      {expanded && (
        <tr className="border-t border-line/60 bg-raised/30">
          <td colSpan={17} className="px-3 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-2xs uppercase tracking-wider text-faint">
                  Why this reads {reading.lean}
                </div>
                <ul className="space-y-0.5">
                  {reading.reasons.map((r, i) => (
                    <li key={i} className="text-xs text-ink/90">
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-2xs uppercase tracking-wider text-faint">
                  What would make this wrong
                </div>
                <ul className="space-y-0.5">
                  {reading.caveats.map((c, i) => (
                    <li key={i} className="text-xs text-muted">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Execution side gets its own visual weight because it is the field §4's
 * interpretation rule turns on.
 */
function ExecutionPill({ side }: { side: FlowEvent["executionSide"] }) {
  const map = {
    ask: { tone: "up" as const, label: "Ask" },
    bid: { tone: "down" as const, label: "Bid" },
    midpoint: { tone: "neutral" as const, label: "Mid" },
    unknown: { tone: "neutral" as const, label: "N/R" },
  };
  const { tone, label } = map[side];
  return (
    <Pill
      tone={tone}
      title={
        side === "unknown"
          ? "Execution side was not reported by the feed."
          : side === "midpoint"
            ? "Printed at the midpoint — neither side clearly initiated."
            : `Printed on the ${side}.`
      }
    >
      {label}
    </Pill>
  );
}

function ReadingPill({ lean, confidence }: { lean: string; confidence: number }) {
  if (lean === "unclear") {
    return (
      <Pill tone="neutral" title="Direction cannot be determined from this print.">
        Unclear
      </Pill>
    );
  }
  return (
    <Pill
      tone={lean === "bullish" ? "up" : "down"}
      title={`Confidence ${(confidence * 100).toFixed(0)}% — a single print is weak evidence.`}
    >
      {lean === "bullish" ? "Bullish" : "Bearish"}{" "}
      <span className="tnum opacity-70">{(confidence * 100).toFixed(0)}%</span>
    </Pill>
  );
}

function Th({
  children,
  align = "left",
  onClick,
  active,
  desc,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  onClick?: () => void;
  active?: boolean;
  desc?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={cn(
        "whitespace-nowrap px-3 py-2 font-medium",
        align === "right" ? "text-right" : "text-left",
        onClick && "cursor-pointer select-none hover:text-ink",
        active && "text-ink",
      )}
    >
      {children}
      {active && <span className="ml-1">{desc ? "↓" : "↑"}</span>}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 py-1.5",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
