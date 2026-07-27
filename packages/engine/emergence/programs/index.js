import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { walkForward } from "../../prediction/tasks/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { commitPrediction, revealAndScore } from "../../prediction/commitments/index.js";
import { createLedger, recordStep, finalizeCompetency, competencyGain } from "../../competency/ledger/index.js";
import { enumeratePrograms, mutatePrograms, predictWith, descriptionLength, canonicalKey } from "../expressions/index.js";

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
  library = [],
  seasonalPeriod,
  population = "series:anonymous",
} = {}) {
  const n = series.length;
  const resolvedWarmup = warmup ?? Math.ceil(Math.sqrt(n));
  const resolvedLambda = lambda ?? 1 / n;

  if (!Array.isArray(series) || series.length <= resolvedWarmup + 1) throw new TypeError("programs: series too short for the requested warmup");
  const baselines = defaultNumericBaselines({ window: Math.max(3, Math.floor(Math.sqrt(n))), seasonalPeriod });
  let programs;
  const seeds = enumeratePrograms(enumeration);
  const seedLib = seeds.map((s) => ({ program: s }));
  if (library.length > 0) {
    // Round 1+: mutate the promoted operators AND the fresh seeds, composing
    // both against the promoted library (as opref nodes). The seeds must
    // re-enter the pool: the productive helix composition is a promoted
    // structure joined with a reducer it has not absorbed yet — e.g.
    // add(mean(diff(hist)), opref(promoted)) — and that program is
    // unreachable from library-only mutation.
    programs = mutatePrograms([...library, ...seedLib], { composeWith: library });
  } else {
    // Round 0: seed programs plus mutations of seeds (bootstrapping).
    // Seeds have no id so mutateProgram uses inline references (not opref).
    const mutants = mutatePrograms(seedLib);
    // Dedup: include all unique seeds and mutants
    const seen = new Set();
    const all = [];
    for (const p of [...seeds, ...mutants]) {
      const key = canonicalKey(p);
      if (!seen.has(key)) { seen.add(key); all.push(p); }
    }
    programs = all;
  }
  // The pool is capped at the enumeration's maxPrograms, simplest first —
  // mutatePrograms returns description-length order already, and round 0's
  // seeds are simpler than every mutant derived from them.
  const maxPrograms = enumeration.maxPrograms;
  if (Number.isFinite(maxPrograms) && maxPrograms > 0 && programs.length > maxPrograms) {
    programs = programs.slice(0, maxPrograms);
  }
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
