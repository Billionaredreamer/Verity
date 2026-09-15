# Verity

AI-powered trading intelligence. Market data, options flow, gamma exposure,
position context, risk and conversational analysis in one workflow.

Verity explains what is happening, why it matters, and what changed. It does
not place trades.

## Status

**Phase 1 of the handover roadmap (§11).** The foundation, Terminal, Flow and
GEX screens are built and run on a labeled mock data layer behind real provider
interfaces. No live market data is wired yet — that is phase 2, and it is a
configuration change rather than a rewrite.

What works today:

| Screen | State |
|---|---|
| Terminal | Context retrieval, grounded answers split into facts / analysis / uncertainty, context cards, inspectable retrieval trace |
| Flow | All §4 event fields and all §4 filters, per-print interpretation that can return "unclear" |
| GEX | Deterministic gamma engine — walls, zero gamma, flip, regime, by-strike and by-expiration views, plus 0DTE mode |
| Markets | Regime assessment, indexes, sectors, breadth, economic calendar |
| Signals | Factor-scored setups with evidence, risks and invalidation conditions |
| Portfolio | Read-only positions, P/L, exposure, concentration, upcoming expirations |

Not built, by design: live provider connections, voice, trade monitoring,
brokerage OAuth, auth. The interfaces exist; the implementations do not.

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

## Three decisions worth knowing about

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
data is fine is a badge nobody can trust.

## Working on this

Read [`CLAUDE.md`](./CLAUDE.md) before changing anything. It holds the
non-negotiables — no execution in V1, deterministic math outside the model, no
secrets client-side, no fake functionality to complete the UI — and the
reasoning behind each. `AGENTS.md` points there too.

The spec of record is `Verity_Product_Engineering_Handover.docx`. Where this
repo and the handover disagree, the handover wins.
