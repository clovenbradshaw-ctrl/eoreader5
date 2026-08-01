// transition.js — Cell transition entropy significance scorer.
//
// The 27-cell EO encoding space captures real semantic structure in clause
// embeddings: clause→clause cell transitions are non-uniform, with 59%
// surprise reduction from uniform (4.7 bits → 1.9 bits observed).
//
// This module uses transition surprisal as a significance signal:
//   - Build a Markov transition matrix over the 27 cells from a text's
//     clause/sentence sequence
//   - Score each transition by -log2(P(cell_i+1 | cell_i))
//   - High surprisal = unexpected narrative mode shift = plot-relevant moment
//
// Unlike lexical forward-surprise (spine.js), this measures structural
// significance — shifts in the EO terrain (Mode/Domain/Object) rather than
// vocabulary novelty. The two are complementary: lexical surprise peaks on
// new-word entry, transition surprise peaks on mode-switch.
//
// Usage:
//   import { transitionSignificance } from "@eoreader/def/transition";
//   const result = await transitionSignificance(text, encoder, centroids);
//   // result.scores — per-sentence surprisal (bit score, higher = more significant)
//   // result.peaks  — indices of highest-surprisal transitions

const N_CELLS = 27;

export const ALL_CELL_KEYS = (() => {
  const keys = [];
  for (const q1 of ["DIFFERENTIATING", "RELATING", "GENERATING"]) {
    for (const q2 of ["EXISTENCE", "STRUCTURE", "SIGNIFICANCE"]) {
      for (const q3 of ["CONDITION", "PARTICULAR", "PATTERN"]) {
        keys.push(`${q1},${q2},${q3}`);
      }
    }
  }
  return keys;
})();

const CELL_INDEX = Object.fromEntries(ALL_CELL_KEYS.map((k, i) => [k, i]));

export function cellKey(cell) {
  return `${cell.q1},${cell.q2},${cell.q3}`;
}

export function keyIndex(k) {
  return CELL_INDEX[k] ?? -1;
}

/**
 * Split text into sentences (simple punctuation-based split).
 * Same approach as explore-cells.mjs for consistency.
 */
export function splitToSentences(text) {
  return text
    .replace(/\n/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

/**
 * buildTransitionMatrix(cellKeys, smooth) → 27×27 row-stochastic matrix
 *
 * Markov transition matrix with add-k smoothing. Rows = from-cell,
 * columns = to-cell. Every row sums to 1. Smoothing ensures no
 * unseen transition has infinite surprisal.
 */
export function buildTransitionMatrix(cellKeys, smooth = 0.01) {
  const counts = Array.from({ length: N_CELLS }, () => Array(N_CELLS).fill(smooth));
  const totals = Array(N_CELLS).fill(smooth * N_CELLS);

  for (let i = 0; i < cellKeys.length - 1; i++) {
    const from = keyIndex(cellKeys[i]);
    const to = keyIndex(cellKeys[i + 1]);
    if (from === -1 || to === -1) continue;
    counts[from][to]++;
    totals[from]++;
  }

  return counts.map((row, i) => row.map(c => c / totals[i]));
}

/**
 * Final-state distribution of the Markov chain (stationary distribution
 * if the chain is ergodic; empirical last-observed-state otherwise).
 */
export function finalDistribution(counts, smooth = 0.01) {
  const dist = Array(N_CELLS).fill(smooth);
  const total = smooth * N_CELLS + counts.length;
  for (const k of counts) {
    const idx = keyIndex(k);
    if (idx >= 0) dist[idx]++;
  }
  return dist.map(c => c / total);
}

/**
 * Per-row entropy of the transition matrix.
 * A cell with H near 0 is highly predictable (always transitions to
 * the same cell). A cell with H near log2(27)=4.75 is maximally
 * surprising (all transitions equally likely).
 */
export function rowEntropies(matrix) {
  return matrix.map(row =>
    -row.reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0)
  );
}

/**
 * Surprisal (bits) of a single transition.
 * -log2(P(to | from)) = information gained by observing this transition.
 */
export function transitionSurprisal(fromKey, toKey, matrix) {
  const from = keyIndex(fromKey);
  const to = keyIndex(toKey);
  if (from === -1 || to === -1) return 0;
  const p = matrix[from][to];
  return p > 0 ? -Math.log2(p) : 64; // cap at 64 bits for structural zeros
}

/**
 * Score a sequence of cell keys: for each position i ≥ 1, the score is
 * the surprisal of cellKeys[i] given cellKeys[i-1]. Position 0 has score 0.
 *
 * The scores array has the same length as cellKeys.
 */
export function scoreSequence(cellKeys, matrix) {
  const scores = [0];
  for (let i = 1; i < cellKeys.length; i++) {
    scores.push(transitionSurprisal(cellKeys[i - 1], cellKeys[i], matrix));
  }
  return scores;
}

/**
 * Find peak positions: indices of the top-k highest scores, in reading order.
 */
export function findPeaks(scores, k = 12, excludeFirst = 0) {
  const indexed = scores
    .map((s, i) => ({ score: s, idx: i }))
    .filter(x => x.idx >= excludeFirst)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return indexed.map(x => x.idx).sort((a, b) => a - b);
}

/**
 * transitionSignificance(text, encoder, centroids, options) →
 *   { sentences, cellKeys, matrix, entropies, scores, peaks,
 *     meanEntropy, uniformEntropy, surpriseReduction, scoreByPos }
 *
 * Full pipeline: split → embed → assign → build matrix → score.
 * Higher scores = more surprising cell transitions = more significant moments.
 */
export async function transitionSignificance(text, encoder, centroids, options = {}) {
  const {
    smooth = 0.01,
    k = 12,
    minLength = 10,
  } = options;

  const sents = text.replace(/\n/g, " ").split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > minLength);

  if (sents.length < 2) {
    return {
      sentences: sents, cells: [], cellKeys: [],
      matrix: null, entropies: [], scores: [], peaks: [],
      meanEntropy: 0, uniformEntropy: Math.log2(N_CELLS),
      surpriseReduction: 0, scoreByPos: new Map(), units: sents.length,
    };
  }

  const cells = [];
  for (const sent of sents) {
    const v = await encoder.encode(sent);
    cells.push(nearestCell(v, centroids));
  }

  const keys = cells.map(c => c ? cellKey(c) : null).filter(k => k !== null);

  const matrix = buildTransitionMatrix(keys, smooth);
  const entropies = rowEntropies(matrix);
  const scores = scoreSequence(keys, matrix);

  const meanEntropy = entropies.reduce((s, h) => s + h, 0) / entropies.length;
  const uniformEntropy = Math.log2(N_CELLS);

  // For peakedness: how many cells have entropy below uniform/2
  const predictableCount = entropies.filter(h => h < uniformEntropy / 2).length;
  const peakedness = entropies.length > 0 ? predictableCount / entropies.length : 0;

  const peaks = findPeaks(scores, k, /*excludeFirst=*/0);

  // Build scoreByPos for compatibility with existing spine consumers
  const scoreByPos = new Map(scores.map((s, i) => [i, s]));

  return {
    sentences: sents,
    cells,
    cellKeys: keys,
    matrix,
    entropies,
    scores,
    peaks,
    scoreByPos,
    meanEntropy,
    uniformEntropy,
    surpriseReduction: ((1 - meanEntropy / uniformEntropy) * 100).toFixed(1),
    peakedness,
    units: sents.length,
  };
}

export default { transitionSignificance, buildTransitionMatrix, scoreSequence, findPeaks, rowEntropies, cellKey, splitToSentences };
