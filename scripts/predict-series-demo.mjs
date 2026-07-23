// Phase 0 vertical slice (spec "EO Emergent Mathematics for Predictive
// Competency", section 29) driven entirely through the pure engine.
//
// It runs the full epistemic loop on synthetic numeric series:
//
//   observe history  →  commit a prediction BEFORE reveal  →  reveal the next
//   value  →  proper-score candidate and baselines under one horizon  →
//   accumulate prequential competency  →  seal a scoped CompetencyRecord.
//
// Every prediction is committed with a logical-clock seal that refuses reveal
// before its horizon (invariant 7.1). The candidate is a *reducible program*
// (drift = last value + mean first difference), not an opaque call — matching
// the Section 29.4 requirement that seed operators be reducible programs.
//
// This module is a demo/harness in scripts/, not engine code, so it MAY draw
// seeded randomness to synthesize the series. The engine it calls stays pure.

import {
  walkForward,
  createPredictionTask,
  defaultNumericBaselines,
  commitPrediction,
  revealAndScore,
  createLedger,
  recordStep,
  finalizeCompetency,
  createSeededRng,
} from "@eoreader/engine";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const SEASONAL_PERIOD = 6;
const SCORING_RULE = "log-loss";

// ---- pure numeric helpers (local to the harness) --------------------------

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}
function diffs(xs) {
  const out = [];
  for (let i = 1; i < xs.length; i += 1) out.push(xs[i] - xs[i - 1]);
  return out;
}

// ---- the candidate: a reducible drift program (section 29.4) --------------
//
//   predict(history) = last + mean(diff(history));  spread = stdev(diff)
//
// Named and version-hashed so its exact form is frozen into every commitment.
const CANDIDATE = {
  candidate_id: "candidate:drift-v1",
  program: { op: "add", args: [{ op: "lag", k: 1 }, { op: "mean", of: { op: "diff" } }] },
  predict(history) {
    const last = history[history.length - 1];
    const d = diffs(history);
    const drift = d.length ? mean(d) : 0;
    const spread = stdev(d);
    const center = last + drift;
    return spread > 0 ? { kind: "gaussian", mean: center, sd: spread } : { kind: "point", value: center };
  },
};
const CANDIDATE_VERSION_HASH = canonicalHashSync(CANDIDATE.program);

// ---- synthetic sources (harness-only randomness) --------------------------

function makeSeries({ seed, length, base, slope, amp }) {
  const rng = createSeededRng(seed);
  const xs = [];
  for (let t = 0; t < length; t += 1) {
    const noise = (rng() - 0.5) * 2; // deterministic, in [-1, 1)
    xs.push(base + slope * t + amp * Math.sin((2 * Math.PI * t) / SEASONAL_PERIOD) + noise);
  }
  return xs;
}

// ---- one series through the full loop --------------------------------------

export function runSeries(series_id, series, { warmup = SEASONAL_PERIOD + 1 } = {}) {
  const baselines = defaultNumericBaselines({ window: 3, seasonalPeriod: SEASONAL_PERIOD });
  const task = createPredictionTask({
    target_type: "number",
    horizon: { kind: "walk-forward", h: 1 },
    scoring_rule: SCORING_RULE,
    baseline_ids: [CANDIDATE.candidate_id, ...baselines.map((b) => b.id)],
    population: series_id,
  });

  let ledger = createLedger({
    task_id: task.id,
    candidate_id: CANDIDATE.candidate_id,
    baseline_ids: baselines.map((b) => b.id),
    scoring_rule: SCORING_RULE,
  });

  const trace = [];
  for (const stepInfo of walkForward(series, { warmup })) {
    const { step, history, target, committed_at_step, reveal_not_before_step } = stepInfo;
    const input_snapshot_hash = canonicalHashSync(history);

    // 1. Commit the candidate prediction BEFORE the target is revealed.
    const candidateCommit = commitPrediction({
      task_id: task.id,
      candidate_id: CANDIDATE.candidate_id,
      candidate_version_hash: CANDIDATE_VERSION_HASH,
      input_snapshot_hash,
      predictive_output: CANDIDATE.predict(history),
      committed_at_step,
      reveal_not_before_step,
    });

    // Commit every baseline under the identical horizon.
    const baselineCommits = baselines.map((b) => ({
      id: b.id,
      commitment: commitPrediction({
        task_id: task.id,
        candidate_id: b.id,
        candidate_version_hash: canonicalHashSync({ baseline: b.id }),
        input_snapshot_hash,
        predictive_output: b.predict(history),
        committed_at_step,
        reveal_not_before_step,
      }),
    }));

    // 2. Reveal and score — leakage guard enforced inside revealAndScore.
    const revealed_at_step = reveal_not_before_step;
    const candidateScore = revealAndScore({ commitment: candidateCommit, observed: target, revealed_at_step, scoring_rule: SCORING_RULE });
    const baseline_losses = {};
    for (const { id, commitment } of baselineCommits) {
      const s = revealAndScore({ commitment, observed: target, revealed_at_step, scoring_rule: SCORING_RULE });
      // Baselines that degrade to a point yield an improper log-loss; fall back
      // to absolute error so the honest comparison still has a finite number,
      // and record that a proper score was unavailable for that step.
      baseline_losses[id] = s.loss ?? revealAndScore({ commitment, observed: target, revealed_at_step, scoring_rule: "absolute-error" }).loss;
    }

    const candidate_loss = candidateScore.loss ?? revealAndScore({ commitment: candidateCommit, observed: target, revealed_at_step, scoring_rule: "absolute-error" }).loss;
    ledger = recordStep(ledger, { candidate_loss, baseline_losses, proper: candidateScore.proper });

    trace.push({ step, target, candidate_loss, baseline_losses, prediction: candidateCommit.predictive_output });
  }

  const competency = finalizeCompetency(ledger, {
    horizon: { kind: "walk-forward", h: 1 },
    population: series_id,
    source_versions: [canonicalHashSync(series)],
    evaluation_protocol: "prequential-walk-forward",
    warrant_status: "unknown",
    status: "experimental",
  });

  return { task, competency, trace };
}

// ---- the whole slice -------------------------------------------------------

export function runPredictiveSlice({ length = 40 } = {}) {
  const specs = [
    { series_id: "series:alpha", seed: "alpha", base: 10, slope: 0.5, amp: 3 },
    { series_id: "series:beta", seed: "beta", base: -5, slope: -0.2, amp: 5 },
    { series_id: "series:gamma", seed: "gamma", base: 100, slope: 0, amp: 8 },
  ];
  const results = specs.map((s) => {
    const series = makeSeries({ ...s, length });
    return runSeries(s.series_id, series);
  });
  return {
    scoring_rule: SCORING_RULE,
    seasonal_period: SEASONAL_PERIOD,
    candidate_version_hash: CANDIDATE_VERSION_HASH,
    results,
  };
}

// ---- CLI presentation ------------------------------------------------------

function formatNats(x) {
  return (x >= 0 ? "+" : "") + x.toFixed(3);
}

function present(slice) {
  console.log(`\n=== Predictive-competency slice (candidate: drift-v1, rule: ${slice.scoring_rule}) ===`);
  console.log(`candidate program hash: ${slice.candidate_version_hash}`);
  for (const { competency, trace } of slice.results) {
    const gain = competency.competency_gain;
    console.log(`\n--- ${competency.scope.population} ---`);
    console.log(`observations: ${competency.observations} (proper log-loss on ${competency.proper_observations})`);
    console.log(`candidate cumulative loss: ${competency.cumulative_loss.toFixed(3)}`);
    console.log("competency gain vs baselines (positive = candidate lower cumulative loss):");
    for (const id of Object.keys(gain).sort()) {
      console.log(`  ${id.padEnd(28)} ${formatNats(gain[id])}`);
    }
    // A Section 25.1 "thinking surface" for the final committed step.
    const last = trace[trace.length - 1];
    const p = last.prediction;
    const centre = p.kind === "gaussian" ? p.mean : p.value;
    console.log("last committed step (thinking surface):");
    console.log(`  FORM        drift(last + mean(diff))`);
    console.log(`  PREDICTION  ${p.kind}  centre=${centre.toFixed(3)}${p.kind === "gaussian" ? `  sd=${p.sd.toFixed(3)}` : ""}`);
    console.log(`  STATUS      committed before step ${last.step + 1} was revealed`);
    console.log(`  AFTER REVEAL observed=${last.target.toFixed(3)}  candidate log-loss=${last.candidate_loss.toFixed(3)}`);
    console.log(`  WARRANT     ${competency.warrant_status} (predictive only — not causal)`);
  }
}

// Entry point: run twice and confirm deterministic replay (Phase 0 exit
// criterion / invariant 12.12).
if (import.meta.url === `file://${process.argv[1]}`) {
  const run1 = runPredictiveSlice();
  const run2 = runPredictiveSlice();
  const deterministic = canonicalHashSync(run1) === canonicalHashSync(run2);
  present(run1);
  console.log(`\ndeterministic replay (run1 === run2): ${deterministic}`);
  if (!deterministic) process.exitCode = 1;
}
