// j-lens-probe.js — Averaged-Jacobian probe for the watchmaker loop.
//
// A sensor that reads what the local model is "about to commit to" at
// candidate fold boundaries, then reports whether the boundary marks a
// real sub-assembly worth checkpointing.
//
// Technique (from the J-space paper's broadcast-head methodology):
//   At each candidate boundary, treat the cube classifier (keyword-frequency
//   estimator) as a differentiable map from text → amplitude distribution over
//   {operator, terrain, stance}.  The Jacobian of this map is
//   ∂amplitude_i / ∂feature_j — how much each classification dimension
//   responds to a unit change in each input feature (word frequency).
//
//   At a real topic/conceptual boundary, the Jacobian norm is high: the
//   classifier is "deciding" between two regimes and small feature changes
//   produce large classification changes.  Between boundaries the Jacobian
//   norm is low: the classifier is already committed.
//
//   Averaging over a local window and over a corpus stabilises the signal.
//
// This probe sits BETWEEN boundary detection and fold checkpointing:
//   1. detectBoundaries finds candidate positions (lexical shift).
//   2. The J-lens probe reads each candidate (interpretive shift).
//   3. The catalog/checkpoint decides whether to store a sub-assembly.
//
// The probe never gates — it reports.  The catalog decides.

import { classifyAmplitudes, advisoryClassifyTerrain, advisoryClassifyStance, advisoryClassifyOperator } from "../../cube/index.js";

// ── Feature extraction ──────────────────────────────────────────────────────
//
// The cube classifier reads text through keyword-pattern matching.  Its input
// features are word counts.  For the Jacobian we need a fixed-dimensional
// feature space.  We use the top-K most frequent words in a frame as the
// feature basis, plus the cube's own strong/weak pattern hit counts.

function frameFeatures(frame) {
  const words = frame.dist ? [...frame.dist.entries()] : [];
  const freq = {};
  for (const [w, p] of words) freq[w] = p;
  return freq;
}

// ── Amplitude vector for one dimension ─────────────────────────────────────
//
// Returns the amplitude distribution as a flat array, sorted by label.

function amplitudeVector(text, table, key) {
  const t = String(text ?? "");
  const scored = table.map((row) => ({ label: row[key], score: evidenceHits(t, row) }));
  const total = scored.reduce((s, r) => s + r.score, 0);
  return scored.map((r) => ({ label: r.label, amplitude: total > 0 ? r.score / total : 0 }));
}

function evidenceHits(t, row) {
  const strong = (t.match(row.strong) ?? []).length;
  const weak = (t.match(row.weak) ?? []).length;
  return Math.log1p(strong) + 0.15 * Math.log1p(weak);
}

// ── Empirical Jacobian via finite differences ──────────────────────────────
//
// For each word in a frame, perturb its count and measure the change in
// classifier amplitudes.  The Jacobian is the matrix of amplitude
// differences.  The probe averages this over a window to get a stable signal.
//
// NOTE: This is an empirical (finite-difference) Jacobian, not analytic.
// The cube is a keyword-frequency estimator with no neural weights, so there
// is no backprop graph.  The empirical measurement is the correct analog:
// "how much does the classification change if the text changed slightly?"

function empiricalJacobian(text, table, key) {
  const base = amplitudeVector(text, table, key);
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const seen = new Set();
  const jacobian = {};

  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    // Remove one occurrence of this word
    const perturbed = text.replace(new RegExp(`\\b${escapeRegex(word)}\\b`, "i"), "");
    if (perturbed === text) continue;
    const perturbedAmps = amplitudeVector(perturbed, table, key);
    // Compute ∂amplitude for each category
    const delta = {};
    for (let i = 0; i < base.length; i++) {
      const diff = base[i].amplitude - perturbedAmps[i].amplitude;
      if (Math.abs(diff) > 1e-6) {
        delta[base[i].label] = +diff.toFixed(6);
      }
    }
    if (Object.keys(delta).length > 0) {
      jacobian[word] = delta;
    }
  }

  return jacobian;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Jacobian norm ──────────────────────────────────────────────────────────
//
// The total sensitivity: sum of absolute amplitude changes across all
// categories and all perturbed words, averaged per word.

function jacobianNorm(jacobian) {
  const words = Object.keys(jacobian);
  if (words.length === 0) return 0;
  let totalChange = 0;
  let totalEntries = 0;
  for (const word of words) {
    for (const label of Object.keys(jacobian[word])) {
      totalChange += Math.abs(jacobian[word][label]);
      totalEntries++;
    }
  }
  // Normalise: average absolute change per (word, category) pair
  return totalEntries > 0 ? totalChange / totalEntries : 0;
}

// ── Commitment signal ──────────────────────────────────────────────────────
//
// How stably is the classifier committed to its current interpretation?
// Low commitment = high Jacobian norm = the classifier is at a decision
// boundary = possible real sub-assembly boundary.

function commitmentSignal(text) {
  const fullAmps = classifyAmplitudes(text);

  // Jacobian for each dimension
  const terrainJacobian = empiricalJacobian(text, TERRAIN_TABLE, "terrain");
  const stanceJacobian = empiricalJacobian(text, STANCE_TABLE, "stance");

  // Norms
  const terrainNorm = jacobianNorm(terrainJacobian);
  const stanceNorm = jacobianNorm(stanceJacobian);

  // Commitment: inverse of norm, scaled to [0, 1]
  // High commitment (close to 1) = stable classification
  // Low commitment (close to 0) = at a decision boundary
  const MAX_EXPECTED_NORM = 0.5;
  const commitment = Math.max(0, Math.min(1, 1 - (terrainNorm + stanceNorm) / (2 * MAX_EXPECTED_NORM)));

  // Dominant category stability: does the argmax match the most common
  // category in the frame's word distribution?
  const terrainLabel = advisoryClassifyTerrain(text);
  const stanceLabel = advisoryClassifyStance(text);

  return {
    commitment: +commitment.toFixed(4),
    terrainNorm: +terrainNorm.toFixed(6),
    stanceNorm: +stanceNorm.toFixed(6),
    terrainLabel,
    stanceLabel,
    // The probe's primary output: is this a likely sub-assembly boundary?
    // True when commitment is low — the classifier hasn't locked in yet
    isBoundaryCandidate: commitment < 0.5,
  };
}

// ── Windowed probe (the actual sensor) ─────────────────────────────────────
//
// The averaged-Jacobian technique: average commitment over a local window
// of frames to get a stable signal.  A window with persistently low
// commitment followed by a jump to high commitment marks a real regime
// shift — the classifier "decided" on a new interpretation.

const TERRAIN_TABLE = [
  { terrain: "Void",       strong: /\b(void|absence|emptiness|nothingness|oblivion|silence|vacant|barren)\b/gi,
                           weak:   /\b(nothing|empty|missing|none|null|no\s+one)\b/gi },
  { terrain: "Entity",     strong: /\b(who|person|people|name|identity|character|figure|individual|actor|agent|my\s+name|I\s+am)\b/gi,
                           weak:   /\b(he|she|they|him|her|his|their|them)\b/gi },
  { terrain: "Kind",       strong: /\b(type|kind|category|class|definition|species|genre|sort|variety)\b/gi,
                           weak:   /\b(is\s+a|are\s+a|was\s+a)\b/gi },
  { terrain: "Field",      strong: /\b(data|information|content|passage|quote|narrative|document|corpus|record)\b/gi,
                           weak:   /\b(text|context|chapter|book|story)\b/gi },
  { terrain: "Link",       strong: /\b(relation|connection|link|dependency|bond|ally|enemy|reports?\s+to|works?\s+for|relates)\b/gi,
                           weak:   /\b(between|friend|with)\b/gi },
  { terrain: "Network",    strong: /\b(system|network|empire|republic|government|army|legion|senate|organization|institution|regiment|society)\b/gi,
                           weak:   /\b(structure|state)\b/gi },
  { terrain: "Atmosphere", strong: /\b(feeling|feelings|mood|emotion|passion|fear|anger|love|loved|hate|desire|sentiment|atmosphere|joy|joyful|grief|sorrow|tenderness|shame|despair|rapture|terror|pity|weep|wept|weeping|tears|sobbed|sobbing|trembled|trembling|blushed)\b/gi,
                           weak:   /\b(tone|happy|sad|glad|afraid)\b/gi },
  { terrain: "Lens",       strong: /\b(perspective|standpoint|angle|lens|interpretation|analysis|stance|posture|point\s+of\s+view|in\s+his\s+eyes|in\s+her\s+eyes|as\s+if\s+seeing)\b/gi,
                           weak:   /\b(view|focus|frame|reading|seemed\s+to\s+him|seemed\s+to\s+her)\b/gi },
  { terrain: "Paradigm",   strong: /\b(theory|framework|paradigm|worldview|philosophy|doctrine|canon|providence|destiny|the\s+meaning\s+of\s+life|God's\s+will|first\s+principles)\b/gi,
                           weak:   /\b(model|principle|axiom|fate|truth|faith|law\s+of)\b/gi },
];

const STANCE_TABLE = [
  { stance: "Clearing",    strong: /\b(clear|remove|delete|purge|wipe|erase|clean|abandon|renounce)\b/gi,
                           weak:   /\b(empty|leave|left)\b/gi },
  { stance: "Dissecting",  strong: /\b(analyze|analyse|break\s+down|examine|inspect|dissect|deconstruct|debug|scrutin)\w*\b/gi,
                           weak:   /\b(compare|study)\b/gi },
  { stance: "Unraveling",  strong: /\b(interpret|significance|decipher|unravel|make\s+sense\s+of|puzzle)\w*\b/gi,
                           weak:   /\b(meaning|why|reason|purpose|explain)\b/gi },
  { stance: "Tending",     strong: /\b(nurse|nursed|nursing|tend|tended|care\s+for|nurture|sustain|preserve|comfort|soothe|watch\s+over)\b/gi,
                           weak:   /\b(maintain|support|help|assist|care)\b/gi },
  { stance: "Binding",     strong: /\b(bind|bound|betroth|engage[dm]|marry|married|wed|vow|pledge|unite|attach)\w*\b/gi,
                           weak:   /\b(connect|link|relate|depend|bond|join|associate)\b/gi },
  { stance: "Tracing",     strong: /\b(tell\s+me|describe|summarize|summarise|overview|trace|timeline|recount)\b/gi,
                           weak:   /\b(what|track|follow|path|history)\b/gi },
  { stance: "Cultivating", strong: /\b(realiz|realis|understood|recogniz|recognis|came\s+to\s+see|dawned|matured|grew\s+to|learned\s+that|for\s+the\s+first\s+time)\w*\b/gi,
                           weak:   /\b(grow|develop|evolve|learn|understand|deepen|progress)\b/gi },
  { stance: "Making",      strong: /\b(create|construct|implement|forge|fashion)\w*\b/gi,
                           weak:   /\b(make|build|produce|generate)\b/gi },
  { stance: "Composing",   strong: /\b(orchestrate|compose|arrange|layout|choreograph)\w*\b/gi,
                           weak:   /\b(organize|organise|structure|design|plan)\b/gi },
];

// ── Exported sensor ────────────────────────────────────────────────────────

/**
 * probeFoldBoundary(frames, boundaryOrders, options) -> Array<BoundaryProbe>
 *
 * Given a set of frames and candidate boundary positions (from
 * detectBoundaries), compute the J-lens commitment signal for each
 * boundary.  Returns an array of probe results, one per boundary,
 * sorted by boundary order.
 *
 * Each result includes:
 *   - order / offset: the boundary position
 *   - text: the frame text at the boundary
 *   - commitment: [0, 1] how stably the classifier is committed (low =
 *     possible boundary worth checkpointing)
 *   - terrainNorm / stanceNorm: the Jacobian norms
 *   - isBoundaryCandidate: true when commitment < threshold
 *   - windowCommitment: the AVERAGE commitment over the sliding
 *     window surrounding the boundary — this is the "averaged
 *     Jacobian" signal, stable across frames
 *
 * @param {Array<{order, offset, text, dist}>} frames
 * @param {Array<{order, offset}>} boundaryOrders
 * @param {number} options.windowRadius — frames on each side to average
 * @param {number} options.threshold — commitment below this is a candidate
 * @returns {Array<{order, offset, text, commitment, terrainNorm, stanceNorm, isBoundaryCandidate, windowCommitment}>}
 */
export function probeFoldBoundary(frames, boundaryOrders, options = {}) {
  const { windowRadius = 3, threshold = 0.5 } = options;
  if (!frames.length || !boundaryOrders.length) return [];

  const frameByOrder = new Map(frames.map((f) => [f.order, f]));

  // Precompute commitment for every frame (cached for window averages)
  const commitmentCache = new Map();
  for (const f of frames) {
    commitmentCache.set(f.order, commitmentSignal(f.text));
  }

  const results = [];

  for (const boundary of boundaryOrders) {
    const frame = frameByOrder.get(boundary.order);
    if (!frame) continue;

    const probe = commitmentSignal(frame.text);

    // Window: average commitment over [order - radius, order + radius]
    let windowSum = 0;
    let windowCount = 0;
    for (let o = boundary.order - windowRadius; o <= boundary.order + windowRadius; o++) {
      const cached = commitmentCache.get(o);
      if (cached) {
        windowSum += cached.commitment;
        windowCount++;
      }
    }
    const windowCommitment = windowCount > 0 ? windowSum / windowCount : probe.commitment;

    // Cross-window gradient: is the commitment RISING or FALLING through
    // this boundary?  A rising commitment = entering stable regime (exit
    // from a transition).  A falling commitment = entering a transition.
    const beforeWindow = [];
    const afterWindow = [];
    for (let o = boundary.order - windowRadius; o < boundary.order; o++) {
      const cached = commitmentCache.get(o);
      if (cached) beforeWindow.push(cached.commitment);
    }
    for (let o = boundary.order + 1; o <= boundary.order + windowRadius; o++) {
      const cached = commitmentCache.get(o);
      if (cached) afterWindow.push(cached.commitment);
    }
    const beforeMean = beforeWindow.length > 0
      ? beforeWindow.reduce((s, v) => s + v, 0) / beforeWindow.length
      : probe.commitment;
    const afterMean = afterWindow.length > 0
      ? afterWindow.reduce((s, v) => s + v, 0) / afterWindow.length
      : probe.commitment;
    const commitmentGradient = afterMean - beforeMean;

    results.push({
      order: boundary.order,
      offset: frame.offset,
      text: frame.text.slice(0, 200),
      commitment: probe.commitment,
      terrainNorm: probe.terrainNorm,
      stanceNorm: probe.stanceNorm,
      terrainLabel: probe.terrainLabel,
      stanceLabel: probe.stanceLabel,
      windowCommitment: +windowCommitment.toFixed(4),
      commitmentGradient: +commitmentGradient.toFixed(4),
      isBoundaryCandidate: windowCommitment < threshold,
      // A real sub-assembly boundary has TWO signatures:
      //   1. Low window commitment (classifier hasn't locked in)
      //   2. Rising commitment gradient (about to lock into a new regime)
      //   OR falling commitment gradient (exiting a stable regime)
      // A spurious boundary has low commitment with FLAT gradient (noise).
      isSubAssembly: windowCommitment < threshold && Math.abs(commitmentGradient) > 0.05,
    });
  }

  return results.sort((a, b) => a.order - b.order);
}

/**
 * probeTextAtBoundary(text, options) -> BoundaryProbe
 *
 * Probe a single text passage (not a frame sequence).  Useful for
 * standalone testing or for probing a candidate fold region before
 * deciding whether to checkpoint.
 *
 * @param {string} text
 * @param {object} options
 * @returns {{ commitment, terrainNorm, stanceNorm, terrainLabel, stanceLabel, isBoundaryCandidate }}
 */
export function probeTextAtBoundary(text) {
  return commitmentSignal(text);
}
