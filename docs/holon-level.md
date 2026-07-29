# Holon level: discovered, never assigned

Status: implemented.
Code: `packages/engine/emergence/holon-level/index.js` (generic gates),
`packages/engine/emergence/holon-level/series.js` (predictive-competency
construction for numeric series),
`packages/engine/emergence/structured/index.js` (`buildHolonicTree` wiring),
`packages/engine/emergence/holon/index.js` (composeHolon wiring),
`packages/engine/emergence/surprise/index.js` (tick detection),
`packages/engine/emergence/paradigm/index.js` (Zollman-delay hysteresis,
reused pattern).
Schema: `packages/spec/schemas/holon-level-relation.schema.json`.
Real-data proof: `scripts/test-holon-level-nexrad.mjs`.

## 1. The law

Two candidates X and Y have a holon-level relation only if BOTH hold, in the
same direction:

1. **Existence-dependency** — "cannot exist without." X depends on Y iff
   removing/perturbing Y degrades X's own viability more than a comparable
   random removal would.
2. **Possibility-constraint** — "above constrains, below enables." X
   constrains Y iff perturbing X narrows Y's admissible-state distribution
   more than a comparable random perturbation would.

If both hold with X on the dependent/constraining side: **X is above Y.**
If neither holds discriminately: **X and Y are peers** — no level exists
between them. If they disagree in direction, the relation is **unstable** — a
typed gap, surfaced on the audit trail, never silently resolved into a level.

This is quoted, not invented. Both halves come from `eoreader4.2/docs/eo-wiki.md`
(legacy — this document is the ported, load-bearing source going forward):

> "A dependency ordering says: capacity B cannot exist without capacity A
> being available. If A is degraded, B degrades." — `eo-wiki.md:17584`
> (worked example at `:11987`)

> "The below provides SYN (possibility, composability, the space of what
> could happen). The above provides DEF (probability, constraint, the
> narrowing of what does happen)." — `eo-wiki.md:17031`

And the same wiki warns not every nesting is a Koestlerian ladder:

> "An emergent organization's nesting is not hierarchical but polycentric:
> each node governs itself by the same principles that govern the whole; the
> whole is not above the parts but among them." — `eo-wiki.md:3181`

`docs/mereotopology-relations.md` independently re-derived this same
polycentric case for `grounded_by`: two referents under one operator are
"siblings... not parts of each other," never a cross-referent parthood
relation. The **peer** outcome here is the general form of that same
discovery — it is why this gate must be able to return "no level" as a first-
class, equally-valid result, not just a weaker "above."

## 2. Discovery, not assignment

Every other promotion gate in this engine (individuation type, boundary
stability, supplementation, paradigm promotion) earns its verdict from a
perturbation of the real data compared against a null built the same way —
never a hand-set constant, never a stamped label (`emergence/nulls/index.js`).
A holon-level relation is held to the identical discipline: `above`/`below`/
`peer`/`unstable` are `deriveNull`-gated verdicts over `existenceDependencyTest`
and `possibilityConstraintTest`, exactly as `individuation.js` gates
`field`/`emanon`/`protogon`/`holon`/`apparatus`. Nothing about which candidate
is "higher" is ever named in advance.

This also means the relation is not fixed at composition time. `composeHolon`
(`emergence/holon/index.js`) confirms — via `classifyHolonLevelRelation` — that
a newly admitted holon is actually above its parts, rather than assuming SYN
composition always produces a ladder rung.

## 3. Possibility-constraint is measured as prediction, not similarity

The first real-data check (Frankenstein text) tried operationalizing
possibility-constraint as `pull = cos²(part, whole)` — a static feature-vector
similarity borrowed from eoPriors' `spectral.js`. It came back mixed on real
prose. The problem was the framing, not the noise: "above constrains, below
enables" is a claim about what's *predictable*, not about vector geometry.
For anything with a sequential/temporal axis, the right measurement is
genuine predictive competency gain — and the engine already has a complete,
domain-agnostic substrate for exactly that (`packages/engine/prediction/
scoring` — proper scoring rules; `prediction/baselines`; `prediction/tasks`'
leakage-safe `walkForward`; `competency/ledger`'s
`competencyGain(m, b) = Σ L(b) − Σ L(m)`). None of it is textual.

`packages/engine/emergence/holon-level/series.js` builds
`existenceDependencyTest`/`possibilityConstraintTest` inputs for plain numeric
series on top of that substrate:

- **Existence-dependency**: does the whole series' own mean depend on
  retaining this candidate's indices, more than an arbitrary same-size window
  would (leave-out degradation vs. a random-window null)?
- **Possibility-constraint**: does conditioning prediction on "am I inside
  this candidate regime" beat an unconditioned baseline, by more than an
  arbitrary same-size regime label would — the competency gain measured
  under a proper scoring rule (default CRPS), walked forward
  commit-before-reveal? The null must draw random **contiguous** windows, not
  scattered index sets — a genuine regime is always contiguous, and a
  scattered null gives its own regime-conditioned history a handful of
  unrelated far-apart points, which produces wildly unstable variance
  estimates under a proper scoring rule and has nothing to do with whether
  the true candidate is informative. (Measured directly: switching a
  scattered null to a contiguous one on the NEXRAD data below moved the null
  threshold from the −400,000s to the low thousands — the same order of
  magnitude as the observed statistic, which is what a well-posed null looks
  like.)

**Worked example, real data, no narrative text involved**:
`scripts/test-holon-level-nexrad.mjs` runs this against the Albuquerque
NEXRAD radar file-size series already in this workspace
(`data/nexrad-s3-listing.xml`, 1000 scans, March 30–April 8 2020;
narrated independently in `nexrad-chronicle.txt`). `buildHolonicTree`
(`emergence/structured/index.js`) discovers 5 storm events from the raw
series; only **event:1** — 78,572-byte peak, 113 scans, the same storm the
human-written chronicle separately singles out as "The Great Storm" and its
"climax" — clears both bars and discovers `above`, with a printed competency
gain of ~39,898 against a Born-null threshold of ~−1,963. The other 4 events
come back `peer`/`unstable`: the discovery is selective, not a rubber stamp —
a smaller storm sitting inside the same ladder does not automatically inherit
"above" just because it was also discovered as an event.

`composeHolon`'s existing wiring (`emergence/holon/index.js`) still uses the
static `pull` proxy for its possibility-constraint check, because its parts
are feature vectors with no time axis — a predictive reframing does not apply
there. That is a narrower, weaker proxy kept only for the no-time-axis case;
`series.js`'s competency-gain construction is the preferred pattern for
anything sequential.

## 4. Time is per-holon, and it is signal, not a clock

There is no universal clock in this engine, because it is designed
omnimodally (text, video, audio, music — no modality gets a privileged clock).
Confirmed directly:

- `operator_epoch` is a fixed **spec-version** tag (`eo-2026-07`, see
  `docs/operator-epoch.md` and `packages/spec/operators/epoch.js`), stamped
  identically (`CURRENT_OPERATOR_EPOCH`) at every call site in the engine. It
  names which operator vocabulary is in effect, never a moment in a reading.
- `discourse`'s `turn` (`packages/engine/discourse/index.js`) is a real
  logical clock — but it is scoped to text/dialogue interaction and has no
  video/audio/music analogue.
- The one substrate every modality actually shares is the append-only
  semantic event log.

So "a meaningful frame of time" for a holon H is discovered per-holon, the
same way its level relation is: **a tick is signal from noise for that
specific holon.** Not every boundary-scoped observation is a tick — most are
redundant with what H already contains. A boundary-scoped observation is a
tick for H iff its `forwardScore` (`emergence/surprise/index.js`) against H's
own accumulated boundary-scoped history clears a `deriveNull` threshold built
from a null **conditioned on H's own history** (shuffled/resampled from H's
own prior observations — never an unconditional/global background; see
AGENTS.md's "Unconditional nulls" dead-end: an unconditioned null is a units
change, not a dimension). `noveltyReserve`'s `isNew` flag is exactly this
check, already built for this purpose and unused for it until now.

Because tick-rate is discovered per holon rather than assigned, a coarser
holon naturally ticks less often than a finer one — its own history changes
more slowly relative to its own noise floor — with nothing extra built for
that to fall out.

`holonLevelHistory` is an append-only log of `{ tick, relation, existence,
constraint }`, one entry per genuine tick, never mutated. "Does the
relationship change over time" is a plain diff over this log. A verdict flip
is only accepted once it holds for a Born-null-gated `min_window` of
consecutive ticks — the exact `checkZollmanDelay` pattern
(`packages/engine/emergence/paradigm/index.js`) reused rather than
reinvented, so a single noisy tick can't register as "the relationship
changed."

## 5. What this is not

This does not touch `individuation.js`'s `grounded_by`/`part_of`. Those fields
are a deliberately different, single-hop, non-cross-referent relation —
`docs/mereotopology-relations.md`'s fix for an earlier category error (treating
cross-referent comparison as a parthood question). Reusing a holon-level
depth for `part_of` would reintroduce exactly that error. This is new,
additive machinery for a different question: the relation between two
independently individuated candidates, of any kind, in any modality.

## 6. Where the machinery lives

| concern | module |
|---|---|
| existence-dependency + possibility-constraint gates (generic) | `packages/engine/emergence/holon-level/index.js` |
| relation classification (above/below/peer/unstable) | same, `classifyHolonLevelRelation` |
| tick detection (signal from noise, per holon) | same, `holonTick`, built on `emergence/surprise/index.js` |
| history + hysteresis | same, `holonLevelHistory` helpers, reusing `checkZollmanDelay` |
| predictive-competency construction for numeric series | `packages/engine/emergence/holon-level/series.js` |
| structured-pipeline confirmation wiring (events vs. whole series) | `packages/engine/emergence/structured/index.js`'s `buildHolonicTree` |
| composeHolon confirmation wiring (feature vectors, existence-only) | `packages/engine/emergence/holon/index.js` |
| schema | `packages/spec/schemas/holon-level-relation.schema.json` |
| real-data proof (NEXRAD radar, no narrative text) | `scripts/test-holon-level-nexrad.mjs` |

Enforced by `packages/engine/emergence/holon-level/index.test.js`,
`packages/engine/emergence/holon-level/series.test.js`, and
`packages/conformance/invariants/forbidden-dependencies.test.js` (the module
must stay pure — no `Date.now`, no ambient randomness, same as every other
emergence gate).
