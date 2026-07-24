// Prior-conditioned prediction (spec "EO Emergent Mathematics for Predictive
// Competency" section 13, read against the eoPriors Ground-column prior). A
// PRIOR is a distribution over the categories a reader can observe next — for a
// text read it is the 27-cell phasepost distribution the eoPriors corpus prior
// carries; for any categorical task it is a distribution over that task's
// labels. Reading under a prior means committing the prior (or a blend of the
// prior with the document's own local history) as the predictive distribution
// BEFORE the next observation is revealed, then scoring it with the same proper
// rule everything else uses (prediction/scoring/index.js). A prior "minimizes
// surprise" exactly when that committed distribution earns lower log-loss than
// the cold uniform prior a reader would otherwise start from.
//
// Everything here is pure and deterministic: no ambient time, no randomness, no
// mutation of its inputs. It emits the same categorical predictive output the
// scoring rules already accept, so nothing new has to learn how to score it.

import { logLoss } from "../scoring/index.js";

const EPS = 1e-9; // smoothing floor so a never-seen category never costs −log(0).

function assertDistribution(dist, label) {
  if (!dist || typeof dist !== "object" || Array.isArray(dist)) {
    throw new TypeError(`priors: ${label} must be a { category: weight } object`);
  }
}

/**
 * Normalize a { category: weight } map into a proper probability mass function,
 * with a smoothing floor so every listed category keeps positive mass (a prior
 * that assigned exactly zero to a category the reader then observes would score
 * an infinite, uninformative loss). Weights may be counts, ppm, or
 * probabilities — only their ratios matter. Non-finite or negative weights are
 * treated as zero. Returns a frozen pmf.
 */
export function normalizePrior(weights, { floor = EPS } = {}) {
  assertDistribution(weights, "prior weights");
  const keys = Object.keys(weights);
  if (keys.length === 0) throw new TypeError("priors: a prior needs at least one category");
  const clean = {};
  let sum = 0;
  for (const k of keys) {
    const w = Number(weights[k]);
    const v = Number.isFinite(w) && w > 0 ? w : 0;
    clean[k] = v;
    sum += v;
  }
  const probs = {};
  let total = 0;
  for (const k of keys) {
    probs[k] = sum > 0 ? Math.max(floor, clean[k] / sum) : 1 / keys.length;
    total += probs[k];
  }
  for (const k of keys) probs[k] /= total; // renormalize after flooring
  return Object.freeze(probs);
}

/**
 * The predictive output committed when reading under a prior: a categorical
 * distribution over the prior's categories, shaped exactly like the scoring
 * rules' `{ kind: "categorical", probs }` input. This is the object a reader
 * commits BEFORE the next span is revealed.
 */
export function priorPredictor(weights, opts) {
  return Object.freeze({ kind: "categorical", probs: normalizePrior(weights, opts) });
}

/**
 * Blend a document's own local (within-history) distribution with a background
 * prior by Dirichlet / empirical-Bayes shrinkage: localCount + alpha·prior.
 * With no local history the blend IS the prior (cold start); as local evidence
 * accumulates the prior's pull fades. `alpha` is the prior's pseudo-count
 * strength. Returns a committed categorical predictor over the union of
 * categories seen in either map.
 */
export function blendedPriorPredictor(localWeights, priorWeights, { alpha = 1, floor = EPS } = {}) {
  assertDistribution(localWeights, "local weights");
  assertDistribution(priorWeights, "prior weights");
  if (!(Number.isFinite(alpha) && alpha >= 0)) throw new RangeError("priors: alpha must be a non-negative finite number");
  const prior = normalizePrior(priorWeights, { floor });
  const localSum = Object.values(localWeights).reduce((s, w) => s + (Number.isFinite(Number(w)) && w > 0 ? Number(w) : 0), 0);
  const categories = new Set([...Object.keys(priorWeights), ...Object.keys(localWeights)]);
  const blended = {};
  for (const c of categories) {
    const local = Number(localWeights[c]);
    const localMass = Number.isFinite(local) && local > 0 ? local : 0;
    // prior[c] is 0 for a category the prior never listed; the floor in the
    // final normalize keeps it positive so it is still scoreable.
    blended[c] = localMass + alpha * (prior[c] || 0) * Math.max(1, localSum || 1);
  }
  return priorPredictor(blended, { floor });
}

/**
 * The uniform baseline over a set of categories — the "cold prior" a reader
 * starts from with no background knowledge. Reading under a real prior is only
 * competent if it beats this (section 13.4: never call a predictor competent
 * merely for existing; it must beat the honest simple baseline).
 */
export function uniformPredictor(categories) {
  const keys = Array.isArray(categories) ? categories : Object.keys(categories || {});
  if (keys.length === 0) throw new TypeError("priors: uniformPredictor needs at least one category");
  const p = 1 / keys.length;
  const probs = {};
  for (const k of keys) probs[k] = p;
  return Object.freeze({ kind: "categorical", probs: Object.freeze(probs) });
}

/**
 * How much surprise a prior removes when the reader observes `observed`,
 * measured against the uniform cold-start baseline with the same proper rule
 * (log-loss). Positive `reductionNats`/`reductionBits` means the prior made the
 * observation less surprising than starting cold; negative means the prior
 * actively mispredicted. Reported in nats (the scoring module's native unit,
 * natural log) and bits (nats / ln 2) so a caller can speak either.
 */
export function surpriseReduction(priorWeights, observed, { categories } = {}) {
  const predictor = priorPredictor(priorWeights);
  const keys = categories || Object.keys(predictor.probs);
  const under = logLoss(predictor, observed).loss;
  const cold = logLoss(uniformPredictor(keys), observed).loss;
  const reductionNats = cold - under;
  return Object.freeze({
    lossUnderPrior: under,
    lossUnderUniform: cold,
    reductionNats,
    reductionBits: reductionNats / Math.LN2,
  });
}

/**
 * Total surprise reduction across a sequence of observations read under a fixed
 * prior — the aggregate "bits saved by reading with this prior." Sums the
 * per-observation reductions; also returns the mean so sequences of different
 * lengths are comparable. This is the sequence-level statement of "a prior
 * minimizes surprise for this source."
 */
export function sequenceSurpriseReduction(priorWeights, observations, opts = {}) {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new TypeError("priors: observations must be a non-empty array");
  }
  const per = observations.map((o) => surpriseReduction(priorWeights, o, opts));
  const totalBits = per.reduce((s, r) => s + r.reductionBits, 0);
  const totalNats = per.reduce((s, r) => s + r.reductionNats, 0);
  return Object.freeze({
    per,
    n: observations.length,
    totalBits,
    totalNats,
    meanBits: totalBits / observations.length,
    meanNats: totalNats / observations.length,
  });
}
