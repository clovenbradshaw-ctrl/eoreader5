// Holon-level relation: discovered, never assigned. See docs/holon-level.md.
//
// Two candidates have a holon-level relation only if BOTH hold, in the same
// direction (eoreader4.2/docs/eo-wiki.md, quoted in full in the doc above):
//
//   EXISTENCE-DEPENDENCY  — "cannot exist without." The subject depends on
//     the candidate iff removing/perturbing the candidate degrades the
//     subject's own viability more than a comparable random removal would.
//   POSSIBILITY-CONSTRAINT — "above constrains, below enables." The
//     candidate constrains the subject iff perturbing the candidate narrows
//     the subject's admissible-state distribution more than a comparable
//     random perturbation would.
//
// Both passing means the candidate is ABOVE the subject. Neither passing
// means they are PEERS — polycentric, no level exists between them (the
// same discovery `grounded_by` already makes for referents under one
// operator: siblings, not parts of each other). Disagreement is UNSTABLE —
// a typed gap, surfaced, never silently resolved into a level.
//
// Same discipline as every other promotion gate in this engine
// (individuation.js, boundaries/index.js, paradigm/index.js): every
// threshold is a Born null from deriveNull, generating the actual
// perturbation is the caller's job, and results are frozen for audit.
//
// Time follows the same rule: there is no universal clock (operator_epoch is
// a fixed spec-version tag, not a clock; discourse's turn is real but
// text-only). A "tick" for a holon is signal-from-noise local to that
// holon — see `holonTick` below, built on `../surprise/index.js`'s
// `forwardScore`/`noveltyReserve` conditioned on the holon's OWN history,
// never a global background.

import { deriveNull, createSeededRng, seededShuffle } from "../nulls/index.js";
import { forwardScore, noveltyReserve } from "../surprise/index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

// ── Gate 1: existence-dependency ────────────────────────────────────────────
//
// The caller removes/perturbs the candidate from the subject's own
// supporting evidence (leave-one-out or replacement — the same idiom
// `supplementationTest` in `../holon/index.js` uses) and measures the
// resulting degradation in the subject's own viability statistic (its
// individuation mass/coupling, or its boundary stability). `nullDegradations`
// is the degradation seen when a random comparable member is removed
// instead of the candidate specifically.

export function existenceDependencyTest({
  observedDegradation,
  nullDegradations,
  quantile,
  protocol,
}) {
  if (typeof observedDegradation !== "number" || Number.isNaN(observedDegradation)) {
    throw new TypeError("existenceDependencyTest: observedDegradation must be a number");
  }
  const nullResult = deriveNull({
    nullSamples: nullDegradations,
    observedStatistic: observedDegradation,
    tailDirection: "greater",
    quantile,
    protocol: protocol ?? { name: "existence-dependency-removal-degradation" },
  });
  return Object.freeze({
    observed_degradation: observedDegradation,
    passed: nullResult.passed,
    null_result: nullResult,
    reason: nullResult.passed
      ? `removing the candidate degrades the subject's viability (${observedDegradation.toFixed(4)}) more than chance removal — the subject depends on it`
      : `removing the candidate does not degrade the subject's viability (${observedDegradation.toFixed(4)}) more than chance removal — no existence-dependency detected`,
  });
}

// ── Gate 2: possibility-constraint ──────────────────────────────────────────
//
// The caller perturbs the candidate (shuffles/nulls its state) and measures
// the resulting narrowing of the subject's admissible-state distribution
// (entropy/variance of the subject's own null model, or displacement of the
// subject's boundary — `jaccardDistance`/`computeBoundaryStabilityGate`'s
// displacement machinery is the natural reuse). `nullNarrowings` is the
// narrowing seen from an unrelated perturbation of comparable magnitude.

export function possibilityConstraintTest({
  observedNarrowing,
  nullNarrowings,
  quantile,
  protocol,
}) {
  if (typeof observedNarrowing !== "number" || Number.isNaN(observedNarrowing)) {
    throw new TypeError("possibilityConstraintTest: observedNarrowing must be a number");
  }
  const nullResult = deriveNull({
    nullSamples: nullNarrowings,
    observedStatistic: observedNarrowing,
    tailDirection: "greater",
    quantile,
    protocol: protocol ?? { name: "possibility-constraint-perturbation-narrowing" },
  });
  return Object.freeze({
    observed_narrowing: observedNarrowing,
    passed: nullResult.passed,
    null_result: nullResult,
    reason: nullResult.passed
      ? `perturbing the candidate narrows the subject's possibility space (${observedNarrowing.toFixed(4)}) more than chance perturbation — the candidate constrains the subject`
      : `perturbing the candidate does not narrow the subject's possibility space (${observedNarrowing.toFixed(4)}) more than chance perturbation — no possibility-constraint detected`,
  });
}

// ── Classification: the discovered relation ─────────────────────────────────
//
// A pure combinator, no statistics of its own. `subject_id`/`candidate_id`
// are optional audit labels only — the actual direction is determined by
// which entity's degradation/narrowing the caller measured when building
// `existence`/`constraint`, not by anything here.

export function classifyHolonLevelRelation({ existence, constraint, subject_id = null, candidate_id = null } = {}) {
  if (!existence || typeof existence.passed !== "boolean") {
    throw new TypeError("classifyHolonLevelRelation: existence must be an existenceDependencyTest result");
  }
  if (!constraint || typeof constraint.passed !== "boolean") {
    throw new TypeError("classifyHolonLevelRelation: constraint must be a possibilityConstraintTest result");
  }

  let relation;
  let reason;
  if (existence.passed && constraint.passed) {
    relation = "above";
    reason = "existence-dependency and possibility-constraint agree: candidate is above subject";
  } else if (!existence.passed && !constraint.passed) {
    relation = "peer";
    reason = "neither existence-dependency nor possibility-constraint holds — polycentric, no level assigned";
  } else {
    relation = "unstable";
    reason = `existence-dependency (${existence.passed}) and possibility-constraint (${constraint.passed}) disagree — relation is a typed gap, not silently resolved`;
  }

  return Object.freeze({
    schema: "HolonLevelRelation@1",
    relation,
    subject_id,
    candidate_id,
    existence,
    constraint,
    reason,
  });
}

// ── Ticks: signal from noise, per holon ─────────────────────────────────────
//
// Not every boundary-scoped observation is a tick for a holon — most are
// redundant with what it already contains. An observation is a tick iff its
// forward score against the holon's OWN accumulated history clears a
// Born-null threshold built from a null CONDITIONED on that same history
// (leave-one-out within the holon's own observations) — never an
// unconditional/global background (AGENTS.md's "Unconditional nulls" dead
// end: only a conditional null earns a dimension).

export function holonTick({ observation, holonHistory, quantile, protocol, permutations = 200 }) {
  const history = holonHistory ?? [];
  if (history.length < 2) {
    return Object.freeze({
      is_tick: null,
      score: forwardScore(observation, history),
      null_result: null,
      reason: "insufficient holon history to build a conditional null (need >= 2 prior observations)",
    });
  }

  const rng = createSeededRng(
    canonicalHashSync({ purpose: "holon-tick-null", history: history.map((u) => u.text ?? "") })
  );
  const nullScores = [];
  for (let i = 0; i < permutations; i++) {
    const shuffled = seededShuffle(history, rng);
    const heldOut = shuffled[0];
    const rest = shuffled.slice(1);
    nullScores.push(forwardScore(heldOut, rest));
  }

  const observedScore = forwardScore(observation, history);
  const nullResult = deriveNull({
    nullSamples: nullScores,
    observedStatistic: observedScore,
    tailDirection: "greater",
    quantile,
    protocol: protocol ?? {
      name: "holon-tick-leave-one-out-novelty",
      iterations: permutations,
      scope: `conditioned on this holon's own ${history.length}-observation history`,
    },
  });

  const novelty = noveltyReserve(observation, history, nullResult.threshold);
  return Object.freeze({
    is_tick: novelty.isNew,
    score: novelty.score,
    null_result: nullResult,
    reason: novelty.reason,
  });
}

// ── History & hysteresis ─────────────────────────────────────────────────────
//
// An append-only log of genuine ticks only — never mutated (same discipline
// as `projectReferents`/`projectGraph`). "Does the relationship change over
// time" is a plain diff over this log; `checkHolonLevelStability` is the
// Zollman-delay-style hysteresis check (mirroring
// `../paradigm/index.js`'s `checkZollmanDelay`) that gates whether the most
// recent relation should be ACCEPTED as a real change, versus a single noisy
// flip.

export function appendHolonLevelTick(history, relationResult) {
  const prior = history ?? [];
  const tick = prior.length;
  return Object.freeze([
    ...prior,
    Object.freeze({
      tick,
      relation: relationResult.relation,
      existence: relationResult.existence,
      constraint: relationResult.constraint,
    }),
  ]);
}

export function checkHolonLevelStability({ history, quantile, permutations = 200 }) {
  if (!Array.isArray(history) || history.length === 0) {
    return Object.freeze({
      passed: false,
      reason: "no history — cannot check stability",
      stable_relation: null,
      run_length: 0,
      null_result: null,
    });
  }

  const relations = history.map((h) => h.relation);
  const latest = relations[relations.length - 1];

  let runLength = 0;
  for (let i = relations.length - 1; i >= 0; i--) {
    if (relations[i] !== latest) break;
    runLength += 1;
  }

  if (relations.length < 2) {
    return Object.freeze({
      passed: false,
      reason: "fewer than 2 ticks — insufficient evidence to accept a relation as stable",
      stable_relation: null,
      run_length: runLength,
      null_result: null,
    });
  }

  const rng = createSeededRng(canonicalHashSync({ purpose: "holon-level-stability-null", relations }));
  const nullRuns = [];
  for (let i = 0; i < permutations; i++) {
    const shuffled = seededShuffle(relations, rng);
    const tail = shuffled[shuffled.length - 1];
    let run = 0;
    for (let j = shuffled.length - 1; j >= 0; j--) {
      if (shuffled[j] !== tail) break;
      run += 1;
    }
    nullRuns.push(run);
  }

  const nullResult = deriveNull({
    nullSamples: nullRuns,
    observedStatistic: runLength,
    tailDirection: "greater",
    quantile,
    protocol: {
      name: "holon-level-zollman-stability",
      iterations: permutations,
      scope: `trailing run of "${latest}" across ${relations.length} ticks`,
    },
  });

  return Object.freeze({
    passed: nullResult.passed,
    stable_relation: nullResult.passed ? latest : null,
    run_length: runLength,
    null_result: nullResult,
    reason: nullResult.passed
      ? `"${latest}" holds for ${runLength} consecutive ticks — clears the Born-null threshold, accepted as stable`
      : `"${latest}" holds for only ${runLength} consecutive ticks — does not clear the Born-null threshold (${nullResult.threshold.toFixed(1)}), may be a single noisy flip`,
  });
}
