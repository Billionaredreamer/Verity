/**
 * Date and expiration helpers.
 *
 * Options expirations are date-only concepts, so everything here works in
 * YYYY-MM-DD strings and avoids constructing local-midnight Date objects,
 * which shift across timezones and silently move an expiration by a day.
 */

import type { ExpirationBucket } from "@/lib/schema/core";

export function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(iso: string): Date {
  // Noon UTC keeps the date stable under any reasonable timezone shift.
  return new Date(`${iso}T12:00:00Z`);
}

/** Whole calendar days from `a` to `b`. Negative when `b` precedes `a`. */
export function daysBetween(a: Date, b: Date): number {
  const ms = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  return Math.round(ms / 86_400_000);
}

export function daysToExpiration(expiration: string, from: Date = new Date()): number {
  return Math.max(0, daysBetween(from, parseIsoDate(expiration)));
}

/** True when the date is the third Friday of its month — the monthly cycle. */
export function isMonthlyExpiration(iso: string): boolean {
  const d = parseIsoDate(iso);
  if (d.getUTCDay() !== 5) return false;
  const dom = d.getUTCDate();
  return dom >= 15 && dom <= 21;
}

/**
 * Handover §4 filter group: "0DTE / weekly / monthly". LEAPS is added because
 * a year-out contract filed under "monthly" is misleading on the Flow screen.
 */
export function bucketForDte(dte: number, expiration: string): ExpirationBucket {
  if (dte <= 0) return "0dte";
  if (dte > 365) return "leaps";
  if (isMonthlyExpiration(expiration)) return "monthly";
  if (dte <= 9) return "weekly";
  return "monthly";
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * The next `count` listed expirations, approximating a real calendar: every
 * Friday, plus Monday and Wednesday for the index proxies that list them.
 * Today counts as an expiration when it is a listed day — that is what makes
 * the 0DTE view (§5) have anything in it.
 */
export function upcomingExpirations(count: number, from: Date = new Date()): string[] {
  const out: string[] = [];
  const listedDays = new Set([1, 3, 5]); // Mon, Wed, Fri
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let i = 0; i < 400 && out.length < count; i++) {
    if (listedDays.has(cursor.getUTCDay())) out.push(toIsoDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Today in YYYY-MM-DD, used by the 0DTE view. */
export function todayIso(from: Date = new Date()): string {
  return toIsoDate(from);
}

/** Compact relative time for feed rows: "12s", "4m", "2h", "3d". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * US regular session state, in Eastern time. Drives the §2 "market-hours
 * response style" and the freshness readout. Market holidays are not modeled
 * here — a real implementation reads them from the exchange calendar, and
 * that belongs behind a provider rather than in a util.
 */
export type SessionState = "premarket" | "open" | "afterhours" | "closed";

export function sessionState(now: Date = new Date()): SessionState {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return "closed";
  const minutes = et.getHours() * 60 + et.getMinutes();
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "premarket";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "open";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "afterhours";
  return "closed";
}
