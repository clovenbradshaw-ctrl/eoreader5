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
| reaction channel | `packages/engine/reaction/index.js` | `ReactionEvent@1` in its OWN append-only content-addressed log — never the semantic ledger (a reaction is an observation of a READER, not an inference; it carries no operator, no prior_id, no epoch). `ts`/`seq` are host-supplied; the engine has no clock. `salienceRanking` is a zero-weight TALLY, not a model — inferring from this channel is deliberately out of scope until it has data. Firewall: `conformance/invariants/reaction-channel-firewall.test.js`. |
| relationship graph | `packages/engine/emergence/summary/relationship-graph.js` | cross-entity edges over a WHOLE text, not one entity's fold: `admitCast`/`presenceBySentence` reuse `admitReferent`/`presenceByFrame` per referent (never graph.js's union-find name-merging — a multi-word seed like "Prince Vasíli" must strip single-word nameSurfaces first, or it absorbs every OTHER prince's bare "Prince" vocative via containment; measured, see the comment in `admitCast`). `annotateSignificance` is a per-pair CONDITIONAL null (`N·pA·pB` from each referent's own presence rate, not one global mean/sd — see dead-ends). `classifyEdges` types each edge from an injected `{category:[keyword,...]}` lexicon gated by CLAUSE adjacency (`splitClauses`/`clauseIndexOf`): a keyword counts only if A and B sit in DIFFERENT clauses with the keyword's clause inside that (tight) span — modeling how a reader actually binds an appositive ("Andrew's father, the old colonel, greeted Pierre") across a clause chain, not a character-distance threshold, and never counting a keyword when A and B already share one clause (their own clause's verb IS the relation, a neighboring aside isn't). Plus subject/object-resolved SVO `statedRelations`, stronger evidence than any keyword. `computeNodeKindProfiles` is an emergent `advisoryKind`-argmax amplitude vector per node — never a gate, same discipline as the cube. Cast + lexicon are DATA (`priors/coref/*.json`, `priors/lexicon/*.json` — temporary repo-root location, moves to `eoPriors/` later); the module itself has no text or language baked in. `text-organ.js::splitSentences` gained a full-document sentence splitter where a paragraph break is a harder boundary than any terminator (a chapter heading has no period and must not glue onto the next paragraph). Driven by `scripts/build-relationship-graph.mjs <textPath> <corefPriorPath> [lexiconPath] [outPath]`. |

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
- `scripts/bench-retrieval-vs-colbert.mjs` + `scripts/bench/` — benchmarks
  the associative-memory store (`buildStore`/`surface`) against a
  ColBERT-style late-interaction retriever (MaxSim over WordLlama static
  token embeddings — a substitute for the real ColBERTv2 checkpoint, whose
  only host, huggingface.co, this sandbox's network policy blocks; see
  `scripts/bench/README.md`) and a pooled-cosine dense baseline. On the 4
  frozen memory-golden events, all three systems correctly hit both
  engine-tier events and correctly GAP both model-tier ones (no leaks) — the
  tier boundary held even against a semantic retriever. On 60 auto-derived
  long-range verbatim-motif pairs per book (mined from `store.posting`,
  mechanical, not hand-picked): engine ≥ colbert-maxsim ≥ dense-cosine on
  both books (pg84 R@10 13/10/4 of 60; pg2600 R@10 4/3/2 of 60) — late
  interaction beats pooled dense as ColBERT's own claim predicts, and the
  Hebbian sparse code holds a small edge over it at the range these motifs
  actually recur. All three are weak at long range; see
  `scripts/bench/RESULTS.md` for the full table.

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
