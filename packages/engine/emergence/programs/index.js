// Competency-ranked program search (spec "EO Emergent Mathematics for
// Predictive Competency" sections 14 and 29.5-29.6). Ties the bounded typed
// enumerator (../expressions) to the Phase 0 competency substrate: every
// enumerated program is scored prequentially against the same baselines, under
// the same leakage-safe commit-before-reveal protocol, and ranked by a
// description-length-penalized utility (section 13.5). Pure and deterministic —
// no ambient time, no randomness, no promotion decision.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { walkForward } from "../../prediction/tasks/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { commitPrediction, revealAndScore } from "../../prediction/commitments/index.js";
import { createLedger, recordStep, finalizeCompetency, competencyGain } from "../../competency/ledger/index.js";
import { enumeratePrograms, predictWith, descriptionLength, canonicalKey } from "../expressions/index.js";

// CRPS is the ranking score for program search: it is a proper scoring rule
// (section 13.1) but, unlike log-loss, it stays well-behaved when a program's
// self-derived spread is small or momentarily miscalibrated — so an accurate
// sharp forecaster is rewarded instead of being punished by a single
// low-density outlier during early warmup.
const SCORING_RULE = "crps";

// A finite loss for the ledger even when a proper score is unavailable for the
// emitted kind: fall back to absolute error and mark the step improper.
function lossFor(commitment, observed, revealed_at_step) {
  const s = revealAndScore({ commitment, observed, revealed_at_step, scoring_rule: SCORING_RULE });
  if (s.loss !== null) return { loss: s.loss, proper: s.proper };
  const fallback = revealAndScore({ commitment, observed, revealed_at_step, scoring_rule: "absolute-error" });
  return { loss: fallback.loss, proper: false };
}

/**
 * Evaluate one program on one series via prequential walk-forward against the
 * given baselines. Returns { competency, gain } where competency is a sealed
 * CompetencyRecord and gain is the per-baseline competency gain.
 */
export function evaluateProgramCompetency(series, program, { baselines, warmup, taskId, population, sourceVersion }) {
  const candidate_id = `candidate:${canonicalKey(program)}`;
  const candidate_version_hash = canonicalHashSync(program);
  let ledger = createLedger({
    task_id: taskId,
    candidate_id,
    baseline_ids: baselines.map((b) => b.id),
    scoring_rule: SCORING_RULE,
  });

  for (const { history, target, committed_at_step, reveal_not_before_step } of walkForward(series, { warmup })) {
    const input_snapshot_hash = canonicalHashSync(history);
    const output = predictWith(program, history, { warmup: 2 });
    if (output === null) {
      // The program yields no forecast for this history (e.g. degenerate
      // window). Skip the step honestly rather than fabricate a number.
      continue;
    }
    const candidateCommit = commitPrediction({
      task_id: taskId,
      candidate_id,
      candidate_version_hash,
      input_snapshot_hash,
      predictive_output: output,
      committed_at_step,
      reveal_not_before_step,
    });
    const baseline_losses = {};
    for (const b of baselines) {
      const c = commitPrediction({
        task_id: taskId,
        candidate_id: b.id,
        candidate_version_hash: canonicalHashSync({ baseline: b.id }),
        input_snapshot_hash,
        predictive_output: b.predict(history),
        committed_at_step,
        reveal_not_before_step,
      });
      baseline_losses[b.id] = lossFor(c, target, reveal_not_before_step).loss;
    }
    const { loss, proper } = lossFor(candidateCommit, target, reveal_not_before_step);
    ledger = recordStep(ledger, { candidate_loss: loss, baseline_losses, proper });
  }

  const competency = finalizeCompetency(ledger, {
    horizon: { kind: "walk-forward", h: 1 },
    population,
    source_versions: [sourceVersion],
    evaluation_protocol: "prequential-walk-forward",
    warrant_status: "unknown",
    status: "experimental",
  });
  return { competency, gain: competencyGain(ledger) };
}

/**
 * Search enumerated programs on a series and return a ranked frontier.
 *
 * Utility (spec 13.5) = competency gain against the reference baseline
 * − lambda · description length. The reference baseline defaults to the global
 * mean, so a program earns rank only by beating a genuinely simple predictor,
 * not by beating a deliberately weak one (invariant, section 13.4).
 *
 * @returns {object[]} ranked list of { program, key, description_length,
 *   reference_gain, utility, competency, gain }, best first.
 */
export function searchCompetentPrograms(series, {
  warmup = 4,
  lambda = 0.05,
  referenceBaselineId = "baseline:global-mean",
  enumeration = {},
  seasonalPeriod,
  population = "series:anonymous",
} = {}) {
  if (!Array.isArray(series) || series.length <= warmup + 1) throw new TypeError("programs: series too short for the requested warmup");
  const baselines = defaultNumericBaselines({ window: 3, seasonalPeriod });
  const programs = enumeratePrograms(enumeration);
  const sourceVersion = canonicalHashSync(series);
  const taskId = `task:${canonicalHashSync({ population, sourceVersion, warmup, rule: SCORING_RULE })}`;

  const ranked = programs.map((program) => {
    const { competency, gain } = evaluateProgramCompetency(series, program, { baselines, warmup, taskId, population, sourceVersion });
    const dl = descriptionLength(program);
    const reference_gain = gain[referenceBaselineId] ?? 0;
    return {
      program,
      key: canonicalKey(program),
      description_length: dl,
      reference_gain,
      utility: reference_gain - lambda * dl,
      competency,
      gain,
    };
  });

  return ranked.sort((a, b) => b.utility - a.utility || a.description_length - b.description_length || a.key.localeCompare(b.key));
}
