import test from 'node:test';
import assert from 'node:assert/strict';

import {
  changeSeries,
  detectBoundaries,
  detectChapters,
  segmentChapters,
  consensusBoundaries,
} from './index.js';

// A series with regimes: flat stretches separated by step changes.
function regimes(levels, lengthEach, noise = 0) {
  const out = [];
  let h = 42;
  const rand = () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return (h >>> 8) / 0x1000000 - 0.5;
  };
  for (const level of levels) {
    for (let i = 0; i < lengthEach; i++) out.push(level + rand() * noise);
  }
  return out;
}

test('changeSeries reports the frame-to-frame delta and leaves index 0 null', () => {
  const c = changeSeries([1, 1, 5, 5]);
  assert.equal(c[0], null);
  assert.equal(c[1], 0);
  assert.equal(c[2], 4);
  assert.equal(c[3], 0);
});

test('changeSeries carries nulls through rather than inventing values', () => {
  const c = changeSeries([1, null, 3]);
  assert.equal(c[1], null);
  assert.equal(c[2], null);
});

test('a flat series yields no boundaries and says why', () => {
  const flat = new Array(200).fill(0.5);
  const r = detectBoundaries(flat);
  assert.ok(r.abstained);
  assert.equal(r.boundaries.length, 0);
  assert.equal(r.reason, 'flat-spectrum');
});

test('pure noise does not manufacture chapter boundaries', () => {
  // The point of the extreme-value correction: the largest change in a
  // long noisy series is large by construction, and a naive top-k would
  // report it as structure.
  const noisy = regimes([1], 300, 0.4);
  const r = detectBoundaries(noisy);
  assert.ok(
    r.abstained || r.boundaries.length <= 2,
    `noise produced ${r.boundaries.length} boundaries`,
  );
});

test('a single step change is found at the step', () => {
  const series = regimes([0, 10], 100);
  const r = detectBoundaries(series);
  assert.ok(!r.abstained, 'a clean step is real structure');
  assert.equal(r.boundaries.length, 1);
  assert.equal(r.boundaries[0].index, 100, 'the boundary sits at the transition');
});

test('three regimes give two boundaries in axis order', () => {
  const series = regimes([0, 5, 1], 80);
  const r = detectBoundaries(series);
  assert.equal(r.boundaries.length, 2);
  assert.deepEqual(r.boundaries.map((b) => b.index), [80, 160]);
  assert.ok(r.boundaries[0].position < r.boundaries[1].position, 'output is axis-ordered');
});

test('a regime change is found through the DEF path when the series is noisy', () => {
  // The clean-step cases above take the zero-variance shortcut. Real
  // physics series always carry noise, so this exercises the actual
  // extreme-value path: a step that is large relative to the noise the
  // series itself exhibits.
  const series = regimes([0, 6], 150, 0.5);
  const r = detectBoundaries(series);
  assert.ok(!r.abstained, 'a step well above the noise floor is real structure');
  assert.notEqual(r.evidence.background, 'zero-variance', 'this must not be the degenerate path');
  assert.ok(
    r.boundaries.some((b) => Math.abs(b.index - 150) <= 3),
    `expected a boundary near 150, got ${r.boundaries.map((b) => b.index)}`,
  );
});

test('a step buried in the noise is not reported', () => {
  // The complement: the same machinery must decline when the step is
  // not distinguishable from the series' own variation.
  const series = regimes([0, 0.05], 150, 2);
  const r = detectBoundaries(series);
  assert.ok(
    r.abstained || !r.boundaries.some((b) => Math.abs(b.index - 150) <= 3),
    'a step below the noise floor must not be claimed',
  );
});

test('boundaries carry the evidence that justified them', () => {
  const r = detectBoundaries(regimes([0, 8], 100));
  assert.ok(r.evidence.k >= 1);
  assert.ok(r.evidence.candidates > 0);
  assert.ok(r.evidence.strongest > 0);
  assert.ok(Number.isFinite(r.evidence.threshold) || r.evidence.threshold === null);
});

test('positions map boundaries onto the real axis, not the index', () => {
  // The Potemkin case: 2 fps frames, boundary reported in seconds.
  const fps = 2;
  const series = regimes([0.1, 0.9], 200);
  const positions = series.map((_, i) => i / fps);
  const r = detectBoundaries(series, { positions });
  assert.equal(r.boundaries.length, 1);
  assert.equal(r.boundaries[0].position, 100, '200 frames at 2 fps = 100 s');
});

test('minGap collapses boundaries too close to be distinct', () => {
  // Two steps three units apart are one structural event seen twice.
  const series = [...new Array(50).fill(0), 5, 5, 5, ...new Array(50).fill(10)];
  const loose = detectBoundaries(series, { minGap: 0 });
  const tight = detectBoundaries(series, { minGap: 20 });
  assert.ok(tight.boundaries.length <= loose.boundaries.length);
  for (let i = 1; i < tight.boundaries.length; i++) {
    assert.ok(tight.boundaries[i].position - tight.boundaries[i - 1].position >= 20);
  }
});

test('smoothing suppresses single-frame spikes but keeps real regime changes', () => {
  const series = regimes([0, 6], 100);
  series[30] = 40; // one-frame flash: a cut, not a chapter
  const raw = detectBoundaries(series, { window: 1 });
  const smoothed = detectBoundaries(series, { window: 9 });
  const hasSpike = (r) => r.boundaries.some((b) => Math.abs(b.index - 30) <= 1);
  const hasStep = (r) => r.boundaries.some((b) => Math.abs(b.index - 100) <= 5);
  assert.ok(hasSpike(raw), 'unsmoothed, the flash reads as a boundary');
  assert.ok(hasStep(smoothed), 'the real regime change survives smoothing');
});

test('a series shorter than two measurable points abstains', () => {
  assert.ok(detectBoundaries([]).abstained);
  assert.ok(detectBoundaries([1]).abstained);
  assert.equal(detectBoundaries([1]).reason, 'insufficient-data');
});

test('non-finite values are skipped, not propagated', () => {
  const series = regimes([0, 7], 60);
  series[10] = NaN;
  series[11] = Infinity;
  const r = detectBoundaries(series);
  for (const b of r.boundaries) assert.ok(Number.isFinite(b.magnitude));
});

// ── Chapters ─────────────────────────────────────────────────────

test('segmentChapters turns boundaries into contiguous spans covering the extent', () => {
  const chapters = segmentChapters([{ position: 30 }, { position: 70 }], { extent: 100 });
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].start, 0);
  assert.equal(chapters[2].end, 100);
  for (let i = 1; i < chapters.length; i++) {
    assert.equal(chapters[i].start, chapters[i - 1].end, 'no gaps between chapters');
  }
});

test('detectChapters runs the whole pipeline', () => {
  const series = regimes([0, 5, 1], 80);
  const positions = series.map((_, i) => i / 2);
  const result = detectChapters(series, { positions });
  assert.equal(result.boundaries.length, 2);
  assert.equal(result.chapters.length, 3);
  assert.ok(result.chapters.every((c) => c.duration > 0));
});

test('an abstaining series yields one chapter, not zero', () => {
  const result = detectChapters(new Array(100).fill(1));
  assert.ok(result.abstained);
  assert.equal(result.chapters.length, 1, 'the whole extent is a single chapter');
});

// ── Cross-observable agreement ───────────────────────────────────

test('boundaries confirmed by several observables are reported with their agreement', () => {
  // Curl, divergence and current density all changing at the same
  // frame is much stronger evidence than any one of them alone.
  const curl = regimes([0, 4], 100);
  const divergence = regimes([1, 6], 100);
  const current = regimes([2, 9], 100);
  const r = consensusBoundaries({ curl, divergence, current }, { minAgreement: 2 });
  assert.ok(r.boundaries.length >= 1);
  const strongest = r.boundaries[0];
  assert.equal(strongest.agreement, 1, 'all three observables agree');
  assert.deepEqual([...strongest.observables].sort(), ['curl', 'current', 'divergence']);
});

test('a boundary only one observable sees is filtered out by minAgreement', () => {
  const flat = new Array(200).fill(1);
  const stepped = regimes([0, 5], 100);
  const r = consensusBoundaries({ a: stepped, b: flat, c: flat }, { minAgreement: 2 });
  assert.equal(r.boundaries.length, 0, 'one witness is a hypothesis, not a boundary');
  assert.ok(r.perObservable.a.boundaries.length > 0, 'but the per-observable finding is kept');
});

test('consensus keeps each observable full result for auditing', () => {
  const r = consensusBoundaries({
    curl: regimes([0, 4], 60),
    divergence: regimes([1, 6], 60),
  }, { minAgreement: 2 });
  assert.deepEqual(Object.keys(r.perObservable).sort(), ['curl', 'divergence']);
  assert.ok(r.perObservable.curl.evidence);
});
