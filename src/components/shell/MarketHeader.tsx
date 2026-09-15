/**
 * Market header — "SPY, QQQ, IWM, VIX, and major index movement" (handover §2).
 *
 * A server component: it reads through the provider registry, which is
 * server-only, so no provider key can reach the browser (§10).
 */

import { providers } from "@/lib/providers/registry";
import { DataStateBadge } from "@/components/ui/DataStateBadge";
import { cn, formatSignedPercent, toneClass, toneOf } from "@/components/ui/primitives";
import { sessionState } from "@/lib/util/dates";
import type { IndexQuote, Provenance } from "@/lib/schema/core";

const SESSION_LABELS: Record<ReturnType<typeof sessionState>, string> = {
  premarket: "Pre-market",
  open: "Market open",
  afterhours: "After hours",
  closed: "Market closed",
};

export async function MarketHeader() {
  let quotes: IndexQuote[] = [];
  let provenance: Provenance;

  try {
    const result = await providers().market.getIndexes();
    quotes = result.data;
    provenance = result.provenance;
  } catch (err) {
    // §10: an outage is shown, not swallowed into an empty strip.
    provenance = {
      state: "UNAVAILABLE",
      source: "market",
      observedAt: new Date().toISOString(),
      retrievedAt: new Date().toISOString(),
      delaySeconds: null,
      note: err instanceof Error ? err.message : "Index quotes could not be retrieved.",
    };
  }

  const session = sessionState();

  return (
    <div className="flex items-center gap-4 overflow-x-auto">
      <div className="flex shrink-0 items-center gap-2">
        <DataStateBadge provenance={provenance} showAge />
        <span
          className={cn(
            "text-2xs uppercase tracking-wider",
            session === "open" ? "text-up" : "text-faint",
          )}
        >
          {SESSION_LABELS[session]}
        </span>
      </div>

      {quotes.length === 0 ? (
        <span className="text-xs text-unavailable">
          {provenance.note ?? "Index quotes unavailable."}
        </span>
      ) : (
        <div className="flex items-center gap-4">
          {quotes.map((q) => (
            <IndexTicker key={q.symbol} quote={q} />
          ))}
        </div>
      )}
    </div>
  );
}

function IndexTicker({ quote }: { quote: IndexQuote }) {
  // VIX moves inversely to risk appetite, so a rising VIX is not "good".
  // Coloring it by sign like an equity would read backwards to a trader;
  // it is shown in the warn tone when elevated instead.
  const isVix = quote.symbol === "VIX";
  const tone = isVix
    ? quote.price >= 20
      ? "warn"
      : "neutral"
    : toneOf(quote.changePercent);

  return (
    <div className="flex shrink-0 items-baseline gap-1.5" title={quote.name}>
      <span className="text-2xs font-medium uppercase tracking-wider text-faint">
        {quote.symbol}
      </span>
      <span className="tnum text-sm font-medium text-ink">{quote.price.toFixed(2)}</span>
      <span className={cn("tnum text-xs", toneClass(tone))}>
        {formatSignedPercent(quote.changePercent)}
      </span>
    </div>
  );
}
