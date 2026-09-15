/**
 * Shared UI primitives.
 *
 * Small and unopinionated on purpose — the interesting decisions in this
 * product are in the engines, and the UI's job is to display their output
 * without editorializing.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ReactNode } from "react";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function Card({
  children,
  className,
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={cn("rounded-card border border-line bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          {typeof title === "string" ? (
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted">{title}</h2>
          ) : (
            title
          )}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A labeled figure. `value` is pre-formatted by the server. */
export function Stat({
  label,
  value,
  detail,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string;
  detail?: string | null;
  tone?: "up" | "down" | "neutral" | "warn";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-2xs uppercase tracking-wider text-faint">{label}</div>
      <div className={cn("tnum mt-0.5 truncate text-lg font-medium", toneClass(tone))}>{value}</div>
      {detail && <div className="mt-0.5 truncate text-xs text-muted">{detail}</div>}
    </div>
  );
}

export function toneClass(tone: "up" | "down" | "neutral" | "warn"): string {
  switch (tone) {
    case "up":
      return "text-up";
    case "down":
      return "text-down";
    case "warn":
      return "text-warn";
    default:
      return "text-ink";
  }
}

/** Directional tone from a number, with exact zero treated as neutral. */
export function toneOf(n: number | null | undefined): "up" | "down" | "neutral" {
  if (n === null || n === undefined || n === 0) return "neutral";
  return n > 0 ? "up" : "down";
}

export function Pill({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "up" | "down" | "neutral" | "warn" | "accent";
  className?: string;
  title?: string;
}) {
  const tones: Record<string, string> = {
    up: "border-up/30 bg-up/10 text-up",
    down: "border-down/30 bg-down/10 text-down",
    warn: "border-warn/30 bg-warn/10 text-warn",
    accent: "border-accent/30 bg-accent/10 text-accent",
    neutral: "border-line bg-raised text-muted",
  };
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Empty state. Says what is absent and why, never just "no data". */
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <p className="text-sm text-muted">{title}</p>
      {detail && <p className="max-w-md text-xs text-faint">{detail}</p>}
    </div>
  );
}

export function SectionHeading({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h1 className="text-base font-semibold tracking-tight text-ink">{children}</h1>
      {detail && <div className="text-xs text-muted">{detail}</div>}
    </div>
  );
}

export function formatNumber(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function formatSignedPercent(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
