# Verity

AI-powered trading intelligence. Market data, options flow, gamma exposure,
position context, risk and conversational analysis in one workflow.

Verity explains what is happening, why it matters, and what changed. It does
not place trades.

## Status

**Phase 1 of the handover roadmap (§11), audited and remediated.** Everything
runs on a labeled mock data layer behind real provider interfaces.

### Implemented, running on mock data

| Screen | What it does |
|---|---|
| Terminal | Context retrieval, grounded answers split into facts / analysis / uncertainty, context cards, inspectable retrieval trace |
| Flow | All §4 event fields and all §4 filters, per-print interpretation that can return "unclear" |
| GEX | Deterministic gamma engine — walls, zero gamma, flip, regime, by-strike and by-expiration views, plus 0DTE mode |
| Markets | Regime assessment, indexes, sectors, breadth, economic calendar |
| Signals | Factor-scored setups with evidence, risks and invalidation conditions |
| Portfolio | Read-only positions, P/L, exposure, concentration, upcoming expirations |

### Implemented, needs configuration

The language-model reasoner. Set `ANTHROPIC_API_KEY` and `ModelReasoner`
answers; leave it unset and `DeterministicReasoner` does. Model output is
validated for shape and **grounding** before anyone sees it — every figure and
date must trace to the context package, or the whole answer is discarded and
the deterministic one is shown with the substitution stated in the UI.

### Interface only — no implementation

Live market, options, news and brokerage adapters. The interfaces are complete
and `registry.ts` is the single switch point, but only `mock` is registered;
selecting anything else throws at startup rather than quietly serving fixtures.

**This is not merely an environment-variable change.** The provider names in
`.env.example` are candidates from handover §9, not working options — each
needs an adapter written against the interface. What the architecture buys you
is that writing one touches a new file and one registry line, and nothing else.

### Absent

Auth (`userId` is hardcoded), persistence (no database wired; the §9 entity
list is a schema sketch), voice (control rendered disabled), trade monitoring
and alerts (types exist, no engine), real-time streaming.

## Running it

```bash
npm install
cp .env.example .env.local   # no keys needed — defaults to the mock adapters
npm run dev
```

Open http://localhost:3000. Every figure will be badged `MOCK`, because it is.

```bash
npm run typecheck
npm test
npm run build
```

## How it fits together

```
providers → normalization → engines → context engine → AI layer → UI
```

One direction, no shortcuts. A component that calls a provider directly is a
bug even when it works.

- `src/lib/schema/core.ts` — the internal types everything speaks. Providers
  are translated into these; nothing above the adapter boundary knows a vendor's
  vocabulary.
- `src/lib/providers/` — adapter implementations. The only place a vendor name
  appears. Swapping the mock market adapter for Polygon means one new file and
  one line in `registry.ts`.
- `src/lib/engines/` — deterministic analytics: gamma, flow interpretation,
  risk, signals, market regime. Pure functions, unit-tested.
- `src/lib/context/` — assembles the structured package the AI layer reads.
- `src/lib/ai/` — the reasoning layer. Reads the package; has no market
  endpoints of its own.

## Four decisions worth knowing about

**Flow is not directional by contract type.** A large call print is not
bullish. A call *bought on the ask* is bullish for the buyer; a call *sold on
the bid* is the opposite; a midpoint print is genuinely unreadable. The engine
returns `unclear` in that last case and the UI shows it, because the alternative
is a confident answer the data does not support.

**Gamma exposure is a model, not a measurement.** Every GEX figure rests on the
convention that dealers are long call open interest and short put open interest.
Real dealer books are not observable. `GEX_ASSUMPTION` is exported so every
surface that shows gamma can say so, and they do.

**Mock data is labeled everywhere, including when it is good news.** The data
state badge renders `LIVE` as visibly as `MOCK`. A badge that disappears when
data is fine is a badge nobody can trust. Derived values inherit the weakest
state among their inputs, so a deterministic risk calculation over mock
positions is labeled `MOCK` — determinism makes arithmetic trustworthy, it
does not upgrade the data underneath.

**Model grounding is enforced, not requested.** Telling a model in its prompt
to use only the supplied data is a request. `checkGrounding` is the
enforcement: every number and date in a model response is matched against
values actually present in the context package, and one that is not discards
the entire answer. The model is also forbidden from computing derived figures,
which sounds strict until you notice it is just the existing rule — the
calculations live in engines — applied consistently. If a derived figure is
worth showing, an engine computes it and it enters the package, where it is
testable and consistent across screens.

## Working on this

Read [`CLAUDE.md`](./CLAUDE.md) before changing anything. It holds the
non-negotiables — no execution in V1, deterministic math outside the model, no
secrets client-side, no fake functionality to complete the UI — and the
reasoning behind each. `AGENTS.md` points there too.

The spec of record is `Verity_Product_Engineering_Handover.docx`. Where this
repo and the handover disagree, the handover wins.
