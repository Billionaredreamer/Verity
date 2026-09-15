/**
 * Footer strip naming the active providers.
 *
 * Handover §10 requires separating mock, delayed and live data states and
 * logging enough to explain where a result came from. Putting the active
 * adapter set permanently on screen means a trader can always answer "what am
 * I actually looking at?" without opening a config file.
 */

import { providerSummary } from "@/lib/providers/registry";

export function DataSourceStrip() {
  let sources: ReturnType<typeof providerSummary>;
  try {
    sources = providerSummary();
  } catch (err) {
    return (
      <p className="text-2xs text-unavailable">
        Provider configuration error: {err instanceof Error ? err.message : "unknown"}
      </p>
    );
  }

  const allMock = sources.every((s) => s.id === "mock");

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-2xs text-faint">
      {sources.map((s) => (
        <span key={s.role}>
          <span className="text-faint/70">{s.role}:</span>{" "}
          <span className={s.id === "mock" ? "text-mock" : "text-muted"}>{s.label}</span>
        </span>
      ))}
      {allMock && (
        <span className="text-mock">
          Every figure on screen is synthetic fixture data — nothing here reflects a real market.
        </span>
      )}
      <span className="ml-auto">
        Trading intelligence and market analysis software. Not investment advice.
      </span>
    </div>
  );
}
