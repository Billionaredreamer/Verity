/**
 * Enforceable grounding for model output.
 *
 * The prompt tells the model to use only the context package. A prompt is a
 * request, not a guarantee — and the repository describes grounding as a
 * non-negotiable. This module is the enforcement: every figure and date the
 * model writes must correspond to a value actually present in the package, or
 * the response is rejected and the deterministic reasoner answers instead.
 *
 * ---------------------------------------------------------------------------
 * Why strict numeric matching is the right rule here, and not too strict
 * ---------------------------------------------------------------------------
 * The obvious objection: the model might legitimately compute something, like
 * "2.4% above VWAP", from a price and a VWAP that ARE in the package. Strict
 * matching rejects that.
 *
 * Rejecting it is correct, because handover §12 already forbids it: the model
 * is not where calculations happen. If a derived figure is worth showing, an
 * engine computes it and the context engine puts it IN the package — where it
 * is testable, consistent between screens, and attributable. So enforcement
 * and architecture agree, and the system prompt is written to match: state
 * relationships qualitatively, quote figures verbatim.
 *
 * The check is deliberately one-directional. It catches invented numbers. It
 * cannot catch an invented claim made without numbers ("institutions are
 * accumulating"), and nothing here pretends otherwise — that is what the
 * facts/analysis/uncertainty split and the deterministic fallback are for.
 */

import type { VerityContextPackage } from "@/lib/schema/core";

export interface GroundingResult {
  ok: boolean;
  /** Human-readable reasons, surfaced under uncertainty when a response is rejected. */
  violations: string[];
}

/** The shape the model must return. Validated, never coerced. */
export interface ModelAnswerShape {
  text: string;
  facts: string[];
  analysis: string[];
  uncertainty: string[];
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/**
 * Validate the response shape strictly.
 *
 * Coercion is the failure mode being avoided: `String(parsed.text)` turns
 * `undefined` into the string "undefined" and ships it to a trader, and
 * treating a non-array `facts` as `[]` silently discards the part of the
 * answer that was supposed to carry the evidence.
 */
export function validateShape(value: unknown): ModelAnswerShape | { error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "response was not a JSON object" };
  }
  const v = value as Record<string, unknown>;

  if (typeof v.text !== "string") return { error: "'text' was missing or not a string" };
  if (v.text.trim().length === 0) return { error: "'text' was empty" };

  for (const key of ["facts", "analysis", "uncertainty"] as const) {
    if (!Array.isArray(v[key])) return { error: `'${key}' was missing or not an array` };
    const arr = v[key] as unknown[];
    if (!arr.every((x) => typeof x === "string")) {
      return { error: `'${key}' contained a non-string entry` };
    }
  }

  return {
    text: v.text,
    facts: v.facts as string[],
    analysis: v.analysis as string[],
    uncertainty: v.uncertainty as string[],
  };
}

// ---------------------------------------------------------------------------
// Building the allowlist from the package
// ---------------------------------------------------------------------------

export interface Allowlist {
  numbers: number[];
  dates: Set<string>;
}

/**
 * Walk the package and collect every number and ISO date in it.
 *
 * Array lengths are included because counting the contents of the package is
 * a legitimate, verifiable statement ("28 flow prints") and the count is not
 * otherwise a value in the tree.
 */
export function buildAllowlist(pkg: VerityContextPackage): Allowlist {
  const numbers = new Set<number>();
  const dates = new Set<string>();
  const seen = new WeakSet<object>();

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

  function walk(node: unknown, depth: number): void {
    if (depth > 12 || node === null || node === undefined) return;

    if (typeof node === "number") {
      if (Number.isFinite(node)) numbers.add(node);
      return;
    }
    if (typeof node === "string") {
      // Timestamps and expirations: keep the date part.
      if (ISO_DATE.test(node)) dates.add(node.slice(0, 10));
      // Numbers already formatted into engine-generated prose are legitimate
      // — an engine produced them, so they are package values.
      for (const n of extractNumbers(node)) numbers.add(n.value * n.scale);
      return;
    }
    if (typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      numbers.add(node.length);
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      walk(value, depth + 1);
    }
  }

  walk(pkg, 0);
  return { numbers: [...numbers], dates };
}

// ---------------------------------------------------------------------------
// Extracting figures from prose
// ---------------------------------------------------------------------------

interface WrittenNumber {
  raw: string;
  value: number;
  /** Decimal places written, which sets the rounding tolerance. */
  decimals: number;
  /** 1, 1e3, 1e6 or 1e9 from a K/M/B suffix. */
  scale: number;
}

/**
 * Pull numeric tokens out of text, handling $, thousands separators, percent
 * signs and K/M/B suffixes.
 */
export function extractNumbers(text: string): WrittenNumber[] {
  const out: WrittenNumber[] = [];
  // Skip anything inside an ISO date — those are checked as dates.
  const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}/g, " ");

  const pattern = /(-?\$?\d[\d,]*(?:\.\d+)?)\s*([KMB])?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutDates)) !== null) {
    const rawNumber = match[1]!;
    const suffix = match[2];
    const cleaned = rawNumber.replace(/[$,]/g, "");
    const value = Number(cleaned);
    if (!Number.isFinite(value)) continue;

    const dot = cleaned.indexOf(".");
    const decimals = dot === -1 ? 0 : cleaned.length - dot - 1;
    const scale =
      suffix?.toUpperCase() === "B"
        ? 1e9
        : suffix?.toUpperCase() === "M"
          ? 1e6
          : suffix?.toUpperCase() === "K"
            ? 1e3
            : 1;

    out.push({ raw: match[0], value, decimals, scale });
  }
  return out;
}

/**
 * Is this written figure present in the allowlist?
 *
 * Tolerance is half of the last written decimal place, scaled by any suffix —
 * so "$59.0M" accepts anything that rounds to it, while "660.68" demands the
 * value to the cent. Sign is ignored, because prose says "down 5.38" for a
 * change of -5.38.
 */
function isAllowed(written: WrittenNumber, allowed: number[]): boolean {
  const target = Math.abs(written.value * written.scale);
  // Exactly half the last written place, scaled by any suffix. No floor: an
  // absolute floor of half a unit sounds harmless but lets a small derived
  // figure (0.023%) match an unrelated package value (0.2%), which is the
  // precise hole this check exists to close.
  const tolerance = 0.5 * Math.pow(10, -written.decimals) * written.scale;

  for (const candidate of allowed) {
    if (Math.abs(Math.abs(candidate) - target) <= tolerance) return true;
    // Percentages are sometimes stored as decimals (0.42) and written as 42%.
    if (Math.abs(Math.abs(candidate) * 100 - target) <= tolerance) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * Verify that every figure and date in the answer exists in the package.
 *
 * Returns all violations rather than the first, so the log says how badly a
 * response missed rather than merely that it did.
 */
export function checkGrounding(
  answer: ModelAnswerShape,
  pkg: VerityContextPackage,
): GroundingResult {
  const allowlist = buildAllowlist(pkg);
  const violations: string[] = [];

  const segments: Array<[string, string[]]> = [
    ["text", [answer.text]],
    ["facts", answer.facts],
    ["analysis", answer.analysis],
    ["uncertainty", answer.uncertainty],
  ];

  for (const [field, strings] of segments) {
    for (const s of strings) {
      for (const date of s.match(/\d{4}-\d{2}-\d{2}/g) ?? []) {
        if (!allowlist.dates.has(date)) {
          violations.push(`${field}: date ${date} is not in the context package`);
        }
      }
      for (const written of extractNumbers(s)) {
        if (!isAllowed(written, allowlist.numbers)) {
          violations.push(`${field}: figure "${written.raw.trim()}" is not in the context package`);
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}
