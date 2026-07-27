// EO: EVA·SYN(Lens,Field → Paradigm,Lens, Binding,Tending,Composing) — character lens assertion
//
// The character lens assertion is the CONSTRUCT where the reader ASSERTS what a character's
// lens is, shaped by their priors and measured by the trajectory's red shift.
//
// This is the HIGHER TIER — the atmosphere/lenses/paradigms that are RELATIVISTIC:
//   - different readers assert different lenses
//   - all can be valid
//   - the assertion is shaped by the reader's priors
//   - the confidence is measured by the red shift
//
// THREE LAYERS OF ASSERTION:
//
//   1. TEXT LAYER — what is explicitly stated (the event log, the trajectory's relations)
//   2. CHARACTER LAYER — the reader ASSERTS what the character's lens is (an interpretation)
//   3. READER LAYER — the reader's priors shape what they can assert (the frame of assertion)
//
// The assertion is an EVA (evaluate operator) — the reader JUDGING the character's state
// against their frame. It carries:
//   - the character's current relation signature (what they're doing now)
//   - the red shift (how far they've moved)
//   - a confidence score (derived from the red shift + reader priors)
//   - the reader's prior (what shaped the assertion)
//   - the available assertions (what this reader can say)
//
// DETERMINISTIC and MODEL-FREE: the assertion is read off the trajectory and the prior,
// never authored. The engine computes the red shift and the available assertions; the
// app layer supplies the prior; the assertion is the intersection.

import { redShift, restFrameDivergence, phaseVolatility } from '../trajectory/index.js';
import { availableAssertions, priorConfidenceBoost } from '../reader-priors/index.js';

const round = (x) => Math.round(x * 1e4) / 1e4;

// ── Relation signature: the structural fingerprint of a character's state ──────────

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

// ── The character lens assertion: the full construct ─────────────────────────────
//
// Given a trajectory and a reader prior, produce the character lens assertion.
// The assertion is graded by confidence:
//   high confidence → "Pierre's lens IS idealistic naivety"
//   medium confidence → "Pierre's lens MIGHT BE idealistic naivety"
//   low confidence → "Pierre's lens is UNCERTAIN — he has changed too much"

export const assertLens = (traj, prior, { confidenceFloor = 0.1 } = {}) => {
  if (!traj || !traj.focus) return null;

  const rs = redShift(traj);
  const rfd = restFrameDivergence(traj);
  const volatility = phaseVolatility(traj);

  // A red shift of zero means "no measured movement" ONLY when there was
  // something to measure. With zero relations in every phase there is no
  // evidence at all, and asserting a confident lens from silence would be
  // fabrication — the confidence collapses to the prior's boost alone.
  const evidence = (traj.phases ?? []).reduce((n, p) => n + (p.relations?.length ?? 0), 0);

  // The base confidence is INVERSELY proportional to the red shift
  const baseConfidence = evidence === 0 ? 0 : 1 - rs;

  // The prior boosts confidence
  const boost = prior ? priorConfidenceBoost(prior, {}) : 0;
  const confidence = Math.min(1, baseConfidence + boost);

  // The assertion strength
  let strength;
  if (confidence >= 0.7) strength = 'asserted';
  else if (confidence >= 0.4) strength = 'suggested';
  else strength = 'uncertain';

  // The available assertions for this reader
  const available = prior ? availableAssertions(traj, prior, { confidenceFloor }) : [];

  // The character's current state and rest frame
  const currentPhase = traj.phases[traj.phases.length - 1];
  const currentState = relationSignature(currentPhase?.relations || []);
  const initialPhase = traj.phases[0];
  const restFrame = relationSignature(initialPhase?.relations || []);

  // The dominant shift: what changed most
  const dominantShift = volatility.length
    ? volatility.reduce((a, b) => b.shift > a.shift ? b : a)
    : null;

  return Object.freeze({
    character: traj.focus,
    characterId: traj.focusId,

    // The red shift metrics
    redShift: rs,
    restFrameDivergence: rfd,
    phaseVolatility: volatility,

    // The confidence and strength
    confidence: round(confidence),
    strength,

    // The reader's prior (what shaped this assertion)
    prior: prior ? Object.freeze({
      id: prior.id,
      label: prior.label,
      familiarity: prior.familiarity,
    }) : null,

    // What this reader can assert
    available,

    // The character's states
    currentState: Object.freeze(new Map(currentState)),
    restFrame: Object.freeze(new Map(restFrame)),

    // The trajectory summary
    gained: traj.gained,
    lost: traj.lost,
    phases: traj.phases.length,
    turns: traj.turns,
    dominantShift,

    // Cube coordinates
    terrain: 'Lens',
    linkTerrain: 'Entity',
  });
};

// ── Speak the assertion: thin, replaceable last step ────────────────────────────

export const speakLensAssertion = (assertion) => {
  if (!assertion) return null;
  const f = assertion.character || 'the character';
  const rs = assertion.redShift;

  const shiftDesc = rs < 0.2 ? 'has barely shifted'
    : rs < 0.5 ? 'has shifted moderately'
    : rs < 0.8 ? 'has shifted significantly'
    : 'has undergone a profound transformation';

  const confDesc = assertion.strength === 'asserted'
    ? `The reading asserts a lens for ${f}.`
    : assertion.strength === 'suggested'
    ? `The reading suggests a lens for ${f}, but with reservations.`
    : `The reading cannot confidently assert a lens for ${f} — the character has shifted too much.`;

  const priorNote = assertion.prior
    ? ` (reader: ${assertion.prior.label}, familiarity: ${assertion.prior.familiarity})`
    : '';

  const availableNote = assertion.available.length
    ? ` Available assertions: ${assertion.available.slice(0, 3).map((a) => {
        if (a.kind === 'gained') return `gained ${a.via}`;
        if (a.kind === 'lost') return `lost ${a.via}`;
        if (a.kind === 'frame') return `${a.frame} frame`;
        if (a.kind === 'experience') return `${a.experience} experience`;
        return a.kind;
      }).join(', ')}.`
    : '';

  const moved = assertion.gained.length
    ? ` Gained: ${assertion.gained.map((b) => b.via).join(', ')}.`
    : '';
  const lost = assertion.lost.length
    ? ` Lost: ${assertion.lost.map((b) => b.via).join(', ')}.`
    : '';

  return `${f} ${shiftDesc} (red shift: ${rs}). ${confDesc}${priorNote}${availableNote}${moved}${lost}`.trim();
};
