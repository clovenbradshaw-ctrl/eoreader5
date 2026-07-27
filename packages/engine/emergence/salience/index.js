// Born salience: the routing layer for tiny models.
//
// Ported from eoreader4.2:src/weave/chorus/born.js (bornSalience)
// and src/turn/meta-route.js (the router that composes bornSalience,
// deriveNull, and relax). The key insight: you don't need a big model
// to decide what to send to a small model. Born salience measures
// content against exemplar bases using deriveNull thresholds, and
// relax settles the decision.
//
// This module is pure and deterministic. The exemplar bases are
// INPUTS (the engine doesn't compute them — that's the app/eoPriors
// layer's job). The scoring and threshold derivation happen here.
//
// For a tiny model with limited context, born salience is how you
// avoid wasting tokens on irrelevant content: route the right
// things to the model before calling it.

import { deriveNull, createSeededRng, seededShuffle } from "../nulls/index.js";
import { klDivergence, wordFrequencies } from "../surprise/index.js";

/**
 * scoreAgainstBasis(content, basis) -> number
 *
 * How well does this content match an exemplar basis?
 * Measured as negative KL divergence (higher = more similar).
 * A content that matches the basis closely gets a high score;
 * content that diverges gets a low score.
 *
 * @param {string} content - the text to score
 * @param {object} basis - { frequencies: Map<string, number>, label: string }
 * @returns {number} similarity score (0 = no match, 1 = perfect match)
 */
export function scoreAgainstBasis(content, basis) {
  if (!content || !basis?.frequencies) return 0;
  const contentDist = wordFrequencies(content);
  const kl = klDivergence(contentDist, basis.frequencies);
  // Convert KL divergence to similarity: exp(-KL) gives 1 at KL=0, decays
  return Math.exp(-kl);
}

/**
 * bornSalience(content, bases, options) -> { score, route, bestBasis, nullResult }
 *
 * The born-salience scoring: measure content against multiple exemplar
 * bases, derive a Born-null threshold, and decide the route.
 *
 * @param {string} content - text to evaluate
 * @param {Array<object>} bases - exemplar bases [{ frequencies, label, weight? }]
 * @param {object} options - { quantile, tailDirection, protocol }
 * @returns {{ score: number, route: string, bestBasis: string|null, nullResult: object }}
 */
export function bornSalience(content, bases, options = {}) {
  if (!content || !Array.isArray(bases) || bases.length === 0) {
    return { score: 0, route: "unknown", bestBasis: null, nullResult: null };
  }

  const quantile = options.quantile ?? 0.95;
  const tailDirection = options.tailDirection ?? "greater";
  const seed = options.seed ?? "born-salience";

  // Score content against each basis
  const scores = bases.map((basis) => ({
    label: basis.label,
    score: scoreAgainstBasis(content, basis),
    weight: basis.weight ?? 1,
  }));

  // Weighted composite score
  let totalWeight = 0;
  let weightedScore = 0;
  for (const s of scores) {
    weightedScore += s.score * s.weight;
    totalWeight += s.weight;
  }
  const compositeScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

  // Best matching basis
  const best = scores.reduce((a, b) => (a.score >= b.score ? a : b), scores[0]);

  // Derive Born-null threshold: build null distribution by shuffling
  // content words and re-scoring against the best basis
  const contentWords = content.split(/\s+/).filter(Boolean);
  if (contentWords.length < 3) {
    return {
      score: compositeScore,
      route: compositeScore > 0.5 ? "proceed" : "refine",
      bestBasis: best.label,
      nullResult: null,
    };
  }

  const rng = createSeededRng(seed);
  const nullSamples = [];
  const iterations = Math.max(40, contentWords.length * 2);

  for (let i = 0; i < iterations; i++) {
    const shuffled = seededShuffle(contentWords, rng);
    const shuffledText = shuffled.join(" ");
    const shuffledScore = scoreAgainstBasis(shuffledText, bases.find((b) => b.label === best.label) ?? bases[0]);
    nullSamples.push(shuffledScore);
  }

  const nullResult = deriveNull({
    nullSamples,
    observedStatistic: compositeScore,
    tailDirection,
    quantile,
    protocol: {
      name: "born-salience-shuffle",
      iterations,
      statistic: "weighted-basis-similarity",
      scope: `content vs ${bases.length} bases`,
    },
  });

  // Route decision based on null result
  let route;
  if (nullResult.passed) {
    route = "proceed"; // content is significantly similar to a basis
  } else if (compositeScore > 0.3) {
    route = "refine"; // somewhat similar, but not significant — try different terms
  } else {
    route = "drill"; // not similar to anything — need more detail
  }

  return {
    score: compositeScore,
    route,
    bestBasis: best.label,
    nullResult,
  };
}

/**
 * relax(settled, current, factor) -> number
//
// Settling function from4.2:src/weave/longgen/relax.js.
// Gradually moves from current toward settled, controlled by factor.
// This is how the router "settles" on a decision over multiple
// iterations — it doesn't snap to the answer, it relaxes toward it.
 *
 * @param {number} settled - the target value
 * @param {number} current - the current value
 * @param {number} factor - relaxation factor (0 = no change, 1 = snap)
 * @returns {number} relaxed value
 */
export function relax(settled, current, factor = 0.3) {
  return current + (settled - current) * Math.max(0, Math.min(1, factor));
}

/**
 * routeDecision(salienceResult, foldBudget, history) -> { action, params }
 *
 * Compose born salience with fold budget to produce a concrete
 * routing decision. This is the engine-level replacement for
// meta-route.js — it doesn't call a model, it just decides.
 *
 * @param {object} salienceResult - from bornSalience()
 * @param {number} foldBudget - token budget for the fold
 * @param {Array} history - previous routing decisions (for relax settling)
 * @returns {{ action: string, params: object }}
 */
export function routeDecision(salienceResult, foldBudget, history = []) {
  const { route, score, bestBasis } = salienceResult;

  // Settle the route over history using relax
  const routeScores = { proceed: 1, refine: 0.5, drill: 0 };
  let settled = routeScores[route] ?? 0.5;
  for (const h of history) {
    settled = relax(settled, routeScores[h.action] ?? 0.5, 0.3);
  }

  // Final decision based on settled score
  if (settled >= 0.7) {
    return {
      action: "proceed",
      params: {
        foldBudget,
        bestBasis,
        salienceScore: score,
      },
    };
  } else if (settled >= 0.3) {
    return {
      action: "refine",
      params: {
        hint: bestBasis ? `content related to ${bestBasis}` : "try different search terms",
        foldBudget,
        salienceScore: score,
      },
    };
  } else {
    return {
      action: "drill",
      params: {
        field_id: bestBasis,
        depth: 2,
        foldBudget,
        salienceScore: score,
      },
    };
  }
}
