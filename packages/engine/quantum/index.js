/**
 * Quantum Mechanics Core for EO Reader Engine
 *
 * The fundamental operation: fold → project → measure → decohere
 *
 * This is the small subunit of the ribosome.
 * It reads the mRNA (raw observations) and translates it into
 * the language of the cube (amplitude vectors).
 *
 * Core insight: "state is always a projection of the fold"
 * - The FOLD compresses reality into bounded amplitude vectors
 * - The BORN RULE projects folds into definite outcomes
 * - STATE exists only after measurement
 * - Before measurement, there's only the fold
 */

// ── Constants ──

import { OPERATOR_CODES } from "@eoreader/spec/operators";
import { TERRAINS as SPEC_TERRAINS, STANCES as SPEC_STANCES } from "@eoreader/spec/cube";

// The three face vocabularies come from the spec — the single source of
// truth — in helix order (NUL, SIG, INS, SEG, CON, SYN, DEF, EVA, REC).
// Order is load-bearing: amplitude ties collapse to the earliest key in
// face order, so "earliest in the helix wins" is the explicit tie rule.
export const OPERATORS = OPERATOR_CODES;
export const TERRAINS = SPEC_TERRAINS;
export const STANCES = SPEC_STANCES;

// Uncertainty constant (I.34.27: ℏ)
export const UNCERTAINTY_H = 0.1;

// Decoherence time constant (ms) — exponential decay I.6.2a
const DECOHERENCE_TAU = 3600000;

// Gaussian kernel bandwidth (I.6.2: σ) — controls amplitude smoothing
const GAUSSIAN_SIGMA = 0.4;

// Anisotropic scattering parameters (III.17.37: β(1 + α·cosθ))
const SCATTER_BETA = 1.0;
const SCATTER_ALPHA = 0.3;

// ── Gaussian Kernel (I.6.2: e^(−(θ/σ)²/2) / (√(2π)·σ)) ──

/**
 * Gaussian kernel score between two values.
 * Higher when values are close, falls off smoothly with distance.
 *
 * @param {number} x - First value
 * @param {number} y - Second value
 * @param {number} sigma - Bandwidth (default GAUSSIAN_SIGMA)
 * @returns {number} Gaussian similarity [0, 1]
 */
export function gaussianKernel(x, y, sigma = GAUSSIAN_SIGMA) {
  const diff = x - y;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

/**
 * Gaussian-weighted similarity between two amplitude vectors.
 * Each dimension pair is scored via Gaussian kernel, then averaged.
 * Replaces raw keyword counting with a smooth distance metric.
 *
 * @param {object} ampA - Amplitude vector A
 * @param {object} ampB - Amplitude vector B
 * @param {number} sigma - Bandwidth
 * @returns {number} Gaussian similarity [0, 1]
 */
export function gaussianAmplitudeSimilarity(ampA, ampB, sigma = GAUSSIAN_SIGMA) {
  const dims = new Set([...Object.keys(ampA), ...Object.keys(ampB)]);
  if (dims.size === 0) return 0;
  let sum = 0;
  for (const dim of dims) {
    sum += gaussianKernel(ampA[dim] || 0, ampB[dim] || 0, sigma);
  }
  return sum / dims.size;
}

// ── The Fold ──

/**
 * The fold is the fundamental operation.
 * It takes raw text and compresses it into amplitude vectors.
 *
 * A fold is NOT a state vector. It's the thing that generates state vectors.
 * It's the wave function before measurement.
 *
 * @param {string} text - Raw text to fold
 * @param {object} priors - Accumulated knowledge (termFreq, entities, etc.)
 * @returns {object} A fold: { operator: {amp}, terrain: {amp}, stance: {amp} }
 */
export function fold(text, priors = null, surfaces = null) {
  const rawTokens = (text || "").split(/\s+/).filter(w => w.length > 2);
  const words = rawTokens.map(w => w.toLowerCase());
  const wordSet = new Set(words);
  const wordCount = words.length;

  if (wordCount === 0) {
    return emptyFold();
  }

  // Proper nouns must be counted before lowercasing destroys the case
  // evidence. Unicode-aware so accented names (Natásha, Hélène) count.
  const properNounCount = rawTokens.filter(w => /^\p{Lu}\p{Ll}/u.test(w)).length;

  const operatorAmplitudes = computeOperatorAmplitudes(words, wordSet, wordCount, priors);
  const terrainAmplitudes = computeTerrainAmplitudes(words, wordSet, wordCount, priors, surfaces, properNounCount);
  const stanceAmplitudes = computeStanceAmplitudes(words, wordSet, wordCount, priors);

  return {
    operator: operatorAmplitudes,
    terrain: terrainAmplitudes,
    stance: stanceAmplitudes,
    timestamp: null
  };
}

// A uniform face asserts nothing: every basis key equally likely, the
// maximum-entropy expression of absence. Each face is normalized over its
// OWN nine keys — mixing the three vocabularies into one object would make
// grain coherence unverifiable and leave the fold unnormalized (‖ψ‖²=3).
function uniformFace(keys) {
  const amps = {};
  const amp = 1 / Math.sqrt(keys.length);
  for (const key of keys) amps[key] = amp;
  return amps;
}

function emptyFold() {
  return {
    operator: uniformFace(OPERATORS),
    terrain: uniformFace(TERRAINS),
    stance: uniformFace(STANCES),
    timestamp: null
  };
}

// ── Amplitude Computation (No Regex) ──

function computeOperatorAmplitudes(words, wordSet, wordCount, priors) {
  const amps = {};
  for (const op of OPERATORS) amps[op] = 0;

  const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / wordCount;
  if (avgWordLen > 5) {
    amps.DEF += 0.15;
    amps.EVA += 0.1;
    amps.SYN += 0.05;
  }

  const actionWords = new Set(['is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'can', 'could', 'should', 'may', 'might']);
  if (words.some(w => actionWords.has(w))) {
    amps.SIG += 0.15;
  }

  const connectWords = new Set(['and', 'but', 'or', 'with', 'for', 'to', 'from', 'by', 'in', 'on', 'at']);
  const connectCount = words.filter(w => connectWords.has(w)).length;
  if (connectCount > 0) {
    amps.CON += connectCount * 0.1;
  }

  const negWords = new Set(['not', 'no', 'never', 'nothing', 'none', 'neither', 'nor']);
  if (words.some(w => negWords.has(w))) {
    amps.NUL += 0.2;
  }

  const uniqueRatio = wordSet.size / wordCount;
  if (uniqueRatio < 0.7) {
    amps.SYN += 0.15;
  }

  if (priors?.termFreq) {
    let entityCount = 0;
    for (const word of wordSet) {
      if (priors.entities?.has(word)) entityCount++;
    }
    if (entityCount > 0) {
      amps.SIG += entityCount * 0.1;
      amps.CON += entityCount * 0.05;
    }

    let rareCount = 0;
    for (const word of wordSet) {
      const freq = priors.termFreq.get(word) || 0;
      if (freq > 0 && freq < 3) rareCount++;
    }
    if (rareCount > 0) {
      amps.DEF += rareCount * 0.08;
    }
  }

  // No operator evidence at all: assert nothing (uniform), never a
  // fabricated default toward specific operators.
  if (Object.values(amps).every((a) => a === 0)) return uniformFace(OPERATORS);
  normalizeAmplitudes(amps);
  return amps;
}

function computeTerrainAmplitudes(words, wordSet, wordCount, priors, surfaces, properNounCount = 0) {
  const amps = {};
  for (const terr of TERRAINS) amps[terr] = 0;

  const personIndicators = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'who', 'whom']);
  const priorEntityCount = priors?.entities ? words.filter((w) => priors.entities.has(w)).length : 0;
  const personCount = words.filter(w => personIndicators.has(w)).length + properNounCount + priorEntityCount;
  if (personCount > 0) amps.Entity += personCount * 0.15;

  // Anchored surfaces are declared referents — direct Entity-terrain evidence.
  if (surfaces?.length) amps.Entity += surfaces.length * 0.15;

  const relWords = new Set(['with', 'for', 'from', 'to', 'by', 'about', 'between', 'among']);
  const relCount = words.filter(w => relWords.has(w)).length;
  if (relCount > 0) amps.Link += relCount * 0.12;

  const systemWords = new Set(['system', 'network', 'structure', 'organization', 'group', 'team', 'company']);
  const systemCount = words.filter(w => systemWords.has(w)).length;
  if (systemCount > 0) amps.Network += systemCount * 0.2;

  const abstractWords = new Set(['idea', 'concept', 'theory', 'model', 'framework', 'principle', 'philosophy']);
  const abstractCount = words.filter(w => abstractWords.has(w)).length;
  if (abstractCount > 0) amps.Paradigm += abstractCount * 0.2;

  const emotionWords = new Set(['love', 'hate', 'fear', 'anger', 'joy', 'sad', 'happy', 'angry', 'afraid']);
  const emotionCount = words.filter(w => emotionWords.has(w)).length;
  if (emotionCount > 0) amps.Atmosphere += emotionCount * 0.2;

  const contentWords = new Set(['text', 'data', 'information', 'content', 'document', 'file', 'page', 'chapter']);
  const contentCount = words.filter(w => contentWords.has(w)).length;
  if (contentCount > 0) amps.Field += contentCount * 0.2;

  const defWords = new Set(['is', 'are', 'was', 'were', 'means', 'defined', 'called', 'named']);
  const defCount = words.filter(w => defWords.has(w)).length;
  if (defCount > 0) amps.Kind += defCount * 0.15;

  const voidWords = new Set(['nothing', 'empty', 'void', 'null', 'none', 'absence', 'missing']);
  const voidCount = words.filter(w => voidWords.has(w)).length;
  if (voidCount > 0) amps.Void += voidCount * 0.25;

  const perspectiveWords = new Set(['view', 'perspective', 'angle', 'frame', 'lens', 'interpret', 'analyze']);
  const perspectiveCount = words.filter(w => perspectiveWords.has(w)).length;
  if (perspectiveCount > 0) amps.Lens += perspectiveCount * 0.2;

  // No terrain evidence: assert nothing (uniform), never a fabricated
  // Field/Entity default.
  if (Object.values(amps).every((a) => a === 0)) return uniformFace(TERRAINS);
  normalizeAmplitudes(amps);
  return amps;
}

function computeStanceAmplitudes(words, wordSet, wordCount, priors) {
  const amps = {};
  for (const st of STANCES) amps[st] = 0;

  const questionWords = new Set(['what', 'who', 'when', 'where', 'why', 'how']);
  if (words.some(w => questionWords.has(w))) {
    amps.Tracing += 0.2;
    amps.Dissecting += 0.1;
  }

  const imperativeWords = new Set(['make', 'create', 'build', 'write', 'generate', 'produce', 'help', 'assist']);
  if (words.some(w => imperativeWords.has(w))) {
    amps.Making += 0.2;
    amps.Tending += 0.15;
  }

  const analysisWords = new Set(['analyze', 'examine', 'inspect', 'compare', 'evaluate', 'assess', 'measure']);
  if (words.some(w => analysisWords.has(w))) {
    amps.Dissecting += 0.25;
  }

  const connectWords = new Set(['connect', 'link', 'relate', 'bind', 'attach', 'join', 'combine']);
  if (words.some(w => connectWords.has(w))) {
    amps.Binding += 0.25;
  }

  const interpretWords = new Set(['interpret', 'meaning', 'significance', 'purpose', 'reason', 'why']);
  if (words.some(w => interpretWords.has(w))) {
    amps.Unraveling += 0.25;
  }

  const growthWords = new Set(['grow', 'develop', 'evolve', 'learn', 'understand', 'improve']);
  if (words.some(w => growthWords.has(w))) {
    amps.Cultivating += 0.25;
  }

  const orgWords = new Set(['organize', 'arrange', 'structure', 'design', 'plan', 'layout']);
  if (words.some(w => orgWords.has(w))) {
    amps.Composing += 0.25;
  }

  const clearWords = new Set(['clear', 'clean', 'empty', 'remove', 'delete', 'purge', 'reset']);
  if (words.some(w => clearWords.has(w))) {
    amps.Clearing += 0.25;
  }

  const trackWords = new Set(['track', 'follow', 'trace', 'path', 'history', 'timeline', 'log']);
  if (words.some(w => trackWords.has(w))) {
    amps.Tracing += 0.2;
  }

  // No stance evidence: assert nothing (uniform), never a fabricated
  // Tracing default.
  if (Object.values(amps).every((a) => a === 0)) return uniformFace(STANCES);
  normalizeAmplitudes(amps);
  return amps;
}

// ── Projection (Born Rule) ──

/**
 * Project foldA onto foldB using the Born rule: |⟨ψ|φ⟩|²
 *
 * @param {object} foldA - The system fold
 * @param {object} foldB - The measurement basis fold
 * @returns {number} Probability of this projection [0, 1]
 */
export function project(foldA, foldB) {
  const opIP = innerProductAmplitudes(foldA.operator, foldB.operator);
  const terrIP = innerProductAmplitudes(foldA.terrain, foldB.terrain);
  const stanceIP = innerProductAmplitudes(foldA.stance, foldB.stance);

  const amplitude = opIP * terrIP * stanceIP;
  const prob = amplitude * amplitude;

  return Math.max(0, Math.min(1, prob));
}

function innerProductAmplitudes(ampA, ampB) {
  const dims = new Set([...Object.keys(ampA), ...Object.keys(ampB)]);
  let ip = 0;
  for (const dim of dims) {
    ip += (ampA[dim] || 0) * (ampB[dim] || 0);
  }
  return ip;
}

/**
 * Convert fold to definite state (collapse).
 * This IS a measurement — it destroys superposition.
 */
export function foldToState(fold) {
  return {
    operator: amplitudeToProbability(fold.operator),
    terrain: amplitudeToProbability(fold.terrain),
    stance: amplitudeToProbability(fold.stance)
  };
}

function amplitudeToProbability(amplitudes) {
  const probs = {};
  for (const [dim, amp] of Object.entries(amplitudes)) {
    probs[dim] = amp * amp;
  }
  return probs;
}

// ── Interference ──

/**
 * Compute interference between folds.
 * Reinforcing folds boost each other; contradictory folds cancel.
 *
 * Uses two-source interference (I.37.4): I₁+I₂+2√(I₁I₂)·cosδ
 * with anisotropic scattering kernel (III.17.37): β(1+α·cosθ)
 *
 * @param {object} queryFold - The measurement basis
 * @param {Array} folds - Folds to interfere
 * @returns {Array} Interfered probabilities
 */
export function interfere(queryFold, folds) {
  const amplitudes = folds.map(fold => {
    const opIP = innerProductAmplitudes(queryFold.operator, fold.operator);
    const terrIP = innerProductAmplitudes(queryFold.terrain, fold.terrain);
    const stanceIP = innerProductAmplitudes(queryFold.stance, fold.stance);
    return opIP * terrIP * stanceIP;
  });

  return amplitudes.map((ampI, i) => {
    // Individual intensity: I₁ = |amp|²
    let intensity = ampI * ampI;

    // Cross-interference: 2√(I₁I₂) · kernel(δ)
    for (let j = 0; j < amplitudes.length; j++) {
      if (i === j) continue;
      const ampJ = amplitudes[j];
      const phase = computePhase(folds[i], folds[j]);
      const intensityJ = ampJ * ampJ;

      // Anisotropic scattering: β(1 + α·cosδ) — forward-peaked for
      // correlated folds, suppresses backscattering
      const kernel = SCATTER_BETA * (1 + SCATTER_ALPHA * Math.cos(phase));
      intensity += 2 * Math.sqrt(ampI * ampI * intensityJ) * kernel * Math.cos(phase);
    }

    return Math.max(0, Math.min(1, intensity));
  });
}

/**
 * Compute phase difference between folds.
 * Uses law of cosines (I.29.16): √(x₁² + x₂² − 2x₁x₂·cos(Δθ))
 * instead of simple linear sum, giving proper angular distance on the
 * amplitude sphere.
 */
function computePhase(foldA, foldB) {
  const terrDist = 1 - innerProductAmplitudes(foldA.terrain, foldB.terrain);
  const stanceDist = 1 - innerProductAmplitudes(foldA.stance, foldB.stance);
  // Phase angle: how correlated are the terrain and stance differences
  const terrIP = innerProductAmplitudes(foldA.terrain, foldB.terrain);
  const stanceIP = innerProductAmplitudes(foldA.stance, foldB.stance);
  const deltaTheta = Math.acos(Math.max(-1, Math.min(1, terrIP * stanceIP + Math.sqrt(Math.max(0, (1 - terrIP * terrIP) * (1 - stanceIP * stanceIP))))));
  // Law of cosines combining the two distance components
  const phase = Math.sqrt(terrDist * terrDist + stanceDist * stanceDist
    - 2 * terrDist * stanceDist * Math.cos(deltaTheta));
  return phase * Math.PI;
}

// ── Measurement Backaction ──

/**
 * Measure a fold. This changes the fold.
 *
 * Before measurement: fold exists in superposition
 * After measurement: fold is projected towards measurement basis
 *
 * Uses relativistic velocity addition (I.16.6): (u+v)/(1+uv/c²)
 * for blending amplitudes — naturally caps at 1.0 and gives
 * sublinear combination for large values.
 *
 * @param {object} fold - The fold to measure
 * @param {object} basis - The measurement basis
 * @param {number} strength - Measurement strength [0, 1]
 * @param {object} opts - Options: { oscillate: false, oscillationCount: 1 }
 * @returns {object} Modified fold
 */
export function measureFold(fold, basis, strength = 0.3, opts = {}) {
  const { oscillate = false, oscillationCount = 1 } = opts;
  const newOperator = {};
  const newTerrain = {};
  const newStance = {};

  // Oscillatory backaction (III.8.54: sin²(Et/ℏ))
  // Repeated measurements cause the fold to oscillate rather than
  // monotonically converge. The effective strength cycles through
  // sin²(n·π/2) peaks.
  let effectiveStrength = strength;
  if (oscillate && oscillationCount > 1) {
    effectiveStrength = strength * Math.sin(oscillationCount * Math.PI / 2) ** 2;
  }

  // Relativistic velocity addition blend: (u+v)/(1+uv)
  // Replaces linear interpolation — sublinear for same-sign amplitudes,
  // naturally bounded, and associative.
  const blend = (u, v) => {
    const uv = u * v;
    if (Math.abs(uv) < 1e-10) return u + v;
    return (u + v) / (1 + uv);
  };

  for (const [op, amp] of Object.entries(fold.operator)) {
    const basisAmp = basis.operator[op] || 0;
    newOperator[op] = blend(amp * (1 - effectiveStrength), basisAmp * effectiveStrength);
  }

  for (const [terr, amp] of Object.entries(fold.terrain)) {
    const basisAmp = basis.terrain[terr] || 0;
    newTerrain[terr] = blend(amp * (1 - effectiveStrength), basisAmp * effectiveStrength);
  }

  for (const [st, amp] of Object.entries(fold.stance)) {
    const basisAmp = basis.stance[st] || 0;
    newStance[st] = blend(amp * (1 - effectiveStrength), basisAmp * effectiveStrength);
  }

  normalizeAmplitudes(newOperator);
  normalizeAmplitudes(newTerrain);
  normalizeAmplitudes(newStance);

  return {
    operator: newOperator,
    terrain: newTerrain,
    stance: newStance,
    timestamp: null
  };
}

function normalizeAmplitudes(amplitudes) {
  let sumSquares = 0;
  for (const amp of Object.values(amplitudes)) {
    sumSquares += amp * amp;
  }

  if (sumSquares > 0) {
    const norm = Math.sqrt(sumSquares);
    for (const key of Object.keys(amplitudes)) {
      amplitudes[key] /= norm;
    }
  }
}

// ── Entanglement ──

/**
 * Check if two folds are entangled.
 * Entanglement = shared information = high correlation.
 */
export function areEntangled(foldA, foldB) {
  const opCorr = correlation(foldA.operator, foldB.operator);
  const terrCorr = correlation(foldA.terrain, foldB.terrain);
  const stanceCorr = correlation(foldA.stance, foldB.stance);

  const avgCorr = (opCorr + terrCorr + stanceCorr) / 3;
  return avgCorr > 0.8;
}

function correlation(ampA, ampB) {
  const keys = new Set([...Object.keys(ampA), ...Object.keys(ampB)]);
  const valsA = [];
  const valsB = [];

  for (const key of keys) {
    valsA.push(ampA[key] || 0);
    valsB.push(ampB[key] || 0);
  }

  const n = valsA.length;
  if (n === 0) return 0;

  const meanA = valsA.reduce((a, b) => a + b, 0) / n;
  const meanB = valsB.reduce((a, b) => a + b, 0) / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const dA = valsA[i] - meanA;
    const dB = valsB[i] - meanB;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  const denom = Math.sqrt(varA * varB);
  return denom === 0 ? 0 : cov / denom;
}

/**
 * Update entangled fold when one is measured.
 * Non-local update: measuring one instantly affects the other.
 * Uses relativistic velocity addition (I.16.6) for blending.
 *
 * Pure: returns a NEW fold; the input fold is never mutated. Callers hold
 * folds in replayable state, and in-place mutation would make the same
 * request produce different readings across replays.
 */
export function updateEntangledFold(measuredFold, otherFold, measurementBasis, strength = 0.1) {
  const corrFactor = computeCorrelationFactor(measuredFold, otherFold);

  // Relativistic velocity addition blend: (u+v)/(1+uv)
  const blend = (u, v) => {
    const uv = u * v;
    if (Math.abs(uv) < 1e-10) return u + v;
    return (u + v) / (1 + uv);
  };

  const newOperator = {};
  const newTerrain = {};
  const newStance = {};

  for (const [op, amp] of Object.entries(otherFold.operator)) {
    const measuredAmp = measurementBasis.operator[op] || 0;
    newOperator[op] = blend(amp * (1 - corrFactor * strength), measuredAmp * corrFactor * strength);
  }

  for (const [terr, amp] of Object.entries(otherFold.terrain)) {
    const measuredAmp = measurementBasis.terrain[terr] || 0;
    newTerrain[terr] = blend(amp * (1 - corrFactor * strength), measuredAmp * corrFactor * strength);
  }

  for (const [st, amp] of Object.entries(otherFold.stance)) {
    const measuredAmp = measurementBasis.stance[st] || 0;
    newStance[st] = blend(amp * (1 - corrFactor * strength), measuredAmp * corrFactor * strength);
  }

  normalizeAmplitudes(newOperator);
  normalizeAmplitudes(newTerrain);
  normalizeAmplitudes(newStance);

  return {
    operator: newOperator,
    terrain: newTerrain,
    stance: newStance,
    timestamp: otherFold.timestamp ?? null,
  };
}

function computeCorrelationFactor(foldA, foldB) {
  const opCorr = correlation(foldA.operator, foldB.operator);
  const terrCorr = correlation(foldA.terrain, foldB.terrain);
  return (opCorr + terrCorr) / 2;
}

// ── Uncertainty Principle ──

/**
 * Compute uncertainty of a fold.
 * Uses entropy as a proxy for uncertainty.
 */
export function computeUncertainty(fold) {
  return {
    operator: amplitudeEntropy(fold.operator),
    terrain: amplitudeEntropy(fold.terrain),
    stance: amplitudeEntropy(fold.stance)
  };
}

function amplitudeEntropy(amplitudes) {
  const probs = amplitudeToProbability(amplitudes);
  let entropy = 0;
  for (const prob of Object.values(probs)) {
    if (prob > 0) {
      entropy -= prob * Math.log2(prob);
    }
  }
  return entropy;
}

/**
 * Check if fold satisfies uncertainty principle: Δterrain × Δstance ≥ ħ
 */
export function satisfiesUncertaintyPrinciple(fold) {
  const uncertainty = computeUncertainty(fold);
  const product = uncertainty.terrain * uncertainty.stance;
  return product >= UNCERTAINTY_H;
}

// ── Decoherence ──

/**
 * Apply decoherence to a fold over time.
 * Folds decay from quantum (superposition) to classical (definite).
 *
 * @param {object} fold - The fold
 * @param {number} timeMs - Time elapsed
 * @returns {object} Decohered fold
 */
export function decohereFold(fold, timeMs) {
  const decayFactor = Math.exp(-timeMs / DECOHERENCE_TAU);

  const newOperator = {};
  const newTerrain = {};
  const newStance = {};

  const opUniform = 1 / Math.sqrt(OPERATORS.length);
  const terrUniform = 1 / Math.sqrt(TERRAINS.length);
  const stanceUniform = 1 / Math.sqrt(STANCES.length);

  for (const [op, amp] of Object.entries(fold.operator)) {
    newOperator[op] = amp * decayFactor + opUniform * (1 - decayFactor);
  }
  for (const [terr, amp] of Object.entries(fold.terrain)) {
    newTerrain[terr] = amp * decayFactor + terrUniform * (1 - decayFactor);
  }
  for (const [st, amp] of Object.entries(fold.stance)) {
    newStance[st] = amp * decayFactor + stanceUniform * (1 - decayFactor);
  }

  normalizeAmplitudes(newOperator);
  normalizeAmplitudes(newTerrain);
  normalizeAmplitudes(newStance);

  return {
    operator: newOperator,
    terrain: newTerrain,
    stance: newStance,
    timestamp: null
  };
}

/**
 * Collapse a fold to a definite classical state.
 * This is full decoherence.
 */
export function collapseFold(fold) {
  const state = foldToState(fold);
  return {
    operator: collapseToAmplitude(state.operator),
    terrain: collapseToAmplitude(state.terrain),
    stance: collapseToAmplitude(state.stance),
    timestamp: null
  };
}

function collapseToAmplitude(probs) {
  const maxKey = Object.entries(probs).reduce((a, b) => b[1] > a[1] ? b : a)[0];
  const amps = {};
  for (const key of Object.keys(probs)) {
    amps[key] = key === maxKey ? 1.0 : 0.0;
  }
  return amps;
}

// ── Utility ──

/**
 * Convert classical coordinate to a fold.
 */
export function classicalToFold(coord) {
  const operator = {};
  const terrain = {};
  const stance = {};

  for (const op of OPERATORS) operator[op] = op === coord.operator ? 1.0 : 0.0;
  for (const terr of TERRAINS) terrain[terr] = terr === coord.terrain ? 1.0 : 0.0;
  for (const st of STANCES) stance[st] = st === coord.stance ? 1.0 : 0.0;

  return { operator, terrain, stance, timestamp: null };
}

/**
 * Convert fold to classical coordinate (backward compat).
 * This IS a measurement.
 */
export function foldToClassical(fold) {
  const state = foldToState(fold);
  return {
    operator: maxKey(state.operator),
    terrain: maxKey(state.terrain),
    stance: maxKey(state.stance)
  };
}

function maxKey(obj) {
  return Object.entries(obj).reduce((a, b) => b[1] > a[1] ? b : a)[0];
}

// Re-export constants for external use
export { GAUSSIAN_SIGMA, SCATTER_BETA, SCATTER_ALPHA };
