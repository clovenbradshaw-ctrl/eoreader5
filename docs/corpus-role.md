# The corpus-role citation firewall

**Status: landed.** Retirement gate item 1 (hard blocker, non-negotiable per
`docs/eoreader5-parity-checklist.md` §4 / §"Retirement gate"). Ported from
`eoreader4.2:tests/corpus-role.test.js` against `eoreader4.2:src/core/log.js`
+ `src/core/project.js`.

## What this guards against

Reference-corpus content -- material admitted so a lens/prior can be
calibrated against it (eoPriors exemplar bases, competency corpora, install
corpora) -- must never be able to pass as, or contaminate, a document the
engine is actually reading. A corpus item is folded by the same engine, into
the same event ledger, as any document (no separate or simplified path).
`role: 'corpus'` is the only thing that marks it. Two guarantees hold
regardless of how a role:`'corpus'` event came to share a ledger with
document events:

1. **The mark is sealed at the one chokepoint.** A caller marks a command
   `role: 'corpus'` (`applyCommand(state, { ..., role: 'corpus' })` in
   `packages/engine/replay/index.js`); every event that command produces
   carries `role: 'corpus'`. A plain event never carries a `role` key at
   all -- not even a false-y one -- and an unrecognized `role` value is
   never trusted onto the event (only the literal string `"corpus"`
   survives).
2. **The projection firewall (F4).** `packages/engine/replay`'s
   `reduceEvents` skips every `role: 'corpus'` event unconditionally, before
   any other handling. It can never mint an observation, a referent, a
   relation (merge/split/same_as), a hypothesis (accepted/competing/held/
   superseded), a frame, or a resolution that a citing surface --
   `project()`, `readingSnapshot()`, `search()` -- can see.

The firewall is enforced at projection, not at storage (F6, mirroring
4.2): the ledger itself never refuses to *append* a `role: 'corpus'` event,
and it still appears in `project()`'s `evidence_links` (the raw provenance
trail keeps everything, same as 4.2's log). What it can never do is surface
as citable content.

## Where it lives

- Schema: `packages/spec/schemas/semantic-event.schema.json`'s optional
  `role` property (`enum: ["corpus"]`).
- Chokepoint: `applyCommand`'s `role` passthrough into `baseEvent`
  (`packages/engine/replay/index.js`).
- Firewall: the `if (event.role === "corpus") continue;` guard at the top of
  `reduceEvents`'s event loop (same file).
- Conformance pin: `packages/conformance/invariants/corpus-role.test.js`.

## Why this gates everything downstream

Any feature that reads from eoPriors content -- exemplar-basis lenses,
competency-corpus harvesting, prior calibration -- ultimately routes real
corpus text through this same engine ledger. Until this firewall is
conformance-pinned, there is no guarantee that content admitted for
calibration cannot leak into a reading's citable projection. This is why it
is retirement-gate item 1 and lands before any prior/lens feature, not
after.
