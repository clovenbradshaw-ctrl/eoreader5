// Prediction task construction and the prequential walk-forward driver (spec
// section 12.2 "target and horizon construction" and record 22.1). There is no
// untyped "predict what happens next": a task names its target type, horizon,
// scoring rule, baselines, evaluation population, and reveal procedure.
//
// The walk-forward driver is a pure generator over an explicit series. It
// yields one step at a time as { step, history, target, reveal_not_before_step }
// where `history` is everything legally visible at that step and `target` is
// the withheld next value. The caller commits a prediction from `history`
// before ever reading `target` — the ordering the commitment's logical clock
// enforces (see ../commitments).

import { canonicalHashSync } from "@eoreader/spec/canonical-json";

/**
 * Build a content-addressed PredictionTask record (record 22.1).
 *
 * @param {object} t
 * @param {string} t.target_type - e.g. "number".
 * @param {object} t.horizon - horizon spec, e.g. { kind: "walk-forward", h: 1 }.
 * @param {string} t.scoring_rule - default rule for the task.
 * @param {string[]} t.baseline_ids
 * @param {string} t.population - evaluation population identifier.
 * @param {string} [t.leakage_policy] - short description of the leakage guard.
 * @param {object[]} [t.provenance]
 */
export function createPredictionTask(t) {
  if (!t || typeof t !== "object") throw new TypeError("tasks: task input must be an object");
  for (const field of ["target_type", "horizon", "scoring_rule", "baseline_ids", "population"]) {
    if (t[field] === undefined) throw new TypeError(`tasks: PredictionTask must declare ${field} (section 12.2)`);
  }
  if (!Array.isArray(t.baseline_ids) || t.baseline_ids.length === 0) throw new TypeError("tasks: a task must declare at least one baseline (section 13.4)");
  const body = {
    schema: "PredictionTask@1",
    target_type: t.target_type,
    horizon: t.horizon,
    scoring_rule: t.scoring_rule,
    baseline_ids: [...t.baseline_ids],
    population: t.population,
    leakage_policy: t.leakage_policy ?? "prequential: target withheld until reveal_not_before_step",
    provenance: Array.isArray(t.provenance) ? [...t.provenance] : [],
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, id: `task:${content_hash}`, content_hash });
}

/**
 * Pure prequential walk-forward over a numeric `series`. Starting at index
 * `warmup`, yields one step per withheld target. `history` is a fresh copy of
 * series[0..i-1]; `target` is series[i]. The logical clock is the step index i
 * itself: a prediction committed at step i must declare reveal_not_before_step
 * = i + 1, and the target at index i is revealed at step i + 1.
 *
 * @param {number[]} series
 * @param {object} [opts]
 * @param {number} [opts.warmup=1] - first index to predict (needs some history).
 * @param {number} [opts.horizon=1] - forecast horizon h (only h=1 supported here).
 */
export function* walkForward(series, { warmup = 1, horizon = 1 } = {}) {
  if (!Array.isArray(series)) throw new TypeError("tasks: series must be an array of numbers");
  if (horizon !== 1) throw new RangeError("tasks: walkForward currently supports horizon = 1 only");
  if (!Number.isInteger(warmup) || warmup < 1) throw new TypeError("tasks: warmup must be an integer >= 1");
  for (let i = warmup; i < series.length; i += 1) {
    const target = series[i];
    if (typeof target !== "number" || !Number.isFinite(target)) throw new TypeError(`tasks: series[${i}] is not a finite number`);
    yield Object.freeze({
      step: i,
      history: Object.freeze(series.slice(0, i)),
      target,
      committed_at_step: i,
      reveal_not_before_step: i + 1,
    });
  }
}
