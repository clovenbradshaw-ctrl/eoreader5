# EOReader5 — engine map for agents

Read `docs/nameless-referent.md` first. It is the foundational principle:
identity lives in the REFERENT, never in a string; surfaces are scoped
evidence admitted by explicit events; witness-tier knowledge is injected as
priors, never derived. Every coref regression in this project came from
forgetting it. The companion principle is omnimodal design: an organ must
make sense for a nameless leitmotif in music, or it is string-thinking.

## Organs and their status (2026-07)

| organ | file | status |
|---|---|---|
| cube classifier | `packages/engine/cube/index.js` | scored amplitudes over all 9×9×9 (was first-match-wins regex; that made Atmosphere/Lens/Paradigm unreachable). `classifyAmplitudes()` = the uncollapsed fold; `classify()` = its argmax. |
| referent presence | `packages/engine/perceiver/text/presence.js` | `admitReferent` — event-sourced via `referents/projectReferents`; name variants structural (holons); descriptor aliases + narrator spans from per-text coref priors (`eoPriors/priors/coref/*.json`, anchor-quoted scopes). Emanons/first-person handled; missing prior ⇒ typed gap. |
| associative memory | `packages/engine/emergence/store/index.js` | Hebbian edges at co-occurrence; sparse-BAND keys (idf ≥ floor AND df ≥ 2); keyword and phrase stores separate; index all, wire top-k; one CA3 completion hop. Biology notes in header are load-bearing. |
| entity fold | `packages/engine/emergence/summary/entity-fold.js` | offset-grounded spans (verified round-trip), presence-based frames, stratified whole-arc selection, `withRelations`, `referent` prior option, `echoes` (spans carry offset-anchored recalled antecedents from the store). |
| spine | `summary/spine.js` | `scoreByPos` exposes ALL sampled scores (not just peaks); `minHistory` cold-start mask exists but masking kills exposition scenes — see dead-ends. |

## Goldens and scorers (frozen — the discipline is the point)

- `summary/golden/span-golden.json` + `scripts/score-span-golden.mjs` —
  significance. Current best **5/21** (forward-surprise × presence,
  stratified). 21 scenes, 3 entities, 3 arc kinds. Never tune on one entity:
  Cult×Atmo×density hit 5.5× chance on Natasha and 0.7× (worse than chance)
  on Pierre.
- `summary/golden/memory-golden.json` + `scripts/score-memory-golden.mjs`
  (run from repo root) — associative memory. Current: engine 2/2 recalled,
  model-tier 2/2 correctly gapped.
- `summary/golden/natasha-rostova.js` — aspirational PROSE golden (Storgy
  shape). Not machine-scored; the plan is EOT-first, prosify later by porting
  `eoreader4.2/src/weave/write/brief.js` (phraser→talker: engine determines
  content, model only makes it fluent, veto strips inventions).

Tests that must stay green: `cube/index.test.js`,
`perceiver/text/presence.test.js`, `emergence/store/store.test.js` (the
presence and store tests ENFORCE the principles — if one fails, you are
probably re-deriving identity from strings).

## Tier discipline

`resolution/resolution-spectrum.js` draws the line: RESOLVED/ENGINE vs
MODEL (needsWitness). Engine-tier: structural name coref, verbatim/keyword
motif recurrence. Model-tier: descriptor synonymy (monster≈creature,
union≈wedding), thematic resonance (the two oaks). Model-tier absences are
reported as typed `gaps` — faking them is the cardinal regression.

## Measured dead ends — do NOT silently retry

- Distributional coref (frame-level lift; sentence-level complementary
  distribution) — both failed measurably; see `presence.js` header.
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
  source, verified by round-trip. Offsets were silently dropped at three
  layers once; any new span-shaped output must carry them from birth.
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

## Open problem (the next real win)

Span-golden recall is capped ~5/21 by the lexical channel. The missing piece
is a NON-LEXICAL observable: what the entity does (SVO relation stream — the
extractor exists in `perceiver/text/extraction.js`), dialogue attribution,
affect. Feed one of those into span selection and score against the golden
before any tuning. Arc-kind labels in the golden are INPUTS (Pierre falsified
single-scalar significance).

Vision (agreed): one packet, five altitudes (L0 line → L4 full dossier),
monotone (every claim at Ln appears at Ln+1), every claim offset-grounded,
`heldOpen` never asserted. Prose is the last projection, behind the 4.2 veto.
