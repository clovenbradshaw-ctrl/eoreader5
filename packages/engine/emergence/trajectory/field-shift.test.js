import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fieldRedShift,
  fieldRestFrameDivergence,
  fieldPhaseVolatility,
  fieldCurrentDensity,
  fieldTrajectory,
  trajectoryToVectors,
  signatureToVector,
  signatureBasis,
  restFrameDistances,
  stepDistances,
} from './field-shift.js';
import { redShift, restFrameDivergence, phaseVolatility, relationSignature } from './index.js';
import { cosineDistance, defineFieldSpec } from '../../perceiver/field-spec.js';

// A trajectory in the shape trajectory/index.js expects: phases, each
// carrying relations with a `via` label.
const rel = (...vias) => vias.map((via) => ({ via }));
const TRAJECTORY = {
  focus: 'Natásha Rostóva',
  focusId: 'figure_natasha_rostova',
  gained: [],
  lost: [],
  turns: [1, 2, 3, 4],
  phases: [
    { phase: 0, relations: rel('sees', 'sees', 'stands') },
    { phase: 1, relations: rel('sees', 'stands', 'dances', 'dances') },
    { phase: 2, relations: rel('dances', 'dances', 'dances', 'speaks') },
    { phase: 3, relations: rel('speaks', 'speaks', 'reflects') },
    { phase: 4, relations: rel('reflects', 'reflects', 'reflects') },
  ],
};

// ── The unification claim ────────────────────────────────────────

test('a relation signature densified against a basis is the same vector', () => {
  const sig = relationSignature(rel('a', 'a', 'b'));
  const basis = signatureBasis([sig]);
  const vec = signatureToVector(sig, basis);
  assert.deepEqual(basis, ['a', 'b']);
  assert.ok(Math.abs(vec[0] - 2 / 3) < 1e-12);
  assert.ok(Math.abs(vec[1] - 1 / 3) < 1e-12);
});

test('Map-based and array-based cosine distance agree exactly', () => {
  // trajectory/index.js compares relation-signature Maps; field-spec.js
  // compares arrays. If these disagree the unification is a claim, not
  // a fact — so this pins them together.
  const a = relationSignature(rel('sees', 'sees', 'stands'));
  const b = relationSignature(rel('dances', 'dances', 'speaks', 'sees'));
  const basis = signatureBasis([a, b]);
  const arrayDistance = cosineDistance(signatureToVector(a, basis), signatureToVector(b, basis));

  // The Map form, recomputed here exactly as trajectory/index.js does it.
  let dot = 0, na = 0, nb = 0;
  for (const via of new Set([...a.keys(), ...b.keys()])) {
    const va = a.get(via) || 0;
    const vb = b.get(via) || 0;
    dot += va * vb; na += va * va; nb += vb * vb;
  }
  const mapDistance = 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));

  assert.ok(Math.abs(arrayDistance - mapDistance) < 1e-12, `${arrayDistance} vs ${mapDistance}`);
});

test('fieldRedShift reproduces trajectory redShift on the same trajectory', () => {
  // The headline of the unification: the character's red shift computed
  // from field vectors equals the one computed from relation signatures.
  const { vectors } = trajectoryToVectors(TRAJECTORY, relationSignature);
  assert.equal(fieldRedShift(vectors), redShift(TRAJECTORY));
});

test('fieldRestFrameDivergence reproduces restFrameDivergence', () => {
  const { vectors } = trajectoryToVectors(TRAJECTORY, relationSignature);
  assert.equal(fieldRestFrameDivergence(vectors), restFrameDivergence(TRAJECTORY));
});

test('fieldPhaseVolatility reproduces the per-phase shifts', () => {
  const { vectors } = trajectoryToVectors(TRAJECTORY, relationSignature);
  const fromFields = fieldPhaseVolatility(vectors).map((v) => v.shift);
  const fromTrajectory = phaseVolatility(TRAJECTORY).map((v) => v.shift);
  assert.deepEqual(fromFields, fromTrajectory);
});

// ── Current density over the same measurements ───────────────────

test('current density is built from the same step distances as red shift', () => {
  const { vectors } = trajectoryToVectors(TRAJECTORY, relationSignature);
  const current = fieldCurrentDensity(vectors);
  assert.deepEqual(current.steps, stepDistances(vectors));
  const sum = stepDistances(vectors).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(current.total - sum) < 1e-12, 'total is the path length through field space');
});

test('a character who travels and returns has high path length but low coherence', () => {
  const there = { phase: 0, relations: rel('a', 'a', 'a') };
  const away = { phase: 1, relations: rel('b', 'b', 'b') };
  const back = { phase: 2, relations: rel('a', 'a', 'a') };
  const { vectors } = trajectoryToVectors({ phases: [there, away, back] }, relationSignature);
  const current = fieldCurrentDensity(vectors);
  assert.ok(current.total > 1.9, 'the path is long — out and back');
  assert.ok(current.net < 1e-12, 'but the displacement is nil');
  assert.ok(current.coherence < 1e-9, 'so the current is incoherent');
});

test('a character who transforms steadily has coherent current', () => {
  const { vectors } = trajectoryToVectors({
    phases: [
      { phase: 0, relations: rel('a', 'a', 'a', 'a') },
      { phase: 1, relations: rel('a', 'a', 'a', 'b') },
      { phase: 2, relations: rel('a', 'a', 'b', 'b') },
      { phase: 3, relations: rel('a', 'b', 'b', 'b') },
      { phase: 4, relations: rel('b', 'b', 'b', 'b') },
    ],
  }, relationSignature);
  const current = fieldCurrentDensity(vectors);
  assert.ok(current.coherence > 0.5, `steady transformation is coherent, got ${current.coherence}`);
  assert.ok(current.net > 0.9, 'and ends far from the rest frame');
});

// ── Over a real field spec ───────────────────────────────────────

test('the same functions run over a multi-channel field spec', () => {
  // The modality-blind claim: nothing here asks what medium it is
  // reading. A two-channel spec stands in for audio chroma+moments or
  // video motion+histogram.
  const spec = defineFieldSpec({
    id: 'test-spec',
    channels: [
      { name: 'tone', dims: 3, metric: 'angular' },
      { name: 'level', dims: 2, metric: 'euclidean' },
    ],
  });
  const vectors = [
    Float64Array.from([1, 0, 0, 0.5, 0.5]),
    Float64Array.from([0.7, 0.7, 0, 0.6, 0.4]),
    Float64Array.from([0, 1, 0, 0.7, 0.3]),
  ];
  const reading = fieldTrajectory(vectors, spec);
  assert.equal(reading.spec, 'test-spec');
  assert.equal(reading.states, 3);
  assert.ok(reading.redShift > 0, 'the sequence moved away from its rest frame');
  assert.ok(reading.currentDensity > 0);
  assert.ok(reading.coherenceBounded, 'angular + euclidean channels are true metrics');
  assert.ok(reading.coherence > 0 && reading.coherence <= 1);
  assert.equal(reading.phaseVolatility.length, 2);
});

test('cosine channels are flagged as non-metric, and coherence can exceed 1', () => {
  // Cosine distance (1 − cos θ) violates the triangle inequality, so
  // displacement/path-length is not bounded by 1 under it. Rather than
  // clamp — which would hide the fact that the measure is being read
  // outside its domain — the result says the ratio is unbounded.
  const cosineSpec = defineFieldSpec({
    id: 'cosine-spec',
    channels: [
      { name: 'tone', dims: 3, metric: 'cosine' },
      { name: 'level', dims: 2, metric: 'euclidean' },
    ],
  });
  const vectors = [
    Float64Array.from([1, 0, 0, 0.5, 0.5]),
    Float64Array.from([0.7, 0.7, 0, 0.6, 0.4]),
    Float64Array.from([0, 1, 0, 0.7, 0.3]),
  ];
  const current = fieldCurrentDensity(vectors, cosineSpec);
  assert.ok(!current.bounded, 'a cosine channel makes the spec non-metric');
  assert.ok(current.coherence > 1, `this case actually exceeds 1: ${current.coherence}`);

  // The same data under the angular form stays inside [0,1].
  const angularSpec = defineFieldSpec({
    id: 'angular-spec',
    channels: [
      { name: 'tone', dims: 3, metric: 'angular' },
      { name: 'level', dims: 2, metric: 'euclidean' },
    ],
  });
  const safe = fieldCurrentDensity(vectors, angularSpec);
  assert.ok(safe.bounded);
  assert.ok(safe.coherence <= 1 + 1e-12, `angular coherence ${safe.coherence} must be bounded`);
});

test('a stationary sequence has zero red shift and zero current', () => {
  const v = Float64Array.from([1, 0, 0]);
  const reading = fieldTrajectory([v, v, v, v]);
  assert.equal(reading.redShift, 0);
  assert.equal(reading.currentDensity, 0);
  assert.equal(reading.restFrameDivergence, 0);
});

test('degenerate inputs return zero rather than NaN', () => {
  assert.equal(fieldRedShift([]), 0);
  assert.equal(fieldRedShift([Float64Array.from([1, 2])]), 0);
  assert.equal(fieldRestFrameDivergence(null), 0);
  assert.deepEqual(restFrameDistances([]), []);
  const current = fieldCurrentDensity([]);
  assert.equal(current.total, 0);
  assert.equal(current.coherence, 0);
});

test('a zero vector does not produce NaN distances', () => {
  const zero = Float64Array.from([0, 0, 0]);
  const one = Float64Array.from([1, 0, 0]);
  assert.ok(Number.isFinite(cosineDistance(zero, one)));
  const reading = fieldTrajectory([zero, one, zero]);
  for (const [k, v] of Object.entries(reading)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} is finite`);
  }
});
