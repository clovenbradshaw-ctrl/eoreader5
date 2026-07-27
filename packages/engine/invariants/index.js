// The invariant layer.
//
// A subassembly is not a group of equations or sensors. It is a
// constraint network that any valid state must satisfy. This module is
// the constraint network's bottom layer: the four invariants that
// define the system's state space — the region of amplitude space it
// is allowed to occupy.
//
//   1. PROBABILITY    0 ≤ P ≤ 1              (Born range)
//   2. CONTINUITY     Σ|ψ|² = 1              (norm conservation)
//   3. THERMODYNAMIC  dS/dt ≥ 0              (entropy under decoherence)
//   4. PHASE          |Σ√(I₁I₂)cosδ| ≤ ΣI    (interference bound)
//
// Every operation (fold, project, measure, decohere, interfere) is a
// transformation that must preserve these. If an operation violates
// one, the state is corrupted.
//
// ── Why this layer exists separately from quantum/ ────────────────
//
// quantum/index.js currently ENFORCES two of these by clamping:
// project() and interfere() both end in Math.max(0, Math.min(1, x)).
// Clamping satisfies the invariant at the output while destroying the
// evidence that it was violated at all — a state that computed P = 1.4
// and a state that computed P = 1.0 become indistinguishable. Silent
// repair is how a constraint network stops being able to detect its
// own corruption.
//
// So: this module CHECKS, it does not clamp. Every check reports a
// margin (how much room was left, or how far past the bound the state
// went) so a caller can tell "just inside" from "comfortably inside",
// and locate the violating dimension rather than only learning that
// something, somewhere, went wrong.

// Floating-point slack. Norm conservation is an equality over sums of
// squares, so it accumulates error proportional to the dimension count;
// callers working with large bases can widen it.
export const DEFAULT_TOLERANCE = 1e-9;

export const INVARIANT_IDS = Object.freeze([
  'probability',
  'continuity',
  'thermodynamic',
  'phase',
]);

const result = (id, satisfied, margin, detail) =>
  Object.freeze({ invariant: id, satisfied, margin, ...detail });

// ── 1. PROBABILITY INVARIANT: 0 ≤ P ≤ 1 ──────────────────────────
//
// The Born range. `margin` is the distance to the nearest bound:
// positive means inside with room to spare, negative is the overshoot.
export function checkProbability(p, { label = 'P', tolerance = DEFAULT_TOLERANCE } = {}) {
  if (!Number.isFinite(p)) {
    return result('probability', false, -Infinity, { label, value: p, reason: 'not-finite' });
  }
  const margin = Math.min(p, 1 - p);
  return result('probability', margin >= -tolerance, margin, { label, value: p });
}

// Check a whole probability map at once, reporting the worst offender.
export function checkProbabilities(probs, { tolerance = DEFAULT_TOLERANCE } = {}) {
  const violations = [];
  let worst = Infinity;
  for (const [label, p] of Object.entries(probs)) {
    const check = checkProbability(p, { label, tolerance });
    if (!check.satisfied) violations.push(check);
    if (check.margin < worst) worst = check.margin;
  }
  return result('probability', violations.length === 0, Number.isFinite(worst) ? worst : 0, {
    violations,
    checked: Object.keys(probs).length,
  });
}

// ── 2. CONTINUITY INVARIANT: Σ|ψ|² = 1 ───────────────────────────
//
// Norm conservation, checked after every operation. `margin` is the
// tolerance slack remaining; negative means the norm drifted out.
//
// The zero-amplitude case matters and is reported honestly rather than
// waved through: quantum/index.js's normalizeAmplitudes() short-circuits
// on sumSquares === 0, leaving an all-zero face whose norm is 0, not 1.
// That state violates continuity and every downstream projection from
// it is meaningless, so it must be visible, not silently tolerated.
export function checkContinuity(amplitudes, { label = 'face', tolerance = DEFAULT_TOLERANCE } = {}) {
  const values = Object.values(amplitudes ?? {});
  if (values.length === 0) {
    return result('continuity', false, -1, { label, norm: 0, reason: 'empty-face' });
  }
  let sumSquares = 0;
  for (const amp of values) {
    if (!Number.isFinite(amp)) {
      return result('continuity', false, -Infinity, { label, norm: NaN, reason: 'not-finite' });
    }
    sumSquares += amp * amp;
  }
  if (sumSquares === 0) {
    return result('continuity', false, -1, { label, norm: 0, reason: 'zero-norm' });
  }
  const error = Math.abs(sumSquares - 1);
  return result('continuity', error <= tolerance, tolerance - error, {
    label,
    norm: sumSquares,
    error,
  });
}

// A fold has three faces; all three must conserve norm independently.
export function checkFoldContinuity(fold, { tolerance = DEFAULT_TOLERANCE } = {}) {
  const faces = ['operator', 'terrain', 'stance'];
  const checks = faces.map((f) => checkContinuity(fold?.[f], { label: f, tolerance }));
  const violations = checks.filter((c) => !c.satisfied);
  return result('continuity', violations.length === 0, Math.min(...checks.map((c) => c.margin)), {
    faces: checks,
    violations,
  });
}

// ── 3. THERMODYNAMIC INVARIANT: dS/dt ≥ 0 ────────────────────────
//
// Entropy is non-decreasing under decoherence, and under measurement
// it must not decrease either — measurement injects an external basis,
// which cannot spontaneously order the state below where it started
// without doing work that the system does not model.
//
// Shannon entropy over the Born probabilities |ψ|², in bits.
export function amplitudeEntropy(amplitudes) {
  let entropy = 0;
  let norm = 0;
  const values = Object.values(amplitudes ?? {});
  for (const amp of values) norm += amp * amp;
  if (!(norm > 0)) return 0;
  for (const amp of values) {
    const p = (amp * amp) / norm;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function foldEntropy(fold) {
  return {
    operator: amplitudeEntropy(fold?.operator),
    terrain: amplitudeEntropy(fold?.terrain),
    stance: amplitudeEntropy(fold?.stance),
    get total() {
      return this.operator + this.terrain + this.stance;
    },
  };
}

// `direction` says which way entropy is allowed to move:
//   'non-decreasing' — decoherence, measurement (the invariant proper)
//   'any'            — for observing a step without constraining it
//
// Pruning (consolidate) is the one operation that legitimately reduces
// entropy: it removes entries from the store rather than reordering
// amplitudes, so it exports entropy instead of destroying it. Callers
// model that by checking the surviving set against itself, not against
// the pre-prune set — see cycles.js.
export function checkEntropyMonotone(before, after, { label = 'step', tolerance = DEFAULT_TOLERANCE } = {}) {
  const sBefore = typeof before === 'number' ? before : amplitudeEntropy(before);
  const sAfter = typeof after === 'number' ? after : amplitudeEntropy(after);
  const dS = sAfter - sBefore;
  return result('thermodynamic', dS >= -tolerance, dS, {
    label,
    entropyBefore: sBefore,
    entropyAfter: sAfter,
    dS,
  });
}

// ── 4. PHASE INVARIANT: |Σ√(I₁I₂)cosδ| ≤ ΣI ──────────────────────
//
// The two-source interference bound. Total intensity from interfering
// sources is ΣI + cross terms, and the cross terms cannot exceed the
// sum of the individual intensities — otherwise interference is
// creating intensity from nothing.
//
// This is the invariant quantum/index.js's interfere() currently
// violates by construction, not by accident. Its scattering kernel is
//   kernel = SCATTER_BETA · (1 + SCATTER_ALPHA · cos δ)
// with β = 1.0 and α = 0.3, so the cross term carries a factor of up
// to 1.3. The bound allows at most 1.0. The overshoot is invisible
// downstream because interfere() clamps its result into [0,1] — the
// intensity is capped, so nothing looks wrong, but the ordering among
// folds near the cap has already been distorted. checkPhaseBound is
// how that becomes visible.
export function checkPhaseBound(intensities, crossTerms, { label = 'interference', tolerance = DEFAULT_TOLERANCE } = {}) {
  let sumI = 0;
  for (const i of intensities) {
    if (!Number.isFinite(i)) {
      return result('phase', false, -Infinity, { label, reason: 'not-finite' });
    }
    sumI += i;
  }
  let cross = 0;
  for (const c of crossTerms) cross += c;
  const bound = Math.abs(cross);
  return result('phase', bound <= sumI + tolerance, sumI - bound, {
    label,
    sumIntensity: sumI,
    crossMagnitude: bound,
    // > 1 means interference manufactured intensity.
    ratio: sumI > 0 ? bound / sumI : 0,
  });
}

// The kernel form used by interfere(). Returns the maximum amplification
// the kernel can apply, so a caller can check the constants themselves
// rather than waiting to observe a violation at runtime.
export function scatteringKernelBound(beta, alpha) {
  const max = Math.abs(beta) * (1 + Math.abs(alpha));
  return result('phase', max <= 1 + DEFAULT_TOLERANCE, 1 - max, {
    label: 'scattering-kernel',
    beta,
    alpha,
    maxAmplification: max,
  });
}

// ── The full battery ─────────────────────────────────────────────
//
// Run every invariant that applies to a state. `probabilities`,
// `entropyBefore`, and `interference` are optional — a bare fold can
// only be checked for continuity, which is exactly the right answer.
export function checkInvariants(state, { tolerance = DEFAULT_TOLERANCE } = {}) {
  const checks = [];

  if (state.fold) checks.push(checkFoldContinuity(state.fold, { tolerance }));
  if (state.amplitudes) checks.push(checkContinuity(state.amplitudes, { tolerance }));
  if (state.probabilities) checks.push(checkProbabilities(state.probabilities, { tolerance }));
  if (state.entropyBefore !== undefined && state.entropyAfter !== undefined) {
    checks.push(checkEntropyMonotone(state.entropyBefore, state.entropyAfter, { tolerance }));
  }
  if (state.interference) {
    checks.push(checkPhaseBound(state.interference.intensities, state.interference.crossTerms, { tolerance }));
  }

  const violations = checks.filter((c) => !c.satisfied);
  return Object.freeze({
    satisfied: violations.length === 0,
    checks: Object.freeze(checks),
    violations: Object.freeze(violations),
    // Which of the four came back clean, which were not applicable.
    covered: Object.freeze([...new Set(checks.map((c) => c.invariant))]),
  });
}

// Wrap an operation so its output is checked against the invariants the
// operation is supposed to preserve. `describe` maps the operation's
// input and output to a checkable state.
//
// `onViolation` defaults to throwing: an operation that corrupts the
// state space should not be allowed to return quietly. Pass a function
// to log-and-continue instead, which is what the cycle layer does —
// cycles are allowed to pass through invalid intermediate states so
// long as the cycle closes on a valid one.
export function guard(operation, describe, { onViolation, tolerance = DEFAULT_TOLERANCE } = {}) {
  return (...args) => {
    const output = operation(...args);
    const report = checkInvariants(describe(output, ...args), { tolerance });
    if (!report.satisfied) {
      if (onViolation) {
        onViolation(report, output);
      } else {
        const names = report.violations.map((v) => `${v.invariant}(${v.label ?? ''})`).join(', ');
        const err = new Error(`invariant violation after ${operation.name || 'operation'}: ${names}`);
        err.report = report;
        throw err;
      }
    }
    return output;
  };
}
