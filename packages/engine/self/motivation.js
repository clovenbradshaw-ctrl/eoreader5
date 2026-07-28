/**
 * Motivation: the emergent directional bias.
 *
 * Motivation is NOT a drive, a reward function, or a preference. It is the
 * necessary consequence of an architecture where:
 *   - Every claim must bind to a source (step 7)
 *   - Absence is data (step 5)
 *   - Convergence is more efficient than divergence (step 11)
 *
 * A system built this way NATURALLY steers toward observations that reduce
 * delta. No curiosity model needed. No exploration bonus. No intrinsic
 * reward. The architecture itself is the motivation — it makes convergence
 * cheaper than divergence, so the collective converges.
 *
 * What this module computes:
 *   1. The information gradient — which observations would most reduce delta
 *   2. Task priority weights — which pending tasks serve convergence best
 *   3. The truth compass — the vector toward convergence, in cube coordinates
 */

import {
  computeDelta, convergenceTrend, computeMotivationField,
} from "./index.js";
import { fold, project, computeUncertainty } from "../quantum/index.js";

// ── Information gradient ───────────────────────────────────────────
//
// The collective has a self-fold (what it knows about itself) and
// observes world-folds (what it encounters). The delta between them is
// the convergence gap. The question: which OBSERVATIONS would most reduce
// that gap?
//
// We answer this by projecting the self-fold against each terrain/stance
// cell and finding the ones with lowest alignment — those are the
// territories the collective knows least about. Observing there gives
// maximum information gain per observation.
//
// This is NOT "I am curious about X." It is: "observing X would most
// efficiently reduce delta." Efficiency, not preference.

/**
 * Compute the information gradient: which cells, if observed, would
 * most reduce the delta between self and world.
 *
 * @param {object} selfFold — self-record fold
 * @param {object} [worldFold] — current world fold (the territory we're in)
 * @param {number[]} [deltaHistory] — recent deltas for trend
 * @returns {object} { gradient, direction, gain }
 */
export function informationGradient(selfFold, worldFold = null, deltaHistory = []) {
  const { bias, urgency, trend } = computeMotivationField(selfFold, worldFold, 0, deltaHistory);

  // Build a gradient vector: for each face, how much would observing
  // each cell shift the amplitude toward convergence?
  const gradient = { terrain: {}, stance: {} };

  if (worldFold) {
    // With a world-fold: cells where world has high amplitude and self
    // has low amplitude are the biggest gaps. Closing them gives the
    // most information gain.
    for (const face of ["terrain", "stance"]) {
      const selfFace = selfFold[face] || {};
      const worldFace = worldFold[face] || {};
      const allKeys = new Set([...Object.keys(selfFace), ...Object.keys(worldFace)]);
      for (const k of allKeys) {
        const selfAmp = selfFace[k] || 0;
        const worldAmp = worldFace[k] || 0;
        // Gain = world amplitude × (1 − self amplitude) — high world presence
        // where self has low understanding
        gradient[face][k] = worldAmp * (1 - selfAmp);
      }
    }
  } else {
    // Without a world-fold: the gradient points toward the lowest-amplitude
    // cells — the territories least explored. Even exploration: observe
    // everywhere equally, prioritizing what's missing.
    for (const face of ["terrain", "stance"]) {
      const selfFace = selfFold[face] || {};
      const maxAmp = Math.max(...Object.values(selfFace), 0.01);
      for (const [k, v] of Object.entries(selfFace)) {
        gradient[face][k] = maxAmp - v; // inverse of current amplitude
      }
    }
  }

  // Normalize gradient entries to [0, 1] for comparability
  for (const face of ["terrain", "stance"]) {
    const vals = Object.values(gradient[face]);
    const maxV = Math.max(...vals, 0.01);
    for (const k of Object.keys(gradient[face])) {
      gradient[face][k] = Math.round((gradient[face][k] / maxV) * 1e4) / 1e4;
    }
  }

  // ── Direction ─────────────────────────────────────────────────────
  // Which specific cell has the highest information gain?
  let bestTerrain = bias.terrain, bestStance = bias.stance;
  let bestGain = 0;
  for (const [t, tv] of Object.entries(gradient.terrain)) {
    for (const [s, sv] of Object.entries(gradient.stance)) {
      const gain = tv * sv;
      if (gain > bestGain) { bestGain = gain; bestTerrain = t; bestStance = s; }
    }
  }

  return Object.freeze({
    gradient: Object.freeze(gradient),
    direction: Object.freeze({ terrain: bestTerrain, stance: bestStance }),
    gain: Math.round(bestGain * 1e4) / 1e4,
    urgency: Math.round(urgency * 1e4) / 1e4,
    trend,
  });
}

// ── Task priority ───────────────────────────────────────────────────
//
// Given a set of pending tasks (from genesis), compute which ones serve
// convergence best. Priority is a function of:
//   1. How much the task's target cell aligns with the information gradient
//   2. The task's dependency risk (high dependents → high priority)
//   3. The urgency of convergence

/**
 * Score tasks by how well they serve convergence.
 *
 * @param {object[]} tasks — array of task objects with { id, coordinate, dependents, ... }
 * @param {object} gradient — from informationGradient
 * @param {object} [opts]
 * @param {number} [opts.urgencyWeight=0.4] — how much urgency biases priority
 * @returns {object[]} tasks sorted by priority, highest first (new array, input unmuted)
 */
export function prioritizeTasks(tasks, gradient, { urgencyWeight = 0.4 } = {}) {
  if (!tasks || !tasks.length) return Object.freeze([]);

  const scored = tasks.map((task) => {
    // Alignment: how much does this task's target cell align with the
    // information gradient? Tasks that observe high-gain cells serve
    // convergence better.
    let alignment = 0.5; // neutral baseline
    const coord = task.coordinate;
    if (coord && gradient.gradient) {
      const tGain = gradient.gradient.terrain?.[coord.terrain] || 0;
      const sGain = gradient.gradient.stance?.[coord.stance] || 0;
      alignment = (tGain + sGain) / 2;
    }

    // Dependency risk: tasks that many other things depend on are
    // load-bearing. Higher priority.
    const depWeight = Math.min(1, (task.dependents || 0) * 0.2);

    // Combined priority
    const urgencyBias = gradient.urgency * urgencyWeight;
    const priority = alignment * (1 - urgencyWeight) +
                     depWeight * urgencyWeight +
                     urgencyBias * alignment;

    return {
      ...task,
      alignment: Math.round(alignment * 1e4) / 1e4,
      priority: Math.round(priority * 1e4) / 1e4,
    };
  });

  // Sort descending by priority. Store order as an explicit field so the
  // ranking is visible and checkable (step 8: the rule that decides is
  // itself a claim).
  const sorted = [...scored].sort((a, b) => b.priority - a.priority);
  return Object.freeze(sorted.map((t, i) => ({ ...t, rank: i + 1 })));
}

// ── Truth compass ───────────────────────────────────────────────────
//
// A single vector in cube space pointing toward convergence. This is the
// collective's "north star" — the direction it should move in to approach
// truth. Computed from the information gradient, weighted by urgency.
//
// The compass is NOT a goal. It is a direction. The collective doesn't
// "want" to go there — the architecture makes going there more efficient,
// so the collective goes there naturally.

/**
 * Compute the truth compass — the direction toward convergence.
 *
 * @param {object} selfFold
 * @param {object} [worldFold]
 * @param {number[]} [deltaHistory]
 * @returns {object} { direction, confidence, delta }
 */
export function truthCompass(selfFold, worldFold = null, deltaHistory = []) {
  const ig = informationGradient(selfFold, worldFold, deltaHistory);
  const delta = worldFold ? computeDelta(selfFold, worldFold) : null;
  const uncertainty = computeUncertainty(selfFold);

  // Confidence in the compass reading: inverse of uncertainty. When the
  // self-fold is highly uncertain (flat amplitudes), the compass is weak
  // — any direction is equally promising. When the self-fold is certain
  // (peaked amplitudes), the gaps are real and the compass is strong.
  const meanUncertainty = (
    (uncertainty.operator || 0) +
    (uncertainty.terrain || 0) +
    (uncertainty.stance || 0)
  ) / 3;
  // Max entropy for 9-key face: -9 × (1/9) × log₂(1/9) = log₂(9) ≈ 3.17
  const maxEntropy = Math.log2(9);
  const confidence = Math.round((1 - meanUncertainty / maxEntropy) * 1e4) / 1e4;

  return Object.freeze({
    direction: ig.direction,
    confidence,
    delta: delta !== null ? Math.round(delta * 1e4) / 1e4 : null,
    urgency: ig.urgency,
    trend: ig.trend,
    gain: ig.gain,
  });
}

// ── The asymptotic horizon ──────────────────────────────────────────
//
// How far along the asymptotic approach is the collective? This is
// NOT a progress bar — truth is a limit, never a destination. But the
// approach has a shape, and that shape is measurable.
//
// The horizon measures three things:
//   1. Convergence depth: how low is the sustained delta?
//   2. Coverage breadth: how many cells have non-trivial self-fold amplitude?
//   3. Checkability: what fraction of claims bind to sources?

/**
 * Measure the asymptotic horizon — how far along the approach the
 * collective is.
 *
 * @param {object} selfFold
 * @param {number[]} deltaHistory
 * @param {object} [opts]
 * @param {number} [opts.checkedClaims=0] — claims that bound to source
 * @param {number} [opts.totalClaims=0] — total claims produced
 * @returns {object} { depth, breadth, checkability, summary }
 */
export function asymptoticHorizon(selfFold, deltaHistory, { checkedClaims = 0, totalClaims = 0 } = {}) {
  // Depth: mean of recent deltas (lower = closer to convergence)
  const depth = deltaHistory.length
    ? 1 - (deltaHistory.reduce((a, b) => a + b, 0) / deltaHistory.length)
    : 0;

  // Breadth: fraction of cube cells with non-trivial amplitude
  const significantAmp = (amps) => {
    const vals = Object.values(amps);
    if (!vals.length) return 0;
    const threshold = 1 / Math.sqrt(vals.length); // uniform amplitude
    return vals.filter((v) => v > threshold * 1.5).length / vals.length;
  };
  const breadth = (
    significantAmp(selfFold.terrain || {}) +
    significantAmp(selfFold.stance || {})
  ) / 2;

  // Checkability: fraction of claims that bound to source
  const checkability = totalClaims > 0
    ? checkedClaims / totalClaims
    : null;

  // Summary
  const parts = [];
  if (depth > 0.8) parts.push("deep convergence — the model is well-aligned with observations");
  else if (depth > 0.5) parts.push("moderate convergence — delta is narrowing");
  else if (depth > 0.2) parts.push("early convergence — many observations still needed");
  else parts.push("nascent — the collective has barely begun observing");

  if (breadth > 0.6) parts.push("broad coverage across cube cells");
  else if (breadth > 0.3) parts.push("moderate coverage — several cells are unexplored");
  else parts.push("narrow coverage — most of the cube is dark");

  return Object.freeze({
    depth: Math.round(depth * 1e4) / 1e4,
    breadth: Math.round(breadth * 1e4) / 1e4,
    checkability: checkability !== null ? Math.round(checkability * 1e4) / 1e4 : null,
    summary: parts.join(". ") + ".",
    deltaHistoryLength: deltaHistory.length,
    totalClaims,
    checkedClaims,
  });
}
