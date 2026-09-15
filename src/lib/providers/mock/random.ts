/**
 * Deterministic pseudo-randomness for the mock adapter.
 *
 * Mock data must be stable within a session (so a strike doesn't jump between
 * two renders of the same page) while still varying across tickers and time
 * buckets. A seeded generator gives both, and makes the mock layer testable.
 */

export function hashSeed(...parts: Array<string | number>): number {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for fixtures. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function between(r: () => number, min: number, max: number): number {
  return min + r() * (max - min);
}

export function intBetween(r: () => number, min: number, max: number): number {
  return Math.floor(between(r, min, max + 1));
}

export function pick<T>(r: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick() called with an empty list");
  return items[Math.min(items.length - 1, Math.floor(r() * items.length))]!;
}

/** Weighted pick. Weights need not sum to 1. */
export function pickWeighted<T>(r: () => number, entries: ReadonlyArray<[T, number]>): T {
  if (entries.length === 0) throw new Error("pickWeighted() called with an empty list");
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = r() * total;
  for (const [item, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return entries[entries.length - 1]![0];
}

/** Box–Muller, for return distributions that aren't uniform. */
export function gaussian(r: () => number, mean = 0, sd = 1): number {
  const u = Math.max(1e-9, r());
  const v = r();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Buckets `now` so mock values refresh periodically instead of on every
 * render, mimicking a polling feed without being noisy.
 */
export function timeBucket(seconds = 20, now: Date = new Date()): number {
  return Math.floor(now.getTime() / (seconds * 1000));
}
