# Physics layer: deep review and integration

Status of the review request, the defects found, and what changed. The
short version: the reported NaN bug is real but its stated cause was
not, the reported edge-confidence bias runs in the opposite direction
from the one described, and the two most serious problems found were
not on the list.

Everything is now covered by unit tests that run without media files.

---

## 1. The physics.js NaN bug

**Reported:** `divergenceField` returns NaN in the mean; likely
`Float64Array.reduce` propagating NaN from boundary blocks.

**Actual:** The mean could never be NaN, and that was the problem. Every
reduction ended in `|| 0`:

```js
return { field: div, mean: div.reduce((a, v) => a + v, 0) / (cols * rows) || 0 };
```

`NaN` is falsy, so `NaN || 0` evaluates to `0`. The mean silently
reported "no divergence" — indistinguishable from a genuinely still
frame — while `maxDiv`, `minDiv`, `rotationalEnergy` and `currentDensity`
in the same summary object *did* come back NaN, since they had no such
guard. That asymmetry is what made the bug look like it lived in the
mean.

**Root cause:** `analyzeFlowPhysics` hardcoded `cols = 20, rows = 15`.
Any flow computed on a differently sized grid read past the end of the
typed array; out-of-bounds reads on a `Float64Array` return `undefined`,
and `undefined - undefined` is NaN. Reproduced directly:

```
grid 20×10 data, analysed as 20×15
  divergence:      0     ← the mean, masked by `|| 0`
  maxDiv:          NaN
  rotationalEnergy: NaN
```

**Fixed:**
- Dimensions are validated against the data (`resolveGrid`) and throw a
  `RangeError` on mismatch instead of reading out of bounds.
- `analyzeFlowPhysics` takes the grid from the flow result, which
  `blockFlow` now reports.
- Every reduction is NaN-safe *and* returns `samples`/`dropped`, so a
  mean of 0 from 234 blocks is distinguishable from a mean of 0 because
  everything was dropped.
- Means are computed over the **interior only**. The old code divided by
  the full `cols * rows` while writing only the interior, diluting every
  mean by 234/300 ≈ 0.78 — a systematic 22% underestimate.
- Extrema return `null` rather than `±Infinity` when nothing is
  measurable.

Also corrected while in there:

- **`laplacianField` was not computing a Laplacian.** It summed
  `∂²Fx/∂x² + ∂²Fy/∂y²` — one partial from each of two different vector
  components. For a vector field the Laplacian is per-component and each
  component needs both second derivatives. The old form vanishes for
  uniform and linear flow, which is why it looked correct.
- **`gradientMagnitude` was blind to shear.** It used only `∂Fx/∂x` and
  `∂Fy/∂y` — the two terms that make up the divergence — so pure shear,
  exactly the motion boundary it exists to find, registered as zero. Now
  the full Jacobian norm.
- **`vorticity` hardcoded `* 20`** as the grid width, silently indexing
  the wrong cells for any other grid. Now requires the width.
- **`findDipoles` thresholded a raw dot product**, making it
  magnitude-dependent: two slow blobs moving directly at each other never
  registered, two fast ones always did. Now thresholds the cosine.

**Tests:** `perceiver/video/physics.test.js` — 21 tests covering uniform
flow (curl ≈ 0, div ≈ 0), rotational flow (`∇×(-y, x) = 2` exactly),
expanding flow (`∇·(x, y) = 2`), contraction, shear, NaN propagation,
all-NaN input, dimension mismatch, border handling and mask propagation.

---

## 2. Optical flow at frame edges

**Reported:** Edge blocks have artificially *high* confidence because
fewer candidates mean lower minimum SAD.

**This is backwards.** `bestCost` is a minimum over the candidate set.
Fewer candidates means the minimum is taken over a subset, so it can only
be **higher** — edge confidence is artificially *low*, not high.

The real edge defect is worse than a confidence artefact. The search
truncates asymmetrically at the border: at `bx = 0` only `sx ≥ 0` is
reachable, at `bx = COLS-1` only `sx ≤ 0`. So border vectors are forced
to point **inward**, and a ring of inward-pointing vectors is precisely a
spurious divergence. The boundary bias in curl and divergence was
manufactured by the search window, not measured from motion.

**Fixed:** `blockFlow` marks border blocks in `vectors.valid`;
`analyzeFlowPhysics` honours that mask by default and propagates it
outward one ring, since a finite-difference stencil that *reads* an
untrusted block is itself untrustworthy. `flow.test.js` includes the
counter-test proving the mask is load-bearing: the same synthetic pan
shows measurably more divergence with the border included.

### 2a. The sign convention was inverted (not reported)

`blockFlow` searches for the current block *in the previous frame*, so
the winning offset points from where the block **is** to where it
**was** — the negation of the motion vector. Nothing negated it.

Consequences:

- `dy[i] > 1` was labelled "Moving down" but meant content had moved
  **up**.
- `downwardDominance`, and therefore `motionSignature().downward`,
  reported the opposite of the motion on screen.
- The Odessa Steps reading — whose entire claim is that the massacre
  turns milling motion into sustained **downward** flow — was measuring
  the reverse of what it reported.

`physics.js` also documents `(fdx, fdy)` as a motion field when computing
`∇×F` and `∇·F`, so curl and divergence carried flipped signs too:
"counterclockwise" meant clockwise, "crowd scattering" meant converging.

**Fixed:** `blockFlow` negates at the source, so `vectors.dx/dy` are
motion vectors (+y is down the frame). `flow.test.js` pins this with
synthetic translated frames in all four directions.

**Callers should re-run.** Anything that read direction rather than
magnitude now reports the opposite of what it did before — which is to
say, it now reports the truth. Consumers that used `Math.abs` (people.js
blob detection, the curl/divergence magnitudes in
`pipeline-cross-modal.mjs`) are unaffected.

### 2b. The confidence gate never fired (not reported)

The gate was `confidence > 0.2`, i.e. `SAD < 0.8 × 64 × 255 ≈ 13056`.
Real 8-bit matches land two orders of magnitude below that, so the gate
passed every block on every frame. `activityFraction` — documented as
"fraction of blocks with meaningful motion" — was therefore computing
mean confidence over all 300 blocks, roughly 0.9 regardless of content.

**Fixed:** the threshold now comes from the frame's own cost
distribution (a block is confidently matched when its cost is in the
lower half), which is scale-free and adapts to grain and exposure.
`activityFraction` is now a genuine count over a genuine denominator.

---

## 3. Trajectory red shift ↔ physics current density

The two were computing the same thing on different representations. Both
are a cosine comparison of a state vector against a reference,
accumulated along an axis; the only differences were the source of the
vector (a relation-signature `Map` vs. a field-spec slice) and the axis
(phases vs. frames).

`emergence/trajectory/field-shift.js` implements the shared core once
over any field sequence. `emergence/trajectory/index.js` keeps its
`Map`-based interface — it is the right shape for an EOT operator log —
and `field-shift.test.js` proves the two agree **exactly**, not
approximately:

```
fieldRedShift(vectors)             === redShift(trajectory)
fieldRestFrameDivergence(vectors)  === restFrameDivergence(trajectory)
fieldPhaseVolatility(vectors)      === phaseVolatility(trajectory)
```

A character's red shift is now computable from the physics fields of the
video or text they appear in, which was the goal.

### A metric problem found in the process

`coherence = displacement / path-length` is only bounded by 1 when the
distance obeys the triangle inequality. **Cosine distance (1 − cos θ) is
not a metric** — it fails the triangle inequality — so a spec built from
`cosine` channels can produce coherence above 1, at which point it stops
meaning "the fraction of the path that was progress". Measured: 1.477 on
a three-state sequence.

Rather than clamp — which would repeat exactly the `|| 0` failure — the
result reports `bounded: false`, and `angular` distance (θ/π) was added
as the triangle-safe form of the same comparison. Same ordering, same
zero, bounded ratios.

---

## 4. Modality-blind field specs

Each perceiver declared a `*_FIELD_SPEC`, but nothing read them. Every
consumer sliced with hardcoded offsets (`u.field.slice(0, 300)` for video
motion energy), so the spec and the code depending on it could drift
apart silently, and any cross-modal formula had to branch on medium.

`perceiver/field-spec.js` makes the declaration executable: offsets,
named slicing, per-channel metrics, validation, and a `fieldDistance`
that weights channels equally by default — so a 300-dim motion channel
does not drown a 2-dim centroid channel purely by being wider, which is
what concatenating everything and taking one euclidean norm does.

Text's missing spec is now `eotFieldSpec({ figures })`: figure
activations, moment score and order, and operator frequencies over the
3×3 vocabulary. It is a factory rather than a frozen literal because
figure count depends on the log.

---

## 5. Exports

`packages/engine/index.js` now exports the video flow primitives, the
physics layer, the holon self-teaching (`AccelTemplate`,
`StructuralVocabulary`, `findAccelerationPattern`, `detectNarrativeArc`),
the field-spec interface, chapter detection, field-shift, and the
invariant/cycle layers. `package.json` gained the matching subpath
exports.

---

## 6. Chapter detection

The Potemkin boundary pipeline was inline in an eval script, so it could
not be reproduced, tested, or pointed at another input.
`emergence/chapters/` is that pipeline as a module: scalar series in,
boundaries out, modality-blind. It abstains when the series holds no
structure rather than returning the top-k largest changes.

`consensusBoundaries` adds the within-modality version of the redundancy
argument: one observable finding a boundary is a hypothesis, three
finding it at the same frame is evidence.

**One degenerate case worth knowing about.** DEF derives its threshold
from the background's own spread, so a background with *no* spread
defeats it — on a perfectly clean synthetic step the gap spectrum is all
zeros, there is nothing to fit, and DEF abstains on the cleanest
structure there is. Real physics series always carry noise and take the
normal path; the module special-cases a literally-constant background,
where no null model is needed because no chance variation exists to
explain the excess.

---

## The invariant architecture

Following the reframing of subassemblies as constraint networks rather
than capability groups, two layers were added.

### `invariants/index.js` — the four constraints

```
1. PROBABILITY     0 ≤ P ≤ 1
2. CONTINUITY      Σ|ψ|² = 1
3. THERMODYNAMIC   dS/dt ≥ 0
4. PHASE           |Σ√(I₁I₂)cos δ| ≤ ΣI
```

These **check**; they do not clamp. `quantum/project()` and
`quantum/interfere()` both end in `Math.max(0, Math.min(1, x))`, which
satisfies the bound at the output while destroying the evidence it was
ever violated — a state that computed P = 1.4 and one that computed
P = 1.0 become indistinguishable. Silent repair is how a constraint
network stops being able to detect its own corruption.

Every check returns a **margin**, so "just inside" is distinguishable
from "comfortably inside", and locates the offending dimension.

### Three findings from the invariant layer

**The interference kernel breaches the phase bound by construction.**
`interfere()` uses `kernel = β(1 + α·cos δ)` with `β = 1.0, α = 0.3`, so
the cross term carries a factor of up to **1.3** where the two-source
bound allows at most 1.0 — a 30% overshoot. It is invisible downstream
because `interfere()` clamps into [0,1]: the intensity is capped, so
nothing looks wrong, while the ordering among folds near the cap is
already distorted. Only a static check on the constants can catch it.
`scatteringKernelBound(1.0, 0.3)` reports it; a test pins it.

**Zero-norm faces violate continuity silently.**
`quantum/normalizeAmplitudes()` short-circuits on `sumSquares === 0`,
leaving an all-zero face whose norm is 0, not 1. Every projection out of
it is meaningless. Now reported as `reason: 'zero-norm'`.

**Maximum ignorance presents as maximum agreement.** `quantum/fold()`
falls back to a *uniform* face when it finds no classifier evidence, and
the Born projection of two uniform faces is exactly 1.0. Measured on the
current engine:

```
project(fold("the crowd surges down the steps…"),
        fold("a fugue subject returns in the dominant…"))  =  1.0000
```

Two unrelated texts, perfect agreement, because neither produced any
evidence. For Cycle 3 this is the failure mode that matters most: three
channels that know nothing form a unanimous, maximally confident,
"fault tolerant" consensus about nothing.

### `invariants/cycles.js` — the three closed loops

**Cycle 1 — Born-Continuity, the oscillator.** measure → normalize →
clamp → check. The useful measurement is not whether it runs but how it
settles. The displacement decays geometrically; the **decay ratio** is
the clock rate, and the turn count follows as log(ε)/log(ratio). At
`strength = 0.3` the ratio is ≈0.84, needing ~77 turns to reach
ε = 1e-6 — a limit of 16 would report a false non-convergence.

**Cycle 2 — Entropy-Phase, the heat engine.** interfere → measure →
decohere → consolidate. Interference is the power stroke and is the one
stage permitted to reduce entropy; decoherence must never. Pruning
reduces the surviving set's entropy without violating dS/dt ≥ 0 because
the entropy leaves with the pruned entries, so the cycle books
`exportedEntropy` explicitly rather than asserting the bookkeeping.
Efficiency is checked against Carnot, and when there is no thermal
gradient the cycle says so instead of returning a number that reads like
an efficiency.

**Cycle 3 — Cross-modal, Byzantine fault tolerance.** The agreement
threshold comes from `boundedNull` over the channels' own deviations, not
a hardcoded tolerance. With three channels there are three deviations —
below `MIN_SAMPLES` — so the null **abstains**, and that is the correct
answer: three witnesses can show you they disagree but cannot justify
naming the liar. Reported as `isolable: false`; a caller who needs
isolation must add channels rather than lower the bar.

Three further properties, each of which took a specific failure to find:

- **Median, not mean.** One lying channel can drag a mean arbitrarily far
  — exactly the failure this cycle exists to survive.
- **Majority cluster, not spread.** No deviation-from-median test can
  see an even partition: with three channels at 0.1 and three at 0.9 the
  median lands at 0.5, a value *no channel holds*, every deviation is
  identically 0.4, and the null flags nobody. A network split in half
  read as unanimous. Caught by clustering on gaps in the sorted values,
  using the same 2.5× elbow multiple `extreme-value.js` uses.
- **Vacuous agreement.** Unanimity among uninformative channels is
  reported as `vacuous`, never `agreed`, and does not count as fault
  tolerance — one silence counted three times is not three witnesses.

---

## What was deliberately not changed

- `quantum/interfere()`'s scattering constants. The kernel breaches the
  phase bound, and the invariant layer now says so, but changing
  `β`/`α` would silently alter every ranking the engine has produced.
  That is a decision to take deliberately, with the affected readings
  re-run — not a drive-by fix inside a review.
- `emergence/physics/index.js` (the Fokker-Planck / Navier-Stokes
  equation set) is untouched; it is a different layer from the
  optical-flow physics and was not in scope.
- The holon self-teaching, structural vocabulary, acceleration templates
  and cross-modal bridge are unchanged in behaviour — now exported and
  covered by `cross-modal-physics.test.js`, which carries the Odessa
  Steps ↔ fugue-subject template match in CI without media files.

## Test counts

| Suite | Tests |
|---|---|
| `perceiver/video/physics.test.js` | 21 |
| `perceiver/video/flow.test.js` | 13 |
| `invariants/index.test.js` | 21 |
| `invariants/cycles.test.js` | 28 |
| `emergence/chapters/index.test.js` | 20 |
| `emergence/trajectory/field-shift.test.js` | 13 |
| `cross-modal-physics.test.js` | 14 |
| **Total added** | **130** |
