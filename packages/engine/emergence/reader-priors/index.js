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

// ── Confidence boost: how much does the prior boost the assertion confidence? ────
//
// The prior can BOOST the confidence of an assertion beyond what the red shift alone
// would allow. A reader who knows the character well (high familiarity) can assert with
// more confidence even at high red shift — they understand the transformation.
//
// The structural context provides additional boost: if the trajectory's field vectors
// align with the prior's named motifs, or if the channel weights match the trajectory's
// dominant channels, confidence increases. This is the bridge between the perceiver's
// field vectors and the prior's structural knowledge.

export const priorConfidenceBoost = (prior, assertion) => {
  if (!prior || !assertion) return 0;

  // Base boost from familiarity
  let boost = prior.familiarity * 0.2;

  // Additional boost if the assertion matches an available frame
  if (assertion.frame && prior.interpretiveFrames.has(assertion.frame)) {
    boost += prior.interpretiveFrames.get(assertion.frame) * 0.1;
  }

  // Additional boost if the assertion resonates with experience
  if (assertion.experience && prior.experiential.has(assertion.experience)) {
    boost += prior.experiential.get(assertion.experience) * 0.1;
  }

  // Structural boost: if the trajectory's field vectors align with named motifs
  if (assertion.currentState && prior.structural.namedMotifs.size > 0) {
    const currentFields = assertion.currentState;
    for (const [, motif] of prior.structural.namedMotifs) {
      if (motif.field && currentFields.size > 0) {
        // Simple alignment check: do any of the current fields match the motif's field?
        // This is a placeholder for a more sophisticated matching algorithm.
        boost += 0.05;
        break;
      }
    }
  }

  // Channel weight boost: if the trajectory's dominant channels match the prior's weights
  if (assertion.stats && prior.structural.channelWeights.size > 0) {
    const { meanShift, maxShift } = assertion.stats;
    if (maxShift > 0) {
      // Higher channel weights mean the reader is paying attention to specific features
      const totalWeight = [...prior.structural.channelWeights.values()].reduce((a, b) => a + b, 0);
      const avgWeight = totalWeight / prior.structural.channelWeights.size;
      boost += avgWeight * 0.05;
    }
  }

  return Math.min(0.3, round(boost));
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
