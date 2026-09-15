"use client";

/**
 * GEX screen (§5), including the dedicated 0DTE mode the handover calls
 * "a major Verity differentiator".
 */

import { useCallback, useEffect, useState } from "react";
import type { GexSnapshot, Provenance } from "@/lib/schema/core";
import { GexChart } from "@/components/gex/GexChart";
import { DataStateBadge, UnavailableNote } from "@/components/ui/DataStateBadge";
import { Card, Empty, Pill, SectionHeading, Stat, cn } from "@/components/ui/primitives";
import { GEX_ASSUMPTION, formatGamma } from "@/lib/engines/gammaEngine";

interface GexResponse {
  ticker: string;
  spot?: number;
  full: GexSnapshot | null;
  zeroDte: GexSnapshot | null;
  narrative: string[];
  provenance: Provenance;
}

const QUICK_TICKERS = ["SPY", "QQQ", "IWM", "NVDA", "TSLA", "AAPL"] as const;

export default function GexPage() {
  const [ticker, setTicker] = useState("SPY");
  const [input, setInput] = useState("SPY");
  const [mode, setMode] = useState<"full" | "0dte">("full");
  const [data, setData] = useState<GexResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gex?ticker=${encodeURIComponent(t)}`);
      setData(await res.json());
    } catch {
      setData({
        ticker: t,
        full: null,
        zeroDte: null,
        narrative: [],
        provenance: {
          state: "UNAVAILABLE",
          source: "client",
          observedAt: new Date().toISOString(),
          retrievedAt: new Date().toISOString(),
          delaySeconds: null,
          note: "Could not reach the GEX endpoint.",
        },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(ticker);
  }, [ticker, load]);

  const active = mode === "0dte" ? data?.zeroDte ?? null : data?.full ?? null;

  return (
    <div className="space-y-4">
      <SectionHeading
        detail={data && <DataStateBadge provenance={data.provenance} showAge />}
      >
        Gamma Exposure
      </SectionHeading>

      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = input.trim().toUpperCase();
            if (/^[A-Z]{1,6}$/.test(next)) setTicker(next);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            className="w-24 rounded border border-line bg-raised px-2 py-1 text-sm uppercase text-ink outline-none focus:border-accent/50"
          />
        </form>

        <div className="flex gap-1">
          {QUICK_TICKERS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTicker(t);
                setInput(t);
              }}
              className={cn(
                "rounded border px-2 py-1 text-2xs transition-colors",
                ticker === t
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-line bg-raised text-muted hover:text-ink",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-1">
          <ModeButton active={mode === "full"} onClick={() => setMode("full")}>
            Full chain
          </ModeButton>
          <ModeButton
            active={mode === "0dte"}
            onClick={() => setMode("0dte")}
            disabled={!data?.zeroDte}
            title={
              data?.zeroDte
                ? "Today's expiration only"
                : "Nothing expires today for this ticker."
            }
          >
            0DTE
          </ModeButton>
        </div>
      </div>

      {data && <UnavailableNote provenance={data.provenance} />}

      {loading ? (
        <Empty title="Computing gamma exposure…" />
      ) : !active ? (
        <Empty
          title={
            mode === "0dte"
              ? `Nothing expires today for ${ticker}.`
              : `No gamma exposure could be computed for ${ticker}.`
          }
          detail={
            mode === "0dte"
              ? "The 0DTE view shows today's expiration only. It does not fall back to the next expiration, because that would be a different thing entirely."
              : "The chain returned no strikes with open interest that could be modeled."
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Stat
              label="Net gamma"
              value={formatGamma(active.totalGamma)}
              detail="per 1% move"
              tone={active.totalGamma >= 0 ? "up" : "down"}
            />
            <Stat label="Positive" value={formatGamma(active.positiveGamma)} tone="up" />
            <Stat label="Negative" value={formatGamma(active.negativeGamma)} tone="down" />
            <Stat
              label="Call wall"
              value={active.callWall?.toString() ?? "—"}
              detail={distance(active.callWall, active.spot)}
            />
            <Stat
              label="Put wall"
              value={active.putWall?.toString() ?? "—"}
              detail={distance(active.putWall, active.spot)}
            />
            <Stat
              label="Gamma flip"
              value={active.gammaFlip?.toString() ?? "—"}
              detail={distance(active.gammaFlip, active.spot)}
              tone={
                active.gammaFlip !== null && active.spot < active.gammaFlip ? "warn" : "neutral"
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={active.regime === "short_gamma" ? "warn" : "neutral"}>
              {active.regime === "long_gamma"
                ? "Dealers modeled long gamma"
                : active.regime === "short_gamma"
                  ? "Dealers modeled short gamma"
                  : "Gamma near balance"}
            </Pill>
            <span className="tnum text-xs text-muted">Spot {active.spot.toFixed(2)}</span>
            <span className="text-xs text-faint">
              {active.expirationsIncluded.length} expiration
              {active.expirationsIncluded.length === 1 ? "" : "s"}:{" "}
              {active.expirationsIncluded.join(", ")}
            </span>
            {active.zeroGamma !== null && (
              <span className="tnum text-xs text-muted">Zero gamma {active.zeroGamma}</span>
            )}
          </div>

          <Card title={`Gamma by strike — ${ticker}`}>
            <GexChart gex={active} />
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Reading">
              <ul className="space-y-1.5">
                {(data?.narrative ?? []).map((line, i) => (
                  <li key={i} className="text-sm text-ink/90">
                    {line}
                  </li>
                ))}
              </ul>
              {/*
                §10: distinguish verified facts from analysis. GEX is a model
                built on an unobservable assumption, and saying so on the
                screen is the difference between analysis and a claim.
              */}
              <p className="mt-3 border-t border-line pt-3 text-xs text-warn">{GEX_ASSUMPTION}</p>
            </Card>

            <Card title="Gamma by expiration">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-2xs uppercase tracking-wider text-faint">
                    <th className="pb-2 text-left font-medium">Expiration</th>
                    <th className="pb-2 text-right font-medium">DTE</th>
                    <th className="pb-2 text-right font-medium">Net gamma</th>
                  </tr>
                </thead>
                <tbody>
                  {active.byExpiration.map((e) => (
                    <tr key={e.expiration} className="border-t border-line/60">
                      <td className="py-1.5">{e.expiration}</td>
                      <td className="tnum py-1.5 text-right text-muted">
                        {e.daysToExpiration === 0 ? "0DTE" : e.daysToExpiration}
                      </td>
                      <td
                        className={cn(
                          "tnum py-1.5 text-right",
                          e.netGamma >= 0 ? "text-up" : "text-down",
                        )}
                      >
                        {formatGamma(e.netGamma)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function distance(level: number | null, spot: number): string | null {
  if (level === null) return null;
  const pct = ((level - spot) / spot) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% from spot`;
}

function ModeButton({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "rounded border px-3 py-1 text-xs transition-colors",
        active
          ? "border-accent/50 bg-accent/15 text-accent"
          : "border-line bg-raised text-muted hover:text-ink",
        disabled && "cursor-not-allowed opacity-40 hover:text-muted",
      )}
    >
      {children}
    </button>
  );
}
