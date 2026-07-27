import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkProbability,
  checkProbabilities,
  checkContinuity,
  checkFoldContinuity,
  checkEntropyMonotone,
  checkPhaseBound,
  scatteringKernelBound,
  amplitudeEntropy,
  checkInvariants,
  guard,
  INVARIANT_IDS,
} from './index.js';

import { fold, project, interfere, decohereFold, measureFold } from '../quantum/index.js';

test('the four invariants are named and exactly four', () => {
  assert.deepEqual(INVARIANT_IDS, ['probability', 'continuity', 'thermodynamic', 'phase']);
});

// ── 1. PROBABILITY: 0 ≤ P ≤ 1 ────────────────────────────────────

test('probability invariant bounds the Born range', () => {
  assert.ok(checkProbability(0).satisfied);
  assert.ok(checkProbability(1).satisfied);
  assert.ok(checkProbability(0.5).satisfied);
  assert.ok(!checkProbability(1.0001).satisfied);
  assert.ok(!checkProbability(-0.0001).satisfied);
  assert.ok(!checkProbability(NaN).satisfied);
  assert.ok(!checkProbability(Infinity).satisfied);
});

test('probability margin distinguishes "just inside" from "comfortably inside"', () => {
  assert.equal(checkProbability(0.5).margin, 0.5);
  assert.ok(checkProbability(0.999).margin < checkProbability(0.5).margin);
  assert.ok(checkProbability(1.4).margin < 0, 'overshoot is a negative margin');
});

test('probability battery locates the offending dimension', () => {
  const report = checkProbabilities({ text: 0.4, audio: 1.7, video: 0.5 });
  assert.ok(!report.satisfied);
  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].label, 'audio');
});

// ── 2. CONTINUITY: Σ|ψ|² = 1 ─────────────────────────────────────

test('continuity invariant holds for normalised amplitudes', () => {
  const r = 1 / Math.sqrt(3);
  assert.ok(checkContinuity({ a: r, b: r, c: r }).satisfied);
  assert.ok(checkContinuity({ a: 1 }).satisfied);
  assert.ok(!checkContinuity({ a: 0.5, b: 0.5 }).satisfied, 'norm 0.5 is not conserved');
});

test('a zero-norm face is a violation, not a pass', () => {
  // quantum/normalizeAmplitudes() short-circuits on sumSquares === 0 and
  // leaves the face all-zero. Its norm is 0, not 1, and every projection
  // out of it is meaningless — so it must be visible here.
  const check = checkContinuity({ a: 0, b: 0, c: 0 });
  assert.ok(!check.satisfied);
  assert.equal(check.reason, 'zero-norm');
});

test('an empty face and a non-finite amplitude both violate continuity', () => {
  assert.equal(checkContinuity({}).reason, 'empty-face');
  assert.equal(checkContinuity({ a: NaN }).reason, 'not-finite');
  assert.ok(!checkContinuity({ a: 1, b: Infinity }).satisfied);
});

test('real folds out of quantum/fold() conserve norm on all three faces', () => {
  const f = fold('the crowd surges down the steps, soldiers advancing in rank');
  const report = checkFoldContinuity(f);
  assert.ok(report.satisfied, JSON.stringify(report.violations));
  assert.equal(report.faces.length, 3);
});

test('measureFold and decohereFold both preserve continuity', () => {
  const a = fold('a fugue subject returns in the dominant');
  const b = fold('she entered the brightly illuminated hall');
  assert.ok(checkFoldContinuity(measureFold(a, b, 0.3)).satisfied);
  assert.ok(checkFoldContinuity(decohereFold(a, 60000)).satisfied);
});

// ── 3. THERMODYNAMIC: dS/dt ≥ 0 ──────────────────────────────────

test('entropy is zero for a collapsed face and maximal for a uniform one', () => {
  assert.equal(amplitudeEntropy({ a: 1, b: 0, c: 0 }), 0);
  const r = 1 / Math.sqrt(4);
  assert.ok(Math.abs(amplitudeEntropy({ a: r, b: r, c: r, d: r }) - 2) < 1e-12, 'log2(4) = 2 bits');
});

test('decoherence never reduces entropy', () => {
  // Start from a strongly peaked state, the case with the most room to
  // fall. Decoherence mixes toward uniform, so entropy must rise.
  const peaked = { a: 0.99, b: 0.1, c: 0.05 };
  const before = amplitudeEntropy(peaked);
  const after = decohereFold({ operator: peaked, terrain: peaked, stance: peaked }, 7200000);
  const check = checkEntropyMonotone(before, amplitudeEntropy(after.terrain));
  assert.ok(check.satisfied, `dS = ${check.dS}`);
  assert.ok(check.dS > 0, 'decoherence strictly increased entropy here');
});

test('entropy monotonicity rejects a decrease and accepts a flat step', () => {
  assert.ok(!checkEntropyMonotone(2.0, 1.0).satisfied);
  assert.ok(checkEntropyMonotone(2.0, 2.0).satisfied);
  assert.ok(checkEntropyMonotone(1.0, 2.0).satisfied);
});

// ── 4. PHASE: |Σ√(I₁I₂)cosδ| ≤ ΣI ────────────────────────────────

test('phase bound accepts cross terms within the sum of intensities', () => {
  assert.ok(checkPhaseBound([0.5, 0.5], [0.3, 0.2]).satisfied);
  assert.ok(!checkPhaseBound([0.1, 0.1], [0.5, 0.5]).satisfied, 'cross terms exceed ΣI');
});

test('the scattering kernel in quantum/interfere() breaches the phase bound by construction', () => {
  // interfere() uses kernel = β(1 + α·cos δ) with β = 1.0, α = 0.3, so
  // the cross term carries a factor of up to 1.3 where the two-source
  // bound allows at most 1.0. This is not a runtime accident — it is in
  // the constants, and it is invisible downstream because interfere()
  // clamps its output into [0,1]: the intensity is capped, so nothing
  // looks wrong, while the ordering among folds near the cap is already
  // distorted. A static check on the constants is the only place it
  // can be caught.
  const bound = scatteringKernelBound(1.0, 0.3);
  assert.ok(!bound.satisfied, 'β=1.0, α=0.3 must be reported as a violation');
  assert.ok(Math.abs(bound.maxAmplification - 1.3) < 1e-12);
  assert.ok(Math.abs(bound.margin + 0.3) < 1e-12, 'the overshoot is 30%');

  // A kernel that respects the bound passes.
  assert.ok(scatteringKernelBound(0.7, 0.3).satisfied);
  assert.ok(scatteringKernelBound(1.0, 0.0).satisfied);
});

test('interfere() output is clamped, which is why the breach needs a static check', () => {
  const store = [
    fold('the crowd surges down the steps'),
    fold('a fugue subject returns in the dominant'),
    fold('she entered the brightly illuminated hall'),
  ];
  const intensities = interfere(store[0], store);
  // Every value is inside [0,1] — the clamp guarantees it. Observing the
  // output alone can therefore never reveal the kernel overshoot.
  for (const i of intensities) assert.ok(checkProbability(i).satisfied);
  assert.ok(intensities.some((i) => i === 1), 'at least one value is saturated at the clamp');
});

// ── The battery and the guard ────────────────────────────────────

test('checkInvariants reports which invariants it could actually cover', () => {
  const f = fold('the crowd surges down the steps');
  const bare = checkInvariants({ fold: f });
  assert.ok(bare.satisfied);
  assert.deepEqual(bare.covered, ['continuity'], 'a bare fold only supports a continuity check');

  const full = checkInvariants({
    fold: f,
    probabilities: { text: 0.4 },
    entropyBefore: 1,
    entropyAfter: 2,
    interference: { intensities: [0.5, 0.5], crossTerms: [0.1] },
  });
  assert.ok(full.satisfied);
  assert.equal(full.covered.length, 4, 'all four invariants covered');
});

test('checkInvariants surfaces every violation, not just the first', () => {
  const report = checkInvariants({
    amplitudes: { a: 0.5, b: 0.5 },
    probabilities: { video: 2 },
    entropyBefore: 3,
    entropyAfter: 1,
  });
  assert.ok(!report.satisfied);
  const kinds = report.violations.map((v) => v.invariant).sort();
  assert.deepEqual(kinds, ['continuity', 'probability', 'thermodynamic']);
});

test('guard throws when an operation corrupts the state space', () => {
  const corrupt = () => ({ operator: { a: 5 }, terrain: { a: 1 }, stance: { a: 1 } });
  const guarded = guard(corrupt, (out) => ({ fold: out }));
  assert.throws(() => guarded(), /invariant violation/);
});

test('guard lets a valid operation through untouched', () => {
  const a = fold('a fugue subject returns in the dominant');
  const b = fold('she entered the brightly illuminated hall');
  const guarded = guard(measureFold, (out) => ({ fold: out }));
  const out = guarded(a, b, 0.3);
  assert.ok(checkFoldContinuity(out).satisfied);
});

test('guard can report instead of throw, for cycles that pass through invalid states', () => {
  const seen = [];
  const corrupt = () => ({ operator: { a: 5 }, terrain: { a: 1 }, stance: { a: 1 } });
  const guarded = guard(corrupt, (out) => ({ fold: out }), { onViolation: (r) => seen.push(r) });
  assert.doesNotThrow(() => guarded());
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].satisfied);
});

test('project() stays inside the Born range across real folds', () => {
  const texts = [
    'the crowd surges down the steps, soldiers advancing in rank',
    'a fugue subject returns in the dominant, inverted',
    'she understood all that awaited her when she entered the hall',
    '',
    'zzz qqq xxx',
  ];
  const folds = texts.map((t) => fold(t));
  for (const a of folds) {
    for (const b of folds) {
      assert.ok(checkProbability(project(a, b)).satisfied);
    }
  }
});
