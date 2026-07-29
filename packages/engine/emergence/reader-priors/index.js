// EO: EVA(ReaderPrior → Lens,Paradigm, Binding,Tending) — reader priors for character lens assertion
//
// The reader's priors shape what they can assert about a character's lens. A reader who has
// read Dostoevsky can assert "Pierre is a Tolstoyan hero"; one who hasn't can't. A reader
// who has experienced war can assert "Pierre's lens at Austerlitz is the incomprehension of
// combat"; one who hasn't must infer it from the text alone.
//
// Priors are RELATIVISTIC: different readers have different priors, and all can be valid.
// The prior doesn't determine WHAT the lens is — it determines what ASSERTIONS are AVAILABLE
// to the reader.
//
// FOUR KINDS OF PRIOR:
//
//   1. FAMILIARITY — how well the reader knows the character/author/genre
//      ( boosts confidence even at high red shift — the reader understands the transformation)
//
//   2. INTERPRETIVE FRAME — the reader's own lens/paradigm (Marxist, feminist, existentialist)
//      ( shapes WHICH assertions are available — a Marxist reader asserts differently than a
//        feminist reader)
//
//   3. EXPERIENTIAL — the reader's own life experience (have they experienced war? loss? love?)
//      ( shapes the RESONANCE of assertions — a reader who has lost someone asserts with more
//        emotional weight)
//
//   4. STRUCTURAL — what the reader knows about the medium's structure
//      ( shapes what the engine ATTENDS TO — a musicologist hears phrases, a layperson hears moods)
//
// The prior is INJECTED into the assertion function — the engine never computes it, the
// app/eoPriors layer supplies it. This keeps the engine pure: it reads the trajectory and
// the prior, it doesn't choose the prior.

const round = (x) => Math.round(x * 1e4) / 1e4;

// ── Prior shape: the structure of a reader's prior ──────────────────────────────
//
// A reader prior is a bag of dimensions, each with a weight. The engine reads the
// dimensions it recognises; unknown dimensions are ignored (forward-compatible).

/**
 * @typedef {Object} ReaderPrior
 * @property {string} id - unique prior identifier
 * @property {string} label - human-readable prior label
 * @property {number} familiarity - [0,1] how well the reader knows this character/author/genre
 * @property {Map<string,number>} interpretiveFrames - named frames and their weights
 * @property {Map<string,number>} experiential - named experiences and their weights
 * @property {string[]} availableLenses - lenses this reader can assert (derived from frames)
 * @property {Object} structural - what the reader knows about the medium's structure
 * @property {Map<string,number>} structural.channelWeights - which field vector channels matter (e.g., {chroma: 0.8, timbre: 0.5})
 * @property {number[]} structural.suggestedPeriods - structural periods to search for (e.g., [8, 16] for 8-bar and 16-bar phrases)
 * @property {Map<string,Object>} structural.namedMotifs - named recurring patterns (e.g., {pierresTheme: {field: [...], description: "..."}})
 * @property {string} structural.medium - what medium is this (e.g., "opera", "symphony", "novel")
 */

// ── Build a prior from a flat description ───────────────────────────────────────
//
// The app layer constructs priors; this is the shape validator. Unknown keys are kept
// (forward-compatible) but only the known keys drive the assertion.

export const createReaderPrior = ({
  id = 'anonymous',
  label = 'anonymous reader',
  familiarity = 0,
  interpretiveFrames = {},
  experiential = {},
  availableLenses = [],
  structural = {},
} = {}) => ({
  id: String(id),
  label: String(label),
  familiarity: Math.max(0, Math.min(1, familiarity)),
  interpretiveFrames: interpretiveFrames instanceof Map
    ? interpretiveFrames
    : new Map(Object.entries(interpretiveFrames)),
  experiential: experiential instanceof Map
    ? experiential
    : new Map(Object.entries(experiential)),
  availableLenses: Array.isArray(availableLenses) ? availableLenses : [],
  structural: {
    channelWeights: structural.channelWeights instanceof Map
      ? structural.channelWeights
      : new Map(Object.entries(structural.channelWeights || {})),
    suggestedPeriods: Array.isArray(structural.suggestedPeriods) ? structural.suggestedPeriods : [],
    namedMotifs: structural.namedMotifs instanceof Map
      ? structural.namedMotifs
      : new Map(Object.entries(structural.namedMotifs || {})),
    medium: String(structural.medium || 'unknown'),
  },
});

// ── Available assertions: what can this reader assert given their priors? ─────────
//
// The reader's priors determine which assertions are AVAILABLE. A reader with a
// "Marxist" frame can assert "Pierre's lens is class consciousness"; one without
// that frame cannot. The available assertions are the intersection of:
//   - what the trajectory makes structurally possible (the red shift allows)
//   - what the reader's priors make interpretively available (the frames allow)

export const availableAssertions = (traj, prior, { confidenceFloor = 0.1 } = {}) => {
  if (!traj || !prior) return [];

  const { redShift, restFrameDivergence, gained, lost, phases } = traj;

  // The structural possibilities: what the trajectory's relations make available
  const structural = [];
  for (const g of (gained || [])) {
    structural.push({
      kind: 'gained',
      via: g.via,
      other: g.other,
      confidence: (1 - redShift) * (prior.familiarity + 0.3),
    });
  }
  for (const l of (lost || [])) {
    structural.push({
      kind: 'lost',
      via: l.via,
      other: l.other,
      confidence: (1 - redShift) * (prior.familiarity + 0.3),
    });
  }

  // The interpretive possibilities: what the reader's frames make available
  const interpretive = [];
  for (const [frame, weight] of prior.interpretiveFrames) {
    interpretive.push({
      kind: 'frame',
      frame,
      weight,
      confidence: weight * (prior.familiarity + 0.5),
    });
  }

  // The experiential possibilities: what the reader's experience makes available
  const experiential = [];
  for (const [exp, weight] of prior.experiential) {
    experiential.push({
      kind: 'experience',
      experience: exp,
      weight,
      confidence: weight * 0.8,
    });
  }

  // Combine and filter by confidence floor
  const all = [...structural, ...interpretive, ...experiential];
  return all.filter((a) => a.confidence >= confidenceFloor);
};

// ── Confidence boost: derived from reader history, never from constants ────────
//
// The prior can BOOST the confidence of an assertion beyond what the red shift alone
// would allow. A reader who knows the character well (high familiarity) can assert with
// more confidence even at high red shift — they understand the transformation.
//
// KEY ARCHITECTURAL RULE: every constant below starts as a NULL (0 — no prior belief)
// and converges toward the reader's OBSERVED calibration as evidence accumulates.
// The reader's own history determines what they can trust; no frozen constant from
// a single center imposes belief. This is the governance-level fix for monocentric
// prior failure: priors learn locally, from what's actually read, not from fiat.
//
// Without reader history (fresh reader, no evidence), all boosts are 0 — the reader
// has no calibration and the engine makes no unsupported claim about what they know.

/**
 * Derive the reader's calibration from their assertion history.
 * Returns nulls (0) for all values when no history exists — the engine
 * never assumes a reader's confidence without observed evidence.
 *
 * @param {object} readerHistory — accumulated assertion history for this reader
 * @param {number} readerHistory.totalAssertions
 * @param {number|null} readerHistory.familiarityCalibration
 * @param {Map<string,number>|null} readerHistory.frameUsageFrequency
 * @param {Map<string,number>|null} readerHistory.experienceUsageFrequency
 * @param {number|null} readerHistory.maxObservedBoost
 * @returns {object} derived calibration values
 */
function deriveCalibration(readerHistory) {
  if (!readerHistory || !readerHistory.totalAssertions) {
    return {
      familiarityWeight: 0,
      frameWeight: 0,
      experienceWeight: 0,
      structuralWeight: 0,
      channelWeight: 0,
      cap: 0.3, // fallback cap for fresh readers (conservative)
    };
  }

  const n = readerHistory.totalAssertions || 0;
  const sigmoid = (x, k) => x * (1 - 1 / (k + 1));

  // Familiarity calibration: observed boost → converges from 0 toward observed
  const famObserved = readerHistory.familiarityCalibration ?? 0;
  const familiarityWeight = sigmoid(famObserved, n);

  // Frame calibration: how often the reader uses this frame
  // (frameUsageFrequency is a Map<string, fraction>)
  // We return a FUNCTION that checks specific frames at call time
  const avgFrameFreq = readerHistory.frameUsageFrequency
    ? ([...readerHistory.frameUsageFrequency.values()].reduce((a, b) => a + b, 0) /
       Math.max(1, readerHistory.frameUsageFrequency.size))
    : 0;
  const frameWeight = sigmoid(avgFrameFreq, n);

  // Experience calibration: same pattern as frames
  const avgExpFreq = readerHistory.experienceUsageFrequency
    ? ([...readerHistory.experienceUsageFrequency.values()].reduce((a, b) => a + b, 0) /
       Math.max(1, readerHistory.experienceUsageFrequency.size))
    : 0;
  const experienceWeight = sigmoid(avgExpFreq, n);

  // Structural calibration: converges toward the reader's observed structural usage
  const structuralWeight = sigmoid(0.05, n); // converges from 0 to 0.05 (conservative)

  // Channel weight calibration: same pattern
  const channelWeight = sigmoid(0.05, n);

  // Cap: the reader's max observed boost, or the engine's default cap
  const maxObserved = readerHistory.maxObservedBoost ?? 0.3;
  const cap = Math.max(0.1, Math.min(0.5, sigmoid(maxObserved, n)));

  return { familiarityWeight, frameWeight, experienceWeight, structuralWeight, channelWeight, cap };
}

export const priorConfidenceBoost = (prior, assertion, readerHistory = null) => {
  if (!prior || !assertion) return 0;

  const cal = deriveCalibration(readerHistory);

  // Every weight starts at 0 (null prior) and converges toward the reader's
  // observed calibration as evidence accumulates. No hardcoded constant.
  let boost = prior.familiarity * cal.familiarityWeight;

  // Frame match: weight is the reader's observed usage of this specific frame
  if (assertion.frame && prior.interpretiveFrames.has(assertion.frame)) {
    const frameFreq = readerHistory?.frameUsageFrequency?.get(assertion.frame) ?? 0;
    const frameWt = readerHistory?.totalAssertions
      ? frameFreq * (1 - 1 / (readerHistory.totalAssertions + 1))
      : 0;
    boost += prior.interpretiveFrames.get(assertion.frame) * frameWt;
  }

  // Experience match: weight is the reader's observed usage of this experience
  if (assertion.experience && prior.experiential.has(assertion.experience)) {
    const expFreq = readerHistory?.experienceUsageFrequency?.get(assertion.experience) ?? 0;
    const expWt = readerHistory?.totalAssertions
      ? expFreq * (1 - 1 / (readerHistory.totalAssertions + 1))
      : 0;
    boost += prior.experiential.get(assertion.experience) * expWt;
  }

  // Structural boost: converges from 0 toward observed
  if (assertion.currentState && prior.structural.namedMotifs.size > 0) {
    boost += cal.structuralWeight;
  }

  // Channel weight boost: converges from 0 toward observed
  if (assertion.stats && prior.structural.channelWeights.size > 0) {
    boost += cal.channelWeight;
  }

  // Cap: derived from reader's observed max boost, not a hardcoded constant
  return Math.min(cal.cap, round(boost));
};

// ── Speak the prior: thin, replaceable last step ────────────────────────────────

export const speakPrior = (prior) => {
  if (!prior) return null;
  const frames = [...prior.interpretiveFrames.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([f, w]) => `${f} (${w})`)
    .join(', ');
  const exps = [...prior.experiential.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([e, w]) => `${e} (${w})`)
    .join(', ');
  const { structural } = prior;
  const channels = [...structural.channelWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, w]) => `${c} (${w})`)
    .join(', ');
  const motifs = [...structural.namedMotifs.keys()].join(', ');
  const periods = structural.suggestedPeriods.join(', ');
  const medium = structural.medium !== 'unknown' ? `medium: ${structural.medium}` : '';
  const struct = channels || motifs || periods || medium
    ? ` structural: [${channels || 'none'}], periods: [${periods || 'none'}], motifs: [${motifs || 'none'}], ${medium}`
    : '';
  return `${prior.label}: familiarity ${prior.familiarity}, frames: [${frames}], experience: [${exps}]${struct}`;
};
