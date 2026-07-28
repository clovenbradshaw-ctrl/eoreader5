# EO Mereotopology: Lens-Relative Part-Whole and Connection Structure

Status: draft — proposes new engine module + refactors, no code changed yet
Extends: `docs/individuation-gate.md` (spec section 13), `docs/operator-epoch.md`
(the Structure row: SEG/CON/SYN)
Touches: `packages/engine/emergence/boundaries/index.js`,
`packages/engine/referents/individuation.js`,
`packages/engine/referents/dispersion.js`,
`packages/engine/emergence/entity-kinds/index.js`,
`packages/engine/emergence/lens-assertion/index.js`,
`packages/engine/emergence/reader-priors/index.js`
New: `packages/engine/emergence/mereotopology/index.js`,
`packages/spec/schemas/mereotopological-relation.schema.json`

## 0. Why this exists

SEG, CON, and SYN — the Structure row (Differentiate / Relate / Generate) —
already do mereotopology's three jobs informally, in three different places,
with three different vocabularies:

- `emergence/boundaries/index.js` scores a referent's boundary against
  re-segmentation using `jaccardDistance` over sets of observation ids —
  a region-overlap measure, unnamed as such.
- `referents/individuation.js` + `referents/dispersion.js` type a referent
  by mass × coupling, where coupling is graded incident-edge weight — a
  connection relation, unnamed as such.
- `emergence/entity-kinds/index.js` clusters entities into Kinds by
  greedy agglomeration on `profileJaccard` similarity — a composition/fusion
  operation, unnamed as such.

Three independent implementations of set-overlap and graph-connection
currently do this work, gated only by `deriveNull` on whichever scalar each
site happens to compute. Naming the shared structure once — as
mereotopology: parthood, connection, boundary, fusion — replaces three
bespoke heuristics with one audited vocabulary that has actual axioms, and
gives SEG/CON/SYN the same "no hand-set constants" discipline
`individuation.js` already holds itself to (spec 12.8, 13.2).

That is the whole ambition. It is explicitly **not** a new categorizer
(spec-adjacent position, 2026-07-27: the cube's value is a design vocabulary
for building, not a classifier over content — mereotopology inherits that
same limit) and it is **not** a single master hierarchy. Section 1 is why.

## 1. The assumption we reject: one global parthood order

Classical mereotopology (Whitehead, Leśniewski, RCC) assumes parthood is a
strict partial order — transitive, antisymmetric, well-founded. That forces
everything typed by it into one tree: a part has exactly one place in
exactly one hierarchy, all the way up. That's Koestler's holon-nesting
picture, and it is wrong for this codebase on its own terms, not just in
the abstract:

- `emergence/lens-assertion/index.js` states its governing premise in the
  file header: *"different readers assert different lenses — all can be
  valid."*
- `emergence/reader-priors/index.js` states the same thing independently:
  *"Priors are RELATIVISTIC: different readers have different priors, and
  all can be valid. The prior doesn't determine WHAT the lens is — it
  determines what ASSERTIONS are AVAILABLE to the reader."*
- The multi-scale-surprise design (document / genre / everything-ever-read)
  already treats disagreement between scales as the signal, not an error to
  resolve — the smuggled passage is exactly the case where the three
  readings disagree.
- The cube is a coordinate system (operator × terrain × stance), not a
  containment tree; nothing about it privileges one nesting order.

**Rule: every mereotopological relation this spec defines is indexed by a
lens.** There is no bare `partOf(x, y)` — only `partOf(x, y, lens)`. A
referent can be a proper part of one whole under an infrastructural-role
lens and simultaneously the more-inclusive term under a narrative-focus
lens; both hold, unranked, the same way a Marxist and a feminist reading
of Pierre both hold in `lens-assertion.js`. Cross-lens agreement is a
finding to surface (a strong, lens-invariant part-whole claim), not a
prerequisite. Cross-lens *disagreement* is a finding too — it is treated
exactly like disagreement across the three surprise scales: computed once,
surfaced, never silently collapsed to a single answer.

This is the formal move that keeps Indra's-net-shaped structure available:
under one lens A can be part of B; under another, B's trace can be part of
A's neighborhood (e.g. an apparatus term like the publication name is
"contained in" the article by one reading and "contains" it by an
attention/salience reading, per the apparatus/frame-demotion work). Refusing
global antisymmetry is what makes that non-contradictory instead of a bug.
Open question in §8: whether this needs a real non-well-founded
(coalgebraic/bisimulation) treatment eventually, or whether "index every
relation by lens and never merge across lenses" is sufficient. This spec
takes the second position and flags the first as unresolved.

## 2. Core relations (per lens)

A **region** is a set of observation ids (or byte-spans collapsed to a
comparable coordinate) — exactly what `jaccardDistance` already consumes
in `boundaries/index.js`. Given two regions X, Y under a lens L:

| Relation | Reading | Existing near-equivalent |
|---|---|---|
| `DC(X,Y,L)` | disconnected | `jaccardDistance = 1`, no adjacency |
| `EC(X,Y,L)` | externally connected (touch, no overlap) | boundary-adjacent, `overlap = 0` |
| `PO(X,Y,L)` | partial overlap | `0 < overlap < min(\|X\|,\|Y\|)` |
| `TPP(X,Y,L)` | tangential proper part | `X ⊂ Y`, shares boundary |
| `NTPP(X,Y,L)` | non-tangential proper part | `X ⊂ Y`, interior only |

These five (the RCC-8 set collapses to five once you don't need the
inverse/equal cases spelled out separately) are **derived, not asserted** —
computed from set overlap plus an adjacency test, the same inputs
`jaccardDistance` already has. Connection `C(X,Y,L)` is the graded case:
not a boolean but `coupling ρ`, already computed as incident edge weight in
`projectGraph`. RCC's boolean connection is the ρ > 0 special case; nothing
here asks the engine to compute something it doesn't already compute, only
to name what it's already computing and make the lens explicit in the
signature.

**Fusion** (SYN) is the composition test currently missing. Mereology's
supplementation principle gives it teeth: *X is a genuine mereological sum
of {a, b, c, ...} only if removing any member changes what the whole
predicts* — not just "these cluster by similarity." Concretely, extend
`induceEntityKinds`'s cluster-then-threshold step with a held-out
leave-one-out check: does removing member `m` from the cluster change the
cluster's competency on held-out prediction more than a random member
removed from a same-sized random cluster would (a `deriveNull` call,
consistent with every other gate in this codebase)? A cluster of entities
that merely look similar but contribute nothing individually to what the
Kind predicts fails supplementation and stays a similarity cluster, not a
promoted Kind — this is the same distinction `boundaries/index.js` already
draws between "clusters" and "figures" (*"mass concentration alone is a
clustering heuristic that will happily individuate boilerplate"*), applied
one level up.

## 3. New module

`packages/engine/emergence/mereotopology/index.js` — pure functions, no
ambient state (engine-purity rule, `docs/invariants.md`):

```
regionOverlap(regionA, regionB) -> { overlapCount, jaccard }
  // generalizes boundaries/index.js's inline set math into one shared
  // primitive; boundaries/index.js's jaccardDistance becomes
  // 1 - regionOverlap(...).jaccard, kept as a thin re-export for
  // call-site stability.

classifyRegionRelation({ regionA, regionB, adjacency }) -> one of
  DC | EC | PO | TPP | NTPP
  // adjacency is caller-supplied (source-order / segmentation concern,
  // same division of labor boundaries/index.js already uses for its
  // re-segmentation perturbations).

fusionSupplementationGate({ members, heldOutScores, nullHeldOutScores,
  quantile, protocol }) -> { passed, null_result, per_member_contribution }
  // deriveNull-gated leave-one-out test, described in §2.

lensRelativeParthood(x, y, lens) -> boolean
  // TPP or NTPP under classifyRegionRelation, always called with an
  // explicit lens id — no default lens, no global variant.
```

Schema: `mereotopological-relation.schema.json` — `{ regionA, regionB,
lens, relation, null_result }`, mirroring the shape of
`individuation-result.schema.json` and `null-protocol.schema.json` already
in `packages/spec/schemas/`.

## 4. Integration, file by file

- **`boundaries/index.js`** — refactor only, no behavior change:
  `jaccardDistance` delegates to the new `regionOverlap`. Existing tests
  (`boundaries/index.test.js`) must stay green unmodified — this proves the
  extraction is a pure refactor before anything new is added.
- **`referents/individuation.js`** — no change to `classifyIndividuationType`'s
  signature or gates. Additive only: the mass/coupling read-off may
  optionally report which `classifyRegionRelation` category the referent's
  sighting-region falls into relative to the document field-region, as an
  audit-surface annotation (spec 29.5: numeric/structural detail belongs on
  the audit surface, not the reader-facing UI). This directly formalizes
  the apparatus/frame-demotion problem: NPR-as-largest-node is an `EC` or
  low-overlap `PO` relation to the article's content-region, not a `NTPP` —
  the existing `attributiveShare`/`couplingDispersion` demotion evidence
  becomes a special case of region-relation classification instead of a
  parallel bespoke signal.
- **`emergence/entity-kinds/index.js`** — add `fusionSupplementationGate`
  as an opt-in second gate after the existing `profileJaccard` clustering,
  behind a flag (default off) until the null-model cost is measured on a
  real corpus. Clustering stays the candidate generator; supplementation
  becomes the promotion gate, matching the `boundaries/index.js` precedent
  of "clustering heuristic" vs. "individuation gate" as two separate steps.
- **`emergence/lens-assertion/index.js`, `emergence/reader-priors/index.js`**
  — no code change. These already carry the lens-relativity premise this
  spec formalizes; §1 cites them as the existing precedent, not something
  they need to newly conform to.
- **`docs/architecture.md` §3** — add a subsection stating the parthood
  relation is always lens-indexed, cross-referencing this doc, so future
  work doesn't reintroduce a bare global `partOf`.

## 5. What this explicitly does not do

- Does not replace `deriveNull`/Born-null gating anywhere. Mereotopology
  supplies the relation vocabulary (is this a part, is this connected, is
  this a boundary); the null test still decides whether a candidate
  instance of that relation clears the salience bar. Same division of
  labor as today, just with the relation named.
- Does not produce a single merged part-whole tree across lenses. Two
  lenses' `lensRelativeParthood` calls are never combined into one
  structure; if a caller wants agreement, that's a new, explicit
  cross-lens comparison (candidate future work, not in this spec), not a
  default.
- Does not touch `quantum/index.js` or the Born-interval/entropy-cone
  physics layer. Mereotopology is a Structure-row (SEG/CON/SYN) concern;
  the Existence and Interpretation rows are untouched.

## 6. Build order

1. `regionOverlap` extraction from `boundaries/index.js`, tests green
   unmodified.
2. `classifyRegionRelation` + schema, new test file, no call sites wired
   yet.
3. Wire `individuation.js`'s optional audit-surface annotation (additive,
   default off).
4. `fusionSupplementationGate`, new test file with the battery in §7.
5. Wire into `entity-kinds/index.js` behind a flag.
6. `docs/architecture.md` §3 addition.

## 7. Acceptance tests

- Region-relation battery: two disjoint regions → `DC`; two regions
  sharing only a boundary observation → `EC`; partial overlap → `PO`;
  strict subset sharing the parent's boundary → `TPP`; strict interior
  subset → `NTPP`. Five fixtures, exact-match assertions.
- `regionOverlap` vs. old inline Jaccard math in `boundaries/index.js`:
  byte-identical results on the existing test fixtures (proves the
  refactor is behavior-preserving).
- Supplementation gate, three-case battery mirroring the existing
  kind-induction battery (`eo-framework.md`'s 2026-07-23 note): a true
  case where every member contributes, a similarity-only cluster where
  members are interchangeable (should fail), and a single free-rider
  member added to an otherwise-real cluster (should reduce but not
  necessarily fail — a proportionality check, not just pass/fail).
- Cross-lens disagreement fixture: same entity set under two lenses that
  legitimately produce different `lensRelativeParthood` results; assert
  both are returned and neither is silently dropped or merged.

## 8. Open questions

- Whether lens-indexing is sufficient to capture Indra's-net-style mutual
  containment, or whether a real non-well-founded (coalgebraic/bisimulation)
  parthood relation is eventually needed for cases where the *same* lens
  wants A part-of B and B part-of A simultaneously (not just different
  lenses disagreeing). No known concrete case forces this yet — flagged,
  not built.
- Whether `fusionSupplementationGate`'s leave-one-out null cost is
  tractable at corpus scale (it's O(n) `deriveNull` calls per candidate
  Kind) or needs a cheaper approximate gate before step 5 of the build
  order ships enabled by default.
