import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { walkForward } from "../../prediction/tasks/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { commitPrediction, revealAndScore } from "../../prediction/commitments/index.js";
import { createLedger, recordStep, finalizeCompetency, competencyGain } from "../../competency/ledger/index.js";
import { enumeratePrograms, predictWith, descriptionLength, canonicalKey } from "../expressions/index.js";

const SCORING_RULE = "crps";

function lossFor(commitment, observed, revealed_at_step) {
  const s = revealAndScore({ commitment, observed, revealed_at_step, scoring_rule: SCORING_RULE });
  if (s.loss !== null) return { loss: s.loss, proper: s.proper };
  const fallback = revealAndScore({ commitment, observed, revealed_at_step, scoring_rule: "absolute-error" });
  return { loss: fallback.loss, proper: false };
}

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

export function searchCompetentPrograms(series, {
  warmup,
  lambda,
  referenceBaselineId = "baseline:global-mean",
  enumeration = {},
  seasonalPeriod,
  population = "series:anonymous",
} = {}) {
  const n = series.length;
  const resolvedWarmup = warmup ?? Math.ceil(Math.sqrt(n));
  const resolvedLambda = lambda ?? 1 / n;

  if (!Array.isArray(series) || series.length <= resolvedWarmup + 1) throw new TypeError("programs: series too short for the requested warmup");
  const baselines = defaultNumericBaselines({ window: Math.max(3, Math.floor(Math.sqrt(n))), seasonalPeriod });
  const programs = enumeratePrograms(enumeration);
  const sourceVersion = canonicalHashSync(series);
  const taskId = `task:${canonicalHashSync({ population, sourceVersion, warmup: resolvedWarmup, rule: SCORING_RULE })}`;

  const ranked = programs.map((program) => {
    const { competency, gain } = evaluateProgramCompetency(series, program, { baselines, warmup: resolvedWarmup, taskId, population, sourceVersion });
    const dl = descriptionLength(program);
    const reference_gain = gain[referenceBaselineId] ?? 0;
    return {
      program,
      key: canonicalKey(program),
      description_length: dl,
      reference_gain,
      utility: reference_gain - resolvedLambda * dl,
      competency,
      gain,
    };
  });

  return ranked.sort((a, b) => b.utility - a.utility || a.description_length - b.description_length || a.key.localeCompare(b.key));
}
