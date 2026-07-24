# Content-extraction positioning: where eoreader5 actually sits

Status: research memo (not normative)
Evidence snapshot: 2026-07-24
Reviewed against: `docs/architecture.md`, `docs/emergence-engine-update.md`,
`docs/individuation-gate.md`, `docs/corpus-role.md`, `docs/priors-boundary.md`,
`packages/engine/*`, `eoreaderapp/src/priors/*`.

This memo responds to a survey of the HTML content-extraction literature
(Readability → Trafilatura → Resiliparse; VIPS; MDR → DEPTA → tag-path
clustering; site-template detection) and the WCXB benchmark (Foley, 2026). It
takes the survey's framing as correct and then does the one thing the survey
could not: it checks each "you already have this" claim against the code, and
puts each build recommendation on the correct side of the
engine / app / eoPriors membrane. That membrane is load-bearing here — most of
the recommendations are admissible, but not one of them lives entirely inside
`packages/engine`.

## 1. The framing is right, with one correction that changes the plan

The survey's diagnosis holds:

- Single-best-node extraction (the Readability lineage) is structurally
  incapable of index/collection/listing pages. That is a real architectural
  gap, not a tuning gap, and WCXB measures the ceiling honestly (~0.93 on
  articles, 0.67–0.71 on collections/listings/products).
- A bigger model on the same article-biased distribution inherits the same
  bias (MinerU-HTML, ReaderLM-v2). This vindicates a model-optional path.
- The frontier is converging on confidence-gated, type-conditional routing —
  a shape eoreader5's philosophy already commits to.

The correction: the survey speaks the **app's** vocabulary and attributes it to
the **engine**. In `packages/engine`, `terrain` is a *cube face*
(`{op, terrain, stance}`, terrains Field/Link/Lens/Paradigm — `ledger/cube.js`,
`spec/row-shapes`), not a page-type. `surprise`, `typed discard`, `motif`,
`repeat`, and `genre` have essentially **zero implemented presence** in either
repo. `prior` in `eoreaderapp/src/priors/*` is `PriorSnapshot` artifact
governance (verify/resolve/cache), not genre-scoped extraction priors.

So the four differentiators are better described as **architectural
commitments the docs already make and three mechanisms partially enforce** —
not as content-extraction machinery that exists. Naming that gap is what makes
the recommendations actionable instead of self-congratulatory.

## 2. Claim-by-claim, against the code

### "Source priors are the type-aware architecture the benchmark says is missing"

Partly, and the split matters. By the membrane
(`docs/emergence-engine-update.md`, `docs/priors-boundary.md`):

- **Constitutional priors live in the engine**: exact anchors, adjacency and
  containment, recurrence, simplicity, predictive gain, stability, provenance,
  abstention. These are genre-*independent* shape detectors.
- **Empirical / genre-scoped priors live in eoPriors** as immutable
  `PriorSnapshot` packs. The engine *consumes* them; it MUST NOT build, select,
  or fetch them (`priors-boundary.md`, "Prohibited coupling").

The closest built analog to "type-aware shape matching" is the **individuation
gate** (`docs/individuation-gate.md`): referents are typed
`field / emanon / protogon / holon` by null-gated mass × coupling, and "high"/
"low" are *never* hand-set — each is typed by `deriveNull` against a caller-
supplied perturbation. That is genuinely the "matched by distance, unmatched
falls through to a generic prior rather than a bad fit" behavior the survey
wants — but it types **referents**, not **page regions**, and the fall-through
is `discovery.abstained`, not a nearest-genre guess. The survey's "pocket
registry of genre-scoped priors" is admissible *as an eoPriors pack family*,
consumed by the engine and pinned per-session by the app. It is not, and by the
membrane cannot be, an engine-internal registry.

### "Multi-scale disagreement gives you the confidence predictor for free"

Not built. `surprise` has one comment-level reference in the engine and no
multi-scale vector anywhere. What *is* built is the substrate it would derive
from: per-observable null distributions (`emergence/nulls`) and a
`HypothesisSet@1` with explicit competing/held/abstained states. A three-scale
surprise vector (document / genre / everything-read) is a **new engine-side
derivation over the existing null substrate** — cheaper than rs-trafilatura's
trained XGBoost regressor and inspectable rather than a regression score, as the
survey says, but it is a thing to build, not a thing to cite. This is the
highest-leverage *new* engine primitive the survey implies.

### "Typed discard inverts the task"

Real as a *philosophy*, enforced by three existing mechanisms, but split across
the membrane for the concrete case:

- Append-only Given (`architecture.md` §3.3): experience is never erased; a
  correction appends. Nothing is thrown away at the substrate.
- The `field` individuation type: ambient/boilerplate material is *typed as
  ambient*, not deleted.
- The corpus-role firewall (`docs/corpus-role.md`): reference material is folded
  by the same engine into the same ledger, marked `role:'corpus'`, and skipped
  at projection — the retained-but-non-contaminating pattern, already tested.

But the concrete "the cookie banner and eleven related-article cards are
retained, typed, and re-foldable" requires **segmentation of a decoded page**,
and the engine decodes nothing (`architecture.md`, MUST NOT list). Producing
those regions is an **app** responsibility (sense organs / source custody);
the engine receives them as `ObservationBlock`s and types them. "Typed discard"
is therefore a two-repo pipeline, not an engine feature — but it is the one
differentiator with real teeth for the reporting use case, because the app side
keeps the removed-since-last-capture sidebar as evidence rather than F1 loss.

### "Omnimodality is the strategic bet"

This one holds cleanly and is the strongest genuine differentiator. The engine
operates on normalized `ObservationEnvelope` axes with decoder identity stripped
of semantic labels (`emergence-engine-update.md`). The recurrence/adjacency/
containment machinery is modality-neutral by construction, so it transfers to a
PDF, a CSV, or a WAV where the entire HTML-only literature does not. Nothing to
build to claim this; it is a property of the existing contract.

## 3. Where each recommendation goes

| Survey recommendation | Correct home | Status |
| --- | --- | --- |
| DEPTA alignment **on the fold**, not tag subtrees | `packages/engine` per-source emergence (recurrence + alignment over `ObservationBlock` unit sequences) | **Buildable now; best first move.** `recurrence` is already a named constitutional prior; emergence is currently "intentionally conservative / abstains." This upgrades abstention to a real repeated-unit operator. Strictly stronger than MDR because the units already dropped the DOM, so non-contiguous records are not an adjacency problem. |
| Adopt WCXB as eval | eoPriors corpus + `packages/conformance`, admitted `role:'corpus'` | **Admissible and pre-defended.** The corpus-role firewall is exactly what stops the eval corpus contaminating real readings. `without[]` annotations map to "should have typed `field` / abstained," testable against the ledger, not only against F1. CC-BY-4.0 makes vendoring fixtures clean. |
| Do NOT ship a single page-type classifier; route per-region | `packages/engine` (already produces per-referent types) + app routing | **Aligned.** Individuation is per-referent, not per-page. Endorse; make the app router consume the typed region set rather than a scalar page-type. |
| Beachhead: listings / collections / products | Product priority; targeted by the recurrence operator above | **Endorse.** These are recurrence-heavy — the exact signal the new emergence operator produces — and they are where the civic documents live (dockets, permit listings, meeting indexes, procurement tables). Articles are at 0.93; do not compete there. |

## 4. The survey's own risk, in engine terms

The survey's honest risk — salience-gated ingestion + dreaming narrowing the
distribution until a novel page type reads as noise — has a precise engine-side
statement: the null distributions that gate individuation
(`emergence/nulls`) are only as honest as the perturbation field they are drawn
from. If that field is itself salience-filtered, "high mass" stops meaning
"stands out against everything" and starts meaning "stands out against what we
already like." The defense is split:

- **Engine**: nulls are caller-supplied perturbations of the actual data, and
  "high/low is never hand-set" is already the rule — keep it, and reject
  callers that supply a pre-filtered null field.
- **App**: ungated ballast in the ingestion/dream cycle is not optional; it is
  what keeps the caller-supplied null field wide enough for the engine's rule to
  mean anything.

That is the same failure WCXB caught in the neural systems (article bias by
distribution), arriving from the ingestion side rather than the training side.

## 5. Recommended sequence

1. **Engine**: a recurrence + partial-alignment emergence operator over
   `ObservationBlock` unit sequences, promoting `discovery.abstained` to a
   typed repeated-unit reading. This is the DEPTA-on-fold move and the single
   change that makes collections/listings tractable.
2. **Engine**: a multi-scale surprise derivation over the existing null
   substrate, exposed on `HypothesisSet` as an inspectable confidence signal —
   the confidence-gate the frontier trains a model to fake.
3. **eoPriors + conformance**: admit WCXB `role:'corpus'`; wire `without[]` to
   ledger assertions (typed `field` / abstained), not F1.
4. **App**: per-region routing over the engine's typed region set, and ungated
   ballast in ingestion per §4.

None of steps 1–2 loosen a MUST in `architecture.md`; they operate on
already-normalized units and caller-supplied nulls, touch no DOM, decode
nothing, and default to abstention.
