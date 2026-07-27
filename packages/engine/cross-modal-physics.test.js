// The cross-modal bridge, as a test rather than a claim.
//
// The system's central assertion is that ONE set of modality-blind
// primitives reads audio, video and text: DEF finds gaps, boundedNull
// sets thresholds, centroid trajectory tracks recurrence, holon
// recursion finds nested structure. That assertion lived in inline eval
// scripts against large media files, so it could not be run in CI and
// could not fail loudly when it stopped being true.
//
// These tests carry the same claims over synthetic stand-ins with the
// same shape as the real signals — a fugue subject's accelerating
// entries, the Odessa Steps' accelerating cuts, a narrative's moment
// scores. No media files, no ffmpeg, deterministic.

import test from 'node:test';
import assert from 'node:assert/strict';

import { AccelTemplate, StructuralVocabulary, findAccelerationPattern } from './perceiver/video/holontutor.js';
import { detectBoundaries, consensusBoundaries } from './emergence/chapters/index.js';
import { analyzeFlowPhysics, physicsSeries } from './perceiver/video/physics.js';
import { fieldTrajectory, fieldCurrentDensity } from './emergence/trajectory/field-shift.js';
import { defineFieldSpec, eotFieldSpec, eotFieldVectors, fieldDistance } from './perceiver/field-spec.js';
import { crossModalConsensus } from './invariants/cycles.js';
import { DEF } from './emergence/nulls/extreme-value.js';

const COLS = 20;
const ROWS = 15;

// ── The acceleration template across modalities ──────────────────

test('one acceleration template matches film cuts and fugue entries alike', () => {
  // The Odessa Steps: shot lengths contracting toward the massacre.
  const odessaCuts = [8.0, 6.4, 5.1, 4.1, 3.3, 2.6, 2.1, 1.7, 1.3, 1.1];
  // A fugue exposition: the interval between subject entries contracting
  // as the stretto tightens. Different units, different medium, same shape.
  const fugueEntries = [4.0, 3.2, 2.55, 2.05, 1.65, 1.3, 1.05, 0.85, 0.65, 0.55];

  const template = new AccelTemplate(odessaCuts, 'odessa-steps');
  const match = template.match(fugueEntries);

  assert.ok(match.significant, `cross-modal match failed: corr ${match.corr}`);
  assert.ok(match.corr > 0.6, `expected a strong correlation, got ${match.corr}`);
  assert.ok(template.monotonicity > 0.9, 'the template is consistently accelerating');
  assert.ok(template.compression > 1, 'and compresses');
});

test('the template rejects a decelerating sequence', () => {
  // The bridge has to be able to say no, or the match means nothing.
  const template = new AccelTemplate([8.0, 6.4, 5.1, 4.1, 3.3, 2.6, 2.1, 1.7], 'odessa-steps');
  const decelerating = [1.0, 1.3, 1.7, 2.1, 2.7, 3.4, 4.3, 5.4];
  assert.ok(!template.match(decelerating).significant, 'deceleration is not acceleration');
});

test('the template rejects a flat sequence', () => {
  const template = new AccelTemplate([8, 6.4, 5.1, 4.1, 3.3, 2.6], 'odessa-steps');
  assert.ok(!template.match([3, 3, 3, 3, 3, 3]).significant);
});

test('the structural vocabulary recognises a learned shape in another medium', () => {
  const vocab = new StructuralVocabulary();
  vocab.learn('odessa-acceleration', [8.0, 6.4, 5.1, 4.1, 3.3, 2.6, 2.1, 1.7, 1.3]);
  vocab.learn('steady-pulse', [3, 3, 3, 3, 3, 3, 3, 3, 3]);

  const fugueStretto = [4.0, 3.2, 2.55, 2.05, 1.65, 1.3, 1.05, 0.85, 0.65];
  const recognised = vocab.recognize(fugueStretto);

  assert.ok(recognised.length > 0, 'the learned film shape must be recognised in music');
  assert.equal(recognised[0].template.label, 'odessa-acceleration');
});

test('findAccelerationPattern locates the accelerating stretch inside a longer series', () => {
  // A film that is calm, then accelerates, then settles. The pattern
  // finder has to locate the middle without being told where it is.
  const series = [
    ...new Array(10).fill(6),
    8.0, 6.4, 5.1, 4.1, 3.3, 2.6, 2.1, 1.7,
    ...new Array(10).fill(2),
  ];
  const found = findAccelerationPattern(series, { minLength: 5, maxLength: 12 });
  assert.ok(found.length > 0, 'an accelerating stretch exists and must be found');
  assert.ok(found[0].compression > 1.2);
});

// ── The same physics over synthetic video ────────────────────────

function flowField(fn) {
  const dx = new Float64Array(COLS * ROWS);
  const dy = new Float64Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const [u, v] = fn(x, y);
      dx[y * COLS + x] = u;
      dy[y * COLS + x] = v;
    }
  }
  return { vectors: { dx, dy }, cols: COLS, rows: ROWS };
}

test('a crowd surge and a crowd scatter are distinguishable by physics alone', () => {
  // The Potemkin reading: a coherent surge down the steps versus a
  // crowd scattering. Divergence and coherence separate them without
  // anyone labelling the frames.
  const surge = analyzeFlowPhysics(flowField(() => [0, 3]));
  const scatter = analyzeFlowPhysics(flowField((x, y) => [x - 9.5, y - 7]));

  assert.ok(Math.abs(surge.divergence) < 1e-9, 'a uniform surge does not expand');
  assert.ok(scatter.divergence > 1, 'scattering is positive divergence');
  assert.ok(surge.currentCoherence > 0.99, 'a surge moves as one');
  assert.ok(scatter.currentCoherence < surge.currentCoherence, 'scattering is less coherent');
});

test('physics observables become a time series the chapter detector can read', () => {
  // The bridge from the perceiver into the modality-blind layer: a
  // sequence of frames becomes scalar series, and the SAME DEF-based
  // detector that reads audio flux or text moment scores reads them.
  const calm = analyzeFlowPhysics(flowField(() => [0.2, 0]));
  const violent = analyzeFlowPhysics(flowField((x, y) => [-(y - 7) * 2, (x - 9.5) * 2]));
  const frames = [
    ...new Array(60).fill(calm),
    ...new Array(60).fill(violent),
  ];
  const series = physicsSeries(frames);

  assert.ok(Array.isArray(series.curl));
  assert.equal(series.curl.length, 120);

  const found = detectBoundaries(series.curl);
  assert.ok(!found.abstained, 'a regime change in curl is structure');
  assert.ok(
    found.boundaries.some((b) => Math.abs(b.index - 60) <= 2),
    `expected the boundary at frame 60, got ${found.boundaries.map((b) => b.index)}`,
  );
});

test('several physics observables agreeing is stronger evidence than one', () => {
  const calm = analyzeFlowPhysics(flowField(() => [0.2, 0]));
  const violent = analyzeFlowPhysics(flowField((x, y) => [-(y - 7) * 2, (x - 9.5) * 2]));
  const frames = [...new Array(60).fill(calm), ...new Array(60).fill(violent)];
  const series = physicsSeries(frames);

  const consensus = consensusBoundaries({
    curl: series.curl,
    gradient: series.gradient,
    rotationalEnergy: series.rotationalEnergy,
  }, { minAgreement: 2 });

  assert.ok(consensus.boundaries.length >= 1);
  assert.ok(consensus.boundaries[0].observables.length >= 2, 'multiple observables confirm the boundary');
});

// ── The same trajectory math over all three modalities ───────────

test('red shift and current density read audio, video and text sequences identically', () => {
  // Three sequences, three field specs, one set of functions. Nothing
  // in fieldTrajectory asks which medium it is looking at.
  const audioSpec = defineFieldSpec({
    id: 'audio-ish',
    channels: [{ name: 'chroma', dims: 12, metric: 'angular' }],
  });
  const videoSpec = defineFieldSpec({
    id: 'video-ish',
    channels: [{ name: 'motion', dims: 12, metric: 'angular' }],
  });
  const textSpec = defineFieldSpec({
    id: 'text-ish',
    channels: [{ name: 'figures', dims: 12, metric: 'angular' }],
  });

  // The same underlying shape: a state rotating steadily through the space.
  const rotate = (steps) =>
    Array.from({ length: steps }, (_, t) => {
      const v = new Float64Array(12);
      v[t % 12] = 1;
      v[(t + 1) % 12] = 0.5;
      return v;
    });

  const readings = [audioSpec, videoSpec, textSpec].map((spec) =>
    fieldTrajectory(rotate(6), spec));

  // Same shape in, same numbers out — regardless of what the channel is
  // called or which modality declared it.
  for (const r of readings.slice(1)) {
    assert.ok(Math.abs(r.redShift - readings[0].redShift) < 1e-12, 'red shift is modality-blind');
    assert.ok(Math.abs(r.currentDensity - readings[0].currentDensity) < 1e-12, 'so is current density');
  }
  assert.ok(readings[0].redShift > 0);
  assert.ok(readings.every((r) => r.coherenceBounded));
});

test('an EOT operator log yields field vectors the physics layer can read', () => {
  // Text's missing field spec: the EOT log defines figures, moment
  // scores and operator frequencies, and from there it is just another
  // field sequence.
  const spec = eotFieldSpec({ figures: ['natasha', 'andrew', 'pierre'] });
  assert.equal(spec.dims, 3 + 2 + 9);

  const moments = [
    { score: 12.3, order: 1, figures: ['natasha'], operators: ['SIG'] },
    { score: 12.5, order: 3, figures: ['natasha', 'andrew'], operators: ['SIG', 'CON'] },
    { score: 13.9, order: 8, figures: ['natasha', 'andrew'], operators: ['EVA'] },
    { score: 12.1, order: 12, figures: ['natasha', 'pierre'], operators: ['SIG'] },
  ];
  const vectors = eotFieldVectors(moments, spec);
  assert.equal(vectors.length, 4);
  assert.equal(vectors[0].length, spec.dims);

  const reading = fieldTrajectory(vectors, spec, { positions: moments.map((m) => m.order) });
  assert.ok(reading.redShift > 0, 'Natasha moves away from her rest frame across the ball');
  assert.ok(reading.currentDensity > 0);
  assert.equal(reading.phaseVolatility.length, 3);
  assert.equal(reading.spec, 'eot-operator-log');
});

test('the EOT field spec slices channels by name, not by hardcoded offset', () => {
  const spec = eotFieldSpec({ figures: ['a', 'b'] });
  const [v] = eotFieldVectors([{ score: 10, order: 1, figures: ['b'], operators: ['EVA', 'EVA'] }], spec);
  const { channels } = fieldDistance(v, v, spec);
  assert.deepEqual(Object.keys(channels).sort(), ['figures', 'moments', 'operators']);
  // Figure 'b' is index 1 of the figures channel, which starts at 0.
  assert.equal(v[1], 1);
  // EVA is index 7 of the operator vocabulary, after figures(2)+moments(2).
  assert.equal(v[2 + 2 + 7], 2);
});

// ── The three modalities as redundant verification paths ─────────

test('three modalities reading the same structure form a consensus', () => {
  // Cycle 3 over real measurements rather than invented numbers: three
  // field sequences with the same shape must project to the same place.
  const spec = defineFieldSpec({ id: 's', channels: [{ name: 'c', dims: 8, metric: 'angular' }] });
  const ramp = (scale) =>
    Array.from({ length: 5 }, (_, t) => {
      const v = new Float64Array(8);
      v[0] = 1 - t * 0.15 * scale;
      v[1] = t * 0.15 * scale;
      return v;
    });

  const projections = {};
  for (const [name, scale] of [['audio', 1], ['video', 1], ['text', 1]]) {
    projections[name] = fieldCurrentDensity(ramp(scale), spec).coherence;
  }
  const consensus = crossModalConsensus(projections);
  assert.ok(consensus.agreed, 'identical structure must agree across modalities');
  assert.ok(consensus.faultTolerant, 'three independent paths');
});

test('a corrupted modality is detected against the other two', () => {
  const spec = defineFieldSpec({ id: 's', channels: [{ name: 'c', dims: 8, metric: 'angular' }] });
  const ramp = () => Array.from({ length: 5 }, (_, t) => {
    const v = new Float64Array(8);
    v[0] = 1 - t * 0.15;
    v[1] = t * 0.15;
    return v;
  });
  const thrash = () => Array.from({ length: 5 }, (_, t) => {
    const v = new Float64Array(8);
    v[t % 2] = 1;
    return v;
  });

  const consensus = crossModalConsensus({
    audio: fieldCurrentDensity(ramp(), spec).coherence,
    video: fieldCurrentDensity(ramp(), spec).coherence,
    text: fieldCurrentDensity(thrash(), spec).coherence,
  });
  assert.ok(!consensus.agreed, 'the odd channel out must break the consensus');
});

// ── DEF is the same primitive everywhere ─────────────────────────

test('DEF finds the same elbow in audio, video and text spectra', () => {
  // The claim that one primitive serves all three: a spectrum with a
  // real gap splits, a flat one abstains, whatever produced it.
  const withGap = [10, 9.5, 9.2, 2.1, 2.0, 1.9, 1.8, 1.7, 1.6, 1.5];
  const flat = [5, 4.9, 4.8, 4.7, 4.6, 4.5, 4.4, 4.3, 4.2, 4.1];

  const gapped = DEF(withGap);
  assert.ok(!gapped.abstain, 'a real gap must be found');
  assert.equal(gapped.k, 3, 'three values sit above the gap');

  assert.ok(DEF(flat).abstain, 'a flat spectrum must abstain');
  assert.equal(DEF(flat).k, 1);
});
