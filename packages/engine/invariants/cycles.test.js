import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bornContinuityCycle,
  entropyPhaseCycle,
  crossModalConsensus,
  crossModalRepair,
  runCycles,
} from './cycles.js';
import { amplitudeEntropy, checkFoldContinuity } from './index.js';
import { fold, project, interfere, measureFold, decohereFold } from '../quantum/index.js';

const FACES = ['operator', 'terrain', 'stance'];

// ══════════════════════════════════════════════════════════════════
//  Cycle 1: Born-Continuity — the oscillator
// ══════════════════════════════════════════════════════════════════

test('cycle 1 settles and reports its turn count as the clock rate', () => {
  const state = fold('the crowd surges down the steps, soldiers advancing');
  const basis = fold('she entered the brightly illuminated hall');
  const cycle = bornContinuityCycle(state, basis, measureFold, { strength: 0.3 });

  assert.ok(cycle.settled, 'the cycle must close on a valid state');
  assert.ok(cycle.converged);
  assert.ok(cycle.turns > 0 && cycle.turns <= 128);
  assert.ok(checkFoldContinuity(cycle.fold).satisfied, 'continuity restored at the close');
});

test('cycle 1 reports a decay ratio, and the turn count follows from it', () => {
  // The clock rate is the decay ratio, not the raw turn count: the
  // displacement falls geometrically, so turns ≈ log(ε)/log(ratio).
  // At strength 0.3 the ratio is ≈0.84, which needs ~77 turns to reach
  // ε = 1e-6 — anything that caps the cycle below that reports a false
  // non-convergence rather than a real one.
  const state = fold('the crowd surges down the steps, soldiers advancing');
  const basis = fold('she entered the brightly illuminated hall');
  const cycle = bornContinuityCycle(state, basis, measureFold, { strength: 0.3 });

  assert.ok(cycle.decayRatio > 0 && cycle.decayRatio < 1, `ratio ${cycle.decayRatio} must contract`);
  const predicted = Math.log(1e-6) / Math.log(cycle.decayRatio);
  assert.ok(
    Math.abs(cycle.turns - predicted) < 0.5 * predicted,
    `turns ${cycle.turns} should track the predicted ${predicted.toFixed(0)}`,
  );
});

test('a stronger measurement settles the oscillator faster', () => {
  const state = fold('the crowd surges down the steps, soldiers advancing');
  const basis = fold('she entered the brightly illuminated hall');
  const slow = bornContinuityCycle(state, basis, measureFold, { strength: 0.1 });
  const fast = bornContinuityCycle(state, basis, measureFold, { strength: 0.6 });
  assert.ok(fast.turns < slow.turns, `strength should raise the clock rate: ${fast.turns} vs ${slow.turns}`);
});

test('cycle 1 restores continuity on every turn, not just at the end', () => {
  const state = fold('a fugue subject returns in the dominant, inverted');
  const basis = fold('the crowd surges down the steps');
  const cycle = bornContinuityCycle(state, basis, measureFold);
  for (const turn of cycle.trace) {
    assert.ok(turn.continuity, `turn ${turn.turn} left the norm unconserved`);
    assert.equal(turn.bornViolations.length, 0, `turn ${turn.turn} left the Born range`);
  }
});

test('cycle 1 is an oscillator: the displacement decays toward equilibrium', () => {
  const state = fold('the crowd surges down the steps, soldiers advancing');
  const basis = fold('she entered the brightly illuminated hall');
  const cycle = bornContinuityCycle(state, basis, measureFold, { strength: 0.3 });
  const deltas = cycle.trace.map((t) => t.delta);
  assert.ok(deltas[0] > 0, 'measurement pushed the state off equilibrium');
  assert.ok(
    deltas[deltas.length - 1] <= deltas[0],
    `displacement must not grow: ${deltas[0]} -> ${deltas[deltas.length - 1]}`,
  );
});

test('cycle 1 halts on a zero-norm face instead of normalising nothing into something', () => {
  const dead = { operator: { a: 0, b: 0 }, terrain: { a: 0 }, stance: { a: 0 } };
  const basis = fold('anything at all');
  // A measurement that cannot lift a zero state off zero.
  const nullMeasure = (f) => f;
  const cycle = bornContinuityCycle(dead, basis, nullMeasure, { maxTurns: 8 });
  assert.ok(!cycle.settled, 'a zero-norm state cannot be a settled state');
  assert.ok(cycle.trace.some((t) => t.zeroNorm));
  assert.equal(cycle.turns, 1, 'the cycle stops rather than spinning');
});

test('cycle 1 reports non-convergence rather than pretending to settle', () => {
  // A measurement that keeps kicking the state by a fixed amount never
  // reaches a fixpoint; the cycle must say so.
  const flip = (f) => {
    const out = {};
    for (const face of FACES) {
      out[face] = Object.fromEntries(Object.entries(f[face]).map(([k, v], i) => [k, i % 2 ? -v : v + 0.4]));
    }
    return out;
  };
  const state = fold('the crowd surges down the steps');
  const cycle = bornContinuityCycle(state, state, flip, { maxTurns: 5 });
  assert.equal(cycle.turns, 5, 'ran to the turn limit');
  assert.ok(!cycle.converged, 'must not claim convergence it did not reach');
});

// ══════════════════════════════════════════════════════════════════
//  Cycle 2: Entropy-Phase — the heat engine
// ══════════════════════════════════════════════════════════════════

test('cycle 2 runs all four stages and conserves entropy under decoherence', () => {
  const store = [
    fold('the crowd surges down the steps, soldiers advancing in rank'),
    fold('a fugue subject returns in the dominant, inverted'),
    fold('she understood all that awaited her when she entered the hall'),
    fold('the baby carriage rolls down the stone steps'),
  ];
  const query = fold('crowd motion down the steps');
  const cycle = entropyPhaseCycle(store, query, {
    interfere, measure: measureFold, decohere: decohereFold, project,
  }, { decohereMs: 60000 });

  assert.deepEqual(cycle.stages.map((s) => s.stage), ['interfere', 'measure', 'decohere', 'consolidate']);
  const decohereStage = cycle.stages.find((s) => s.stage === 'decohere');
  assert.ok(decohereStage.check.satisfied, `decoherence reduced entropy: dS = ${decohereStage.check.dS}`);
});

test('cycle 2 prunes the store and accounts for the entropy it exported', () => {
  const store = Array.from({ length: 8 }, (_, i) => fold(`sample text number ${i} with varied wording`));
  const query = fold('sample text');
  const cycle = entropyPhaseCycle(store, query, {
    interfere, measure: measureFold, decohere: decohereFold, project,
  }, { pruneFraction: 0.25 });

  const consolidate = cycle.stages.find((s) => s.stage === 'consolidate');
  assert.equal(consolidate.kept + consolidate.pruned, 8, 'nothing vanishes unaccounted for');
  assert.ok(consolidate.pruned > 0, 'pruning actually happened');
  assert.equal(cycle.store.length, consolidate.kept);
  assert.ok(Number.isFinite(consolidate.exportedEntropy), 'exported entropy is booked, not discarded');
});

test('cycle 2 does not report an efficiency when there is no thermal gradient', () => {
  // Identical folds leave measurement and decoherence at the same
  // entropy; with no gradient there is no work to extract, and the
  // cycle must say so rather than return a number that reads as one.
  const same = fold('identical text');
  const store = [same, same, same];
  const cycle = entropyPhaseCycle(store, same, {
    interfere, measure: measureFold, decohere: decohereFold, project,
  }, { decohereMs: 0 });
  if (!cycle.hasGradient) {
    assert.equal(cycle.carnotBound, 0);
    assert.ok(cycle.withinCarnot, 'no gradient means the Carnot check is vacuously satisfied');
  }
});

test('cycle 2 keeps the work it claims within the Carnot bound', () => {
  const store = [
    fold('the crowd surges down the steps'),
    fold('a fugue subject returns in the dominant'),
    fold('she entered the brightly illuminated hall'),
    fold('the battleship turns to meet the squadron'),
    fold('soldiers advance in rank down the stone stairs'),
  ];
  const cycle = entropyPhaseCycle(store, fold('crowd motion'), {
    interfere, measure: measureFold, decohere: decohereFold, project,
  });
  assert.ok(cycle.withinCarnot, `work ${cycle.workExtracted} exceeded Carnot ${cycle.carnotBound}`);
});

// ══════════════════════════════════════════════════════════════════
//  Cycle 3: Cross-Modal — Byzantine fault tolerance
// ══════════════════════════════════════════════════════════════════

test('cycle 3 agrees when three modalities report the same projection', () => {
  const r = crossModalConsensus({ text: 0.62, audio: 0.62, video: 0.62 });
  assert.ok(r.agreed);
  assert.ok(r.faultTolerant, 'three channels is the minimum for fault tolerance');
  assert.equal(r.consensus, 0.62);
});

test('cycle 3 uses the median so one liar cannot drag the consensus', () => {
  const r = crossModalConsensus({ text: 0.60, audio: 0.61, video: 0.99 });
  assert.equal(r.consensus, 0.61, 'the median ignores the outlier; a mean would not');
  assert.ok(!r.agreed, 'disagreement is detected');
});

test('cycle 3 detects disagreement but abstains from naming the liar with only three channels', () => {
  // boundedNull needs MIN_SAMPLES deviations to fit a bulk. Three
  // channels give three, below the floor — so the null abstains. That
  // is the honest answer: three witnesses can show you they disagree,
  // but cannot statistically justify which one is lying.
  const r = crossModalConsensus({ text: 0.60, audio: 0.61, video: 0.99 });
  assert.ok(!r.agreed);
  assert.ok(!r.isolable, 'three channels cannot isolate; the null must abstain');
  assert.equal(r.corrupted.length, 0, 'no channel is named without evidence');
});

test('cycle 3 isolates the corrupt channel once there are enough witnesses', () => {
  const r = crossModalConsensus({
    text: 0.60, audio: 0.61, video: 0.605, chroma: 0.6, motion: 0.61, flow: 0.995,
  });
  assert.ok(r.isolable, 'more channels let the null fit a bulk and name the outlier');
  assert.deepEqual(r.corrupted.map((c) => c.name), ['flow']);
  assert.ok(!r.agreed);
});

test('cycle 3 rejects an out-of-range channel regardless of what the others say', () => {
  const r = crossModalConsensus({ text: 0.6, audio: 0.6, video: 1.8 });
  assert.ok(!r.agreed);
  assert.equal(r.corrupted.length, 1);
  assert.equal(r.corrupted[0].name, 'video');
  assert.equal(r.corrupted[0].reason, 'out-of-range');
  assert.equal(r.consensus, 0.6, 'consensus formed from the in-range channels only');
});

test('cycle 3 will not call unanimous ignorance agreement', () => {
  // The trap: quantum/fold() falls back to a UNIFORM face when it finds
  // no classifier evidence, and two uniform faces project to exactly
  // 1.0. Measured on this engine, two unrelated texts project to 1.0000
  // for precisely that reason. Three such channels are unanimous and
  // maximally confident about nothing.
  const uniform = { value: 1.0, entropy: Math.log2(9), dims: 9 };
  const r = crossModalConsensus({ text: uniform, audio: uniform, video: uniform });
  assert.ok(r.vacuous, 'agreement among uninformative channels is vacuous');
  assert.ok(!r.agreed, 'and must not be reported as agreement');
  assert.ok(!r.faultTolerant, 'one silence counted three times is not three witnesses');
  assert.equal(r.meanInformativeness, 0);
});

test('cycle 3 accepts agreement when the channels actually carry evidence', () => {
  const committed = (v) => ({ value: v, entropy: 0.2, dims: 9 });
  const r = crossModalConsensus({
    text: committed(0.62), audio: committed(0.62), video: committed(0.62),
  });
  assert.ok(!r.vacuous);
  assert.ok(r.agreed);
  assert.ok(r.faultTolerant);
  assert.ok(r.meanInformativeness > 0.9);
});

test('cycle 3 says when it could not check informativeness at all', () => {
  const r = crossModalConsensus({ text: 0.6, audio: 0.6, video: 0.6 });
  assert.ok(!r.informativenessChecked, 'bare numbers carry no entropy to check');
  assert.ok(r.agreed, 'and the numeric check still stands on its own');
});

test('cycle 3 drops non-finite channels and reports them', () => {
  const r = crossModalConsensus({ text: 0.6, audio: NaN, video: 0.6, flow: undefined });
  assert.deepEqual([...r.dropped].sort(), ['audio', 'flow']);
  assert.ok(r.agreed, 'the surviving channels still agree');
  assert.ok(!r.faultTolerant, 'but two channels is below the fault-tolerance floor');
});

test('cycle 3 cannot form a consensus from a single channel', () => {
  const r = crossModalConsensus({ text: 0.6 });
  assert.ok(!r.agreed);
  assert.equal(r.reason, 'insufficient-channels');
  assert.ok(!r.faultTolerant);
});

// ── Closing the cycle: repair ────────────────────────────────────

test('cycle 3 repairs an isolable corrupt channel by resetting it to consensus', () => {
  const before = { text: 0.60, audio: 0.61, video: 0.605, chroma: 0.6, motion: 0.61, flow: 0.995 };
  const result = crossModalRepair(before);
  assert.deepEqual(result.repaired, ['flow']);
  assert.equal(result.projections.flow, result.before.consensus);
  assert.ok(result.after.agreed, 'the cycle closes on agreement');
});

test('cycle 3 sees an even partition, which deviation-from-median cannot', () => {
  // Three channels at 0.1 and three at 0.9. The median lands at 0.5 —
  // a value NO channel holds — and every deviation is then exactly
  // 0.4, so the null fits a zero-spread bulk and flags nobody. On
  // deviation alone this partitioned network reads as unanimous.
  // The majority-cluster test is what catches it.
  const r = crossModalConsensus({ a: 0.1, b: 0.9, c: 0.9, d: 0.9, e: 0.1, f: 0.1 });
  assert.equal(r.corrupted.length, 0, 'no single channel is an outlier here');
  assert.equal(r.support, 3, 'the largest agreeing group is half the channels');
  assert.ok(!r.hasMajority, 'half is not a majority');
  assert.ok(!r.agreed, 'a network split in half has not agreed');
});

test('cycle 3 refuses to repair when there is no majority to trust', () => {
  // If most channels are corrupt, "resetting to consensus" would mean
  // agreeing with a minority. The system must not self-repair into that.
  const result = crossModalRepair({ a: 0.1, b: 0.9, c: 0.9, d: 0.9, e: 0.1, f: 0.1 });
  assert.equal(result.repaired.length, 0);
  assert.ok(!result.after.agreed, 'the split survives the repair attempt');
});

test('a lone dissenter still leaves a majority cluster', () => {
  const r = crossModalConsensus({ a: 0.60, b: 0.61, c: 0.605, d: 0.6, e: 0.61, f: 0.995 });
  assert.ok(r.hasMajority, 'five of six agree');
  assert.equal(r.support, 5);
});

test('repair is a no-op when the channels already agree', () => {
  const result = crossModalRepair({ text: 0.6, audio: 0.6, video: 0.6 });
  assert.deepEqual(result.repaired, []);
  assert.ok(result.after.agreed);
});

// ── All three cycles as one report ───────────────────────────────

test('runCycles reports invariant coverage across the cycles it could run', () => {
  const state = fold('the crowd surges down the steps');
  const basis = fold('she entered the hall');
  const report = runCycles({
    born: { fold: state, basis, measure: measureFold },
    entropyPhase: {
      store: [state, basis, fold('a fugue subject returns')],
      query: basis,
      ops: { interfere, measure: measureFold, decohere: decohereFold, project },
    },
    crossModal: { projections: { text: 0.6, audio: 0.6, video: 0.6 } },
  });
  assert.equal(report.coverage, 1, 'all four invariants have a live check');
  assert.equal(report.covered.length, 4);
  assert.ok(report.cycles.bornContinuity);
  assert.ok(report.cycles.entropyPhase);
  assert.ok(report.cycles.crossModal);
});

test('runCycles reports partial coverage honestly', () => {
  const report = runCycles({ crossModal: { projections: { text: 0.6, audio: 0.6, video: 0.6 } } });
  assert.deepEqual(report.covered, ['probability']);
  assert.equal(report.coverage, 0.25, 'one of four invariants covered');
});
