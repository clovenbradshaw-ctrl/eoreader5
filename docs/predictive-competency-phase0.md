# Predictive competency — Phase 0 substrate

Status: implemented (Phase 0 / Section 29 vertical slice)
Spec: *EO Emergent Mathematics for Predictive Competency* v0.1

This is the epistemic substrate from section 28 "Phase 0" plus the Section 29
vertical slice: the smallest end-to-end loop that lets a value be **derived
from source data, committed as a prediction *before* the outcome is revealed,
scored later against baselines, and replayed** — without any claim about
universal mathematics.

It does not add program search, operator compression, calculus induction, or
transfer evaluation. Those are later phases. What it establishes is the honest
scaffolding every later phase is scored on.

## The loop

```
history at step t
  → candidate program emits a predictive distribution
  → commitPrediction (sealed, reveal_not_before_step = t+1)   ← BEFORE reveal
  → reveal series[t]
  → revealAndScore under a proper scoring rule (leakage-guarded)
  → recordStep into the prequential competency ledger
  → finalizeCompetency → scoped, content-addressed CompetencyRecord
```

## Modules (all pure; engine depends only on `@eoreader/spec`)

| Module | Spec | Responsibility |
| --- | --- | --- |
| `packages/engine/prediction/scoring` | 13.1 | Proper scoring rules: log-loss, Brier, CRPS (gaussian closed-form + empirical ensemble), pinball; point losses. Improper rule/kind pairings return `loss: null, proper: false` — a point forecast is never laundered into a proper score. |
| `packages/engine/prediction/baselines` | 13.4, 29.6 | Minimum baselines: last-value, random-walk, global-mean, moving-mean, seasonal-persistence. Spread is **derived from the data**, never a hand-set constant; degrades to a point prediction when no spread is justified. |
| `packages/engine/prediction/commitments` | 7.1, 6.13, 22.2 | `commitPrediction` seals every field with a canonical `commitment_hash` and requires `reveal_not_before_step > committed_at_step`. `revealAndScore` refuses reveal before the eligible step (leakage) and rejects a tampered seal. |
| `packages/engine/prediction/tasks` | 12.2, 22.1 | Typed, content-addressed `PredictionTask` (no untyped "predict what happens next") and a pure `walkForward` generator. |
| `packages/engine/competency/ledger` | 13.2, 22.3, 7.5 | Immutable prequential fold. `competencyGain(m,b) = Σ L(b) − Σ L(m)`. `finalizeCompetency` forces a full scope (horizon, population, sources, protocol) before sealing a `CompetencyRecord`. |

Schemas and validators live in `packages/spec/schemas/prediction-task`,
`prediction-commitment`, `competency-record` and
`packages/spec/validation/index.js`.

## "Before" without a clock

The engine reads no ambient time (`docs/invariants.md`, the purity gate in
`packages/conformance/invariants/forbidden-dependencies.test.js`). So invariant
7.1's "the prediction was persisted before the target became visible" is
enforced with a **logical step index** supplied by the prequential
walk-forward, not a wall clock. A commitment made at step `t` declares
`reveal_not_before_step = t + 1`; `revealAndScore` throws if a target is
revealed earlier. This is exactly the ordering prequential evaluation needs,
and it stays deterministic and replayable.

## Honesty properties enforced here

- **Legality/format before competency** — an unsupported predictive-output kind
  is refused at commit time.
- **No leakage** — reveal before the horizon throws; a mutated commitment fails
  its seal check.
- **Competency is scoped** (7.5) — a `CompetencyRecord` cannot be finalized
  without naming target, horizon, population, sources, baselines, scoring rule,
  and protocol.
- **No causal laundering** (7.7) — records carry `warrant_status` (default
  `unknown`) separately from competency; nothing is rendered as causation.
- **Not rigged** — the demo's drift candidate beats weak baselines on trending
  series and *loses* to last-value on a near-random-walk and to
  seasonal-persistence on a seasonal series. Competency is horizon- and
  task-relative, as the spec requires (section 2.2).

## Run it

```
npm test                               # all workspaces incl. the purity gate
node scripts/predict-series-demo.mjs   # the Section 29 slice, with replay check
node scripts/search-programs-demo.mjs  # Phase 2 program search (below)
```

The demo (`scripts/predict-series-demo.mjs`, importable as `runPredictiveSlice`
/ `runSeries`) runs three synthetic series, prints per-series competency gain
versus every baseline and a Section-25.1 "thinking surface" for the last
committed step, and confirms `deterministic replay: true`.

## Phase 2 — bounded typed program search (§14, §29.5)

On top of the substrate, a bounded typed enumerator *searches* for competent
programs instead of running one fixed candidate.

| Module | Spec | Responsibility |
| --- | --- | --- |
| `packages/engine/emergence/expressions` | 14, 15, 29.3-29.4 | Numeric-program IR (the Section 29 kernel as reducible compositions — `last`, `sum`, `mean`, `diff`, `lag`, `add/sub/mul`, protected `div`), evaluator, canonical-key dedup (§15), and a bounded, deterministic enumerator. |
| `packages/engine/emergence/programs` | 14, 29.5-29.6 | `searchCompetentPrograms` scores every enumerated program prequentially (commit-before-reveal) against the standard baselines and ranks by a description-length-penalized utility (§13.5). Ranking uses **CRPS** — a proper score (§13.1) that stays robust when a program's self-derived spread is momentarily miscalibrated. |

`scripts/search-programs-demo.mjs` (importable as `runSearchDemo`) enumerates
~80 programs over a synthetic trend and a seasonal series and prints the
competency-ranked frontier. On the trend it rediscovers a persistence/drift
structure (`last(hist)` and `last(hist)+1`) ranked well above the global-mean
reference — Phase 2's exit criterion, reached by measured competency rather than
by name. It decides nothing: search proposes and scores; promotion is below.

## Operator emergence — the REC → INS seam (§11.2, §15.3, §11)

This is the move that turns the ranked frontier into a running **helix**. One
pass of the nine EO operators (the `eo-2026-07` epoch) ends at REC —
preserve / revise / promote. `emergence/operators` makes REC actually
restructure the search grammar: a competent *composition* is minted as a
reusable operator and re-enters enumeration as a cost-1 `opref` primitive (INS
at the top of the next pass). Because the same nine moves now range over an
enlarged vocabulary, the next pass reaches structures the previous one could
not — no new mechanism, just the loop pointed at its own recent output. The
kernel→operator mapping this rests on:

```
Identity      NUL constants     SIG field-selection   INS finite-window
Structure     SEG comparison    CON lag               SYN fold / count
Significance  DEF field-algebra EVA conditional        REC composition
```

The mapping lands on the right cell along *both* axes (mode and act): the
Relate column is field-selection / lag / conditional, the Generate column is
window / fold / composition. The scoring rule and the description-length
penalty are deliberately *not* in it — they are what EVA judges by, and in the
code they live in `emergence/programs` (the ranker), never as nodes in
`emergence/expressions` (the IR).

| Module | Spec | Responsibility |
| --- | --- | --- |
| `packages/engine/emergence/operators` | 11.2, 15.3, 22.4, 12.8, 7.6 | `induceOperators` runs the helix until a pass promotes nothing. A candidate is promoted only if it (a) combines two *structural* sub-results — a bare reducer or `reducer ± const` is a variant, not a new operator; (b) beats the reference on a **held-out tail** (transfer, invariant 7.6); and (c) clears a **born-null** derived by shuffling the series (§12.8 — no hand-set thresholds). Each promoted `OperatorCandidate` stores its lens (target/horizon/reference baseline — "surprising relative to what"), its transfer gain, its null record, and `emergence: { promoted_by: "REC", reenters_as: "INS" }`. |

Two honesty facts fall out and are tested:

- On a hierarchical (trend + season) series, pass 0 mints structural operators
  (momentum, drift = `mean(diff)+last`, the §11.2 operator by competency not
  name) and **pass 1 promotes an operator built atop a pass-0 operator** — the
  recursion, made checkable.
- On **white noise, nothing promotes.** The in-sample winners are all
  `reducer ± const` constant-offset artifacts; the structural rule rejects them
  as variants and the transfer gate refuses what does not generalize.

`scripts/induce-operators-demo.mjs` (importable as `runInductionDemo`) prints
the promoted operators, which pass minted each, the lens and null each cleared,
and which ones reuse a prior operator — with the noise series promoting nothing.

### What this seam unlocks but does not build

The next rung up is **kinds** (§11.3): once an operator like a pressure/level
tendency exists, SEG can threshold *on it* (`tendency > θ`) to carve the stream
into regimes and report competency per regime. And the multi-lens **disagreement**
surface — where a candidate is low-surprise under one baseline and high under
another — is an app (eoreaderapp) concern; the engine already emits the raw
material for it, since every `CompetencyRecord` carries per-baseline
`competency_gain` under a named scope. Neither is implemented here.
