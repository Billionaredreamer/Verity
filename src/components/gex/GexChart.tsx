"use client";

/**
 * Gamma-by-strike distribution.
 *
 * A diverging bar chart: call gamma up, put gamma down, with reference lines
 * for spot, the walls and the flip. This is the right form because the
 * question the chart answers is "where is gamma concentrated relative to
 * price" — a comparison of magnitudes along a positional axis, with sign
 * carrying real meaning.
 *
 * Colors come from the design tokens rather than Recharts defaults so the
 * chart matches the rest of the terminal in both weight and hue.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GexSnapshot } from "@/lib/schema/core";
import { formatGamma } from "@/lib/engines/gammaEngine";

const UP = "rgb(45 196 168)";
const DOWN = "rgb(240 152 74)";
const LINE = "rgb(38 42 51)";
const MUTED = "rgb(148 157 173)";
const ACCENT = "rgb(122 162 247)";

export function GexChart({ gex }: { gex: GexSnapshot }) {
  // Trim to strikes within a readable band of spot — a full chain renders as
  // an unreadable picket fence dominated by far-wing noise.
  const band = gex.spot * 0.08;
  const rows = gex.byStrike
    .filter((r) => Math.abs(r.strike - gex.spot) <= band)
    .map((r) => ({
      strike: r.strike,
      // Puts plot downward so the diverging shape reads at a glance.
      call: r.callGamma,
      put: -r.putGamma,
      net: r.netGamma,
      callOi: r.callOpenInterest,
      putOi: r.putOpenInterest,
    }));

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-muted">
        No strikes with open interest within 8% of spot.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 8 }} barGap={-6}>
        <CartesianGrid stroke={LINE} vertical={false} />
        <XAxis
          dataKey="strike"
          tick={{ fill: MUTED, fontSize: 10 }}
          stroke={LINE}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: MUTED, fontSize: 10 }}
          stroke={LINE}
          tickFormatter={(v: number) => formatGamma(v)}
          width={62}
        />
        <Tooltip
          cursor={{ fill: "rgb(22 25 31)" }}
          contentStyle={{
            background: "rgb(15 17 21)",
            border: `1px solid ${LINE}`,
            borderRadius: 6,
            fontSize: 12,
          }}
          labelStyle={{ color: MUTED }}
          formatter={(value, name) => [
            formatGamma(Math.abs(Number(value ?? 0))),
            name === "call" ? "Call gamma" : "Put gamma",
          ]}
          labelFormatter={(l) => `Strike ${l}`}
        />

        <ReferenceLine y={0} stroke={LINE} />
        <ReferenceLine
          x={nearestStrike(rows, gex.spot)}
          stroke={ACCENT}
          strokeDasharray="4 3"
          label={{ value: "Spot", fill: ACCENT, fontSize: 10, position: "top" }}
        />
        {gex.callWall !== null && (
          <ReferenceLine
            x={gex.callWall}
            stroke={UP}
            strokeOpacity={0.5}
            label={{ value: "Call wall", fill: UP, fontSize: 10, position: "insideTopRight" }}
          />
        )}
        {gex.putWall !== null && (
          <ReferenceLine
            x={gex.putWall}
            stroke={DOWN}
            strokeOpacity={0.5}
            label={{ value: "Put wall", fill: DOWN, fontSize: 10, position: "insideBottomLeft" }}
          />
        )}

        <Bar dataKey="call" name="call" radius={[2, 2, 0, 0]}>
          {rows.map((r) => (
            <Cell key={`c-${r.strike}`} fill={UP} fillOpacity={0.85} />
          ))}
        </Bar>
        <Bar dataKey="put" name="put" radius={[0, 0, 2, 2]}>
          {rows.map((r) => (
            <Cell key={`p-${r.strike}`} fill={DOWN} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Reference lines snap to a plotted category, so spot maps to its nearest strike. */
function nearestStrike(rows: Array<{ strike: number }>, spot: number): number {
  return rows.reduce(
    (best, r) => (Math.abs(r.strike - spot) < Math.abs(best - spot) ? r.strike : best),
    rows[0]!.strike,
  );
}
