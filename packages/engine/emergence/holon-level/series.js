// packages/engine/emergence/holon-level/series.js
//
// Constructs existenceDependencyTest/possibilityConstraintTest inputs (see
// ./index.js, docs/holon-level.md) for plain numeric series. Possibility-
// constraint here is measured as predictive competency gain — reusing the
// engine's existing, domain-agnostic prediction/competency substrate (proper
// scoring rules, leakage-safe walk-forward, an immutable competency ledger)
// — never a static similarity proxy. "Above constrains, below enables" is a
// claim about what's predictable, so it is measured as prediction, not
// geometry. No new statistical machinery is invented here: every number
// comes from `../../prediction/*` and `../../competency/ledger`, the same
// modules `scripts/predict-series-demo.mjs`-style code already exercises.

import { createSeededRng } from "../nulls/index.js";
import { existenceDependencyTest, possibilityConstraintTest, classifyHolonLevelRelation } from "./index.js";
import { walkForward } from "../../prediction/tasks/index.js";
import { lastValue } from "../../prediction/baselines/index.js";
import { score as scoreUnder } from "../../prediction/scoring/index.js";
import { createLedger, recordStep, competencyGain } from "../../competency/ledger/index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

function mean(xs) {
  if (xs.length === 0) throw new TypeError("holon-level/series: mean requires at least one value");
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// A genuine event/regime in a series is always a CONTIGUOUS run — that's
// what makes it a coherent episode rather than noise. The fair null is "an
// equally-sized episode happening somewhere else," which means a random
// CONTIGUOUS window, not a scattered index set. A scattered null gives each
// permutation's "regime-conditioned" history a handful of unrelated,
// far-apart points with no real local coherence — which produces wildly
// unstable variance estimates (and, under a proper scoring rule, an
// occasionally catastrophic loss) that have nothing to do with whether the
// TRUE candidate is genuinely informative. Contiguity keeps the null
// comparable in kind to what it's supposed to be a null OF.
function randomSameSizeWindow(totalLength, size, rng) {
  const maxStart = Math.max(0, totalLength - size);
  const start = Math.floor(rng() * (maxStart + 1));
  const window = new Set();
  for (let i = start; i < start + size && i < totalLength; i++) window.add(i);
  return window;
}

function toIndexSet(candidateIndices) {
  return candidateIndices instanceof Set ? candidateIndices : new Set(candidateIndices);
}

// ── Existence-dependency ─────────────────────────────────────────────────
//
// Does the whole series' own summary depend on retaining this specific
// candidate index-set, more than an arbitrary same-size subset would?

export function seriesExistenceDependency({ wholeSeries, candidateIndices, permutations = 200, quantile, protocol }) {
  const idxSet = toIndexSet(candidateIndices);
  const without = wholeSeries.filter((_, i) => !idxSet.has(i));
  const observedDegradation = Math.abs(mean(wholeSeries) - mean(without.length ? without : wholeSeries));

  const rng = createSeededRng(
    canonicalHashSync({ purpose: "series-existence-null", size: idxSet.size, length: wholeSeries.length })
  );
  const nullDegradations = [];
  for (let i = 0; i < permutations; i++) {
    const randomSet = randomSameSizeWindow(wholeSeries.length, idxSet.size, rng);
    const randomWithout = wholeSeries.filter((_, j) => !randomSet.has(j));
    nullDegradations.push(Math.abs(mean(wholeSeries) - mean(randomWithout.length ? randomWithout : wholeSeries)));
  }

  return existenceDependencyTest({
    observedDegradation,
    nullDegradations,
    quantile,
    protocol: protocol ?? { name: "series-leave-out-degradation", iterations: permutations, candidate_size: idxSet.size },
  });
}

// ── Possibility-constraint: predictive competency gain ──────────────────
//
// Walks `series` prequentially (../../prediction/tasks's walkForward, the
// same leakage-safe commit-before-reveal driver the Section 29 slice uses).
// At each step, scores an UNCONDITIONED predictor (last-value over all
// history) against a REGIME-CONDITIONED one (last-value over only the
// history sharing the current step's regime membership) under the same
// proper scoring rule, folded into a competency ledger. A step where either
// side can't produce a proper score is skipped for competency purposes
// (never silently zeroed) — the same honesty discipline `gaussianOrPoint`
// already applies inside the baselines themselves.

function regimeConditionedCompetencyGain({ series, regimeOf, warmup, scoringRule }) {
  let ledger = createLedger({
    task_id: "task:series-holon-level",
    candidate_id: "candidate:regime-conditioned",
    baseline_ids: ["baseline:unconditioned"],
    scoring_rule: scoringRule,
  });

  for (const { step, history, target } of walkForward(series, { warmup })) {
    const unconditioned = lastValue(history);

    const currentRegime = regimeOf(step);
    const sameRegimeHistory = history.filter((_, j) => regimeOf(j) === currentRegime);
    const conditioned = sameRegimeHistory.length >= 2 ? lastValue(sameRegimeHistory) : unconditioned;

    const candidateScored = scoreUnder(conditioned, target, { rule: scoringRule });
    const baselineScored = scoreUnder(unconditioned, target, { rule: scoringRule });

    // Only a step where BOTH sides produced a proper score is comparable —
    // never default a missing score to 0, which would silently favour
    // whichever side happened to stay proper.
    if (!candidateScored.proper || !baselineScored.proper) continue;

    ledger = recordStep(ledger, {
      candidate_loss: candidateScored.loss,
      baseline_losses: { "baseline:unconditioned": baselineScored.loss },
      proper: true,
    });
  }

  return { gain: competencyGain(ledger)["baseline:unconditioned"], observations: ledger.observations };
}

export function seriesPossibilityConstraint({
  series,
  candidateIndices,
  warmup = 2,
  scoringRule = "crps",
  permutations = 200,
  quantile,
  protocol,
}) {
  const idxSet = toIndexSet(candidateIndices);

  const observed = regimeConditionedCompetencyGain({
    series,
    warmup,
    scoringRule,
    regimeOf: (i) => idxSet.has(i),
  });

  const rng = createSeededRng(
    canonicalHashSync({ purpose: "series-constraint-null", size: idxSet.size, length: series.length })
  );
  const nullNarrowings = [];
  for (let i = 0; i < permutations; i++) {
    const randomSet = randomSameSizeWindow(series.length, idxSet.size, rng);
    const nullRun = regimeConditionedCompetencyGain({
      series,
      warmup,
      scoringRule,
      regimeOf: (j) => randomSet.has(j),
    });
    nullNarrowings.push(nullRun.gain);
  }

  return possibilityConstraintTest({
    observedNarrowing: observed.gain,
    nullNarrowings,
    quantile,
    protocol: protocol ?? {
      name: "series-regime-conditioned-competency-gain",
      iterations: permutations,
      candidate_size: idxSet.size,
      scoring_rule: scoringRule,
      observations: observed.observations,
    },
  });
}

// ── Combined discovery ────────────────────────────────────────────────────

export function discoverSeriesLevelRelation({
  series,
  candidateIndices,
  subject_id = null,
  candidate_id = null,
  permutations = 200,
  quantile,
  warmup = 2,
  scoringRule = "crps",
}) {
  const existence = seriesExistenceDependency({ wholeSeries: series, candidateIndices, permutations, quantile });
  const constraint = seriesPossibilityConstraint({ series, candidateIndices, warmup, scoringRule, permutations, quantile });
  return classifyHolonLevelRelation({ existence, constraint, subject_id, candidate_id });
}
