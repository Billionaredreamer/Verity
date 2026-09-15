"use client";

/**
 * Flow filter controls — one control per §4 "Required filters" entry:
 * ticker, calls/puts, min and max premium, expiration, 0DTE/weekly/monthly,
 * sweep/block, volume/OI, ask-side/bid-side.
 *
 * Every filter is wired to the same FlowFilters object the server parses, so
 * there is no control here that does not actually filter.
 */

import type {
  ExecutionSide,
  ExpirationBucket,
  FlowClassification,
  FlowFilters,
  OptionSide,
} from "@/lib/schema/core";
import { cn } from "@/components/ui/primitives";

interface Props {
  filters: FlowFilters;
  onChange: (next: FlowFilters) => void;
  /** Expirations offered by the provider for the selected ticker(s). */
  expirations: string[];
}

export function FlowFiltersBar({ filters, onChange, expirations }: Props) {
  const set = <K extends keyof FlowFilters>(key: K, value: FlowFilters[K]) =>
    onChange({ ...filters, [key]: value });

  /** Toggle membership in a multi-select array filter. */
  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-card border border-line bg-surface px-4 py-3">
      <Field label="Ticker">
        <input
          value={filters.tickers.join(", ")}
          onChange={(e) =>
            set(
              "tickers",
              e.target.value
                .split(",")
                .map((t) => t.trim().toUpperCase())
                .filter(Boolean),
            )
          }
          placeholder="All"
          spellCheck={false}
          className="w-32 rounded border border-line bg-raised px-2 py-1 text-xs uppercase text-ink outline-none placeholder:normal-case placeholder:text-faint focus:border-accent/50"
        />
      </Field>

      <Field label="Side">
        <Group>
          {(["call", "put"] as OptionSide[]).map((s) => (
            <Toggle
              key={s}
              active={filters.sides.includes(s)}
              onClick={() => set("sides", toggle(filters.sides, s))}
            >
              {s === "call" ? "Calls" : "Puts"}
            </Toggle>
          ))}
        </Group>
      </Field>

      <Field label="Premium">
        <div className="flex items-center gap-1">
          <NumberInput
            value={filters.minPremium}
            onChange={(v) => set("minPremium", v)}
            placeholder="Min"
          />
          <span className="text-2xs text-faint">–</span>
          <NumberInput
            value={filters.maxPremium}
            onChange={(v) => set("maxPremium", v)}
            placeholder="Max"
          />
        </div>
      </Field>

      <Field label="Expiration">
        <select
          value={filters.expirations[0] ?? ""}
          onChange={(e) => set("expirations", e.target.value ? [e.target.value] : [])}
          className="rounded border border-line bg-raised px-2 py-1 text-xs text-ink outline-none focus:border-accent/50"
        >
          <option value="">All</option>
          {expirations.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Term">
        <Group>
          {(["0dte", "weekly", "monthly"] as ExpirationBucket[]).map((b) => (
            <Toggle
              key={b}
              active={filters.buckets.includes(b)}
              onClick={() => set("buckets", toggle(filters.buckets, b))}
            >
              {b === "0dte" ? "0DTE" : b === "weekly" ? "Weekly" : "Monthly"}
            </Toggle>
          ))}
        </Group>
      </Field>

      <Field label="Type">
        <Group>
          {(["sweep", "block"] as FlowClassification[]).map((c) => (
            <Toggle
              key={c}
              active={filters.classifications.includes(c)}
              onClick={() => set("classifications", toggle(filters.classifications, c))}
            >
              {c === "sweep" ? "Sweep" : "Block"}
            </Toggle>
          ))}
        </Group>
      </Field>

      <Field label="Vol/OI ≥">
        <NumberInput
          value={filters.minVolumeOiRatio}
          onChange={(v) => set("minVolumeOiRatio", v)}
          placeholder="0.0"
          width="w-16"
          step="0.1"
        />
      </Field>

      <Field label="Execution">
        <Group>
          {(["ask", "bid"] as ExecutionSide[]).map((s) => (
            <Toggle
              key={s}
              active={filters.executionSides.includes(s)}
              onClick={() => set("executionSides", toggle(filters.executionSides, s))}
            >
              {s === "ask" ? "Ask-side" : "Bid-side"}
            </Toggle>
          ))}
        </Group>
      </Field>

      <button
        onClick={() =>
          onChange({
            tickers: [],
            sides: [],
            minPremium: null,
            maxPremium: null,
            expirations: [],
            buckets: [],
            classifications: [],
            minVolumeOiRatio: null,
            executionSides: [],
          })
        }
        className="ml-auto rounded border border-line px-2 py-1 text-2xs text-muted transition-colors hover:text-ink"
      >
        Reset
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs uppercase tracking-wider text-faint">{label}</span>
      {children}
    </label>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-1">{children}</div>;
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded border px-2 py-1 text-2xs transition-colors",
        active
          ? "border-accent/50 bg-accent/15 text-accent"
          : "border-line bg-raised text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  width = "w-20",
  step,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  width?: string;
  step?: string;
}) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        // An empty field means "no constraint", which is not the same as zero.
        if (raw === "") return onChange(null);
        const n = Number(raw);
        onChange(Number.isFinite(n) ? n : null);
      }}
      placeholder={placeholder}
      className={cn(
        "tnum rounded border border-line bg-raised px-2 py-1 text-xs text-ink outline-none placeholder:text-faint focus:border-accent/50",
        width,
      )}
    />
  );
}
