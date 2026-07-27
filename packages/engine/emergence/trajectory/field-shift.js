// Trajectory red shift and physics current density, unified.
//
// The review's claim was that these two are computing related things on
// different representations, and should be one thing:
//
//   redShift          — how far a character's relation signature has
//                       moved from its rest frame, over narrative phases
//   currentDensity    — how much narrative/visual energy is flowing,
//                       over frames of a field
//
// They are the same math. Both are a cosine comparison of a state
// vector against a reference, accumulated over an axis. The only
// differences are the source of the vector (a relation-signature Map
// vs. a field-spec slice) and the axis (phases vs. frames).
//
// So this module implements the shared core ONCE, over any sequence of
// vectors plus a field spec, and trajectory/index.js's Map-based
// redShift is shown to agree with it (see field-shift.test.js). A
// character's red shift is now computable from the physics fields of
// the video or text they appear in — which was the point.
//
// Nothing in trajectory/index.js is replaced. That module keeps its
// relation-signature entry point, which is the right interface for an
// EOT operator log; this is the field-vector entry point for the same
// quantities.

import { cosineDistance, fieldDistance, normalizeFieldSpec, specIsMetric } from '../../perceiver/field-spec.js';

const round = (x) => Math.round(x * 1e4) / 1e4;

// A relation-signature Map, as trajectory/index.js builds it, is a
// sparse vector over `via` labels. Densify it against a shared basis and
// the Map-based and array-based distances become literally the same
// computation — which is the claim this module rests on.
export function signatureToVector(signature, basis) {
  const vec = new Float64Array(basis.length);
  for (let i = 0; i < basis.length; i++) vec[i] = signature.get(basis[i]) ?? 0;
  return vec;
}

export function signatureBasis(signatures) {
  const keys = new Set();
  for (const s of signatures) for (const k of s.keys()) keys.add(k);
  return [...keys].sort();
}

// ── The shared core ──────────────────────────────────────────────
//
// Given a sequence of state vectors along an axis, everything below is
// a different reduction of the same pairwise cosine distances.

// Distance from the rest frame (the first state) to each later state.
export function restFrameDistances(vectors, spec = null) {
  if (vectors.length < 2) return [];
  const rest = vectors[0];
  return vectors.slice(1).map((v) =>
    spec ? fieldDistance(rest, v, spec).distance : cosineDistance(rest, v));
}

// Distance between consecutive states — the per-step volatility.
export function stepDistances(vectors, spec = null) {
  const out = [];
  for (let i = 1; i < vectors.length; i++) {
    out.push(spec ? fieldDistance(vectors[i - 1], vectors[i], spec).distance : cosineDistance(vectors[i - 1], vectors[i]));
  }
  return out;
}

// ── Red shift over a field sequence ──────────────────────────────
//
// Identical in form to trajectory/index.js's redShift: the cumulative
// angular distance from the rest frame, weighted by each step's
// volatility relative to the mean step. Nothing is hardcoded; the
// weights come from the sequence's own statistics.
export function fieldRedShift(vectors, spec = null) {
  if (!vectors || vectors.length < 2) return 0;
  const steps = stepDistances(vectors, spec);
  const cumulative = restFrameDistances(vectors, spec);
  const meanStep = steps.reduce((a, b) => a + b, 0) / (steps.length || 1);

  let weighted = 0;
  let totalWeight = 0;
  for (let i = 0; i < cumulative.length; i++) {
    const weight = meanStep > 0 ? steps[i] / meanStep : 1;
    weighted += cumulative[i] * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? round(weighted / totalWeight) : 0;
}

// Direct distance from first to last state — the snapshot, not the path.
export function fieldRestFrameDivergence(vectors, spec = null) {
  if (!vectors || vectors.length < 2) return 0;
  const a = vectors[0];
  const b = vectors[vectors.length - 1];
  return round(spec ? fieldDistance(a, b, spec).distance : cosineDistance(a, b));
}

// Per-step shift, so a caller can see WHERE the sequence changed most.
export function fieldPhaseVolatility(vectors, spec = null, { positions = null } = {}) {
  const steps = stepDistances(vectors, spec);
  return steps.map((shift, i) => ({
    at: positions ? positions[i + 1] : i + 1,
    shift: round(shift),
    index: i + 1,
  }));
}

// ── Current density over a field sequence ────────────────────────
//
// The physics analogue, computed from exactly the same step distances.
// In the video field, current density is ρv summed over blocks. Along
// an axis of states, the same quantity is the rate at which the state
// vector is sweeping through field space — the magnitude of change per
// step (ρ, how much moved) times its consistency of direction (v).
//
// This is what makes the bridge concrete: `total` is the path length
// through field space, and `coherence` distinguishes a sequence that
// travels steadily in one direction from one that thrashes and returns.
// ── On the boundedness of coherence ──────────────────────────────
//
// coherence = displacement / path-length is only guaranteed to sit in
// [0,1] when the distance obeys the triangle inequality. Cosine
// distance (1 − cos θ) does NOT — it is not a metric — so a spec built
// from `cosine` channels can produce coherence > 1, at which point the
// number no longer means "the fraction of the path that was progress".
//
// This is reported rather than clamped. A clamp would turn a signal
// that the measure is being read outside its domain into a silent 1.0,
// which is the same failure the physics layer's `|| 0` was making.
// Callers who need a bounded coherence should declare their channels
// with metric 'angular', the triangle-safe form of the same comparison.
export function fieldCurrentDensity(vectors, spec = null) {
  if (!vectors || vectors.length < 2) {
    return { total: 0, net: 0, coherence: 0, steps: [], meanRate: 0, bounded: true };
  }
  const steps = stepDistances(vectors, spec);
  const total = steps.reduce((a, b) => a + b, 0);
  // Net displacement: the straight-line distance actually achieved.
  const net = spec
    ? fieldDistance(vectors[0], vectors[vectors.length - 1], spec).distance
    : cosineDistance(vectors[0], vectors[vectors.length - 1]);
  // Without a spec the comparison is plain cosine, which is not a metric.
  const bounded = spec ? specIsMetric(spec) : false;
  return {
    total,                                     // path length
    net,                                       // displacement
    // 1 = every step advanced away from the start; 0 = the path
    // returned to where it began. Same meaning as the spatial
    // coherence in perceiver/video/physics.js currentDensity().
    coherence: total > 1e-12 ? net / total : 0,
    // False means the distance is non-metric and `coherence` may exceed
    // 1; treat it as an ordering, not a fraction.
    bounded,
    steps,
    meanRate: total / steps.length,
  };
}

// ── The unified reading ──────────────────────────────────────────
//
// One call giving both vocabularies over one sequence, so a caller can
// see that the trajectory numbers and the physics numbers are views of
// the same measurements rather than independent claims.
export function fieldTrajectory(vectors, spec = null, { positions = null } = {}) {
  const current = fieldCurrentDensity(vectors, spec);
  return Object.freeze({
    // trajectory vocabulary
    redShift: fieldRedShift(vectors, spec),
    restFrameDivergence: fieldRestFrameDivergence(vectors, spec),
    phaseVolatility: Object.freeze(fieldPhaseVolatility(vectors, spec, { positions })),
    // physics vocabulary — same underlying step distances
    currentDensity: current.total,
    netCurrent: current.net,
    coherence: current.coherence,
    coherenceBounded: current.bounded,
    meanRate: current.meanRate,
    // provenance
    states: vectors.length,
    spec: spec ? normalizeFieldSpec(spec).id ?? null : null,
  });
}

// ── Bridging a relation-signature trajectory into field space ────
//
// Takes the phases trajectory/index.js works with and produces the
// vectors this module works with, so the same character can be measured
// either way and the results compared.
export function trajectoryToVectors(traj, relationSignature) {
  if (!traj?.phases?.length) return { vectors: [], basis: [] };
  const signatures = traj.phases.map((p) => relationSignature(p.relations ?? []));
  const basis = signatureBasis(signatures);
  return {
    vectors: signatures.map((s) => signatureToVector(s, basis)),
    basis,
  };
}
