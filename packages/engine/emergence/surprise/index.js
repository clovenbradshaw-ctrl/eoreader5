// Surprise measure: KL divergence, felt surprise, forward score,
// novelty reserve.
//
// Ported from eoreader4.2:src/core/surprise.js. The surprise math
// answers: "how unexpected is this content, given what we've already
// read?" For a tiny model with limited context, this is the scoring
// function that tells you what's worth including in the fold and
// what's redundant.
//
// This module is pure and deterministic. It takes observed word
// frequencies and expected (background) distributions, and returns
// surprise scores. It does not call models or access ambient state.
//
// The key insight from4.2: surprise is not just "is this different?"
// but "how much information does this add, measured in bits?" KL
// divergence is the natural measure: it counts the bits wasted if
// you expected the background distribution but got the actual one.

/**
 * KL divergence: D_KL(observed || expected).
 *
 * Measures the bits of surprise when the observed distribution
 * diverges from the expected distribution. Both are Maps of
 * {token -> probability}. Tokens not in observed are treated as
 * having zero probability (they contribute to surprise via the
 * -log(expected) term). Tokens not in expected are treated as
 * having a small floor probability (epsilon) to avoid log(0).
 *
 * @param {Map<string, number>} observed - observed token probabilities
 * @param {Map<string, number>} expected - expected (background) token probabilities
 * @param {number} [epsilon=1e-10] - floor probability for unseen expected tokens
 * @returns {number} KL divergence in bits (log base 2)
 */
export function klDivergence(observed, expected, epsilon = 1e-10) {
  let kl = 0;
  const allTokens = new Set([...observed.keys(), ...expected.keys()]);
  for (const token of allTokens) {
    const p = observed.get(token) ?? 0;
    const q = Math.max(expected.get(token) ?? epsilon, epsilon);
    if (p > 0) {
      kl += p * Math.log2(p / q);
    }
  }
  return Math.max(0, kl);
}

/**
 * Word frequency distribution from a text string.
 * Returns a Map of {lowercase_word -> probability}.
 */
export function wordFrequencies(text) {
  const s = String(text ?? "").toLowerCase();
  const words = s.split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return new Map();
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const dist = new Map();
  for (const [w, c] of counts) dist.set(w, c / words.length);
  return dist;
}

/**
 * surpriseAt(observedText, backgroundFrequencies) -> number
 *
 * KL divergence of the observed text's word distribution against
 * the background distribution. Higher = more surprising.
 *
 * @param {string} observedText - the text to measure surprise of
 * @param {Map<string, number>} backgroundFrequencies - expected word distribution
 * @returns {number} surprise in bits
 */
export function surpriseAt(observedText, backgroundFrequencies) {
  const observed = wordFrequencies(observedText);
  return klDivergence(observed, backgroundFrequencies);
}

/**
 * feltSurprise(surpriseBits, context) -> number
 *
 * Contextualized surprise: the raw surprise bits weighted by
 * the content's relevance to the current focus. In4.2 this
 * modulates surprise by the "felt" importance — a surprising
 * fact about the entity you're focused on feels more surprising
 * than a random surprising fact.
 *
 * @param {number} surpriseBits - raw surprise from surpriseAt
 * @param {object} context - { terrain, stance, operator } of the content
 * @param {object} focus - current focus coordinate
 * @returns {number} felt surprise (0-1 normalized)
 */
export function feltSurprise(surpriseBits, context, focus) {
  if (!focus || !context) return Math.min(1, surpriseBits / 10);
  let relevance = 0;
  if (context.terrain === focus.terrain) relevance += 0.4;
  if (context.stance === focus.stance) relevance += 0.3;
  if (context.operator === focus.operator) relevance += 0.3;
  const raw = surpriseBits * (0.3 + 0.7 * relevance);
  return Math.min(1, raw / 10);
}

/**
 * forwardScore(unit, history) -> number
 *
 * Forward-looking surprise: how much new information would this
 * unit add to the reading, given what's already been read?
 * Computed as the KL divergence between the unit's word dist
 * and the cumulative word dist of all prior units.
 *
 * Higher = more novel, more worth including in a fold.
 *
 * @param {object} unit - { text, coord? }
 * @param {Array<{text: string}>} history - previously read units
 * @returns {number} forward score (bits of new information)
 */
export function forwardScore(unit, history) {
  if (!unit?.text) return 0;
  const unitDist = wordFrequencies(unit.text);
  if (history.length === 0) {
    // First unit: surprise is self-entropy (how distinctive is this text)
    let entropy = 0;
    for (const p of unitDist.values()) {
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
  }
  // Build cumulative background from history
  const combined = new Map();
  let totalWords = 0;
  for (const h of history) {
    const dist = wordFrequencies(h.text);
    for (const [w, p] of dist) {
      combined.set(w, (combined.get(w) ?? 0) + p);
      totalWords += 1;
    }
  }
  // Normalize
  if (totalWords > 0) {
    for (const [w, p] of combined) combined.set(w, p / totalWords);
  }
  return klDivergence(unitDist, combined);
}

/**
 * noveltyReserve(unit, history, threshold) -> { score, isNew, reason }
 *
 * Determines whether a unit is "novel enough" to include, based on
 * forward score against a Born-null threshold. If the forward score
 * exceeds the threshold, the unit is genuinely new information.
 *
 * @param {object} unit - { text, coord? }
 * @param {Array<{text: string}>} history - previously read units
 * @param {number} threshold - Born-null threshold for novelty (from deriveNull)
 * @returns {{ score: number, isNew: boolean, reason: string }}
 */
export function noveltyReserve(unit, history, threshold) {
  const score = forwardScore(unit, history);
  const isNew = score >= threshold;
  return {
    score,
    isNew,
    reason: isNew
      ? `forward score ${score.toFixed(3)} exceeds novelty threshold ${threshold.toFixed(3)}`
      : `forward score ${score.toFixed(3)} below novelty threshold ${threshold.toFixed(3)}`,
  };
}

/**
 * informationContent(text, backgroundFrequencies) -> number
 *
 * Self-information (surprisal) of a text: -log2(P(text | background)).
 * This is the per-word average information content.
 *
 * @param {string} text
 * @param {Map<string, number>} backgroundFrequencies
 * @returns {number} average bits per word
 */
export function informationContent(text, backgroundFrequencies) {
  const dist = wordFrequencies(text);
  const epsilon = 1e-10;
  let total = 0;
  let count = 0;
  for (const [word, prob] of dist) {
    const bg = Math.max(backgroundFrequencies.get(word) ?? epsilon, epsilon);
    total += prob * (-Math.log2(bg));
    count += 1;
  }
  return count > 0 ? total / count : 0;
}
