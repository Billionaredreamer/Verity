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
   the package.
4. **Every market value carries `Provenance`.** State, source, `observedAt`,
   `retrievedAt`. If you add a value that skips this, you have introduced a
   number nobody can trace.
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

## Roadmap position

Phase 1 (foundation + Terminal/Flow/GEX shells on mock data) is what exists.
Phases 2–9 — live market data, real flow ingestion, the model layer, voice,
signals, monitoring, brokerage — are listed in handover §11 and are not built.

Before starting a phase, check whether the interfaces it needs already exist.
They usually do, unimplemented on purpose.
