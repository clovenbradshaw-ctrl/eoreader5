import test from 'node:test';
import assert from 'node:assert/strict';

import { defineFieldSpec } from '../../perceiver/field-spec.js';
import { deriveNull } from '../nulls/index.js';
import { seedPool } from './seeding.js';
import { applyShaping, growTaskTree, perturbedCoherenceSamples } from './loop.js';

const spec = defineFieldSpec({
  id: 'test:loop',
  channels: [
    { name: 'form', dims: 3, metric: 'angular' },
    { name: 'function', dims: 3, metric: 'angular' },
  ],
});

// A tight cluster plus an outlier: a settled set with real isolation
// structure, so the round-0 spectrum has a gap for DEF to find. A
// symmetric seed has none and abstains immediately — which is DEF being
// right, but makes for a test that exercises nothing.
const seed = [
  { id: 'seed:a', vector: [1, 0.1, 0, 1, 0.1, 0] },
  { id: 'seed:b', vector: [1, 0.2, 0, 1, 0.0, 0] },
  { id: 'seed:c', vector: [0.9, 0.1, 0.1, 1, 0.1, 0.1] },
  { id: 'seed:d', vector: [0, 0.2, 1, 0, 0.9, 1] },
  { id: 'seed:e', vector: [1, 0.15, 0, 0.95, 0.05, 0] },
];

// A host-side validator that always clears its pencil's own required bar.
// Real hosts run a build; this stands in for one so the loop's wiring is
// what's under test, not the test harness's cleverness.
const alwaysValidates = (pencil) => deriveNull({
  nullSamples: [0.1, 0.2, 0.15, 0.12, 0.18, 0.11],
  observedStatistic: 0.95,
  tailDirection: 'greater',
  quantile: pencil.required_validation_quantile,
  protocol: { name: 'test-build-check' },
});

const neverValidates = () => deriveNull({
  nullSamples: [0.8, 0.9, 0.85, 0.82, 0.88, 0.91],
  observedStatistic: 0.05,
  tailDirection: 'greater',
  quantile: 0.9,
  protocol: { name: 'test-build-check' },
});

// ── Preconditions ────────────────────────────────────────────────────

test('growTaskTree needs at least two seed positions', async () => {
  await assert.rejects(
    () => growTaskTree({ seed: [{ id: 'a', vector: [1, 0, 0, 0, 0, 0] }], validate: alwaysValidates }),
    /at least two seed positions/,
  );
});

test('growTaskTree refuses to run without a host-side validator', async () => {
  await assert.rejects(() => growTaskTree({ seed }), /validate is required/);
});

// ── The self-seeding property ────────────────────────────────────────

test('the settled set grows with every ink, and later pools are generated from it', async () => {
  const result = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 4 });
  assert.ok(result.inks.length > 0, 'something was promoted');
  assert.equal(result.settled.length, seed.length + result.inks.length);
  for (const ink of result.inks) {
    assert.ok(result.settled.some((s) => s.id === ink.id), 'every ink joined the settled set');
  }
});

test('a later round\'s pool is generated from the settled set the inks enlarged', async () => {
  const result = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 4 });
  const firstProductive = result.rounds.findIndex((r) => r.promotions > 0);
  assert.ok(firstProductive >= 0, 'nothing was ever promoted, so there is no feedback to check');
  // The round after a promotion must generate its pool from a settled set
  // that includes the new inks — reproduce it independently and compare.
  const settledAfter = result.settled.slice(0, seed.length + result.rounds.slice(0, firstProductive + 1)
    .reduce((a, r) => a + r.promotions, 0));
  const expected = seedPool({ settled: settledAfter, spec, salt: firstProductive + 1 });
  assert.equal(result.rounds[firstProductive + 1].candidates, expected.candidates.length);
  assert.ok(expected.candidates.length > result.rounds[0].candidates,
    'the pool grew because the settled set did — that is the feedback path');
});

test('the pool a round generates is exactly seedPool over that round\'s settled set', async () => {
  // Round 0's pool must be reproducible from the seed alone: the loop
  // consults nothing else.
  const result = await growTaskTree({ seed, spec, validate: neverValidates, maxRounds: 1 });
  const expected = seedPool({ settled: seed, spec, salt: 0 });
  assert.equal(result.rounds[0].candidates, expected.candidates.length);
});

// ── The measured limit, pinned so a future fix is visible ────────────
//
// seeding.js documents why: a score built only out of geometry is
// isotropic, so once the frontier has been pushed out there is no
// standout next move and DEF abstains — correctly. This test asserts the
// CURRENT measured behaviour, not a desired one. If a future change to
// the candidate observable makes it fail, that is the win, and this test
// is the thing that should be rewritten to describe the new behaviour.
test('MEASURED LIMIT: no promoted task is ever built from another promoted task', async () => {
  const result = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 8 });
  const inkIds = new Set(result.inks.map((i) => i.id));
  const inkParented = result.edges.filter((e) => inkIds.has(e.to));
  assert.equal(inkParented.length, 0,
    'generational depth appeared — the geometric-isotropy limit in seeding.js\'s header no longer holds, and both should be rewritten');
});

test('MEASURED LIMIT: promotion stops after at most one productive round', async () => {
  const result = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 8 });
  const productive = result.rounds.filter((r) => r.promotions > 0);
  assert.ok(productive.length <= 1, `expected at most one productive round under the geometric score, got ${productive.length}`);
});

// ── Held, never dropped ──────────────────────────────────────────────

test('a pencil whose validation fails is held verbatim, and nothing settles', async () => {
  const result = await growTaskTree({ seed, spec, validate: neverValidates, maxRounds: 2 });
  assert.equal(result.inks.length, 0);
  assert.equal(result.settled.length, seed.length, 'a failed validation settles nothing');
  assert.ok(result.held.length > 0);
  for (const h of result.held) {
    assert.equal(h.promoted, false);
    assert.equal(h.task.lifecycle, 'pencil');
    assert.ok(Object.isFrozen(h.task), 'the pencil comes back frozen and unmutated');
  }
});

test('every round records its held reasons rather than silently dropping them', async () => {
  const result = await growTaskTree({ seed, spec, validate: neverValidates, maxRounds: 2 });
  const withHeld = result.rounds.filter((r) => r.held.length > 0);
  assert.ok(withHeld.length > 0);
  for (const r of withHeld) for (const reason of r.held) {
    assert.ok(['validation-failed', 'validation-underpowered'].includes(reason));
  }
});

// ── Dependency risk actually reaches the pencil ──────────────────────

test('validation underpowered for the node\'s dependency risk is rejected like a failure', async () => {
  // A validator that always checks at the same weak quantile regardless of
  // what the pencil demands. Leaves (zero dependents) pass; anything built
  // on a node other things already cite does not.
  const weak = () => deriveNull({
    nullSamples: [0.1, 0.2, 0.15, 0.12, 0.18, 0.11],
    observedStatistic: 0.95,
    tailDirection: 'greater',
    quantile: 0.95,
    protocol: { name: 'fixed-strength-check' },
  });
  const result = await growTaskTree({ seed, spec, validate: weak, maxRounds: 6, baseQuantile: 0.95 });
  const underpowered = result.held.filter((h) => h.reason === 'validation-underpowered');
  const loadBearing = result.held.filter((h) => h.task.dependents > 0);
  assert.equal(underpowered.length, loadBearing.length,
    'every held-for-underpowered pencil is exactly one whose parent had dependents');
});

// ── Shaping: the model may reweight, never author ────────────────────

test('applyShaping keeps the pool\'s candidate body and takes only the score', () => {
  const pool = seedPool({ settled: seed, spec, perMode: 4 });
  const shaped = applyShaping(pool.candidates, pool.candidates.map((c) => ({ id: c.id, score: 42 })));
  for (let i = 0; i < shaped.length; i += 1) {
    assert.equal(shaped[i].score, 42);
    assert.deepEqual(shaped[i].vector, pool.candidates[i].vector, 'the vector came from the pool, not the shaper');
    assert.deepEqual(shaped[i].sourceRef, pool.candidates[i].sourceRef);
    assert.equal(shaped[i].shaped_from, pool.candidates[i].score, 'the original score is kept as provenance');
  }
});

test('a shaper that invents a candidate the pool never generated fails loudly', () => {
  const pool = seedPool({ settled: seed, spec, perMode: 4 });
  assert.throws(
    () => applyShaping(pool.candidates, [{ id: 'cand:invented-by-a-model', score: 99 }]),
    /never generated/,
  );
});

test('a shaper cannot promote anything: DEF still abstains on the spectrum it produced', async () => {
  // Maximal abuse: the shaper flattens every score to the same value,
  // which is what "I want all of these" looks like numerically. DEF sees
  // a flat spectrum and abstains, so nothing is even pencilled.
  const flatten = (candidates) => candidates.map((c) => ({ id: c.id, score: 1 }));
  const result = await growTaskTree({ seed, spec, validate: alwaysValidates, shapePool: flatten, maxRounds: 3 });
  assert.equal(result.inks.length, 0, 'a shaper handing every candidate the same score commits nothing');
  for (const r of result.rounds) {
    assert.equal(r.abstained, true);
    assert.equal(r.reason, 'flat-spectrum');
  }
});

test('a shaper cannot bypass validation either: its favourite still needs evidence', async () => {
  const pool0 = seedPool({ settled: seed, spec, salt: 0 });
  const favourite = pool0.candidates[pool0.candidates.length - 1].id;
  const boost = (candidates) => candidates.map((c) => ({ id: c.id, score: c.id === favourite ? 1e6 : c.score }));
  const result = await growTaskTree({ seed, spec, validate: neverValidates, shapePool: boost, maxRounds: 2 });
  assert.equal(result.inks.length, 0);
  assert.ok(result.held.some((h) => h.task.candidate_id === favourite),
    'the boosted candidate reached a pencil and was held there — shaped into the room, not into the record');
});

// ── Coherence and its null ───────────────────────────────────────────

test('the coherence null is the same content in a scrambled discovery order', () => {
  const vectors = seed.map((s) => s.vector);
  const samples = perturbedCoherenceSamples(vectors, [2, 1, 1], { spec, shuffles: 12 });
  assert.equal(samples.length, 12);
  for (const s of samples) assert.ok(Number.isFinite(s));
});

test('the coherence null is deterministic — the threshold is replayable', () => {
  const vectors = seed.map((s) => s.vector);
  const a = perturbedCoherenceSamples(vectors, [2, 1, 1], { spec, shuffles: 8, salt: 5 });
  const b = perturbedCoherenceSamples(vectors, [2, 1, 1], { spec, shuffles: 8, salt: 5 });
  assert.deepEqual(a, b);
});

test('every round carries a measured coherence, never a placeholder', async () => {
  const result = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 4 });
  for (const r of result.rounds) assert.ok(Number.isFinite(r.coherence));
});

// ── Termination ──────────────────────────────────────────────────────

test('the loop stops on the diagnostic, or on maxRounds, and says which', async () => {
  const result = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 3, completionWindow: 2 });
  assert.ok(['diagnostic', 'max-rounds'].includes(result.stoppedBy));
  assert.ok(result.rounds.length <= 3);
  assert.ok(result.diagnostic);
});

test('a run that settles nothing at all reaches a completion verdict rather than spinning forever', async () => {
  const result = await growTaskTree({ seed, spec, validate: neverValidates, maxRounds: 12, completionWindow: 3 });
  // Nothing promoted for many rounds is exactly the situation
  // completionDiagnostic exists to disambiguate; it must land on one of
  // its verdicts, not on a heuristic.
  assert.ok(['continue', 'done', 'lost-in-babel', 'ambiguous'].includes(result.diagnostic.status));
  if (result.stoppedBy === 'diagnostic') {
    assert.ok(['done', 'lost-in-babel'].includes(result.diagnostic.status));
  }
});

// ── Provenance ───────────────────────────────────────────────────────

test('priors cited on the run are pinned onto every pencil and survive into the ink', async () => {
  const priorsCited = [{ prior_id: 'coding-prior:test', content_hash: 'h1', weight: 0.5 }];
  const result = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 3, priorsCited });
  assert.ok(result.inks.length > 0);
  for (const ink of result.inks) assert.deepEqual(ink.priors_cited, priorsCited);
});

test('every edge points from an ink to a parent it actually cites', async () => {
  const result = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 4 });
  const known = new Set([...seed.map((s) => s.id), ...result.inks.map((i) => i.id)]);
  for (const e of result.edges) {
    assert.ok(known.has(e.from));
    assert.ok(known.has(e.to));
    assert.equal(e.internal, true, 'same edge shape calculus.js produces');
  }
});

test('a run is deterministic given the same seed and the same validator', async () => {
  const a = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 4 });
  const b = await growTaskTree({ seed, spec, validate: alwaysValidates, maxRounds: 4 });
  assert.deepEqual(a.inks.map((i) => i.id), b.inks.map((i) => i.id));
  assert.deepEqual(a.rounds.map((r) => r.coherence), b.rounds.map((r) => r.coherence));
});
