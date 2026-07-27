import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";
import { walkForward } from "../../prediction/tasks/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { crps } from "../../prediction/scoring/index.js";
import { evaluateProgram, predictWith } from "../expressions/index.js";

const HIST = { op: "hist" };
const DEFAULT_SELECTOR = { op: "last", of: { op: "diff", of: HIST } };
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

function meanOf(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function regimeDifferential(steps, theta) {
  const above = [];
  const below = [];
  for (const s of steps) (s.sel > theta ? above : below).push(s.gain);
  if (!above.length || !below.length) return { differential: 0, meanAbove: 0, meanBelow: 0, nAbove: above.length, nBelow: below.length };
  const meanAbove = meanOf(above);
  const meanBelow = meanOf(below);
  return { differential: Math.abs(meanAbove - meanBelow), meanAbove, meanBelow, nAbove: above.length, nBelow: below.length };
}

function bestThreshold(steps, thresholds) {
  let best = { theta: thresholds[0], differential: -Infinity };
  for (const theta of thresholds) {
    const d = regimeDifferential(steps, theta).differential;
    if (d > best.differential) best = { theta, differential: d };
  }
  return best;
}

export function induceKind(series, {
  selector = DEFAULT_SELECTOR,
  predictor = DEFAULT_PREDICTOR,
  referenceBaselineId = "baseline:global-mean",
  warmup,
  selectorWindow,
  baselineWindow = 3,
  fitFraction,
  thresholdQuantiles,
  permutations,
  quantile = 0.95,
  minRelativeEffect,
  population = "series:anonymous",
  selectorOperatorId,
} = {}) {
  const n = series.length;
  const resolvedWarmup = warmup ?? Math.ceil(Math.sqrt(n));
  const resolvedSelectorWindow = selectorWindow ?? Math.max(4, Math.floor(Math.sqrt(n)));
  const resolvedFitFraction = fitFraction ?? Math.max(0.5, 1 - 1 / Math.sqrt(n));
  const resolvedThresholdQuantiles = thresholdQuantiles ?? [
    Math.max(0.01, 1 / Math.sqrt(n)),
    0.5,
    Math.min(0.99, 1 - 1 / Math.sqrt(n)),
  ];
  const resolvedPermutations = permutations ?? Math.max(40, Math.round(n * 5));
  const resolvedMinRelativeEffect = minRelativeEffect ?? 1 / Math.sqrt(n);

  if (!Array.isArray(series) || series.length <= resolvedWarmup + 4) throw new TypeError("kinds: series too short");
  const baselines = defaultNumericBaselines({ window: baselineWindow });
  const referenceBaseline = baselines.find((b) => b.id === referenceBaselineId);
  if (!referenceBaseline) throw new TypeError(`kinds: unknown reference baseline ${referenceBaselineId}`);
  const fitLen = Math.floor(series.length * resolvedFitFraction);

  const steps = [];
  for (const { step, history, target } of walkForward(series, { warmup: resolvedWarmup })) {
    const predDist = predictWith(predictor, history, { warmup: 2 });
    const predLoss = crpsLoss(predDist, target);
    if (predLoss === null) continue;
    const refLoss = crpsLoss(referenceBaseline.predict(history), target);
    const window = history.slice(Math.max(0, history.length - resolvedSelectorWindow));
    const sel = evaluateProgram(selector, window);
    if (sel === null) continue;
    steps.push({ step, sel, gain: refLoss - predLoss, refLoss });
  }
  if (steps.length < 6) return null;

  const fitSteps = steps.filter((s) => s.step < fitLen);
  const holdoutSteps = steps.filter((s) => s.step >= fitLen);
  if (fitSteps.length < 4 || holdoutSteps.length < 2) return null;

  const sortedSel = fitSteps.map((s) => s.sel).sort((a, b) => a - b);
  const thresholds = [...new Set(resolvedThresholdQuantiles.map((q) => quantileAt(sortedSel, q)))];
  if (thresholds.length === 0) return null;

  const chosen = bestThreshold(fitSteps, thresholds);
  const observed = chosen.differential;

  const rng = createSeededRng(canonicalHashSync({ series, selector, predictor, purpose: "kind-null" }));
  const gains = fitSteps.map((s) => s.gain);
  const nullSamples = [];
  for (let i = 0; i < resolvedPermutations; i += 1) {
    const shuffledGains = seededShuffle(gains, rng);
    const permuted = fitSteps.map((s, idx) => ({ sel: s.sel, gain: shuffledGains[idx] }));
    nullSamples.push(bestThreshold(permuted, thresholds).differential);
  }
  const nullResult = deriveNull({
    nullSamples,
    observedStatistic: observed,
    tailDirection: "greater",
    quantile,
    protocol: { name: "regime-label-permutation", iterations: resolvedPermutations, statistic: "max-threshold competency differential", scope: "selector-regime association" },
  });
  if (!nullResult.passed) return null;

  const fitRegime = regimeDifferential(fitSteps, chosen.theta);
  const holdoutRegime = regimeDifferential(holdoutSteps, chosen.theta);
  const sameDirection = Math.sign(fitRegime.meanAbove - fitRegime.meanBelow) === Math.sign(holdoutRegime.meanAbove - holdoutRegime.meanBelow);
  if (holdoutRegime.nAbove === 0 || holdoutRegime.nBelow === 0 || !sameDirection || holdoutRegime.differential <= 0) return null;

  const referenceScale = meanOf(fitSteps.map((s) => s.refLoss));
  if (referenceScale <= 0 || holdoutRegime.differential / referenceScale < resolvedMinRelativeEffect) return null;

  const body = {
    schema: "KindCandidate@1",
    selector,
    selector_operator_id: selectorOperatorId ?? null,
    predictor,
    reference_baseline_id: referenceBaselineId,
    threshold: chosen.theta,
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
    emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, carved_by: "SEG", from_selector: selectorOperatorId ?? "selector-program" },
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, id: `kind:${content_hash}`, content_hash });
}
