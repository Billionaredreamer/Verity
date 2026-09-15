# Agent instructions

**Read `CLAUDE.md` first.** It is the full working agreement for this repo —
architecture, conventions, layout, and the reasoning behind the rules. This
file exists so agents that look for `AGENTS.md` by convention find their way
there. Same rules for every agent and every human.

A real file rather than a symlink, because symlinks do not survive a Windows
checkout cleanly.

The eight non-negotiables, repeated here so they are never missed:

1. No brokerage execution in V1. `BrokerageProvider` has no order method by
   design.
2. Deterministic calculations (gamma, risk, signals, regime) live in
   `src/lib/engines/`, never in the language model.
3. The model gets a `VerityContextPackage` and no market endpoints. It may not
   cite a figure that is not in that package.
4. Every market-derived value carries `Provenance` — state, source,
   `observedAt`, `retrievedAt`.
5. `MOCK`, `DELAYED` and `UNAVAILABLE` are always rendered to the user. Stale
   data is never presented as live.
6. No secrets reach the client. Provider and AI keys are server-side only.
7. No vendor name appears outside `src/lib/providers/`.
8. No fake functionality to complete the UI. Mock data behind a real interface
   is fine; a button that pretends to work is not.

Before finishing any change: `npm run typecheck` and `npm test`.

Source of record for product decisions is
`Verity_Product_Engineering_Handover.docx`. Where this repo and the handover
disagree, the handover wins.
