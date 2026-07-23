# The individuation gate (Ground → Figure)

Status: implemented, P1 slice
Implements: spec section 13 of "EO Terrain Promotion and Predictive Prior
Induction," v0.2 (Ground → Figure individuation; the same gate is the
terrain-parametric entry point named in section 3.3/26 as
`promote(terrain, candidates, evidence)` for the Existence row).
Code: `packages/engine/referents/individuation.js`,
`packages/engine/emergence/nulls/index.js`,
`packages/engine/emergence/boundaries/index.js`.
Schemas: `packages/spec/schemas/individuation-result.schema.json`,
`packages/spec/schemas/null-protocol.schema.json`.

This document did not exist before this change even though
`docs/eoreader5-parity-checklist.md` had been citing it (and the equivalent
`eoreader4.2` doc was itself never committed, despite `individuation.js`
being real and load-bearing there). This is the first canonical writeup.

## 1. Why the gate exists

A `ReferentHypothesis` (`packages/engine/referents/index.js`) is ambient
material with a provisional handle — a continuity anchor, not yet an
entity assertion (`docs/architecture.md` §3.1). Promoting every referent
straight to a Figure floods the history layer with boilerplate and floods
downstream generalization with figures that have nothing to generalize.
The gate exists to decide, per referent, whether it has actually
individuated out of the ambient material.

Two governing sentences from the spec:

> A figure exists where a boundary drawn in ambient material stays put
> under re-segmentation, and the bounded region is coupled to the rest of
> the structure.

> A figure is a place where the cut keeps landing.

## 2. Typing: mass × coupling × named

Every referent is typed by two Born-null-gated observables plus one bit:

| Type | Mass | Coupling | Named (INS bit) | Meaning |
|---|---|---|---|---|
| `field` | low | low | — | ambient, not individuated |
| `emanon` | high | any | false | present and agentive, never name-admitted (a definite-description agent, e.g. "the creature") |
| `protogon` | low | high | any | orbited but absent — talked about, rarely present (e.g. Kurtz) |
| `holon` | high | any | true | fully individuated, name-bound |

Implementation note: the table's "high mass, any coupling" for `emanon`
and `holon` collapses to one rule in `classifyIndividuationType`: mass is
the primary split (high mass → `emanon`/`holon` branch, decided by the
named bit; low mass → `field`/`protogon` branch, decided by coupling).
This is a direct reading of spec 13.5 — a name-bind changes only the
named bit, not mass or coupling, and is the sole thing that turns an
`emanon` into a `holon`.

**"High" and "low" are never hand-set constants.** Per spec 12.8 and 13.2,
mass and coupling are each typed by `deriveNull`
(`packages/engine/emergence/nulls/index.js`): the caller supplies a null
distribution of what that referent's mass (or coupling) would look like
under an explicit perturbation of the actual data — e.g. a shuffled
sighting-to-referent assignment — and `classifyIndividuationType` calls
mass/coupling "high" only when the observed value clears that
distribution's derived quantile.

## 3. Boundary stability: the individuation test

Mass concentration alone is a clustering heuristic and will happily
individuate boilerplate. The gate additionally requires boundary
invariance under re-segmentation (spec 13.3):

```
for k perturbations of the segmentation (SEG):
    recompute the referent's boundary
    record displacement
boundaryStability = 1 − (mean displacement / null displacement)
promote if boundaryStability exceeds deriveNull(displacement | random boundaries)
```

`computeBoundaryStabilityGate`
(`packages/engine/emergence/boundaries/index.js`) takes two arrays the
caller has already computed — real displacement under k segmentation
perturbations (`observedDisplacements`), and displacement of random
boundaries of comparable shape (`nullDisplacements`, the "random
boundaries" null model) — and derives a pass/fail threshold from them via
`deriveNull` with `tailDirection: "less"` (a stable boundary must fall
*below* what chance produces). `jaccardDistance` is provided as the
default displacement metric (symmetric-difference fraction between two
boundary sets), but any distance the caller supplies works.

Generating the k re-segmentation perturbations and the random-boundary
null samples is deliberately left to the caller: it is a modality concern
(what "re-segmenting" means for text vs. a graph vs. a tabular source
differs), and the engine may not draw ambient randomness
(`docs/invariants.md` "Engine purity"). Use
`createSeededRng`/`seededShuffle` (`packages/engine/emergence/nulls/index.js`)
to generate perturbations deterministically from an explicit seed.

**A referent that fails boundary stability remains `field`, not admitted**
— even if its mass and coupling typed it as `emanon` or `holon`. The
boundary test can only downgrade a typed candidate, never promote one past
what mass/coupling earned. This is the exact reading of the worked example
in spec 20.2: "a recurring boilerplate phrase carries mass but fails
boundary stability — remains field, not admitted."

## 4. The gate result

`individuateReferent` combines both checks into one `IndividuationResult@1`
record (`packages/spec/schemas/individuation-result.schema.json`):

- `individuation_type` — one of `field`/`emanon`/`protogon`/`holon`, after
  any boundary-driven downgrade to `field`.
- `mass_null` / `coupling_null` — the full `NullProtocol@1` records used to
  type mass and coupling (threshold, quantile, tail direction, p-value,
  and the null samples themselves, retained for replay).
- `boundary_stability` — `null` if no boundary was evaluated, otherwise
  the full boundary gate result including its own `NullProtocol@1`.
- `gate_result.admitted` — `true` only when typing is not `field` **and**
  boundary stability was evaluated and passed. There is no default-true
  path: a referent with no boundary evidence yet is `status: "pending"`,
  never silently admitted (spec 4.4, "fail closed when an inference lacks
  provenance").

## 5. Name-bind promotion (emanon → holon)

`applyNameBind` (spec 13.5) re-derives an `emanon`'s individuation result
with the named bit flipped true, using the exact same mass, coupling, and
null samples — a name-bind changes identity status, not the underlying
observables. It refuses to run on anything other than an `emanon`. Callers
are expected to retain both the pre- and post-name-bind results for the
audit trail (spec 7.11, "recursive audit"): this module never mutates a
prior result in place, it only produces a new one.

## 6. What this gate does not do (yet)

- It does not compute mass, coupling, agency signal, or boundaries from
  raw observations — those are row-specific extraction concerns (spec
  13.6) that belong in a sense organ / observation-normalization layer,
  not in the gate itself. This module is the gate only.
- It is not yet wired into `packages/engine/runner.js` /
  `packages/engine/replay/index.js`'s event-driven pipeline. The book-run
  evidence (`docs/evidence/book-run-2026-07-23.md`) still emits a
  conservative discovery tape with no referents/cast; wiring the gate into
  that pipeline (an `observation.admit` → sighting aggregation →
  individuation event flow) is follow-up work.
- Field → Link and Atmosphere → Lens (spec 13.6, the Structure and
  Significance rows) reuse this exact gate unmodified once a row supplies
  its own mass/coupling/boundary observables — no changes to
  `individuation.js` are required for that; see spec 3.3 and 27.13
  ("terrain-parametricity tests").
- The Figure → Pattern generalization gate (Entity → Kind: transfer +
  exchangeability, spec section 16) is a separate, larger piece of work
  and is not part of this change. `packages/engine/emergence/{kinds,
  parameters,transitions,lift}/` remain stub modules
  (`export const moduleStatus = "planned"`) pending it.

## 7. Worked example (spec 20.2, in this codebase's terms)

```js
import { individuateReferent, applyNameBind } from "@eoreader/engine/referents";

// "the creature": high mass, high coupling, never named -> emanon.
const creature = individuateReferent({
  referentId: "referent:the-creature",
  mass: 9.5, coupling: 9.5, named: false,
  massNullSamples, couplingNullSamples,
  boundary: { observedDisplacements, nullDisplacements },
});
// creature.individuation_type === "emanon", creature.gate_result.admitted === true

// A recurring boilerplate phrase: high mass, but its boundary is
// indistinguishable from a random boundary -> remains field.
const boilerplate = individuateReferent({
  referentId: "referent:recurring-phrase",
  mass: 9.5, coupling: 9.5, named: false,
  massNullSamples, couplingNullSamples,
  boundary: { observedDisplacements: highDisplacement, nullDisplacements },
});
// boilerplate.individuation_type === "field", boilerplate.gate_result.admitted === false
```

See `packages/engine/referents/individuation.test.js` for the full set of
cases (`field`, `emanon`, `protogon`, `holon`, the boundary-downgrade case,
the pending-without-boundary case, and name-bind promotion), and
`packages/engine/referents/individuation.schema.test.js` for confirmation
that real gate output validates against `IndividuationResult@1`.
