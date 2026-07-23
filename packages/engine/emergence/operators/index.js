// Operator induction: the REC -> INS seam (spec "EO Emergent Mathematics for
// Predictive Competency" sections 11.2 "derived operator", 15.3 "compression
// into operators", and the Level-0..4 recursion of section 11).
//
// This is the move that turns the ranked frontier into a running helix. One
// pass of the nine operators ends at REC — preserve / revise / promote. Here
// REC actually restructures the search grammar: a competent *composition* is
// minted as a reusable operator and re-enters enumeration as a cost-1 `opref`
// primitive (INS at the top of the next pass). Because the same nine moves now
// range over an enlarged vocabulary, the next pass can reach structures the
// previous one could not — without any new mechanism. That recursion, not a
// special generator, is the content of "emergent mathematics" here.
//
// Two honesty constraints the spec and this repo impose, both reused rather
// than reinvented:
//
//   * Lens-explicit competency (invariant 7.5). Surprise is undefined without a
//     distribution to be surprised against, so every promoted operator names
//     the lens it won under — target, horizon, and the reference baseline it
//     beat. "Surprising relative to what" is a stored field, not an argument.
//
//   * Born-null promotion (section 12.8; ../nulls). No gate compares a statistic
//     to a hand-set constant. The threshold is derived from an explicit
//     perturbation of the actual data: we shuffle the series to destroy its
//     temporal order and promote only when the operator's real competency gain
//     clears what that null rarely exceeds. A program that merely fits noise
//     scores no better on the real order than on a shuffle, and is refused.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { searchCompetentPrograms, evaluateProgramCompetency } from "../programs/index.js";
import { evaluateProgram } from "../expressions/index.js";

const BINARY_COMBINATORS = new Set(["add", "sub", "mul", "div"]);

/**
 * A promotable operator must combine two *structural* sub-results (section 11.2:
 * "not new merely because rediscovered"; section 22.4 variant vs candidate_novel).
 * A bare reducer is base vocabulary, and `reducer ± const` is a fitted parameter
 * — a variant, not a new operator. So the top node must be a binary combinator
 * and neither operand may be a constant.
 */
function isPromotableComposition(node) {
  if (!node || !BINARY_COMBINATORS.has(node.op)) return false;
  if (node.a?.op === "const" || node.b?.op === "const") return false;
  return true;
}

/**
 * Behavioral fingerprint of a program on a series: its one-step forecasts over
 * every walk-forward prefix, rounded to damp float noise, then hashed. Two
 * programs with the same fingerprint are behaviorally equivalent ON THIS DATA
 * (section 15.2: empirical agreement is not universal proof — recorded as
 * such, never as a universal equivalence).
 */
function behavioralFingerprint(program, series, warmup) {
  const forecasts = [];
  for (let i = Math.max(1, warmup); i < series.length; i += 1) {
    const f = evaluateProgram(program, series.slice(0, i));
    forecasts.push(f === null ? null : Math.round(f * 1e6) / 1e6);
  }
  return canonicalHashSync(forecasts);
}

/**
 * Reference competency gain of a program on a series, scoring only the steps
 * from `warmup` onward. With `warmup = fitLen` this measures HELD-OUT transfer:
 * the program uses the fit history to predict the unseen tail (invariant 7.6,
 * section 20.2). With a small warmup it measures in-sample gain.
 */
function referenceGain(series, program, referenceBaseline, warmup, tag) {
  const { gain } = evaluateProgramCompetency(series, program, {
    baselines: [referenceBaseline],
    warmup,
    taskId: `task:null:${tag}`,
    population: `null:${tag}`,
    sourceVersion: canonicalHashSync(series),
  });
  return gain[referenceBaseline.id] ?? 0;
}

/**
 * Born-null gate for one candidate program (section 12.8). Perturbation:
 * `shuffles` seeded shuffles of the series, each destroying temporal order.
 * Statistic: reference competency gain. Promote only if the real-order gain
 * clears the derived upper quantile of the shuffled null.
 */
function bornNullGate(series, program, referenceBaseline, { warmup, shuffles, quantile }) {
  const seed = canonicalHashSync({ series, program, purpose: "operator-promotion-null" });
  const rng = createSeededRng(seed);
  const nullSamples = [];
  for (let i = 0; i < shuffles; i += 1) {
    const shuffled = seededShuffle(series, rng);
    nullSamples.push(referenceGain(shuffled, program, referenceBaseline, warmup, `${i}`));
  }
  const observed = referenceGain(series, program, referenceBaseline, warmup, "real");
  return deriveNull({
    nullSamples,
    observedStatistic: observed,
    tailDirection: "greater",
    quantile,
    protocol: { name: "series-shuffle", iterations: shuffles, statistic: "reference-competency-gain", scope: "temporal-order" },
  });
}

/**
 * Induce operators from a series by running the helix repeatedly, promoting a
 * competent composition into the vocabulary each round until a round promotes
 * nothing (loop-until-dry) or a budget is hit.
 *
 * @param {number[]} series
 * @param {object} [opts]
 * @param {number} [opts.warmup=6]
 * @param {number} [opts.maxRounds=3]
 * @param {number} [opts.maxOperators=4]
 * @param {number} [opts.candidatesPerRound=3] - top novel candidates gated per round.
 * @param {number} [opts.shuffles=40] - null-distribution size for the gate.
 * @param {number} [opts.quantile=0.95] - null quantile the real gain must clear.
 * @param {number} [opts.fitFraction=0.7] - leading fraction used to propose and
 *   run the born-null; the trailing remainder is held out for the transfer gate.
 * @param {string} [opts.referenceBaselineId="baseline:global-mean"]
 * @param {number} [opts.seasonalPeriod]
 * @param {string} [opts.population="series:anonymous"]
 * @param {object} [opts.enumeration] - base enumeration options (library is managed internally).
 * @returns {object} { operators, rounds, library, finalFrontier }
 */
export function induceOperators(series, {
  warmup = 6,
  maxRounds = 3,
  maxOperators = 4,
  candidatesPerRound = 3,
  shuffles = 40,
  quantile = 0.95,
  fitFraction = 0.7,
  referenceBaselineId = "baseline:global-mean",
  seasonalPeriod,
  population = "series:anonymous",
  enumeration = {},
} = {}) {
  if (!Array.isArray(series) || series.length <= warmup + 2) throw new TypeError("operators: series too short for the requested warmup");
  const fitLen = Math.floor(series.length * fitFraction);
  if (fitLen <= warmup + 1 || series.length - fitLen < 2) {
    throw new TypeError("operators: series too short to hold out a transfer segment at this warmup/fitFraction");
  }
  // Proposal and the born-null see only the fit segment; the trailing segment is
  // reserved for the transfer gate (invariant 7.6, section 20.2).
  const fitSeries = series.slice(0, fitLen);
  const baselines = defaultNumericBaselines({ window: 3, seasonalPeriod });
  const referenceBaseline = baselines.find((b) => b.id === referenceBaselineId);
  if (!referenceBaseline) throw new TypeError(`operators: unknown reference baseline ${referenceBaselineId}`);

  const library = [];
  const operators = [];
  const known = new Set(); // behavioral fingerprints already accounted for (seeds + promoted)
  const promotedKeys = new Set();
  const rounds = [];

  let finalFrontier = [];
  for (let round = 0; round < maxRounds && operators.length < maxOperators; round += 1) {
    const ranked = searchCompetentPrograms(fitSeries, {
      warmup,
      referenceBaselineId,
      seasonalPeriod,
      population,
      enumeration: { ...enumeration, library },
    });
    finalFrontier = ranked;

    // Seed the "known" set once, from the atomic reducers this round exposes,
    // so a composition equivalent to an existing primitive is never promoted
    // (section 7.9 canonicalization before novelty, section 22.4 equivalent_known).
    if (round === 0) {
      for (const r of ranked) if (r.description_length <= 2) known.add(behavioralFingerprint(r.program, fitSeries, warmup));
    }

    const roundLog = { round, considered: ranked.length, promoted: [] };

    for (const r of ranked) {
      if (operators.length >= maxOperators) break;
      if (roundLog.promoted.length >= candidatesPerRound) break;
      // A candidate must combine two structural sub-results (not a bare reducer
      // or a `reducer ± const` variant) and improve on the reference in-sample.
      if (!isPromotableComposition(r.program) || r.reference_gain <= 0) continue;
      if (promotedKeys.has(r.key)) continue;
      const fingerprint = behavioralFingerprint(r.program, fitSeries, warmup);
      if (known.has(fingerprint)) continue; // behaviorally equivalent to something known

      // Transfer gate (invariant 7.6): the operator must still beat the
      // reference on the held-out tail it never saw. An in-sample bias (e.g. a
      // constant offset that happens to help on this noise realization) does not
      // generalize and is refused here even if it clears the structure null.
      const transfer_gain = referenceGain(series, r.program, referenceBaseline, fitLen, `transfer:${r.key}`);
      if (transfer_gain <= 0) continue;

      const nullResult = bornNullGate(fitSeries, r.program, referenceBaseline, { warmup, shuffles, quantile });
      if (!nullResult.passed) continue; // fits chance no better than the shuffled null — refused

      // Promote: mint a reusable operator (INS on re-entry), carrying its lens.
      const operator = mintOperator(r, {
        round,
        nullResult,
        transfer_gain,
        referenceBaselineId,
        baselineIds: baselines.map((b) => b.id),
        population,
      });
      operators.push(operator);
      library.push({ id: operator.id, program: operator.canonical_program });
      known.add(fingerprint);
      promotedKeys.add(r.key);
      roundLog.promoted.push(operator.id);
    }

    rounds.push(roundLog);
    if (roundLog.promoted.length === 0) break; // dry round: the helix has converged
  }

  return { operators, rounds, library, finalFrontier };
}

/** Build a content-addressed OperatorCandidate record (section 22.4) with epoch provenance. */
function mintOperator(rankedEntry, { round, nullResult, transfer_gain, referenceBaselineId, baselineIds, population }) {
  const body = {
    schema: "OperatorCandidate@1",
    canonical_program: rankedEntry.program,
    description_length: rankedEntry.description_length,
    input_types: ["number[]"],
    output_type: "number",
    novelty_status: "candidate_novel",
    reference_baseline_id: referenceBaselineId,
    reference_gain: rankedEntry.reference_gain,
    transfer_gain,
    // The lens this operator won under — "surprising relative to what": target,
    // horizon, the baselines it was scored against, and the population. Stored,
    // not argued (the second-message point made concrete).
    lens: {
      target_type: "number",
      horizon: { kind: "walk-forward", h: 1 },
      scoring_rule: "crps",
      baseline_ids: baselineIds,
      population,
    },
    promotion_null: nullResult,
    competency: rankedEntry.competency,
    // The operator-epoch acts this record embodies: a REC promoted it (the frame
    // was restructured — a new grammar move exists), and it re-enters the next
    // pass as an INS (a stable instance minted into the vocabulary).
    emergence: {
      operator_epoch: CURRENT_OPERATOR_EPOCH,
      promoted_by: "REC",
      reenters_as: "INS",
      round,
    },
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, id: `operator:${content_hash}`, content_hash });
}

export { behavioralFingerprint };
