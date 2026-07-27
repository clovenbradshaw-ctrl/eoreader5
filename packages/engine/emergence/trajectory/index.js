// EO: SYN·EVA(trajectory → redShift, lensAssertion) — trajectory red shift + character lens assertion
//
// The red shift for trajectories: like how light from distant galaxies is redshifted because
// the universe is expanding, a character's "lens" shifts as they move through the narrative.
// The reader's ability to assert what that lens is depends on how far the character has moved
// from their starting point.
//
// THREE LAYERS OF ASSERTION:
//
//   1. TEXT LAYER — what is explicitly stated (the event log, the trajectory's relations)
//   2. CHARACTER LAYER — the reader ASSERTS what the character's lens is (an interpretation)
//   3. READER LAYER — the reader's priors shape what they can assert (the frame of assertion)
//
// The red shift is the bridge between layers 1 and 2: it measures how far the character has
// moved from their rest frame (where they started), and that distance determines the reader's
// confidence in their assertion.
//
//   REST FRAME — the character's initial relations (their starting point)
//   CURRENT FRAME — where they are now (their current relations)
//   RED SHIFT — the magnitude of the shift between these frames
//
// HIGH RED SHIFT = the character has changed a lot = the reader's assertion is more uncertain
// LOW RED SHIFT = the character hasn't changed much = the reader's assertion is more confident
//
// This is RELATIVISTIC: different readers assert different lenses, and all can be valid. The
// red shift doesn't determine WHAT the lens is — it determines how CONFIDENT the assertion is.
//
// ALL NUMBERS ARE COMPUTED: every threshold, multiplier, and weight is derived from the
// trajectory's own statistics. Nothing is hardcoded. The system is self-consistent.

const round = (x) => Math.round(x * 1e4) / 1e4;

// ── Relation signature: the structural fingerprint of a character's state ──────────
//
// A character's state is their set of relations (CON/SIG bonds). The signature is a
// normalised histogram over the relation types — a point on the simplex that captures
// the structural fingerprint without surface labels.

const relationSignature = (relations) => {
  const viaCounts = new Map();
  let total = 0;
  for (const r of relations) {
    const via = String(r.via || 'unknown').toLowerCase();
    viaCounts.set(via, (viaCounts.get(via) || 0) + 1);
    total++;
  }
  if (total === 0) return new Map();
  const sig = new Map();
  for (const [via, count] of viaCounts) sig.set(via, count / total);
  return sig;
};

// ── Signature magnitude: the "length" of a relation signature ───────────────────
//
// The magnitude of a signature vector — analogous to the wavelength of emitted light.
// Used in the redshift ratio formula.

const signatureMagnitude = (sig) => {
  let sum = 0;
  for (const v of sig.values()) sum += v * v;
  return Math.sqrt(sum);
};

// ── Redshift between two relation signatures ───────────────────────────────────
//
// The proper redshift formula from physics:
//   z = (λ_observed - λ_emitted) / λ_emitted
//
// For cosmological redshift:
//   1 + z = a(now) / a(then)
//
// We adapt this to signatures:
//   z = ||current|| / ||rest|| - 1
//
// Where ||.|| is the L2 norm. This gives:
//   z = 0 → no change (identical magnitudes)
//   z > 0 → REDSHIFT: character moving AWAY from rest frame (transforming)
//   z < 0 → BLUESHIFT: character moving TOWARD rest frame (returning)
//
// We also compute the directional shift: which vias grew vs shrank.
// And we compute the angular shift: how much the composition changed.

const redshiftRatio = (rest, current) => {
  const allVias = new Set([...rest.keys(), ...current.keys()]);
  if (allVias.size === 0) return { z: 0, direction: new Map(), angular: 0 };

  const mRest = signatureMagnitude(rest);
  const mCurrent = signatureMagnitude(current);

  // z = ||current|| / ||rest|| - 1  (cosmological formula)
  const z = mRest > 1e-12 ? (mCurrent / mRest) - 1 : 0;

  // Direction: which vias contributed to the shift
  const direction = new Map();
  for (const via of allVias) {
    const rv = rest.get(via) || 0;
    const cv = current.get(via) || 0;
    direction.set(via, cv - rv); // positive = redshifted, negative = blueshifted
  }

  // Angular shift: cosine distance between the two signatures
  const angular = signatureDistance(rest, current);

  return { z, direction, angular };
};

// ── Cosine distance between two relation signatures ─────────────────────────────
//
// The angular distance between two states: 0 = identical direction, 1 = orthogonal.
// This measures HOW DIFFERENT the relational composition is, independent of magnitude.
// Used alongside the redshift ratio for a complete picture.

const signatureDistance = (a, b) => {
  const allVias = new Set([...a.keys(), ...b.keys()]);
  if (allVias.size === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (const via of allVias) {
    const va = a.get(via) || 0;
    const vb = b.get(via) || 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 1e-12 ? 1 - (dot / d) : 0;
};

// ── Phase transition signature: the relational shift between phases ──────────────
//
// Each phase transition (at a REC frame-break) is a local red shift. The character's
// relations change at each turn. The phase transition signature captures HOW they change.

const phaseTransitionShift = (phaseA, phaseB) => {
  const sigA = relationSignature(phaseA.relations || []);
  const sigB = relationSignature(phaseB.relations || []);
  return signatureDistance(sigA, sigB);
};

// ── Trajectory statistics: derived from the trajectory itself ────────────────────
//
// Every number in the red shift computation is derived from the trajectory's own
// statistics. The trajectory is self-consistent: it knows its own volatility, its own
// mean shift, its own maximum shift. Nothing is imposed from outside.

const trajectoryStats = (traj) => {
  if (!traj || !traj.phases || traj.phases.length < 2) {
    return {
      shifts: [],
      meanShift: 0,
      maxShift: 0,
      minShift: 0,
      stdShift: 0,
      cumulativeShifts: [],
      meanCumulative: 0,
      redshiftPhases: 0,
      blueshiftPhases: 0,
      netDirection: 'stable',
    };
  }

  const phases = traj.phases;
  const restSig = relationSignature(phases[0].relations || []);

  // Per-phase shifts (angular distance)
  const shifts = [];
  for (let i = 1; i < phases.length; i++) {
    shifts.push(phaseTransitionShift(phases[i - 1], phases[i]));
  }

  // Cumulative shifts and redshift values (distance from rest frame at each phase)
  const cumulativeShifts = [];
  const redshiftValues = [];
  let redshiftPhases = 0;
  let blueshiftPhases = 0;

  for (let i = 1; i < phases.length; i++) {
    const currentSig = relationSignature(phases[i].relations || []);
    cumulativeShifts.push(signatureDistance(restSig, currentSig));

    // Compute the redshift ratio for this phase vs rest frame
    const { z } = redshiftRatio(restSig, currentSig);
    redshiftValues.push(z);

    if (z > 1e-12) redshiftPhases++;
    else if (z < -1e-12) blueshiftPhases++;
  }

  // Net direction: is the character overall moving away or toward their rest frame?
  const meanRedshift = redshiftValues.length > 0
    ? redshiftValues.reduce((a, b) => a + b, 0) / redshiftValues.length
    : 0;
  const netDirection = meanRedshift > 1e-12 ? 'redshift'
    : meanRedshift < -1e-12 ? 'blueshift'
    : 'stable';

  // Statistics
  const n = shifts.length;
  const meanShift = n > 0 ? shifts.reduce((a, b) => a + b, 0) / n : 0;
  const maxShift = n > 0 ? Math.max(...shifts) : 0;
  const minShift = n > 0 ? Math.min(...shifts) : 0;
  const variance = n > 0 ? shifts.reduce((a, s) => a + (s - meanShift) ** 2, 0) / n : 0;
  const stdShift = Math.sqrt(variance);
  const meanCumulative = cumulativeShifts.length > 0
    ? cumulativeShifts.reduce((a, b) => a + b, 0) / cumulativeShifts.length
    : 0;

  return {
    shifts,
    meanShift,
    maxShift,
    minShift,
    stdShift,
    cumulativeShifts,
    meanCumulative,
    redshiftPhases,
    blueshiftPhases,
    netDirection,
  };
};

// ── The red shift: cumulative trajectory displacement ────────────────────────────
//
// The red shift is the cumulative angular distance of a character's trajectory from its
// rest frame (the first phase). This measures HOW DIFFERENT the character's relations
// are from where they started — not just the magnitude of change, but the composition.
//
// The angular distance is always positive:
//   0 = no change (identical composition)
//   1 = completely different (orthogonal composition)
//
// We also track the z value (magnitude ratio) separately, which can be negative
// (blueshift: character returning to rest frame magnitude) or positive (redshift:
// character moving away from rest frame magnitude).
//
// Returns a value in [0, 1]:
//   0 = no shift (the character hasn't changed)
//   1 = maximum shift (the character has completely transformed)

export const redShift = (traj) => {
  if (!traj || !traj.phases || traj.phases.length < 2) return 0;

  const stats = trajectoryStats(traj);
  const { shifts, meanShift } = stats;

  if (shifts.length === 0) return 0;

  // Compute the cumulative angular distance from rest frame to each phase
  const restSig = relationSignature(traj.phases[0].relations || []);
  let weightedDistance = 0;
  let totalWeight = 0;

  for (let i = 1; i < traj.phases.length; i++) {
    const currentSig = relationSignature(traj.phases[i].relations || []);
    const angular = signatureDistance(restSig, currentSig);

    // Weight is computed from the trajectory's own volatility:
    // phases that are more volatile than average weigh more
    const weight = meanShift > 0 ? shifts[i - 1] / meanShift : 1;
    weightedDistance += angular * weight;
    totalWeight += weight;
  }

  // Normalise to [0, 1]
  return totalWeight > 0 ? round(weightedDistance / totalWeight) : 0;
};

// ── Rest frame divergence: how far the current state is from the start ───────────
//
// The rest frame divergence is the direct distance between the first and last phase.
// Unlike redShift (which is cumulative), this is a snapshot: where are they NOW relative
// to where they STARTED.

export const restFrameDivergence = (traj) => {
  if (!traj || !traj.phases || traj.phases.length < 2) return 0;
  const first = traj.phases[0];
  const last = traj.phases[traj.phases.length - 1];
  return round(phaseTransitionShift(first, last));
};

// ── Phase volatility: how much the character shifts at each turn ─────────────────
//
// The per-phase red shifts, so a caller can see WHERE the character changed most.
// High volatility at a particular turn means that's where the character transformed.

export const phaseVolatility = (traj) => {
  if (!traj || !traj.phases || traj.phases.length < 2) return [];
  const phases = traj.phases;
  const shifts = [];
  for (let i = 1; i < phases.length; i++) {
    shifts.push({
      at: phases[i].phase,
      shift: round(phaseTransitionShift(phases[i - 1], phases[i])),
      gained: phases[i].relations.length - phases[i - 1].relations.length,
      turn: traj.turns[i - 1] ?? null,
    });
  }
  return shifts;
};

// ── Confidence thresholds: computed from the trajectory's own statistics ─────────
//
// The thresholds for "asserted", "suggested", and "uncertain" are derived from the
// trajectory's own characteristics:
//
//   asserted = red shift is below the mean cumulative shift (the character is stable
//              relative to their own transformation history)
//   suggested = red shift is between the mean and the max (the character has shifted
//               more than average but not beyond their maximum)
//   uncertain = red shift exceeds the maximum phase shift (the character has shifted
//               more than any single transition — the reader cannot reliably assert)
//
// This makes the thresholds SELF-CONSISTENT: they're derived from the trajectory's
// own statistics, not from external values.

const confidenceThresholds = (traj) => {
  const stats = trajectoryStats(traj);

  // The thresholds are relative to the trajectory's own statistics
  const asserted = stats.meanCumulative;    // stable relative to own history
  const suggested = stats.maxShift;         // beyond average but within maximum
  // uncertain is everything above suggested

  return { asserted, suggested };
};

// ── Prior confidence boost: computed from the prior's own distribution ───────────
//
// The prior's boost is computed from its own characteristics, not from hardcoded
// multipliers. The boost is proportional to:
//   - familiarity: how well the reader knows the character
//   - frame strength: the weight of the reader's strongest interpretive frame
//   - experience resonance: the weight of the reader's most relevant experience
//
// The boost is bounded by the trajectory's own volatility: a reader cannot boost
// confidence beyond what the trajectory's own statistics allow.

const priorBoost = (prior, stats) => {
  if (!prior) return 0;

  // Familiarity boost: proportional to how well the reader knows the character
  const familiarityBoost = prior.familiarity;

  // Frame strength: the weight of the reader's strongest interpretive frame
  const frameStrength = prior.interpretiveFrames.size > 0
    ? Math.max(...prior.interpretiveFrames.values())
    : 0;

  // Experience resonance: the weight of the reader's most relevant experience
  const experienceResonance = prior.experiential.size > 0
    ? Math.max(...prior.experiential.values())
    : 0;

  // The boost is the weighted sum, bounded by the trajectory's own volatility
  const rawBoost = familiarityBoost + frameStrength + experienceResonance;
  const maxBoost = stats.maxShift; // cannot exceed the trajectory's own maximum shift

  // Normalise by the number of prior components — computed, not hardcoded
  const componentCount = (prior.familiarity > 0 ? 1 : 0)
    + (prior.interpretiveFrames.size > 0 ? 1 : 0)
    + (prior.experiential.size > 0 ? 1 : 0);

  return componentCount > 0 ? Math.min(maxBoost, rawBoost / componentCount) : 0;
};

// ── Character lens assertion: what the reader can assert given the red shift ─────
//
// The character lens assertion is a CONSTRUCT — the reader ASSERTS what the character's
// lens is, shaped by their priors. The red shift determines the CONFIDENCE of that
// assertion, not its content.
//
//   HIGH RED SHIFT → low confidence assertion (the character has changed a lot)
//   LOW RED SHIFT → high confidence assertion (the character is stable)
//
// The assertion itself is an EVA (evaluate operator) — the reader JUDGING the character's
// state against their frame. It carries:
//   - the character's current relation signature (what they're doing now)
//   - the red shift (how far they've moved)
//   - a confidence score (derived from the red shift + reader priors)
//   - the reader's prior (what shaped the assertion)

export const assertCharacterLens = (traj, { readerPrior = null } = {}) => {
  if (!traj || !traj.focus) return null;

  const rs = redShift(traj);
  const rfd = restFrameDivergence(traj);
  const volatility = phaseVolatility(traj);
  const stats = trajectoryStats(traj);
  const thresholds = confidenceThresholds(traj);

  // The confidence is INVERSELY proportional to the red shift, boosted by priors.
  // For blueshift (rs < 0), confidence increases — the character is returning to a known state.
  // For redshift (rs > 0), confidence decreases — the character is transforming.
  const baseConfidence = 1 - rs;
  const boost = priorBoost(readerPrior, stats);
  const confidence = Math.min(1, baseConfidence + boost);

  // The assertion strength is graded by the COMBINED red shift and trajectory statistics
  let strength;
  if (rs <= thresholds.asserted) strength = 'asserted';
  else if (rs <= thresholds.suggested) strength = 'suggested';
  else strength = 'uncertain';

  // The character's current state: their relation signature at the latest phase
  const currentPhase = traj.phases[traj.phases.length - 1];
  const currentState = relationSignature(currentPhase?.relations || []);

  // The rest frame: their initial state
  const initialPhase = traj.phases[0];
  const restFrame = relationSignature(initialPhase?.relations || []);

  // The redshift ratio for the full trajectory
  const fullRedshift = redshiftRatio(restFrame, currentState);

  return Object.freeze({
    character: traj.focus,
    characterId: traj.focusId,
    redShift: rs,
    restFrameDivergence: rfd,
    phaseVolatility: volatility,
    confidence: round(confidence),
    strength,
    thresholds: Object.freeze({
      asserted: round(thresholds.asserted),
      suggested: round(thresholds.suggested),
    }),
    stats: Object.freeze({
      meanShift: round(stats.meanShift),
      maxShift: round(stats.maxShift),
      stdShift: round(stats.stdShift),
      meanCumulative: round(stats.meanCumulative),
      redshiftPhases: stats.redshiftPhases,
      blueshiftPhases: stats.blueshiftPhases,
      netDirection: stats.netDirection,
    }),
    currentState: Object.freeze(new Map(currentState)),
    restFrame: Object.freeze(new Map(restFrame)),
    redshiftRatio: Object.freeze({
      z: round(fullRedshift.z),
      angular: round(fullRedshift.angular),
    }),
    gained: traj.gained,
    lost: traj.lost,
    phases: traj.phases.length,
    turns: traj.turns,
    terrain: 'Lens',
    linkTerrain: 'Entity',
  });
};

// ── Speak the assertion: thin, replaceable last step ────────────────────────────
//
// Natural language rendering of the character lens assertion. The assertion itself is
// the structural product; this is one way to voice it. The speaking thresholds are
// COMPUTED from the trajectory's own statistics, not hardcoded.

export const speakAssertion = (assertion) => {
  if (!assertion) return null;
  const f = assertion.character || 'the character';
  const rs = assertion.redShift;
  const { meanShift, maxShift, netDirection, redshiftPhases, blueshiftPhases } = assertion.stats;

  // The speaking thresholds are relative to the trajectory's own statistics
  const shiftDesc = netDirection === 'blueshift'
    ? rs < -maxShift / 2 ? 'is returning strongly to their origin'
      : rs < 0 ? 'is drifting back toward their origin'
      : 'has barely shifted'
    : rs < meanShift ? 'has barely shifted'
      : rs < meanShift + (maxShift - meanShift) / 2 ? 'has shifted moderately'
      : rs < maxShift ? 'has shifted significantly'
      : 'has undergone a profound transformation';

  const dirDesc = netDirection === 'blueshift'
    ? ` The arc is predominantly blueshifted (${blueshiftPhases} of ${assertion.phases - 1} phases).`
    : netDirection === 'redshift'
    ? ` The arc is predominantly redshifted (${redshiftPhases} of ${assertion.phases - 1} phases).`
    : '';

  const confDesc = assertion.strength === 'asserted'
    ? `The reading asserts a lens for ${f}.`
    : assertion.strength === 'suggested'
    ? `The reading suggests a lens for ${f}, but with reservations.`
    : `The reading cannot confidently assert a lens for ${f} — the character has shifted too much.`;

  const moved = assertion.gained.length
    ? ` Gained: ${assertion.gained.map((b) => b.via).join(', ')}.`
    : '';
  const lost = assertion.lost.length
    ? ` Lost: ${assertion.lost.map((b) => b.via).join(', ')}.`
    : '';

  return `${f} ${shiftDesc} (red shift: ${rs}). ${confDesc}${dirDesc}${moved}${lost}`.trim();
};
