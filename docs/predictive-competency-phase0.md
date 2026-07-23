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
by name. It decides nothing: search proposes and scores; promotion is a later
phase.
