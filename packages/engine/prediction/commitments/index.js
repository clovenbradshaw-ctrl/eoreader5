// Prediction commitment and leakage-safe reveal (spec invariant 7.1
// "prediction before revelation", section 6.13, section 12.6, record 22.2).
//
// A result counts as predictive evidence only if the exact prediction was
// persisted *before* the target became visible to the predicting process. The
// engine is pure and MUST NOT read ambient time (docs/invariants.md), so the
// ordering that makes "before" meaningful is a caller-supplied logical clock:
// an integer step index from the prequential walk-forward. A commitment
// declares the earliest step at which its target may be revealed
// (`reveal_not_before_step`); reveal at any earlier step is refused as
// leakage. The commitment is sealed with a content hash so it cannot be edited
// after the fact and re-passed as if it were the original.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { score } from "../scoring/index.js";

const SUPPORTED_KINDS = new Set(["point", "gaussian", "categorical", "quantiles", "samples"]);

function assertStep(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`commitments: ${label} must be a non-negative integer step`);
}

function assertPredictiveOutput(dist) {
  if (!dist || typeof dist !== "object" || Array.isArray(dist)) throw new TypeError("commitments: predictive_output must be an object");
  if (!SUPPORTED_KINDS.has(dist.kind)) throw new TypeError(`commitments: unsupported predictive_output kind ${dist.kind}`);
}

/**
 * Freeze and seal a prediction before its target is revealed (section 22.2).
 * The returned record is immutable; its `commitment_hash` is the canonical
 * hash of every committed field, so any later mutation is detectable.
 *
 * @param {object} c
 * @param {string} c.task_id
 * @param {string} c.candidate_id
 * @param {string} c.candidate_version_hash - identifies the exact program version.
 * @param {string} c.input_snapshot_hash - hash of the history the prediction saw.
 * @param {string[]} [c.active_prior_hashes] - priors frozen into this commitment.
 * @param {object} c.predictive_output - the tagged predictive distribution.
 * @param {number} c.committed_at_step - logical step at which the prediction was made.
 * @param {number} c.reveal_not_before_step - earliest step the target may be revealed.
 */
export function commitPrediction(c) {
  if (!c || typeof c !== "object") throw new TypeError("commitments: commitment input must be an object");
  if (typeof c.task_id !== "string" || !c.task_id) throw new TypeError("commitments: task_id is required");
  if (typeof c.candidate_id !== "string" || !c.candidate_id) throw new TypeError("commitments: candidate_id is required");
  if (typeof c.candidate_version_hash !== "string" || !c.candidate_version_hash) throw new TypeError("commitments: candidate_version_hash is required");
  if (typeof c.input_snapshot_hash !== "string" || !c.input_snapshot_hash) throw new TypeError("commitments: input_snapshot_hash is required");
  assertPredictiveOutput(c.predictive_output);
  assertStep(c.committed_at_step, "committed_at_step");
  assertStep(c.reveal_not_before_step, "reveal_not_before_step");
  if (c.reveal_not_before_step <= c.committed_at_step) {
    throw new RangeError("commitments: reveal_not_before_step must be strictly after committed_at_step (a prediction cannot be revealed at or before it is committed)");
  }
  const activePriors = Array.isArray(c.active_prior_hashes) ? [...c.active_prior_hashes] : [];

  const body = {
    schema: "PredictionCommitment@1",
    task_id: c.task_id,
    candidate_id: c.candidate_id,
    candidate_version_hash: c.candidate_version_hash,
    input_snapshot_hash: c.input_snapshot_hash,
    active_prior_hashes: activePriors,
    predictive_output: c.predictive_output,
    committed_at_step: c.committed_at_step,
    reveal_not_before_step: c.reveal_not_before_step,
  };
  const commitment_hash = canonicalHashSync(body);
  return Object.freeze({
    ...body,
    active_prior_hashes: Object.freeze(activePriors),
    predictive_output: Object.freeze({ ...c.predictive_output }),
    commitment_id: `commitment:${commitment_hash}`,
    commitment_hash,
  });
}

/**
 * Reveal a target and score the committed prediction against it. Refuses to
 * score if:
 *   - the commitment has been tampered with (its hash no longer matches), or
 *   - the reveal happens before `reveal_not_before_step` (invariant 7.1: the
 *     target would have been visible earlier than the horizon allowed).
 *
 * Returns a frozen score record { commitment_id, task_id, candidate_id,
 * observed, revealed_at_step, loss, rule, proper, note? }.
 */
export function revealAndScore({ commitment, observed, revealed_at_step, scoring_rule = "log-loss" }) {
  if (!commitment || typeof commitment !== "object") throw new TypeError("commitments: commitment is required");
  const { commitment_hash, commitment_id, predictive_output, ...rest } = commitment;
  const body = {
    schema: rest.schema,
    task_id: rest.task_id,
    candidate_id: rest.candidate_id,
    candidate_version_hash: rest.candidate_version_hash,
    input_snapshot_hash: rest.input_snapshot_hash,
    active_prior_hashes: [...(rest.active_prior_hashes ?? [])],
    predictive_output,
    committed_at_step: rest.committed_at_step,
    reveal_not_before_step: rest.reveal_not_before_step,
  };
  if (canonicalHashSync(body) !== commitment_hash) {
    throw new Error("commitments: commitment_hash mismatch — this prediction was altered after it was sealed");
  }
  assertStep(revealed_at_step, "revealed_at_step");
  if (revealed_at_step < commitment.reveal_not_before_step) {
    throw new Error(
      `commitments: leakage refused — target revealed at step ${revealed_at_step} but the commitment is not eligible before step ${commitment.reveal_not_before_step}`
    );
  }
  const scored = score(predictive_output, observed, { rule: scoring_rule });
  return Object.freeze({
    commitment_id,
    task_id: commitment.task_id,
    candidate_id: commitment.candidate_id,
    observed,
    revealed_at_step,
    loss: scored.loss,
    rule: scored.rule,
    proper: scored.proper,
    ...(scored.note ? { note: scored.note } : {}),
  });
}
