# eoreader5 Parity Checklist — completed pass

Status: **filled in, 2026-07-23.** This is the gate described in the migration
brief: every 4.2 investment gets a deliberate disposition — **Ported /
Re-housed / Rebuilt / Deprecated / Not yet started** — with evidence, so
nothing is dropped by silence.

## How to read the verdicts

- **Ported** — code moved into the new stack, same mechanism, cited path.
- **Re-housed under [X]** — the responsibility moved to a different repo per the
  new boundary, and something is actually there.
- **Rebuilt** — reimplemented under new vocabulary in the new stack.
- **Not yet started** — 4.2 has it, the new stack does not; the "intended home"
  names where it must land per the repo-responsibility split.
- **Deprecated (reason)** — a decision was made not to carry it forward.

## Executive verdict (answers the two operational questions)

**Does eoreader5 actually work?** Yes, as a *pure engine skeleton*. All 35
package tests pass (`spec` 10, `engine` 18, `conformance` 3, `compat-4.2` 2),
and `createEOReaderEngine` runs full public-domain books end-to-end,
deterministically, with byte-anchored search — see
`docs/evidence/book-run-2026-07-23.md` (Frankenstein: 797 paragraph units;
Heart of Darkness: 206; identical event tape on replay; queries localize to
real paragraphs by byte offset). Reproduce with:

```sh
node scripts/read-book-demo.mjs <path-to-text.txt> "query" ["query" ...]
```

**Can we retire eoreader4.2?** **Not yet.** The engine runs, but it does not yet
reproduce 4.2's actual reading. The book run emits a fixed, conservative
65-event discovery tape with **no** referents/cast, waveform, folds, terrains,
or presence roles, and search is coarse (per-source-field, not per-paragraph).
Of the 34 checklist items below, the large majority are **Not yet started**.
4.2 remains the parity target and golden-fixture source until the items marked
"must not regress" and the non-negotiable firewall (§4.2) are actually ported
and conformance-pinned.

---

## 1. Core pipeline (must not regress)

- [ ] **19-stage turn pipeline (route→…→prompt→llm→bind→…→settle)** — **Not yet started; replacement belongs in eoreaderapp.** The real stage list is `eoreader4.2:src/turn/stages.js` (route, expect, converse, retrieve, inquire, fold, foldReading, predict, answerable, gate, reason, prompt, llm, bind, factcheck, revise, veto, absence, validate, settle) assembled by `eoreader4.2:src/turn/pipeline.js`. `eoreader5:packages/engine/runner.js` is a different, smaller replay machine (`observation.admit → discovery.advance → snapshot → projection → query → complete`) with no route/prompt/llm/bind/revise stages — correct, since the engine may not touch models. The orchestration replacing prompt/llm/bind/revise (an eoreaderapp concern) is unbuilt: `eoreaderapp:src/engine/adapter.js`/`protocol.js` is only a thin event relay.

- [ ] **`src/turn/meta-route.js` — Born-measured free-speech routing** — **Not yet started.** `eoreader4.2:src/turn/meta-route.js` measures free-text against exemplar bases via `bornSalience`, gates each direction with `deriveNull`, and settles with `relax` — a real physics router, not regex. Search for `deriveNull`/`bornSalience`/`meta-route` across `eoreader5` and `eoreaderapp` returns zero hits. No router (ported or ad hoc) exists in either new repo yet.

- [ ] **`src/weave/chorus/born.js`, `core/voidnull.js` (deriveNull), `src/weave/longgen/relax.js`** — **Not yet started (clean gap, not a silent reinvention).** All three confirmed present and load-bearing in `eoreader4.2` (`src/weave/chorus/born.js`, `src/core/voidnull.js` with `deriveNull`, `src/weave/longgen/relax.js`); `meta-route.js` imports all three. Search for `deriveNull`/`bornSalience`/`relax` in `eoreader5` and `eoreaderapp` returns zero matches — neither imported nor reimplemented. Every downstream threshold that rests on these primitives is therefore unbuilt in the new stack. Intended home: `eoreader5/packages/engine/` (these are pure math, engine-legal).

- [ ] **DEF/EVA/REC fold kernel** — **Checklist citation is wrong; real logic re-housed, being rebuilt under new names.** There is no `core/fold.js` in 4.2 — `eoreader4.2:docs/fold-trace-spec.md` itself says the closest real analogue is `WaveformModel` (`eoreader4.2:src/weave/waveform/build.js`); `src/core/def.js` is the DEF judgment log and `src/core/holon.js` is Site addressing, neither is the kernel. On the new side, `eoreader5:packages/spec/schemas/hypothesis-set.schema.json` (accepted/competing/held/abstentions) and `enactment-decision.schema.json` (admit|qualify|hold|veto) plus `packages/engine/emergence/evaluate/` are an early, differently-named reconstruction of the propose/accept/reject split — but nothing references the waveform mechanism and no test ties them to the original. Verdict: rebuilding under new vocabulary, not yet validated against 4.2.

- [ ] **`docs/model-as-contracted-part.md` contract (model OUTPUT contract)** — **Not yet started, but the seam exists.** `eoreader4.2:docs/model-as-contracted-part.md` proposes `MODEL_CONTRACT = {ops, terrains, stances}` and notes it was never actually applied even in 4.2 (only post-hoc vetoes). `eoreader5:packages/spec/schemas/effect-request.schema.json` defines a `model-realize` effect kind with `purpose`/`constraints` — the right *shape* (typed request, not ambient authority) — but carries no `{ops,terrains,stances}` structure and no per-perceiver entries. Needs new work in `eoreader5/packages/spec/schemas` (contract shape) with per-perceiver entries owned by eoreaderapp.

---

## 2. Reading / extraction path

- [ ] **Modelless reading path (s.field, local-band strain, coref/figures, echo/novelty, terrain/register)** — **Compute-side Not yet ported; display Not yet started.** The KL surprise math (`surpriseAt`, `feltSurprise`, `forwardScore`, novelty reserve) is whole in `eoreader4.2:src/core/surprise.js`, coref/figures in `src/perceiver/parse/coref.js`, `src/perceiver/figure-fold.js`. Search for `surprise`/`s.field`/`strain` in `eoreader5` returns zero; `packages/engine/emergence/` has no matching vocabulary. Intended home: `eoreader5/packages/engine/` (a `perceive/`/`fold/` subassembly), display in `eoreaderapp/src/outputs/`.

- [ ] **Individuation gate (MASS × COUPLING + subjShare + INS bit; emanon/protogon/holon typing; `unifyDescriptor` name-bind)** — **Not yet started; and the named doc file is missing.** Real logic: `eoreader4.2:src/perceiver/individuation.js` (`typeReferents`, `classifyReferent`, mass/coupling via `couplingByNode`/`projectGraph`, five-way typing, name-bind REC), with `src/perceiver/referent.js`/`referent-nesting.js`. `eoreader5:packages/engine/referents/index.js` implements only a generic admit/same_as/merge/split projector — no mass/coupling gate, no five-way typing, no roles. `eoreaderapp:src/outputs/` has no entity/cast panel (`structure-cards/` is a hypothesis-card projector for boundaries/kinds, not referents). **Doc gap:** `docs/individuation-gate.md` does not exist in `eoreader4.2/docs` although `docs/deviation-waveform.md` and `docs/omnimodal-waveform.md` cite it as a dependency and the code+tests are real — the concept is load-bearing, the home document was apparently never committed.

- [ ] **Deviation waveform (baseline vs local strain, frame-aware baselines, turn markers, echo/motif arcs, typed-discard access)** — **Not yet started; fully built in 4.2.** `eoreader4.2:docs/deviation-waveform.md` (superseded by `docs/omnimodal-waveform.md`) is implemented in `src/weave/waveform/` (`build.js`, `cast.js`, `echo.js`, `frames.js`, `metric.js`) plus per-modality `src/perceiver/{text,audio,tabular,binary}/waveform.js`. Search for `waveform`/`deviation` in `eoreader5` and `eoreaderapp` returns zero — no baseline/strain split, no Turn/Echo events, no typed-discard ledger anywhere new. Intended home: engine core (`buildWaveform`) in `eoreader5/packages/engine/`, skins in `eoreaderapp/src/outputs/`. This is called 4.2's hallmark feature; guard against it being absorbed into a generic "highlights" surface.

- [ ] **Omnimodal perceiver-contract architecture (common substrate; invariant core; display-only skins)** — **Rebuilt in spirit at the app sense layer; the specific contract Not yet ported.** `eoreader4.2:src/perceiver/contract.js` (`validateReading`) + `docs/omnimodal-waveform.md` define `Reading{units,metric,segments,referents,sightings,vocab,resolve,meta}`. `eoreader5:packages/spec/schemas/observation-envelope.schema.json` genuinely enforces a neutral, decoder-agnostic shape (axes/fields/anchors/loss, no semantic labels) — a real parallel discipline — but it has no `Unit.field` vector, no `metric` deviation function, no `Referent`/`Sighting`/`Role` vocabulary, and no per-medium skin-vs-core signal split. The neutral-substrate *principle* is being re-established; the 4.2 `Reading` mechanism itself is not yet ported. This is the single biggest parity risk — verify per-medium renderers stay skins over one core.

- [ ] **Presence roles (FOREGROUND/PRESENT/LATENT; per-modality display words; LATENT mass/coupling asymmetry)** — **Not yet started.** Implemented only in `eoreader4.2`: `src/perceiver/contract.js` (Role enum), `src/weave/waveform/cast.js` (`ROLE_WEIGHT = {FOREGROUND:1, PRESENT:0.5, LATENT:0}`), per-modality vocab in `src/perceiver/{text,audio,tabular,binary}/waveform.js`. Search for `FOREGROUND` in `eoreader5`/`eoreaderapp` returns zero. Intended home: role→mass/coupling math in `eoreader5/packages/engine/`, display vocab in eoreaderapp.

---

## 3. Structural / visualization layer

*All rendering is eoreaderapp-owned; eoreader5 is pure-engine and structurally
cannot host a UI component. It may only emit neutral projection data.*

- [ ] **TERRAINS (9, incl. Ground column Void/Field/Atmosphere)** — **Intact in 4.2; Not yet started in the new stack.** Taxonomy confirmed unchanged in `eoreader4.2:docs/cube.md` (Site face) and `docs/terrain-typed-templates.md`, implemented in `src/rooms/terrains/` and `src/wiki/terrains.js`. Search for `terrain` in `eoreaderapp` returns zero; `eoreader5:packages/spec/schemas/semantic-event.schema.json` has only an untyped `site:{type:object}` — no terrain enum. Intended home: engine emits terrain typing (a `site` enum in spec), eoreaderapp renders the foldable tree.

- [ ] **Solar-system / GEO orbit visualization (`src/rooms/reader/solar-system.js`)** — **Exists in 4.2; Not yet started in new repos.** Confirmed at that exact path; `mountSolarSystem` renders an egocentric POV-pivoting graph (sun/planet/moon = source/entity/claim), with orbit geometry noted as decorative (index/ring-based, not mass-derived) per `eoreader4.2:docs/kernel-probe-2026-07.md`. Search for `solar`/`orbit` in `eoreaderapp` returns zero — no evolution or reimplementation. Intended home: `eoreaderapp/src/outputs/`.

- [ ] **FoldTrace / coil-surfaces family + Poincaré scrubber** — **Mixed in 4.2 (3 of 10 landed); none migrated.** Per `eoreader4.2:docs/coil-surfaces.md` §5, only FoldTrace (`src/core/fold-trace.js`, `docs/fold-trace-spec.md`), the Poincaré scrubber (`src/rooms/scrubber/poincare.js`), and `operator-clock` (`src/surfaces/operator-clock/`) are "Landed"; coil, coherence-panel, recurrence-ribbon, terrain-river, cast-score, coverage-treemap, discard-ledger are marked "Not yet built" even in 4.2 (`src/surfaces/` has only `binvis/`, `rawtext/`, `waveform/`, `operator-clock/`). Search across `eoreaderapp`/`eoreader5` for all names returns zero — nothing, including the landed pieces, has migrated. Intended home: rendering in `eoreaderapp/src/outputs/`; the underlying fold/operator event stream in `eoreader5/packages/engine/` (no `fold/` subdir today).

- [ ] **binviz (Hilbert-curve/entropy raster, Void-terrain pre-fold, byte_offset/pos link)** — **Built in 4.2 as "binvis"; Not yet started new.** `eoreader4.2:docs/binvis-surface.md` confirms it at `src/surfaces/binvis/` (`curve.js`, `classify.js`, `entropy.js`, `significance.js`, `render.strict.js`) + `src/rooms/reader/binvis-surface.js`. The `CON` link to the scrubber via `byte_offset`/`pos` was itself not yet built even in 4.2 (`docs/coil-surfaces.md` §6). Search for `binviz`/`binvis`/`hilbert` in `eoreaderapp`/`eoreader5` returns zero. Decision needed: raw-byte view for unreadable/binary content, or explicitly deprecate for the omnimodal hero screen.

- [ ] **Shared structural fold-grid (same coordinates regardless of medium)** — **Operator axis ported; terrain + stance axes and the coherence guard Not yet ported.** 4.2's `docs/cube.md` defines a Mode×Domain×Object cube whose Act (9 operators), Site (9 terrains), Resolution (9 stances) faces must agree on a shared diagonal (`DIAGONAL_CELLS`, `coherence()`/`isDiagonal()` in `core/cube.js`) — this diagonal coherence is literally what 4.2 calls the thing that makes omnimodality real. In `eoreader5`, `packages/spec/schemas/semantic-event.schema.json` carries the same 9-operator enum (`NUL,SEG,DEF,SIG,CON,EVA,INS,SYN,REC`) as a required `op`, stamped across `SemanticEvent`/`ReadingSnapshot`/`ProjectionBundle` — so the operator dimension is genuinely shared. But `site`/`frame`/`resolution` are untyped `{type:object}`; no terrain enum, no stance enum, no diagonal/coherence validator anywhere (`cube`/`DIAGONAL_CELLS` search returns zero in `eoreader5` and `eoPriors`). The thesis currently rides on one of three axes.

---

## 4. Priors / corpus system

- [ ] **Lens as first-class object (`src/perceiver/lens.js`)** — **Re-housed under eoPriors, with a documented reframing.** `eoreader4.2:src/perceiver/lens.js` defines a Lens `{gamma,horizon,corpus}`. `eoPriors:SPEC.md` §5.5 explicitly states "A basis is a Lens (`lens.js`, first-class object, already built)…a second basis…is a second Lens" — a deliberate, written carry-forward into the exemplar-basis (source-genre) role, not two clashing concepts. `eoreader5` has zero `lens` hits, so the engine does not consume it directly yet; the reframing lives in eoPriors's SPEC referencing still-4.2-resident code.

- [ ] **`role:'corpus'` firewall (never-citable corpus content, pinned by `tests/corpus-role.test.js`)** — **Not yet started — NON-NEGOTIABLE, blocks retirement.** `eoreader4.2:tests/corpus-role.test.js` pins it: `role:'corpus'` events may never mint an entity/edge/merge/void/retraction in `src/core/project.js`. Search for corpus-role in `eoreader5`/`eoPriors` returns zero; `eoreader5:packages/conformance/invariants/` has only `forbidden-dependencies.test.js`. This must be ported and conformance-pinned in `eoreader5/packages/conformance/invariants/` before any citing surface ships.

- [ ] **OPFS binary store + export-pointer manifest (`src/organs/ingest/opfs-store.js`)** — **Re-housed to eoreaderapp (storage is app-owned); not yet built there.** Confirmed present in 4.2. `eoreader5` may not touch browser storage at all. `eoreaderapp:src/state/` (`event-log.js`, `records.js`) and `src/senses/` model the intended replacement (event-sourced SourceRecord/ObservationArtifact) but no OPFS adapter or export-pointer manifest exists yet. `navigator.storage.persist()`/export requirements need explicit re-statement in the app.

- [ ] **Multi-scale surprise (document/genre/everything-read) + disagreement-between-scales** — **Not yet started; referenced only as analogy.** Unbuilt in 4.2 per its own audit. Only trace: `eoPriors:SPEC.md` §5.5 gestures at reusing lens-disagreement machinery "the same mechanism as the document/genre/global multi-scale disagreement." No implementation anywhere. Intended home: eoPriors (measurement), engine consumes the signal via PriorSnapshot. Do not let it fall off silently — it is called the actual detection mechanism for smuggled/off-genre content.

- [ ] **Readiness/competency measurement, dream cycle, forgetting** — **Not yet started (unbuilt in 4.2 too).** "Dream"/"forgetting" appear in 4.2 only as unrelated homonyms (`src/weave/write/voids.js` metaphor; `src/perceiver/credence/filters.js` source-credibility decay). No trace in `eoreader5`/`eoPriors`. Intended home: eoPriors measurement/emergence layer. Explicit **deferred**, not dropped.

- [ ] **Reactive competency-corpus harvesting (search-sourced, distinct store, stricter gate, no auto-promotion)** — **Not yet started; the named spec file does not exist.** `competency-corpora-status-and-remaining-work.md` returns zero org-wide (`search_code` confirmed). Closest 4.2 analog is `docs/the-web-organ-spec.md`'s MDL-gated web-intake keep-criterion, with no confirmed successor. Genuine discrepancy: the checklist names a doc that was never written. When eoreaderapp adds live webpage ingestion, it must apply a stricter-than-install-tier trust gate.

- [ ] **Global South / indigenous / folk-wisdom pocket sourcing** — **Not yet started; no trace, even in prose.** `search_code` for `indigenous`/`Global South` across the org returns zero relevant hits; `eoPriors:README.md`/`SPEC.md` describe only exemplar-basis/ledger mechanics with no source-diversity-by-tradition language. Report plainly: aspirational intent from the brief that is not written down in any of the four repos. Needs an explicit owner in the eoPriors registry roadmap or an explicit deprecation.

---

## 5. Text-generation / composition path

- [ ] **`composeEssay`/`composeEssayGrounded`, `src/weave/longgen/walk.js`** — **Not yet started; scope decision pending.** Present in `eoreader4.2:src/weave/longgen/walk.js` + `src/weave/essay/driver.js`. Zero hits in `eoreader5`/`eoreaderapp`. No decision yet on whether long-form generation stays in scope (it would live in eoreaderapp per the split). The fold-kernel routing requirement is moot until it exists. Decide explicitly: augmentation-only (deprecate generation) vs. keep a gloss layer.

- [ ] **`generate-row-stance-templates.md` contract (four shapes, stance-legality over ρ, entailment/fabrication vetoes, exactly-1 token-trace, Cultivating fallback, SYN·Cultivating forbidden)** — **Not yet started — hard fabrication-firewall requirement.** Marked "Landed" in 4.2, implemented by `eoreader4.2:src/weave/generate-row/` + `src/enactor/ground/row-veto.js`. Search for `Cultivating`/`stanceLegal` in `eoreader5`/`eoreaderapp` returns zero. No generated-prose surface exists new yet to route through it. Forward dependency: any gloss/blurb/caption surface in eoreaderapp must go through this contract.

- [ ] **Tiny-LLM-for-captioning-only rule** — **Not yet started; no surface yet to test the boundary.** Source: `eoreader4.2:docs/tiny-model-form-surface.md` — summarizer contract `ops=DEF, terrains=Lens, stances=Making` (`src/weave/topline/surface.js`), `classifyToken` treats invented fact/thesis/polarity-flip as a violation. Search for `caption` in `eoreaderapp` returns zero — no LLM-touching reading surface exists there yet. Carry forward and re-apply the moment eoreaderapp adds any such surface.

---

## 6. Cross-cutting engineering requirements

- [ ] **Replayability** — **Ported/rebuilt across all three repos.** `eoreader5:packages/engine/replay/index.js` is a pure event-sourced reducer (`createState`/`appendEvents`/`replay`/`read`) computing a `semanticHead` hash — verified deterministic on real books (`docs/evidence/book-run-2026-07-23.md`: identical event tape and head on repeated runs). `eoPriors:src/replay.js` does DAG-topological projection replay (`SPEC.md` §2). `eoreaderapp:src/state/event-log.js`+`records.js` is the append-only app model. The "reads with animation"/toggled-layer replay UI does not exist yet (expected — app is early).

- [ ] **Provenance retained through embedding** — **Re-housed to eoreaderapp (engine may not embed); not yet implemented.** `eoreader5` must not call an embedding model (architecture.md), and none exists there. Pattern carried from `eoreader4.2:docs/retrieval-spec.md` §6 and `src/perceiver/parse/clause-layer.js` (clause keeps its `sentIdx`). `eoreaderapp:src/priors/` (`cache.js`, `resolver.js`, `verify.js`) verifies snapshot hashes but has no embed-with-provenance-pointer code yet.

- [ ] **Native CSS preserved** — **Built in 4.2's app layer; no confirmed successor yet.** `eoreader4.2:src/rooms/reader/reader-render.js` stamps `__eo_native_css`/`nativeLayerCss`; `docs/the-web-organ-spec.md` gate #4 keeps native presentation while stripping structure before judgment. `eoreaderapp` README states the same goal ("Source views preserve native reading modes") but no CSS-preservation implementation was found under `src/outputs/`/`src/senses/`. Intended home: eoreaderapp output organs. Note the interaction with the perceiver/skin split — the web skin must not require stripping source styling to compute structure.

---

## Retirement gate (what must be true to freeze-and-forget 4.2)

1. **§4.2 corpus-role firewall** ported and conformance-pinned in `eoreader5/packages/conformance/invariants/`. *(hard blocker)*
2. **§5 stance-templates + row-veto** ported before any generated prose ships. *(hard blocker — fabrication firewall)*
3. **§1 physics primitives** (born/deriveNull/relax) and **§2 surprise/individuation/waveform** ported or explicitly deprecated with a recorded reason.
4. Every remaining "Not yet started" item either lands or gets a one-line deprecation, and each transferred capability has a golden fixture or parity result per `docs/invariants.md` "migration ratchet."
5. The two missing docs — `individuation-gate.md` and `competency-corpora-status-and-remaining-work.md` — are either written or the checklist is corrected to stop citing them.

Re-run this checklist at each milestone (Page/Outline/Orbit, or whatever the app
surfaces become) — features get dropped mid-rewrite, not just at planning.
