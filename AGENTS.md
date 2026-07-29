# EOReader5 — engine map for agents

Read `docs/nameless-referent.md` first. It is the foundational principle:
identity lives in the REFERENT, never in a string; surfaces are scoped
evidence admitted by explicit events; witness-tier knowledge is injected as
priors, never derived. Every coref regression in this project came from
forgetting it. The companion principle is omnimodal design: an organ must
make sense for a nameless leitmotif in music, or it is string-thinking. The
third is `docs/holon-level.md`: whether one entity is above, below, or a peer
of another is DISCOVERED (existence-dependency + possibility-constraint,
Born-null gated), never assigned by naming a scale ("chapter," "scene").
Read it before writing any cross-entity containment, ranking, or hierarchy
logic.

## Organs and their status (2026-07)

| organ | file | status |
|---|---|---|---|
| cube classifier | `packages/engine/cube/index.js` | scored amplitudes over all 9×9×9 (was first-match-wins regex; that made Atmosphere/Lens/Paradigm unreachable). `classifyAmplitudes()` = the uncollapsed fold; `classify()` = its argmax. |
| referent presence | `packages/engine/perceiver/text/presence.js` | `admitReferent` — event-sourced via `referents/projectReferents`; name variants structural (holons); descriptor aliases + narrator spans from per-text coref priors (`eoPriors/priors/coref/*.json`, anchor-quoted scopes). Emanons/first-person handled; missing prior ⇒ typed gap. |
| associative memory | `packages/engine/emergence/store/index.js` | Hebbian edges at co-occurrence; sparse-BAND keys (idf ≥ floor AND df ≥ 2); keyword and phrase stores separate; index all, wire top-k; one CA3 completion hop. Biology notes in header are load-bearing. |
| entity fold | `packages/engine/emergence/summary/entity-fold.js` | offset-grounded spans (verified round-trip), presence-based frames, stratified whole-arc selection, `withRelations`, `referent` prior option, `echoes` (spans carry offset-anchored recalled antecedents from the store). |
| multi-altitude fold | `packages/engine/emergence/summary/multi-altitude-fold.js` | one-pass five-altitude entity summary (L0 line → L4 dossier); monotone by construction (cumulative prefixes of globally-ranked candidate pool); discourse-aware scene selection (location + motif bias). |
| discourse | `packages/engine/discourse/index.js` | turn-based working memory: motif activation with exponential decay (25 cap, same physics as quantum), pronoun channelling (0.5 weight), topic stack (5 cap), commitment lifecycle, reading-location tracking. Clock is logical turns, not wall time. |
| spine | `summary/spine.js` | `scoreByPos` exposes ALL sampled scores (not just peaks); `minHistory` cold-start mask exists but masking kills exposition scenes — see dead-ends. |
| reaction channel | `packages/engine/reaction/index.js` | `ReactionEvent@1` in its OWN append-only content-addressed log — never the semantic ledger (a reaction is an observation of a READER, not an inference; it carries no operator, no prior_id, no epoch). `ts`/`seq` are host-supplied; the engine has no clock. `salienceRanking` is a zero-weight TALLY, not a model — inferring from this channel is deliberately out of scope until it has data. Firewall: `conformance/invariants/reaction-channel-firewall.test.js`. |

## Structural oracle (the score that matters)

No hand-written goldens. The engine's correctness is verified by a structural
oracle: `scripts/test-altitudes.mjs` (run from repo root). It produces a
five-altitude entity summary packet (L0 line → L4 dossier) for 4+ entities
across 2+ texts and scores the stack on three mechanical invariants:

| check | what it measures | invariant |
|---|---|---|
| GROUNDING | every span has a valid source offset | 100% |
| ENTITY-FAITHFUL | every span comes from a frame where presence detected the entity | 80%+ |
| MONOTONICITY | L0 ⊆ L1 ⊆ L2 ⊆ L3 ⊆ L4 by construction | 100% |

The altitude test replaces the old span-golden (significance, 5/21 ceiling,
hand-picked scenes) and memory-golden (store recall, 4 events). The oracle
is the hypothesis test: any regression in the organs (presence, fold, store,
spine, referent admission) will surface as a failure of grounding, faith-
fulness, or monotonicity. No model call, no hand-labelled golden, no tuning.

The mechanism: `multiAltitudeFold` in `packages/engine/emergence/summary/multi-altitude-fold.js`
builds all five levels in one pass from a globally-scored candidate pool,
partitioning by scene count (3/6/12/24/all). Altitude layers are cumulative
prefixes of the rank-sorted pool, guaranteeing monotonicity by construction.
Layers that collapse to the same size (not enough candidates) signal that the
event extraction or spine ranking needs more coverage.

Tests that must stay green: `scripts/test-altitudes.mjs`,
`discourse/discourse.test.js`, `cube/index.test.js`,
`perceiver/text/presence.test.js`, `emergence/store/store.test.js` (the
presence and store tests ENFORCE the principles — if one fails, you are
probably re-deriving identity from strings). Discourse must also stay green
on the conformance purity gate: `forbidden-dependencies.test.js` (no
Date.now, no I/O, no randomness).

## Tier discipline

`resolution/resolution-spectrum.js` draws the line: RESOLVED/ENGINE vs
MODEL (needsWitness). Engine-tier: structural name coref, verbatim/keyword
motif recurrence. Model-tier: descriptor synonymy (monster≈creature,
union≈wedding), thematic resonance (the two oaks). Model-tier absences are
reported as typed `gaps` — faking them is the cardinal regression.

## Measured dead ends — do NOT silently retry

- Distributional coref (frame-level lift; sentence-level complementary
  distribution) — both failed measurably; see `presence.js` header.
- **Deriving a READER PRIOR from text — three independent mechanisms, all
  failed the same way.** (a) IDF prior built from a different corpus: r =
  0.974 with the intrinsic reading, adds nothing. (b) REC-gated learning
  prior over 85 chapters: matched a greedy prior within 1% on transfer to
  unseen authors. (c) compression-dictionary reader: a WORD-SCRAMBLED prior
  agreed with reader A at r = 0.887 — *more* than a genuine second sample of
  the same author (0.779). Every one collapses toward the text, by way of
  vocabulary. A prior computed from what texts contain can only be a
  statement about what texts contain. The complementary result: provenance
  IS reader-independent (top-3 neighbour agreement 0.49–0.54 vs a 0.082
  chance floor, flat across Melville/Doyle/word-salad seeds). So identity is
  computable from text and salience is not — salience needs the reaction
  channel (`packages/engine/reaction/`), which is why it exists.
- The content classifier as a GATE. `cube/index.js` is order-invariant by
  construction: shuffling words inside each of 2,527 Moby-Dick paragraphs
  left 95.7% of cell assignments unchanged, and random words landed on the
  modal cell at 34.7% vs real prose 33.5%. The fabrication veto that used it
  passed three plain fabrications. Classifiers are `advisoryClassify*` now
  and may inform display/ordering only — enforced by
  `conformance/invariants/no-classifier-in-gates.test.js`. A coordinate that
  gates, vetoes, routes, or addresses is derived from a DECLARATION.
- Treating terrain and stance as free parameters. Naming an operator fixes
  mode and domain; terrain is a function of (domain, grain) and stance of
  (mode, grain). The coherent address space is operator×grain = **27**, not
  729 — 702 of 729 are type errors by construction. Measured effective-cell
  count was 22.6, just under 27, as expected.
- Unconditional nulls. An externally-sourced "chance" channel correlated with
  "surprise" at r = 1.000 *exactly* in all four test books: a global null
  yields one mean and one sd, so z-scoring is an affine map and affine maps
  preserve everything. Same shape as mean-induction's p≈0 trend,
  kind-induction's missing effect-size floor, calculus-induction's
  max-over-members cherry-pick. **An unconditional null is a units change;
  only a conditional null earns a dimension** — it must vary along the axis
  the gaming would exploit.
- Corpus prior in the 4.2 phasepost basis — support disjoint from this
  engine's cube; use `eoPriors/priors/corpus-prior-cube.json` (rebuild:
  `eoPriors/scripts/build-corpus-prior-cube.mjs`). Cell-level prior surprise
  carries no within-book significance signal either (43 distinct values).
- Significance selectors: presence-only (4/21), cold-start masking (4/21 —
  exposition IS canonical), sentence-stream KL (3/21 — per-sentence bags too
  small). Log lives beside the selector in `entity-fold.js`.
- Trailing-window document-level KL as significance — anti-correlated
  (deathbed = 9th percentile).

## Consistently reinvented — CHECK HERE BEFORE WRITING IT AGAIN

These have each been rebuilt (worse) multiple times because the canonical
implementation wasn't checked first. If you are about to write any of these,
you are regressing:

- **COREF RESOLUTION — the major one.** Do not resolve "is this entity here?"
  with `text.includes(name)`, name-token overlap, alias string lists, or any
  distributional trick. The canonical path is
  `perceiver/text/presence.js::admitReferent` → scoped surfaces → events →
  `referents/projectReferents`. Per-text alias/narrator knowledge comes from
  `eoPriors/priors/coref/*.json`. The referents organ existed unwired for a
  long time while three string-matching substitutes were built in parallel
  (`entity-fold` includes(), `graph.js` name merging, flat alias options).
  Read `docs/nameless-referent.md`; the tests enforce it.
- **Diacritic normalization** ("Natásha"≈"Natasha"): already duplicated in two
  modules. Use the single-pass version in `presence.js` (`diaNorm`); do not
  write a third map.
- **Sentence segmentation with offsets**: `summary/text-organ.js` has
  `snapToSentences`; probes have hand-rolled splitters twice. Extend the
  organ, don't fork it.
- **Text framing** (2000-char windows, 1000 hop, offsets): `frameText` in
  `text-organ.js`. Every probe that re-implemented it drifted from the
  engine's offsets.
- **Anchor-quote resolution** (durable pointers into a text): store quote
  strings, resolve at apply time with whitespace-flexible matching —
  `presence.js::resolveSpans`. Raw offsets rot; exact-string anchors break on
  line wraps. Both failures happened repeatedly.
- **Provenance/offset threading**: spans carry `{offset, length}` into the
  source, verified by round-trip via `text-organ.js::locateRawSpan` (whitespace-
  tolerant collapsed-position mapping; wired through `multi-altitude-fold.js`
  and `kernel.js`'s `resolveRawSpan` option). `span.raw` is the literal source
  substring; `span.verified`/`span.drift` report whether resolution succeeded
  and how far the approximate offset was from the true one — measured at
  ~96% of spans nonzero-drift (up to 362 chars) on real W&P data, since
  `frameText`'s window-trim and `snapToSentences`'s whitespace collapse both
  decouple offset from text at birth. No match found ⇒ `verified: false,
  raw: null`, a typed gap, never a guessed slice. Offsets were silently
  dropped at three layers once; any new span-shaped output must carry them
  from birth.
- **Capitalized-surface false positives** ("Well", "Why", chapter headers as
  names): the cap/lower-ratio physics filter + newline/token-count rejection
  live in `entity-fold.js` and `presence.js`. Do not re-derive.
- **Memory/association**: anything shaped like "recall related prior content"
  is `emergence/store` (`buildStore`/`surface`). Do not add another ad-hoc
  co-occurrence counter (`connectionMap` is the legacy one — per-call,
  evaporates; the store is the real organ).
- **Front-loading bias**: any "top N" over a document accumulates opening-
  chapter bias (cold-start novelty + in-order truncation). It has been fixed
  twice (`extractEvents` strongest-by-z, stratified span top-up). New
  selectors must select across the WHOLE extent, never `slice(0, N)` in
  document order.

## What the altitude oracle reveals

The altitude test (`scripts/test-altitudes.mjs`) surfaces three measured gaps:

1. **Altitude collapse**. The multi-pass candidate pool (events + spine + field
   reader) produces ~55 distinct moments per entity in W&P. The significance
   spine covers the remaining gap, but its lexical-surprise peaks aren't
   narrative turning points — they're unusual word clusters. The candidate pool
   is deep but wide in the wrong dimension. A non-lexical observable (SVO
   relation stream, dialogue attribution, affect) would push meaningful
   candidates from the spine tier into the event tier.

2. **80-96% entity-faithfulness**. The ~5-20% of spans where entity presence
   wasn't recorded are edge cases: the entity is present in a nearby frame but
   the span's offset falls at a boundary gap between frames. The frame organ's
   windowed overlap doesn't guarantee continuous coverage. Fixing this would
   require frame overlap to guarantee every character offset belongs to at
   least one frame where any entity is present.

3. **The creature gaps correctly**. The Frankenstein emanon with no per-text
   coref prior produces exactly one typed gap (`descriptor_aliases_unresolved`)
   and zero silently-wrong spans. The tier boundary is holding.

Vision: the oracle is the discipline. Not tuning against a hand-picked 21.
Not fitting a scorer to one entity's arc. Every engine change either passes
the oracle or provably improves it by adding an observable the oracle can
measure.
