import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dependentsOf,
  requiredValidationQuantile,
  collapseCandidates,
  pencilTask,
  inkTask,
  completionDiagnostic,
  TASK_LIFECYCLE,
  SOURCE_KINDS,
} from './index.js';
import { deriveNull } from '../nulls/index.js';

// ── dependentsOf: in-degree over calculus.js's edge shape ────────────

test('dependentsOf counts in-degree from a dependency-graph edge list', () => {
  const edges = [
    { from: 'a', to: 'root', internal: true },
    { from: 'b', to: 'root', internal: true },
    { from: 'c', to: 'a', internal: true },
  ];
  assert.equal(dependentsOf(edges, 'root'), 2);
  assert.equal(dependentsOf(edges, 'a'), 1);
  assert.equal(dependentsOf(edges, 'leaf-nobody-cites'), 0);
  assert.equal(dependentsOf([], 'anything'), 0);
  assert.equal(dependentsOf(null, 'anything'), 0);
});

// ── requiredValidationQuantile: Bonferroni-style, matching calculus.js ──

test('a leaf with zero dependents costs nothing extra to explore', () => {
  assert.equal(requiredValidationQuantile(0.95, 0), 0.95);
});

test('required quantile rises monotonically with dependency risk', () => {
  const q1 = requiredValidationQuantile(0.95, 1);
  const q4 = requiredValidationQuantile(0.95, 4);
  const q20 = requiredValidationQuantile(0.95, 20);
  assert.ok(q1 > 0.95);
  assert.ok(q4 > q1);
  assert.ok(q20 > q4);
  assert.ok(q20 < 1, 'never demands certainty, however central the node');
});

test('required quantile matches the exact Bonferroni correction calculus.js uses', () => {
  // Same formula as induceExtensions's correctedQuantile: 1 - (1-q)/N.
  const q = requiredValidationQuantile(0.95, 3);
  assert.ok(Math.abs(q - (1 - (1 - 0.95) / 4)) < 1e-12);
});

// ── collapseCandidates: DEF, unbiased, over a caller-scored spectrum ──

test('fewer than two candidates abstains for insufficient data', () => {
  const r = collapseCandidates([{ id: 'a', score: 1 }]);
  assert.ok(r.abstained);
  assert.equal(r.reason, 'insufficient-candidates');
});

test('a flat candidate spectrum abstains rather than picking a winner', () => {
  const flat = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, score: 5 + i * 1e-6 }));
  const r = collapseCandidates(flat);
  assert.ok(r.abstained);
  assert.equal(r.reason, 'flat-spectrum');
  assert.equal(r.collapsed.length, 0);
});

// A realistic-sized noise floor: DEF's extreme-value correction needs
// enough background gap samples to fit a bulk (see extreme-value.js's
// MIN_SAMPLES) before it will trust a gap as structure rather than
// abstaining out of appropriate caution about a thin background.
function noiseCandidates(n, base = 1.0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `noise-${i}`,
    score: base + (i % 5) * 0.03 - (i % 3) * 0.02,
  }));
}

test('a real gap collapses the candidates above it, sorted by score', () => {
  const candidates = [
    ...noiseCandidates(16),
    { id: 'real-1', score: 9.0 },
    { id: 'real-2', score: 8.7 },
  ];
  const r = collapseCandidates(candidates);
  assert.ok(!r.abstained);
  assert.deepEqual(r.collapsed.map((c) => c.id).sort(), ['real-1', 'real-2']);
  assert.equal(r.collapsed[0].id, 'real-1', 'sorted by score descending');
});

test('a thin noise floor abstains even with a large-looking gap — caution, not a bug', () => {
  // The same shape as the passing test above, but with too few background
  // samples for the extreme-value correction to trust a threshold. This
  // pins the behaviour collapseCandidates inherits from DEF: it is not
  // fooled by a big-looking gap when there isn't enough data to know
  // whether that gap is itself unusual. (Literal values, not the
  // noiseCandidates() generator — at n=4 the abstain/accept boundary is
  // sensitive to the exact noise realization, which is itself honest:
  // with this little data, whether a gap is "unusual" is genuinely
  // underdetermined.)
  const candidates = [
    { id: 'noise-1', score: 1.0 },
    { id: 'noise-2', score: 1.1 },
    { id: 'noise-3', score: 0.9 },
    { id: 'noise-4', score: 1.05 },
    { id: 'real-1', score: 9.0 },
    { id: 'real-2', score: 8.7 },
  ];
  const r = collapseCandidates(candidates);
  assert.ok(r.abstained);
  assert.equal(r.reason, 'flat-spectrum');
});

test('collapseCandidates ignores non-finite scores rather than crashing on them', () => {
  const r = collapseCandidates([{ id: 'a', score: NaN }, { id: 'b', score: 1 }]);
  assert.ok(r.abstained);
  assert.equal(r.reason, 'insufficient-candidates');
});

// ── pencilTask: provisional, provenance-carrying, never silently dropped ──

test('pencilTask requires a stable candidate id', () => {
  assert.throws(() => pencilTask({ score: 1 }), /stable id/);
});

test('pencilTask rejects an unknown source kind', () => {
  assert.throws(() => pencilTask({ id: 'x' }, { sourceKind: 'telepathy' }), /unknown sourceKind/);
  assert.deepEqual(SOURCE_KINDS, ['discovery', 'mutation', 'splice']);
});

test('pencilTask requires prior citations to have a pinned content_hash and weight', () => {
  assert.throws(() => pencilTask({ id: 'x' }, { priorsCited: [{ prior_id: 'p1' }] }), /content_hash/);
  assert.throws(() => pencilTask({ id: 'x' }, { priorsCited: [{ prior_id: 'p1', content_hash: 'h' }] }), /weight/);
  assert.throws(() => pencilTask({ id: 'x' }, { priorsCited: [{ content_hash: 'h', weight: 0.5 }] }), /prior_id/);
  // An empty citation list is legitimate: pure discovery, no prior consulted.
  assert.doesNotThrow(() => pencilTask({ id: 'x' }, { priorsCited: [] }));
});

test('pencilTask records source, priors, and dependency risk as first-class provenance', () => {
  const p = pencilTask(
    { id: 'task-login-form', score: 4.2, description: 'add login form' },
    {
      sourceKind: 'splice',
      sourceRef: { event_id: 'event:abc123' },
      priorsCited: [{ prior_id: 'coding-prior:react-forms', content_hash: 'hash1', weight: 0.7 }],
      dependents: 3,
    },
  );
  assert.equal(p.lifecycle, 'pencil');
  assert.equal(p.source.kind, 'splice');
  assert.equal(p.source.ref.event_id, 'event:abc123');
  assert.equal(p.priors_cited.length, 1);
  assert.equal(p.priors_cited[0].prior_id, 'coding-prior:react-forms');
  assert.equal(p.dependents, 3);
  assert.equal(p.emergence.op, 'EVA');
  assert.equal(p.emergence.status, 'pencil');
  assert.ok(Object.isFrozen(p));
  assert.ok(p.content_hash);
  assert.ok(p.id.startsWith('task:'));
});

test('pencilTask is deterministic: identical input produces the identical id', () => {
  const input = { id: 'task-x', score: 1, description: 'd' };
  const a = pencilTask(input, { dependents: 2, priorsCited: [] });
  const b = pencilTask(input, { dependents: 2, priorsCited: [] });
  assert.equal(a.id, b.id);
  assert.equal(a.content_hash, b.content_hash);
});

test('required_validation_quantile on the pencil matches requiredValidationQuantile', () => {
  const p = pencilTask({ id: 'x' }, { dependents: 5, baseQuantile: 0.9 });
  assert.equal(p.required_validation_quantile, Math.round(requiredValidationQuantile(0.9, 5) * 1e4) / 1e4);
});

// ── inkTask: promote or hold, never discard ───────────────────────────

function passingValidation(quantile = 0.99) {
  return deriveNull({
    nullSamples: [0.1, 0.2, 0.15, 0.12, 0.18],
    observedStatistic: 0.9,
    tailDirection: 'greater',
    quantile,
    protocol: { name: 'test-validation' },
  });
}

function failingValidation() {
  return deriveNull({
    nullSamples: [0.8, 0.9, 0.85, 0.82, 0.88],
    observedStatistic: 0.1,
    tailDirection: 'greater',
    quantile: 0.9,
    protocol: { name: 'test-validation' },
  });
}

test('inkTask requires a pencil-lifecycle input', () => {
  const p = pencilTask({ id: 'x' });
  const inked = inkTask(p, passingValidation(p.required_validation_quantile));
  assert.throws(() => inkTask(inked.task, passingValidation()), /pencil-lifecycle/);
});

test('inkTask requires a NullProtocol-shaped validation', () => {
  const p = pencilTask({ id: 'x' });
  assert.throws(() => inkTask(p, { passed: true }), /NullProtocol/);
  assert.throws(() => inkTask(p, null), /NullProtocol/);
});

test('failed validation holds the pencil, unchanged, not discarded', () => {
  const p = pencilTask({ id: 'x', score: 1 }, { dependents: 0 });
  const result = inkTask(p, failingValidation());
  assert.equal(result.promoted, false);
  assert.equal(result.reason, 'validation-failed');
  assert.equal(result.task, p, 'the exact same frozen object is returned, nothing rebuilt or mutated');
});

test('validation that clears its own bar but is weaker than required is rejected as underpowered', () => {
  // High dependency risk demands a high quantile; passing at a lower
  // quantile than required must not be allowed to slip a load-bearing
  // mutation through on a technicality.
  const p = pencilTask({ id: 'x', score: 1 }, { dependents: 20, baseQuantile: 0.95 });
  const weakValidation = passingValidation(0.8); // clears 0.8, but p demands much more
  const result = inkTask(p, weakValidation);
  assert.equal(result.promoted, false);
  assert.equal(result.reason, 'validation-underpowered');
  assert.equal(result.task, p);
});

test('validation that meets the required bar promotes to ink', () => {
  const p = pencilTask({ id: 'x', score: 1 }, { dependents: 0, baseQuantile: 0.95 });
  const result = inkTask(p, passingValidation(0.95));
  assert.equal(result.promoted, true);
  assert.equal(result.task.lifecycle, 'ink');
  assert.equal(result.task.pencil_id, p.id);
  assert.equal(result.task.emergence.op, 'EVA', 'a first commit with no prior ink behind it is EVA');
  assert.ok(Object.isFrozen(result.task));
  assert.notEqual(result.task.content_hash, p.content_hash);
});

test('inking a revision (a pencil that supersedes a prior ink) uses REC, not EVA', () => {
  const original = pencilTask({ id: 'x', score: 1 }, { dependents: 0, baseQuantile: 0.9 });
  const firstInk = inkTask(original, passingValidation(0.9));
  assert.ok(firstInk.promoted);

  const revision = pencilTask(
    { id: 'x', score: 1.2, description: 'fixed the bug from the first pass' },
    { dependents: 0, baseQuantile: 0.9, supersedes: firstInk.task.id },
  );
  const secondInk = inkTask(revision, passingValidation(0.9));
  assert.ok(secondInk.promoted);
  assert.equal(secondInk.task.emergence.op, 'REC', 'revising a settled fact is generation re-entering, matching hypothesis.supersede');
  assert.equal(secondInk.task.supersedes, firstInk.task.id);
  // The original ink is untouched — provenance preserved, nothing deleted.
  assert.equal(firstInk.task.lifecycle, 'ink');
  assert.ok(Object.isFrozen(firstInk.task));
});

test('priors cited on the pencil carry through to the ink unchanged', () => {
  const priors = [{ prior_id: 'coding-prior:eopriors-v3', content_hash: 'h1', weight: 0.6 }];
  const p = pencilTask({ id: 'x' }, { priorsCited: priors, baseQuantile: 0.9 });
  const inked = inkTask(p, passingValidation(0.9));
  assert.deepEqual(inked.task.priors_cited, priors);
});

// ── completionDiagnostic: DEF-abstention alone is ambiguous ──────────

const round_ = (abstained, promotions = 0, coherence = 0.5) => ({ abstained, promotions, coherence });

test('fewer rounds than the window declines to conclude anything', () => {
  const r = completionDiagnostic([round_(true), round_(true)], { window: 4 });
  assert.equal(r.status, 'continue');
  assert.equal(r.reason, 'insufficient-rounds');
});

test('an active gap anywhere in the window means the project is still moving', () => {
  const rounds = [round_(true), round_(false), round_(true), round_(true)];
  const r = completionDiagnostic(rounds, { window: 4 });
  assert.equal(r.status, 'continue');
  assert.equal(r.reason, 'active-gap');
});

test('DEF flat but REC still promoting is not done and not lost', () => {
  const rounds = [round_(true, 1), round_(true, 0), round_(true, 0), round_(true, 0)];
  const r = completionDiagnostic(rounds, { window: 4 });
  assert.equal(r.status, 'continue');
  assert.equal(r.reason, 'def-flat-but-rec-active');
});

test('DEF flat and REC silent with no coherence null is reported ambiguous, not guessed', () => {
  const rounds = Array.from({ length: 4 }, () => round_(true, 0, 0.9));
  const r = completionDiagnostic(rounds, { window: 4 });
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.reason, 'def-flat-and-rec-silent-but-no-coherence-null-supplied');
});

test('DEF flat, REC silent, and coherence that clears its null reads as done', () => {
  const rounds = Array.from({ length: 4 }, () => round_(true, 0, 0.95));
  // A perturbed-discovery background of low, noisy coherence.
  const coherenceNull = [0.1, 0.2, 0.15, 0.18, 0.12, 0.22];
  const r = completionDiagnostic(rounds, { window: 4, coherenceNull });
  assert.equal(r.status, 'done');
  assert.ok(r.evidence.nullResult.passed);
});

test('DEF flat, REC silent, and coherence indistinguishable from noise reads as lost in Babel', () => {
  const rounds = Array.from({ length: 4 }, () => round_(true, 0, 0.15));
  // A perturbed-discovery background whose coherence is just as high —
  // the recent path is not distinguishable from wandering.
  const coherenceNull = [0.5, 0.6, 0.55, 0.58, 0.52, 0.62];
  const r = completionDiagnostic(rounds, { window: 4, coherenceNull });
  assert.equal(r.status, 'lost-in-babel');
  assert.ok(!r.evidence.nullResult.passed);
  assert.match(r.reason, /widen the search/);
});

test('the task lifecycle vocabulary is closed and exported', () => {
  assert.deepEqual(TASK_LIFECYCLE, ['pencil', 'ink', 'held', 'superseded']);
});

// ── End-to-end: pencil -> collapse -> ink -> revise, provenance intact ──

test('a full pencil-then-ink-then-revise pass preserves every step', () => {
  const candidates = [
    ...noiseCandidates(16),
    { id: 'add-search-bar', score: 8.5 },
  ];
  const collapse = collapseCandidates(candidates);
  assert.ok(!collapse.abstained);
  // DEF's k is floored at 2 even for a single genuine outlier (the same
  // "always at least a two-way split" behaviour used for audio/video
  // holon separation) — the real candidate is always the top of the
  // collapsed set, but it may not be alone in it.
  assert.equal(collapse.collapsed[0].id, 'add-search-bar');

  const pencil = pencilTask(collapse.collapsed[0], {
    sourceKind: 'mutation',
    priorsCited: [{ prior_id: 'coding-prior:search-ui', content_hash: 'h', weight: 0.4 }],
    dependents: 2,
  });
  const firstAttempt = inkTask(pencil, failingValidation());
  assert.equal(firstAttempt.promoted, false);
  assert.equal(firstAttempt.task, pencil, 'the failed pencil is preserved exactly as proposed');

  // "the model goes back in to ink it, fix if needed" — a fresh pencil
  // citing the failed one, then a validation that actually clears the bar.
  const retry = pencilTask(collapse.collapsed[0], {
    sourceKind: 'mutation',
    priorsCited: pencil.priors_cited,
    dependents: 2,
    supersedes: pencil.id,
  });
  const secondAttempt = inkTask(retry, passingValidation(retry.required_validation_quantile));
  assert.equal(secondAttempt.promoted, true);
  assert.equal(secondAttempt.task.supersedes, pencil.id, 'the retry cites the original pencil, not just its own score');
  assert.deepEqual(secondAttempt.task.priors_cited, pencil.priors_cited, 'provenance of the prior survives the retry');

  // Nothing was ever overwritten: both pencils are still intact objects.
  assert.ok(Object.isFrozen(pencil));
  assert.ok(Object.isFrozen(retry));
  assert.notEqual(pencil.id, retry.id);
});
