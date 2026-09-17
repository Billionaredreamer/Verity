# Verity — working agreement

Read this before changing anything. It encodes rules from
`Verity_Product_Engineering_Handover.docx`, which is the spec of record. Where
this file and the handover disagree, the handover wins — and the disagreement
is a bug in this file worth fixing.

Sandra owns the product. Claude and Codex both work in this repo. Same rules
for both, so a reviewer cannot tell from the diff who wrote it.

## What Verity is

An AI-powered trading intelligence platform: market data, options flow, gamma
exposure, position context, risk, catalysts and conversational AI in one
workflow. It analyses and explains. It does not trade.

Every major feature answers at least one of three questions:
**What is happening? Why does it matter? What changed that deserves attention?**
A feature that answers none of them does not belong in V1.

## Non-negotiables

These come straight from handover §10 and §12. Breaking one is a revert, not a
review comment.

1. **No brokerage execution in V1.** `BrokerageProvider` has no order method,
   and that absence is deliberate. Adding one means changing the interface,
   which means a conversation with Sandra first.
2. **Deterministic calculations stay out of the language model.** Gamma, risk,
   signal scores and regime are computed in `src/lib/engines/`. The model reads
   the result and explains it. It never produces the number.
3. **The model gets no market endpoints.** It receives a
   `VerityContextPackage` assembled by the context engine and nothing else.
   Do not give it fetch access, and do not let it cite a figure that is not in
   the package. This is *enforced*, not requested: `checkGrounding` validates
   every figure and date in a model response against the package and discards
   the answer if any cannot be traced. Do not weaken that check to accommodate
   a model that wants to do arithmetic — rule 2 says the arithmetic belongs in
   an engine, and if a derived figure is worth showing, compute it and put it
   in the package.
4. **Every market value carries `Provenance`, and derived values inherit it.**
   State, source, `observedAt`, `retrievedAt`. A value computed from other
   values takes the weakest state among its inputs (`mergeProvenance`) — risk
   derived from mock positions is `MOCK`, however deterministic the
   arithmetic. Never construct a `Provenance` at render time with a literal
   state; that is how a screen ends up claiming `LIVE` over mock data.
5. **Never silently substitute stale or mock data for live.** `MOCK`,
   `DELAYED` and `UNAVAILABLE` are rendered to the user, always. An outage
   shows as an outage.
6. **No secrets reach the client.** Provider keys, brokerage tokens, DB
   credentials and AI keys are server-side only. `src/lib/providers/registry.ts`
   imports `server-only` to enforce this at build time.
7. **Providers stay replaceable.** Nothing outside `src/lib/providers/` may
   name a vendor. If `Polygon` appears in a component, that is a bug.
8. **No fake functionality to complete the UI.** Mock data behind a real
   interface is fine and expected. A button that appears to do something and
   does not is never fine. If a feature is not built, the UI says so.

## Interpretation rules that are easy to get wrong

- **Flow is not directional by contract type.** A large call is not bullish.
  A call *bought on the ask* is bullish for the buyer; a call *sold on the bid*
  is not. Midpoint and unreported prints are `unclear`, and `unclear` is a real
  answer that must survive to the UI. See `flowEngine.readEvent`.
- **GEX assumes dealer positioning it cannot observe.** The convention is that
  dealers are long call OI and short put OI. That is a model, not a
  measurement. `GEX_ASSUMPTION` is exported so every surface that shows gamma
  can say so.
- **A signal without invalidation conditions is not a signal.** §6 requires
  every setup to explain why it was surfaced and what would falsify it. The
  engine returns `null` rather than emit a setup that cannot do both.
- **Confidence is capped below 1.0 everywhere.** Nothing here is certain.
- **`null` is not zero, and it is not 100%.** An unknown portfolio total must
  yield a `null` position weight. Passing the position's own size as the
  denominator — which this codebase did once — produces a confident "100% of
  portfolio" for every position: a fabricated number wearing the shape of a
  real one, which is worse than a blank.
- **Market value is not exposure.** `exposure` on an option is
  delta-equivalent notional (what it behaves like); market value is what it is
  worth. Summing exposure into an account total inflated the portfolio
  threefold once already. `positionEngine` holds both; use the right one.

## Layout

```
src/
  app/                  Next.js App Router — routes and API handlers
  components/           UI, grouped by feature
  lib/
    schema/core.ts      Internal types. The contract between everything.
    providers/          Adapter boundary. Vendor names live here and nowhere else.
      mock/             Labeled fixtures. Structurally realistic, never real.
    engines/            Deterministic analytics. Pure functions. Unit-tested.
    math/               Black-Scholes greeks.
    context/            Retrieval and assembly for the AI layer.
    ai/                 The reasoning layer and its prompt.
    util/               Dates, formatting.
```

Data flows one way: **providers → normalization → engines → context → AI → UI.**
Do not shortcut it. A component calling a provider directly is a bug even when
it works.

## Conventions

- TypeScript strict, including `noUncheckedIndexedAccess`. Do not turn either
  off, and do not reach for `any` — if the type is genuinely unknown, model
  that.
- `null` means "we do not know". Never use `0` to mean absent: a relative
  volume of `0` and an unknown relative volume are different facts, and the UI
  renders them differently.
- Comments explain *why*, not *what*. If a number is a judgment call
  (thresholds, weights, confidence scaling), the comment says what it is and
  why it was chosen.
- Run `npm run typecheck` and `npm test` before you consider something done.

## What exists, precisely

An earlier version of this section said "the model layer, signals … are not
built", which was wrong in both directions — signals ship, and the model layer
exists but needs a key. Four states, not two:

**Implemented and running on mock data.** Terminal with context retrieval and
grounded answers; Flow with every §4 field and filter; GEX including 0DTE;
Markets; Signals; read-only Portfolio. All six engines
(`flow`, `gamma`, `risk`, `signal`, `marketRegime`, `position`). The mock
adapters are real implementations of the provider interfaces, not stubs.

**Implemented, requires configuration.** The language-model reasoner. With
`ANTHROPIC_API_KEY` set, `ModelReasoner` answers; without it,
`DeterministicReasoner` does. Model output passes strict shape validation and
grounding enforcement (`src/lib/ai/grounding.ts`) before a trader sees it —
any figure not traceable to the context package discards the whole answer and
the deterministic reasoner answers instead, with the substitution shown in the
UI. Switching reasoners is a key, not a code change.

**Interface only — the contract exists, no implementation does.** Live market,
options, news and brokerage adapters. `registry.ts` registers `mock` alone, and
selecting anything else throws at startup rather than silently serving mocks.
Writing a real adapter is a new file implementing the interface plus one
registry line; it is genuinely *not* just flipping an environment variable,
and the `.env.example` provider list names candidates, not working options.

**Absent.** Auth (`userId` is hardcoded `"local-user"`), persistence (no
database is wired; the entity list in §9 is a schema sketch), voice (the
control is rendered disabled), trade monitoring and alerts (types exist in
`schema/core.ts`, no engine), real-time streaming.

Before starting a phase, check whether the interfaces it needs already exist.
They usually do, unimplemented on purpose.
