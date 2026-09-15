/**
 * The data-state badge.
 *
 * Handover §2 requires the UI to "clearly indicate whether data is LIVE,
 * DELAYED, MOCK, or UNAVAILABLE", and §10 requires freshness and latency to be
 * exposed and outages handled explicitly.
 *
 * This component is the single implementation of that promise, which is why
 * it renders every state rather than hiding the boring one: a screen where the
 * badge disappears when data is live is a screen where the user cannot tell
 * "live" from "the badge is broken".
 */

import type { DataState, Provenance } from "@/lib/schema/core";
import { cn } from "./primitives";

const STYLES: Record<DataState, { cls: string; label: string; help: string }> = {
  LIVE: {
    cls: "border-live/40 bg-live/10 text-live",
    label: "LIVE",
    help: "Real-time data from the configured provider.",
  },
  DELAYED: {
    cls: "border-delayed/40 bg-delayed/10 text-delayed",
    label: "DELAYED",
    help: "Real data, but behind the live market.",
  },
  MOCK: {
    cls: "border-mock/40 bg-mock/10 text-mock",
    label: "MOCK",
    help: "Synthetic fixture data. Not real market activity.",
  },
  UNAVAILABLE: {
    cls: "border-unavailable/40 bg-unavailable/10 text-unavailable",
    label: "UNAVAILABLE",
    help: "The provider could not supply this data.",
  },
};

export function DataStateBadge({
  provenance,
  showAge = false,
  className,
}: {
  provenance: Provenance;
  showAge?: boolean;
  className?: string;
}) {
  const style = STYLES[provenance.state];
  const tooltip = [
    style.help,
    `Source: ${provenance.source}`,
    `Observed: ${new Date(provenance.observedAt).toLocaleTimeString()}`,
    provenance.delaySeconds !== null ? `Provider delay: ${provenance.delaySeconds}s` : null,
    provenance.note,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold tracking-wide",
        style.cls,
        className,
      )}
    >
      {style.label}
      {showAge && <FreshnessAge provenance={provenance} />}
    </span>
  );
}

/**
 * Rendered as a static string from the server-supplied timestamp rather than
 * ticking, because a per-second re-render across a dense screen is a real
 * performance cost for information the trader glances at.
 */
function FreshnessAge({ provenance }: { provenance: Provenance }) {
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(provenance.observedAt).getTime()) / 1000),
  );
  const text = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
  return <span className="font-normal opacity-70">· {text}</span>;
}

/**
 * Inline note for an UNAVAILABLE payload. §10: "Handle provider outages
 * explicitly" — the reason is shown rather than rendering an empty table that
 * looks like a quiet market.
 */
export function UnavailableNote({ provenance }: { provenance: Provenance }) {
  if (provenance.state !== "UNAVAILABLE") return null;
  return (
    <p className="rounded border border-unavailable/30 bg-unavailable/5 px-3 py-2 text-xs text-unavailable">
      {provenance.note ?? "This data could not be retrieved."} Nothing has been substituted in its place.
    </p>
  );
}
