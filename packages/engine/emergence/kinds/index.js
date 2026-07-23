// Level-2 mathematical kinds: regime induction by SEG on an operator (spec
// "EO Emergent Mathematics for Predictive Competency" section 11.3). This is
// the next rung of the same helix: once operators exist (../operators), the
// Structure/Differentiate act SEG can draw a boundary *on an operator's output*
// — `selector(history) > theta` — carving the stream into regimes, and EVA
// reports that competency differs inside each. A partition under which the same
// predictive form succeeds in one regime and fails in another is a kind: it
// makes phase-relative state predictively relevant (section 11.3's example).
//
// Honesty, reused not reinvented:
//   * The threshold is data-derived (quantiles of the selector's own values),
//     never a hand-set constant (section 12.8 idiom).
//   * A permutation null (shuffle which steps carry which regime label) decides
//     whether the competency difference is real or a partition of noise
//     (section 20 multiple-hypothesis control) — via ../nulls deriveNull.
//   * The regime effect must survive on a held-out tail (invariant 7.6): a
//     partition that only separates competency in-sample is not a kind.
//   * A relative effect-size floor (section 1's governing criterion, section
//     13.5/20): the permutation null answers "is this split better than a
//     random one," which is a DIFFERENT question from "is it big enough to
//     matter." A near-deterministic series (e.g. one constant-slope trend with
//     almost no noise) has almost-zero-variance competency gains, so its null
//     is almost-zero too — a microscopic, practically meaningless differential
//     can then clear it. The floor requires the holdout differential to be a
//     non-trivial fraction of the reference's own typical loss scale (derived
//     from the fit data, never a hand-set absolute constant), so a "kind" must
//     be operationally interesting, not merely statistically distinguishable
//     from a coincidence.
//
// Pure and deterministic: no ambient time or randomness.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";
import { walkForward } from "../../prediction/tasks/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { crps } from "../../prediction/scoring/index.js";
import { evaluateProgram, predictWith } from "../expressions/index.js";

const HIST = { op: "hist" };
// Default regime selector: recent tendency (the "pressure tendency" of the
// weather example) — last first-difference. Any scalar program, including a
// promoted operator, may be supplied instead.
const DEFAULT_SELECTOR = { op: "last", of: { op: "diff", of: HIST } };
// Default predictor whose regime-conditional competency is examined.
const DEFAULT_PREDICTOR = { op: "last", of: HIST };

function crpsLoss(dist, y) {
  if (dist === null) return null;
  const r = crps(dist, y);
  return r.loss ?? Math.abs((dist.mean ?? dist.value) - y);
}

function quantileAt(sorted, q) {
  const rank = q * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Mean of a numeric array, or 0 for an empty array. */
function meanOf(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Absolute difference in mean competency gain between the two regimes a
 * threshold induces over a set of per-step records. The statistic EVA reports:
 * "the same form predicts differently on each side of this boundary."
 */
function regimeDifferential(steps, theta) {
  const above = [];
  const below = [];
  for (const s of steps) (s.sel > theta ? above : below).push(s.gain);
  if (!above.length || !below.length) return { differential: 0, meanAbove: 0, meanBelow: 0, nAbove: above.length, nBelow: below.length };
  const meanAbove = meanOf(above);
  const meanBelow = meanOf(below);
  return { differential: Math.abs(meanAbove - meanBelow), meanAbove, meanBelow, nAbove: above.length, nBelow: below.length };
}

/** Best threshold (max differential) over the candidate set, on the given steps. */
function bestThreshold(steps, thresholds) {
  let best = { theta: thresholds[0], differential: -Infinity };
  for (const theta of thresholds) {
    const d = regimeDifferential(steps, theta).differential;
    if (d > best.differential) best = { theta, differential: d };
  }
  return best;
}

/**
 * Induce a kind candidate: a regime partition of `series` under which the
 * predictor's competency differs across regimes, beyond a permutation null and
 * on held-out data. Returns a sealed KindCandidate, or null if no admissible
 * partition is found.
 *
 * @param {number[]} series
 * @param {object} [opts]
 * @param {object} [opts.selector=DEFAULT_SELECTOR] - scalar program carving the regime (may be an induced operator).
 * @param {object} [opts.predictor=DEFAULT_PREDICTOR] - scalar program whose competency is examined.
 * @param {string} [opts.referenceBaselineId="baseline:global-mean"]
 * @param {number} [opts.warmup=4]
 * @param {number} [opts.selectorWindow=8] - trailing window the selector is
 *   evaluated over, so it reflects the CURRENT regime rather than a running
 *   average since the start of the series.
 * @param {number} [opts.fitFraction=0.7] - leading fraction to select the threshold and run the null.
 * @param {number[]} [opts.thresholdQuantiles=[0.34,0.5,0.66]] - data-derived candidate thresholds.
 * @param {number} [opts.permutations=200]
 * @param {number} [opts.quantile=0.95]
 * @param {number} [opts.minRelativeEffect=0.05] - holdout differential must be
 *   at least this fraction of the reference's mean fit-side loss (a
 *   data-derived scale) to count as operationally interesting.
 * @param {string} [opts.population="series:anonymous"]
 * @param {string} [opts.selectorOperatorId] - provenance: the operator id if the selector is a promoted operator.
 */
export function induceKind(series, {
  selector = DEFAULT_SELECTOR,
  predictor = DEFAULT_PREDICTOR,
  referenceBaselineId = "baseline:global-mean",
  warmup = 4,
  selectorWindow = 8,
  fitFraction = 0.7,
  thresholdQuantiles = [0.34, 0.5, 0.66],
  permutations = 200,
  quantile = 0.95,
  minRelativeEffect = 0.05,
  population = "series:anonymous",
  selectorOperatorId,
} = {}) {
  if (!Array.isArray(series) || series.length <= warmup + 4) throw new TypeError("kinds: series too short");
  const baselines = defaultNumericBaselines({ window: 3 });
  const referenceBaseline = baselines.find((b) => b.id === referenceBaselineId);
  if (!referenceBaseline) throw new TypeError(`kinds: unknown reference baseline ${referenceBaselineId}`);
  const fitLen = Math.floor(series.length * fitFraction);

  // One walk-forward pass: per step, the predictor's competency gain over the
  // reference, and the selector's value (the regime coordinate). The selector
  // sees only a TRAILING WINDOW of history, not the full cumulative history:
  // "hist"-based reducers (mean, sum, ...) average since the series start, so
  // evaluated on the full history they converge toward a running average and
  // wash out exactly the *current* regime SEG needs to detect. A selector is a
  // Structure/Differentiate act on the recent state, not a whole-series
  // statistic, so it gets its own bounded view (baselines already do the same
  // thing internally for movingMean; this makes that windowing explicit for
  // regime carving instead of hiding it inside one baseline).
  const steps = [];
  for (const { step, history, target } of walkForward(series, { warmup })) {
    const predDist = predictWith(predictor, history, { warmup: 2 });
    const predLoss = crpsLoss(predDist, target);
    if (predLoss === null) continue;
    const refLoss = crpsLoss(referenceBaseline.predict(history), target);
    const window = history.slice(Math.max(0, history.length - selectorWindow));
    const sel = evaluateProgram(selector, window);
    if (sel === null) continue;
    steps.push({ step, sel, gain: refLoss - predLoss, refLoss });
  }
  if (steps.length < 6) return null;

  const fitSteps = steps.filter((s) => s.step < fitLen);
  const holdoutSteps = steps.filter((s) => s.step >= fitLen);
  if (fitSteps.length < 4 || holdoutSteps.length < 2) return null;

  // Data-derived candidate thresholds from the selector's fit-side values.
  const sortedSel = fitSteps.map((s) => s.sel).sort((a, b) => a - b);
  const thresholds = [...new Set(thresholdQuantiles.map((q) => quantileAt(sortedSel, q)))];
  if (thresholds.length === 0) return null;

  const chosen = bestThreshold(fitSteps, thresholds);
  const observed = chosen.differential;

  // Permutation null: break the association between selector regime and
  // competency by shuffling the gains across fit steps, re-selecting the best
  // threshold each time (so the null accounts for the threshold search).
  const rng = createSeededRng(canonicalHashSync({ series, selector, predictor, purpose: "kind-null" }));
  const gains = fitSteps.map((s) => s.gain);
  const nullSamples = [];
  for (let i = 0; i < permutations; i += 1) {
    const shuffledGains = seededShuffle(gains, rng);
    const permuted = fitSteps.map((s, idx) => ({ sel: s.sel, gain: shuffledGains[idx] }));
    nullSamples.push(bestThreshold(permuted, thresholds).differential);
  }
  const nullResult = deriveNull({
    nullSamples,
    observedStatistic: observed,
    tailDirection: "greater",
    quantile,
    protocol: { name: "regime-label-permutation", iterations: permutations, statistic: "max-threshold competency differential", scope: "selector-regime association" },
  });
  if (!nullResult.passed) return null;

  // Transfer gate (invariant 7.6): the same boundary must still separate
  // competency on the held-out tail, in the same direction.
  const fitRegime = regimeDifferential(fitSteps, chosen.theta);
  const holdoutRegime = regimeDifferential(holdoutSteps, chosen.theta);
  const sameDirection = Math.sign(fitRegime.meanAbove - fitRegime.meanBelow) === Math.sign(holdoutRegime.meanAbove - holdoutRegime.meanBelow);
  if (holdoutRegime.nAbove === 0 || holdoutRegime.nBelow === 0 || !sameDirection || holdoutRegime.differential <= 0) return null;

  // Effect-size floor: the holdout differential must be a non-trivial fraction
  // of the reference's own typical (fit-side) loss scale, not merely a split
  // the permutation null happens to consider non-random.
  const referenceScale = meanOf(fitSteps.map((s) => s.refLoss));
  if (referenceScale <= 0 || holdoutRegime.differential / referenceScale < minRelativeEffect) return null;

  const body = {
    schema: "KindCandidate@1",
    selector,
    selector_operator_id: selectorOperatorId ?? null,
    predictor,
    reference_baseline_id: referenceBaselineId,
    threshold: chosen.theta,
    // Per-regime competency EVA reports on each side of the boundary.
    regimes: {
      above: { n: fitRegime.nAbove, mean_gain: fitRegime.meanAbove },
      below: { n: fitRegime.nBelow, mean_gain: fitRegime.meanBelow },
    },
    differential: observed,
    holdout_differential: holdoutRegime.differential,
    reference_scale: referenceScale,
    relative_effect: holdoutRegime.differential / referenceScale,
    partition_null: nullResult,
    lens: { target_type: "number", horizon: { kind: "walk-forward", h: 1 }, scoring_rule: "crps", reference_baseline_id: referenceBaselineId, population },
    // The operator-epoch act: SEG drew this boundary on the selector's output.
    emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, carved_by: "SEG", from_selector: selectorOperatorId ?? "selector-program" },
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, id: `kind:${content_hash}`, content_hash });
}
