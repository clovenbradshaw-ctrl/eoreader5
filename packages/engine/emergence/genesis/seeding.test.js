import test from 'node:test';
import assert from 'node:assert/strict';

import { defineFieldSpec } from '../../perceiver/field-spec.js';
import { SOURCE_KINDS } from './index.js';
import {
  SEED_MODES,
  centroid,
  discoveryCandidates,
  mutationCandidates,
  scoreCandidate,
  seedPool,
  spliceCandidates,
  spread,
} from './seeding.js';

const spec = defineFieldSpec({
  id: 'test:two-channel',
  channels: [
    { name: 'form', dims: 2, metric: 'angular' },
    { name: 'function', dims: 2, metric: 'angular' },
  ],
});

const settledFixture = [
  { id: 'seed:a', vector: [1, 0, 1, 0] },
  { id: 'seed:b', vector: [0, 1, 0, 1] },
  { id: 'seed:c', vector: [1, 1, 0, 0] },
];

// ── The vocabulary is the gate's vocabulary, not a parallel one ──────

test('SEED_MODES is exactly genesis SOURCE_KINDS — the generator and the gate share one vocabulary', () => {
  assert.deepEqual([...SEED_MODES], [...SOURCE_KINDS]);
});

// ── centroid / spread ────────────────────────────────────────────────

test('centroid is the per-dimension mean', () => {
  assert.deepEqual(centroid([[0, 0], [2, 4]]), [1, 2]);
});

test('spread refuses a one-point history — there is no variation to measure', () => {
  assert.equal(spread([[1, 2, 3]]), null);
  assert.deepEqual(spread([[0], [2]]), [1]);
});

test('a dimension the history never varied has zero spread', () => {
  const s = spread([[0, 5], [2, 5], [4, 5]]);
  assert.ok(s[0] > 0);
  assert.equal(s[1], 0, 'a channel with no observed variation is not given invented variation');
});

// ── Scoring: two measured channels, multiplied ───────────────────────

test('a candidate sitting on top of a settled node scores zero however well aimed', () => {
  const s = scoreCandidate([1, 0, 1, 0], { settled: settledFixture, aim: [1, 0, 1, 0], spec });
  assert.equal(s.novelty, 0);
  assert.equal(s.score, 0, 'zero novelty is a restatement, not a proposal');
});

test('novelty is distance to the NEAREST settled node, not to the centroid', () => {
  // Sits on seed:c but far from the centroid of all three. Nearest-node
  // novelty catches that; centroid novelty would not.
  const s = scoreCandidate([1, 1, 0, 0], { settled: settledFixture, aim: null, spec });
  // Angular distance goes through acos, so an exact coincidence lands at
  // float epsilon rather than a literal zero — the point is that it is
  // the NEAREST node that sets novelty, not the (far away) centroid.
  assert.ok(s.novelty < 1e-8, `expected ~0 novelty on top of a settled node, got ${s.novelty}`);
});

test('alignment falls as a candidate points away from the aim', () => {
  const near = scoreCandidate([1, 0.1, 1, 0.1], { settled: settledFixture, aim: [1, 0, 1, 0], spec });
  const far = scoreCandidate([0, 1, 0, 1], { settled: settledFixture, aim: [1, 0, 1, 0], spec });
  assert.ok(near.alignment > far.alignment);
});

// ── Discovery ────────────────────────────────────────────────────────

test('discovery steps outside the settled hull, citing the node it stepped from', () => {
  const out = discoveryCandidates({ settled: settledFixture, aim: null, spec });
  assert.equal(out.length, settledFixture.length, 'one candidate per settled node — the enumeration is the spectrum');
  const c = centroid(settledFixture.map((s) => s.vector));
  for (const cand of out) {
    assert.equal(cand.sourceKind, 'discovery');
    assert.equal(cand.sourceRef.mode, 'frontier-extrapolation');
    assert.equal(cand.sourceRef.depends_on.length, 1);
    const anchor = settledFixture.find((s) => s.id === cand.sourceRef.depends_on[0]);
    // Every coordinate moved away from the centroid, or stayed put where
    // the anchor already sat on it — never inward.
    for (let d = 0; d < c.length; d += 1) {
      const anchorGap = Math.abs(anchor.vector[d] - c[d]);
      const candGap = Math.abs(cand.vector[d] - c[d]);
      assert.ok(candGap >= anchorGap - 1e-12, 'frontier extrapolation never steps back inside the hull');
    }
  }
});

// ── Mutation ─────────────────────────────────────────────────────────

test('mutation is single-locus: exactly one coordinate differs from its parent', () => {
  const out = mutationCandidates({ settled: settledFixture, aim: null, spec });
  assert.ok(out.length > 0);
  for (const cand of out) {
    assert.equal(cand.sourceKind, 'mutation');
    const parent = settledFixture.find((s) => s.id === cand.sourceRef.depends_on[0]);
    const differing = cand.vector.filter((x, i) => x !== parent.vector[i]);
    assert.equal(differing.length, 1, 'point mutation, not a rewrite');
    assert.equal(cand.vector[cand.sourceRef.locus] !== parent.vector[cand.sourceRef.locus], true);
  }
});

test('mutation takes its magnitude from the settled spread, never from a constant', () => {
  const sigma = spread(settledFixture.map((s) => s.vector));
  const out = mutationCandidates({ settled: settledFixture, aim: null, spec });
  for (const cand of out) {
    assert.ok(Math.abs(Math.abs(cand.sourceRef.delta) - Math.round(sigma[cand.sourceRef.locus] * 1e4) / 1e4) < 1e-4,
      'every perturbation is exactly one of the history\'s own standard deviations in that dimension');
  }
});

test('a settled set with zero spread everywhere yields no mutations at all', () => {
  const flat = [
    { id: 'a', vector: [1, 1, 1, 1] },
    { id: 'b', vector: [1, 1, 1, 1] },
  ];
  const out = mutationCandidates({ settled: flat, aim: null, spec });
  assert.equal(out.length, 0, 'no variation observed, none invented');
});

// ── Splice ───────────────────────────────────────────────────────────

test('splice grafts exactly one channel from a donor onto an acceptor, citing both', () => {
  const out = spliceCandidates({ settled: settledFixture, aim: null, spec });
  const n = settledFixture.length;
  assert.equal(out.length, n * (n - 1) * spec.channels.length, 'every ordered pair, every channel');
  for (const cand of out) {
    assert.equal(cand.sourceKind, 'splice');
    assert.equal(cand.sourceRef.depends_on.length, 2, 'two-parent citation, like induceExtensions');
    const [acceptorId, donorId] = cand.sourceRef.depends_on;
    assert.notEqual(acceptorId, donorId);
    const acceptor = settledFixture.find((s) => s.id === acceptorId);
    const donor = settledFixture.find((s) => s.id === donorId);
    const ch = spec.channels.find((c) => c.name === cand.sourceRef.channel);
    for (let d = 0; d < spec.dims; d += 1) {
      const inGraft = d >= ch.offset && d < ch.offset + ch.dims;
      assert.equal(cand.vector[d], inGraft ? donor.vector[d] : acceptor.vector[d]);
    }
  }
});

test('splice without a field spec is a typed gap, not a random crossover point', () => {
  const out = spliceCandidates({ settled: settledFixture, aim: null, spec: null });
  assert.equal(out.length, 0);
  const pool = seedPool({ settled: settledFixture, spec: null });
  assert.ok(pool.gaps.some((g) => g.kind === 'splice-unavailable'));
  assert.match(pool.gaps.find((g) => g.kind === 'splice-unavailable').detail, /at least two channels/);
});

// ── seedPool ─────────────────────────────────────────────────────────

test('fewer than two settled nodes yields no candidates and a typed gap — the same floor DEF uses', () => {
  const pool = seedPool({ settled: [{ id: 'only', vector: [1, 0, 0, 0] }], spec });
  assert.equal(pool.candidates.length, 0);
  assert.equal(pool.gaps.length, 1);
  assert.equal(pool.gaps[0].kind, 'insufficient-settled');
});

test('seedPool is deterministic: same settled set, same aim, same salt, same pool', () => {
  const a = seedPool({ settled: settledFixture, spec, salt: 3 });
  const b = seedPool({ settled: settledFixture, spec, salt: 3 });
  assert.deepEqual(a.candidates.map((c) => c.id), b.candidates.map((c) => c.id));
});

test('an uncapped pool ignores the salt — it is a pure function of the settled set', () => {
  // Not a stall. With a full enumeration there is nothing left to explore
  // that a different seed would reach, so a round that settled nothing
  // proposes nothing new. That is a true statement about the history.
  const a = seedPool({ settled: settledFixture, spec, salt: 0 });
  const b = seedPool({ settled: settledFixture, spec, salt: 1 });
  assert.deepEqual(a.candidates.map((c) => c.id), b.candidates.map((c) => c.id));
});

test('a perMode cap thins the pool by uniform subsample, and reports what it dropped', () => {
  const full = seedPool({ settled: settledFixture, spec });
  const capped = seedPool({ settled: settledFixture, spec, perMode: 2 });
  assert.ok(capped.candidates.length < full.candidates.length);
  for (const mode of SEED_MODES) {
    assert.ok(capped.generated[mode].retained <= 2);
    assert.equal(capped.generated[mode].enumerated, full.generated[mode].enumerated,
      'the enumerated count is reported even when most of it was dropped — a cap is never silent');
  }
  // Capped pools DO consult the salt: which subsample was kept is the only
  // thing left for a seed to decide.
  const other = seedPool({ settled: settledFixture, spec, perMode: 2, salt: 1 });
  assert.notDeepEqual(capped.candidates.map((c) => c.id), other.candidates.map((c) => c.id));
});

test('seedPool draws from all three generative modes and sorts the spectrum by score', () => {
  const pool = seedPool({ settled: settledFixture, spec });
  const kinds = new Set(pool.candidates.map((c) => c.sourceKind));
  assert.ok(kinds.has('discovery'));
  assert.ok(kinds.has('mutation'));
  assert.ok(kinds.has('splice'));
  for (let i = 1; i < pool.candidates.length; i += 1) {
    assert.ok(pool.candidates[i - 1].score >= pool.candidates[i].score);
  }
});

test('candidates landing on an already-settled position are dropped, not proposed', () => {
  // A splice of two identical-in-that-channel parents reproduces the
  // acceptor exactly; those must never reach the spectrum.
  const pool = seedPool({ settled: settledFixture, spec });
  const settledKeys = new Set(settledFixture.map((s) => JSON.stringify(s.vector)));
  for (const c of pool.candidates) {
    assert.ok(!settledKeys.has(JSON.stringify(c.vector)));
  }
});

test('duplicate positions from different modes collapse to one spectrum entry', () => {
  const pool = seedPool({ settled: settledFixture, spec });
  const keys = pool.candidates.map((c) => JSON.stringify(c.vector));
  assert.equal(new Set(keys).size, keys.length);
});

test('a candidate carries a content-addressed id and no authored description', () => {
  const pool = seedPool({ settled: settledFixture, spec });
  for (const c of pool.candidates) {
    assert.ok(c.id.startsWith('cand:'));
    assert.equal(c.description, null, 'the engine never authors prose; identity is the position');
    assert.ok(Array.isArray(c.vector));
    assert.ok(Object.isFrozen(c));
  }
});

test('seedPool rejects a settled node whose vector does not match the declared spec', () => {
  assert.throws(
    () => seedPool({ settled: [{ id: 'a', vector: [1, 0] }, { id: 'b', vector: [0, 1] }], spec }),
    /does not match the field spec/,
  );
});

test('seedPool requires every settled node to carry a stable id', () => {
  assert.throws(() => seedPool({ settled: [{ vector: [1, 0, 0, 0] }, { id: 'b', vector: [0, 1, 0, 0] }], spec }), /stable id/);
});
