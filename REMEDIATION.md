# Response to the Codex Phase 1 audit

**Baseline audited:** `3c6853e`
**Remediation:** `ef18cd2`

```text
TypeScript: PASS
Tests:      PASS — 236 tests across 12 files (was 68 across 3)
Build:      PASS — Next.js production build
```

The audit was accurate. Three of its findings were real defects, and one of
them shipped with a comment claiming it had been handled. Everything in
Priority 1 is fixed; Priority 2 is done.

---

## Priority 0 — the source-of-record specification

**Closed, not deferred.** `Verity_Product_Engineering_Handover.docx` was not in
the archive Codex received, but it is available to this agent and every change
below was checked against it. Section references throughout the code
(`§4`, `§5`, `§7`, `§10`, `§12`) point at that document.

Two places where the implementation departs from the handover, stated
explicitly rather than left to inference:

1. **§4 lists "0DTE / weekly / monthly" as the expiration filter.** The code
   adds a fourth bucket, `leaps`, for anything beyond a year. Filing a
   contract expiring in 2028 under "monthly" is misleading on a flow screen.
   This is an addition, not a substitution — the three named buckets behave
   as specified.

2. **§9 lists eleven database entities.** None are implemented; there is no
   database. The entity list is treated as a Phase 2 schema sketch rather than
   a Phase 1 deliverable, consistent with §11 placing persistence after the
   foundation phase. Flagging it because "suggested database entities" could
   reasonably have been read as in-scope for Phase 1, and it was not built.

No other deviations were found. The §12 engineering rules and the §10 security
and reliability constraints are implemented as written.

---

## Priority 1 — Terminal portfolio risk

**The defect was worse than reported.** `riskForPosition` passed the position's
own exposure as `portfolioSize`, and carried this comment:

```ts
// A real implementation reads portfolio size from the brokerage summary.
// Using a placeholder would produce a fabricated concentration figure, so
// this is passed through by the caller that has the real total.
portfolioSize: positionSize,
```

The comment describes the correct design and the code does the opposite. A
reader auditing that function would have been told the problem was already
handled. That is a worse failure than the arithmetic bug, and worth naming.

There was a second, compounding error: `positionSize` was the position's
**exposure** (delta-equivalent notional), not its market value. For an option
these differ by orders of magnitude, and `riskEngine` derives the contract
count from `positionSize` via the premium — so every greeks-derived figure was
scaled wrong too.

### What changed

- `VerityContextPackage` now carries the whole `Sourced<PortfolioSummary>`,
  not just a matched `Position`.
- New `src/lib/engines/positionEngine.ts` (a module §8 already lists) holds
  `marketValue`, `signedMarketValue` and `riskInputFor`. **Both the Terminal
  and the Portfolio screen call `riskInputFor`.** Agreement is structural, not
  a convention two call sites are trusted to maintain.
- `RiskInput.portfolioSize` is `number | null`; `RiskAssessment.positionWeight`
  is `number | null`. With no portfolio total, portfolio-relative outputs are
  suppressed and a warning says so. Position-local figures — dollar risk,
  theta cost, dollars per 1% move — are still reported, because those never
  needed the portfolio.

Returning `null` rather than `0` matters here: zero would render as "no
exposure", which is a claim. The unknown is reported as unknown.

### Acceptance criteria

| Criterion | Status |
|---|---|
| $10,000 position in a $100,000 portfolio returns 10% | ✅ `contextEngine.test.ts` |
| Missing portfolio value does not return 100% | ✅ `riskEngine.test.ts`, `contextEngine.test.ts` |
| Terminal agrees with Portfolio for the same position | ✅ `positionEngine.test.ts` |
| Tests for equity, option, missing position, unavailable brokerage | ✅ all four |

---

## Priority 1 — enforceable model grounding

`src/lib/ai/grounding.ts` is new. Two gates before any model output reaches a
trader:

**Shape validation** (`validateShape`) rejects rather than coerces. The prior
code did `String(parsed.text ?? "")`, which converts a missing field into the
literal string `"undefined"`, and `toStringArray` turned a malformed `facts`
field into `[]` — silently discarding the evidence while keeping the claim.

**Grounding** (`checkGrounding`) builds an allowlist of every number and ISO
date in the context package, then verifies every figure the model wrote
against it. Tolerance is exactly half the last written decimal place, scaled
by any K/M/B suffix — so `$59.0M` accepts anything rounding to it, while
`660.68` is held to the cent. Percentages stored as decimals (`0.108`) match
when written as `10.8%`, and unsigned prose ("down 1.32") matches a negative
change.

### The design decision worth flagging

The audit suggested evidence identifiers the model cites and the server
resolves. I did not do that, and the reasoning matters for whether you agree
with the result.

Evidence IDs constrain what the model can *cite* but leave the free-text `text`
field unconstrained — a model could cite correctly and still write an invented
level in prose. Numeric verification covers every field including free text,
and does not depend on the model adopting a citation convention.

The cost is that the model cannot compute derived figures, because a computed
value is by definition not in the package. **That restriction turned out to be
the existing architecture rather than a new limitation.** §12 already says
deterministic calculations stay out of the language model. If a derived figure
is worth showing, an engine computes it and the context engine puts it in the
package. So the enforcement and the architecture agree, and the system prompt
was rewritten to match: quote verbatim, describe relationships in words, never
calculate.

What this does **not** catch, stated plainly: an invented claim containing no
numbers. "Institutions are accumulating" passes the grounding check. The
facts/analysis/uncertainty split and the deterministic fallback are what
address that; the numeric gate is not claimed to be more than it is.

### One thing changed after a test failed

The first implementation had a tolerance floor of half a unit, intended to be
forgiving about rounded integers. It let `0.023%` match an unrelated `0.2%` in
the package — the exact class of error the check exists to catch. The floor is
gone. Caught by `grounding.test.ts` → "rejects a figure the model derived
itself".

### Acceptance criteria

| Criterion | Status |
|---|---|
| Response with a price not in the package is rejected | ✅ |
| Malformed response is rejected | ✅ |
| Valid grounded response is accepted | ✅ |
| Failure produces deterministic answer with a visible notice | ✅ |
| Tests: invented figures, malformed JSON, wrong types, valid output | ✅ 23 tests |

A deliberate departure: the rejection message shown to the user does **not**
name the offending values. Writing "figure 712.45 is not in the package" onto a
trading screen still puts an invented price in front of a trader. The values go
to `console.warn`; the user sees a count and the fact of substitution.

---

## Priority 1 — provenance through derived data

Fixed as specified. Position cards inherit the brokerage adapter's provenance;
risk carries `mergeProvenance([portfolio, snapshot], "riskEngine")` — the
engine named as source, the **weakest input state** as the state. No
`Provenance` is constructed at render time anywhere outside the provider layer,
and a grep for that pattern is part of the audit script.

| Criterion | Status |
|---|---|
| Risk from mock brokerage is visibly MOCK | ✅ |
| Risk from delayed data is visibly DELAYED | ✅ |
| Position cards reflect the real adapter provenance | ✅ |
| Tests across live, delayed, mock, unavailable | ✅ |

---

## Priority 2 — test boundary

68 → 236 tests.

| Area | Tests | What it prevents |
|---|---|---|
| `contextEngine` | 24 | Retrieval planning regressions, swallowed provider failures, the 100%-weight bug, fabricated card provenance |
| `grounding` | 23 | Coerced malformed responses; invented prices, dates and derived figures reaching the UI |
| `reasoner` | 13 | A rejected model answer leaking through; an outage being reported as a rejection |
| `signalEngine` | 14 | Setups without invalidation conditions; BUY/SELL output; confidence reaching 1.0 |
| `marketRegimeEngine` | 13 | Missing breadth read as bearish; confident labels on conflicting inputs |
| `positionEngine` | 16 | Exposure/market-value confusion; Terminal and Portfolio drifting apart |
| `flowQuery` | 17 | A malformed filter silently widening the query |
| API routes | 18 | Unvalidated input; an outage rendering as an empty success |
| `blackScholes` edges | 25 | NaN propagating into a gamma wall; 0DTE zeroing out |

Fake providers implement the real interfaces rather than being module mocks, so
an interface change breaks the tests — which is the point.

**Not done: UI end-to-end coverage.** No browser-driving framework is installed
and adding one is a larger decision than this pass should make unilaterally.
The suggested assertions (navigation, mock badges, disabled voice control, flow
filters, GEX mode switch, one Terminal request) are all reachable through the
route tests and component-level state except the rendering itself. Flagging as
an open gap rather than quietly skipping it.

---

## Priority 2 — documentation

`README.md` and `CLAUDE.md` now use the same four states: implemented / needs
configuration / interface-only / absent.

The specific contradiction the audit found is fixed. `CLAUDE.md` claimed "the
model layer, voice, signals … are not built", which was wrong twice over:
signals ship, and the model layer exists behind a key. Both documents now say
plainly that real provider adapters require implementation and are **not** an
environment-variable switch today.

---

## Also fixed, found while writing tests

The retrieval keyword pattern `/\brisk\b/` does not match `"risks"` — `s` is a
word character, so the trailing boundary fails. The handover's §3 representative
query is *"What risks am I missing?"*, so the exact phrasing the spec calls
representative silently skipped risk retrieval. Patterns now use explicit
plurals. Caught by `contextEngine.test.ts` → "pulls the position for a risk
question".

---

## Scope

Nothing in the out-of-scope list was touched. No execution, no live brokerage
actions, no voice, no auth, no monitoring, no live adapters, no new screens.
The read-only brokerage contract and the disabled voice control are intact.
`BrokerageProvider` still has no order method.

## Runtime verification

Terminal, `What risks am I missing on NVDA?`:

```text
card position  value=+12 187.5 call  state=MOCK  source=mock
card risk      value=$16276/1%       state=MOCK  source=riskEngine
fact: "The position is 2.3% of the portfolio by value."
```

Portfolio screen, same position: total value $154,347, NVDA 12 contracts at a
3.10 mark = $3,720 market value = **2.4%**.

The 2.3 / 2.4 gap is mock prices drifting between two HTTP requests, not a
logic difference — the mock layer re-seeds on a time bucket. Agreement is
asserted deterministically in `positionEngine.test.ts` → "produces identical
risk for the same position through either path", which runs both paths against
one portfolio object and requires the full `RiskAssessment` to be equal.

Before this change the same card read `state=LIVE` and the weight was 100%.
