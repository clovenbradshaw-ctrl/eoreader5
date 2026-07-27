// The cycle layer.
//
// The invariant layer says which states are legal. This layer says how
// the system moves between them. A robust subassembly is an INVARIANT
// CYCLE: a closed loop in which violating one invariant triggers
// another to correct it. Nothing here is a capability; each cycle is a
// constraint that closes on itself.
//
//   Cycle 1  Born-Continuity Couple    the oscillator
//   Cycle 2  Entropy-Phase Couple      the heat engine
//   Cycle 3  Cross-Modal Invariant     Byzantine fault tolerance
//
// A cycle is allowed to pass through states that violate an invariant —
// that is precisely what makes it a cycle rather than a single guarded
// step. What it must do is CLOSE on a valid state, and report the
// trajectory it took to get there.

import {
  amplitudeEntropy,
  checkContinuity,
  checkEntropyMonotone,
  checkFoldContinuity,
  checkPhaseBound,
  checkProbability,
  DEFAULT_TOLERANCE,
} from './index.js';
import { boundedNull } from '../emergence/nulls/extreme-value.js';

const FACES = ['operator', 'terrain', 'stance'];

const norm = (amps) => {
  let s = 0;
  for (const a of Object.values(amps)) s += a * a;
  return Math.sqrt(s);
};

const normalized = (amps) => {
  const n = norm(amps);
  if (!(n > 0)) return null; // zero-norm faces cannot be normalised into existence
  const out = {};
  for (const [k, v] of Object.entries(amps)) out[k] = v / n;
  return out;
};

// ══════════════════════════════════════════════════════════════════
//  Cycle 1: The Born-Continuity Couple — the system's oscillator
// ══════════════════════════════════════════════════════════════════
//
//   measureFold → changes amplitudes → violates Σ|ψ|² = 1
//        ↓
//   normalizeAmplitudes → restores continuity → shifts P
//        ↓
//   P may now be out of [0,1] → violates Born → clamp
//        ↓
//   amplitudes redistributed → continuity checked again
//
// This is the lowest-level cycle; it must complete in every operation.
// Measure pushes the state out of equilibrium, normalize pulls it back,
// measure pushes again. The frequency of this cycle is the system's
// clock rate — so the thing worth measuring is not whether it runs but
// how many turns it takes to settle, and whether it settles at all.
//
// `measure` is injected rather than imported so this cycle can be run
// over any measurement operator, including the physics-layer ones. It
// must have the shape (fold, basis, strength) -> fold.
export function bornContinuityCycle(fold, basis, measure, {
  strength = 0.3,
  // The displacement decays geometrically, so the turns needed to
  // settle go as log(ε)/log(ratio). Measured on quantum/measureFold at
  // strength 0.3 the ratio is ≈0.84, which needs ~77 turns to reach
  // ε = 1e-6 — a limit of 16 would cut the oscillator off mid-decay and
  // report a false non-convergence.
  maxTurns = 128,
  tolerance = DEFAULT_TOLERANCE,
  // The cycle has settled when successive states stop moving. The
  // epsilon is on the amplitude delta, in the amplitudes' own units.
  settleEpsilon = 1e-6,
} = {}) {
  const trace = [];
  let current = fold;
  let turns = 0;
  let converged = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    turns = turn + 1;

    // ── measure: pushes out of equilibrium ──
    const measured = measure(current, basis, strength);

    // ── normalize: pulls continuity back ──
    const restored = {};
    let zeroNorm = false;
    for (const face of FACES) {
      const n = normalized(measured[face] ?? {});
      if (n === null) { zeroNorm = true; restored[face] = measured[face] ?? {}; }
      else restored[face] = n;
    }

    // ── check Born range on the resulting projection ──
    // Continuity is restored, so every |ψ|² is a probability; if any
    // falls outside [0,1] the redistribution was invalid.
    const bornViolations = [];
    for (const face of FACES) {
      for (const [dim, amp] of Object.entries(restored[face])) {
        const p = checkProbability(amp * amp, { label: `${face}.${dim}`, tolerance });
        if (!p.satisfied) bornViolations.push(p);
      }
    }

    // ── check continuity again, closing the loop ──
    const continuity = checkFoldContinuity(restored, { tolerance });

    // How far the state moved this turn — the oscillator's amplitude.
    let delta = 0;
    for (const face of FACES) {
      const before = current[face] ?? {};
      const after = restored[face] ?? {};
      for (const dim of new Set([...Object.keys(before), ...Object.keys(after)])) {
        delta += Math.abs((after[dim] ?? 0) - (before[dim] ?? 0));
      }
    }

    trace.push(Object.freeze({
      turn: turns,
      delta,
      zeroNorm,
      continuity: continuity.satisfied,
      bornViolations: Object.freeze(bornViolations),
      entropy: FACES.reduce((s, f) => s + amplitudeEntropy(restored[f]), 0),
    }));

    current = restored;

    if (zeroNorm) break; // cannot proceed: the state has no direction left
    if (delta < settleEpsilon) { converged = true; break; }
  }

  // The oscillator's decay ratio: how much of the displacement survives
  // each turn. This, not the raw turn count, is the clock rate — the
  // turn count is just log(settleEpsilon)/log(decayRatio).
  const deltas = trace.map((t) => t.delta).filter((d) => d > 0);
  const decayRatio = deltas.length >= 2 ? deltas[deltas.length - 1] / deltas[deltas.length - 2] : null;

  const finalContinuity = checkFoldContinuity(current, { tolerance });
  return Object.freeze({
    fold: current,
    turns,
    converged,
    decayRatio,
    // The clock rate: turns needed to settle. A cycle that never
    // settles is a system with no stable clock.
    settled: converged && finalContinuity.satisfied,
    continuity: finalContinuity,
    trace: Object.freeze(trace),
  });
}

// ══════════════════════════════════════════════════════════════════
//  Cycle 2: The Entropy-Phase Couple — the system's heat engine
// ══════════════════════════════════════════════════════════════════
//
//   interfere  → boosts correlated folds → reduces entropy (order appears)
//        ↓
//   measure    → injects query influence → entropy change depends on alignment
//        ↓
//   decohere   → increases entropy (toward uniform)
//        ↓
//   consolidate→ prunes low-entropy entries → effective entropy reduction
//        ↓
//   back to interfere with a cleaner store
//
// The engine extracts work (relevance) from the temperature gradient
// between measurement (high T = query injection) and decoherence
// (low T = thermal ground). Efficiency is bounded by Carnot:
//   η = 1 − T_decohere / T_query
//
// Temperature here is the entropy of the state at each pole: the query
// injection raises the state's entropy toward the query's own spread,
// decoherence raises it toward uniform. Using entropy as T keeps the
// analogy honest — it is measured from the amplitudes, not assigned.
export function entropyPhaseCycle(store, query, ops, {
  strength = 0.3,
  decohereMs = 60000,
  pruneFraction = 0.25,
  tolerance = DEFAULT_TOLERANCE,
} = {}) {
  const { interfere, measure, decohere } = ops;
  const stages = [];
  const entropyOf = (folds) =>
    folds.length === 0 ? 0 : folds.reduce((s, f) => s + FACES.reduce((t, face) => t + amplitudeEntropy(f[face]), 0), 0) / folds.length;

  const s0 = entropyOf(store);

  // ── interfere: order appears, entropy falls ──
  const intensities = interfere(query, store);
  // The individual (non-interfering) intensities, for the phase bound:
  // each fold's own projection is its I_i, and what interfere() adds
  // beyond that is the cross term.
  const solo = store.map((f) => {
    const p = ops.project ? ops.project(query, f) : null;
    return p ?? 0;
  });
  const crossTerms = intensities.map((total, i) => total - solo[i]);
  const phase = checkPhaseBound(solo, crossTerms, { label: 'interfere', tolerance });

  stages.push(Object.freeze({
    stage: 'interfere',
    entropy: s0,
    phase,
    // Interference is the one stage permitted to reduce entropy: it is
    // where the engine does work. That is not an invariant violation,
    // it is the engine's power stroke — but it must be paid for
    // downstream by decoherence, which the cycle checks below.
    intensities: Object.freeze(intensities),
  }));

  // ── measure: query injection, the hot reservoir ──
  const measured = store.map((f) => measure(f, query, strength));
  const sMeasured = entropyOf(measured);
  stages.push(Object.freeze({
    stage: 'measure',
    entropy: sMeasured,
    check: checkEntropyMonotone(s0, sMeasured, { label: 'measure', tolerance }),
  }));

  // ── decohere: toward uniform, the cold reservoir ──
  const decohered = measured.map((f) => decohere(f, decohereMs));
  const sDecohered = entropyOf(decohered);
  stages.push(Object.freeze({
    stage: 'decohere',
    entropy: sDecohered,
    // This one is a true invariant: decoherence must never reduce entropy.
    check: checkEntropyMonotone(sMeasured, sDecohered, { label: 'decohere', tolerance }),
  }));

  // ── consolidate: prune the least relevant, exporting entropy ──
  // Pruning removes entries rather than reordering amplitudes, so the
  // surviving set's entropy may fall without violating dS/dt ≥ 0 — the
  // entropy left with the pruned entries. The cycle records both so the
  // bookkeeping stays visible instead of being asserted.
  const ranked = decohered
    .map((fold, i) => ({ fold, intensity: intensities[i] ?? 0 }))
    .sort((a, b) => b.intensity - a.intensity);
  const keep = Math.max(1, Math.round(ranked.length * (1 - pruneFraction)));
  const survived = ranked.slice(0, keep).map((r) => r.fold);
  const pruned = ranked.slice(keep).map((r) => r.fold);
  const sSurvived = entropyOf(survived);

  stages.push(Object.freeze({
    stage: 'consolidate',
    entropy: sSurvived,
    kept: survived.length,
    pruned: pruned.length,
    exportedEntropy: entropyOf(pruned),
  }));

  // ── Carnot bound on the cycle's efficiency ──
  // T_query is the entropy the hot reservoir drives the state to,
  // T_decohere the entropy of the cold ground. η = 1 − T_cold/T_hot is
  // only meaningful when the gradient points the right way; when
  // decoherence lands below measurement there is no gradient to
  // extract work from, and the cycle reports that rather than
  // returning a number that looks like an efficiency.
  const tHot = sDecohered;
  const tCold = sMeasured;
  const hasGradient = tHot > tCold && tHot > 0;
  const carnot = hasGradient ? 1 - tCold / tHot : 0;

  // Work extracted: how much order interference produced, relative to
  // the entropy the store started with.
  const work = s0 > 0 ? Math.max(0, (s0 - sSurvived) / s0) : 0;

  const violations = stages
    .filter((s) => s.check && !s.check.satisfied)
    .concat(phase.satisfied ? [] : [{ stage: 'interfere', check: phase }]);

  return Object.freeze({
    store: Object.freeze(survived),
    pruned: Object.freeze(pruned),
    stages: Object.freeze(stages),
    entropy: Object.freeze({ start: s0, measured: sMeasured, decohered: sDecohered, end: sSurvived }),
    carnotBound: carnot,
    workExtracted: work,
    // The engine is running within its bound when the work it claims
    // does not exceed what Carnot allows for the gradient it had.
    withinCarnot: work <= carnot + tolerance || !hasGradient,
    hasGradient,
    violations: Object.freeze(violations),
    satisfied: violations.length === 0,
  });
}

// ══════════════════════════════════════════════════════════════════
//  Cycle 3: The Cross-Modal Invariant — Byzantine fault tolerance
// ══════════════════════════════════════════════════════════════════
//
//   text        audio       video
//   fold        fold        fold
//   project     project     project
//     │           │           │
//     └───────────┼───────────┘
//                 ▼
//          all three ≈ same?
//           ┌─────┴─────┐
//          YES         NO
//           │           │
//        continue   detect corruption
//                   isolate channel
//                   reset to consensus
//
// The Born rule must give the same result regardless of input modality.
// If it does not, one channel is lying — and with three independent
// paths the system can tell which one by majority. Three is the minimum
// for fault tolerance; five gives stronger guarantees.
//
// ── On the agreement threshold ───────────────────────────────────
//
// "≈ same" needs a number, and a hardcoded one would be a hole in a
// system whose whole claim is that its thresholds grow from the data.
// So the tolerance comes from boundedNull over the channels' own
// pairwise deviations: the question "is this channel further from
// consensus than chance would put it?" is the same question DEF and
// extremeValueNull answer everywhere else in the engine.
//
// boundedNull needs at least MIN_SAMPLES deviations to fit a bulk. With
// three channels there are three pairwise deviations — below that floor,
// so the null ABSTAINS. That is the correct and honest answer, not a
// defect to be papered over: with three witnesses you can detect that
// they disagree, but you cannot statistically justify naming the liar.
// The result says so via `isolable`, and a caller that needs isolation
// must add channels rather than lower the bar.
//
// ── The vacuous-agreement trap ───────────────────────────────────
//
// There is a failure mode that unanimity cannot see, and it is the one
// this system is most exposed to. quantum/fold() falls back to a
// UNIFORM face when no classifier evidence is found, and the Born
// projection of two uniform faces is exactly 1.0 — perfect agreement.
// Measured on the current engine, two unrelated texts (a Potemkin crowd
// description and a fugue description) project to 1.0000, because
// neither produced any classifier evidence and both fell back to
// uniform.
//
// So maximum IGNORANCE presents as maximum AGREEMENT, and three
// uninformative channels form a unanimous, fully "fault tolerant"
// consensus about nothing. A constraint network that accepts that has
// no constraint at all — it has three copies of the same silence.
//
// The guard is informativeness: a channel at maximum entropy carries no
// evidence, and agreement among channels that carry no evidence is
// reported as `vacuous`, never as `agreed`. Pass channels as
// { value, entropy, dims } to enable the check; bare numbers skip it
// and the result says so via `informativenessChecked: false`.
export function crossModalConsensus(projections, { alpha = 0.05, tolerance = DEFAULT_TOLERANCE, minInformativeness = 0 } = {}) {
  const raw = Object.entries(projections).map(([name, v]) => {
    if (v !== null && typeof v === 'object') {
      // Normalised informativeness: 1 = fully committed, 0 = uniform
      // (knows nothing). maxEntropy is log2(dims) for a face of `dims`.
      const maxEntropy = Number.isFinite(v.maxEntropy)
        ? v.maxEntropy
        : Number.isFinite(v.dims) && v.dims > 1 ? Math.log2(v.dims) : null;
      const informativeness =
        Number.isFinite(v.entropy) && Number.isFinite(maxEntropy) && maxEntropy > 0
          ? Math.max(0, 1 - v.entropy / maxEntropy)
          : null;
      return { name, value: v.value, entropy: v.entropy ?? null, informativeness };
    }
    return { name, value: v, entropy: null, informativeness: null };
  });
  const channels = raw.filter((c) => Number.isFinite(c.value));
  const dropped = raw.filter((c) => !Number.isFinite(c.value)).map((c) => c.name);

  if (channels.length < 2) {
    return Object.freeze({
      agreed: false,
      consensus: channels[0]?.value ?? null,
      channels: Object.freeze(channels),
      dropped: Object.freeze(dropped),
      isolable: false,
      corrupted: Object.freeze([]),
      reason: 'insufficient-channels',
      faultTolerant: false,
    });
  }

  // Every channel must first satisfy the Born range on its own; a
  // channel reporting P outside [0,1] is corrupt regardless of what
  // the others say, and must not be allowed to drag the consensus.
  const outOfRange = channels.filter((c) => !checkProbability(c.value, { label: c.name, tolerance }).satisfied);
  const inRange = channels.filter((c) => !outOfRange.includes(c));
  const usable = inRange.length >= 2 ? inRange : channels;

  // Consensus is the MEDIAN, not the mean: a single lying channel can
  // drag a mean arbitrarily far, which is exactly the failure mode this
  // cycle exists to survive. The median tolerates a minority of liars.
  const sorted = usable.map((c) => c.value).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const consensus = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const deviations = usable.map((c) => ({ ...c, deviation: Math.abs(c.value - consensus) }));

  // The threshold grows from the deviations themselves. `fallback: null`
  // makes abstention explicit rather than substituting a default.
  const spread = deviations.map((d) => d.deviation);
  const line = boundedNull(spread, { alpha, ceiling: 1, fallback: null });
  const isolable = line !== null && Number.isFinite(line);

  const corrupted = isolable
    ? deviations.filter((d) => d.deviation > line)
    : [];
  const allCorrupt = [...outOfRange.map((c) => ({ ...c, deviation: null, reason: 'out-of-range' })), ...corrupted];

  // Agreement: nobody is out of range and nobody is beyond the line.
  // When the null abstains, agreement falls back to the observed spread
  // being within floating-point slack — a strictly weaker claim, and
  // the result records which of the two was used.
  const maxDeviation = Math.max(...spread);

  // ── The partition trap ──
  //
  // Deviation-from-median alone cannot see an even split. When the
  // channels fall into two equal camps the median lands in the empty
  // gap between them, EVERY deviation is identical, the null fits a
  // zero-spread bulk, and nothing exceeds the threshold — so a network
  // partitioned exactly in half reports unanimous agreement about a
  // value no channel actually holds.
  //
  // No deviation-from-consensus test can catch this, because in a
  // partition every deviation is equal and correct. The tell is a GAP
  // in the sorted values: the camps are separated by a jump far larger
  // than the spacing within either camp. That is the same elbow
  // question extreme-value.js asks of a spectrum, so it is answered the
  // same way — against the gaps' own typical size rather than a fixed
  // number. (DEF itself is too conservative to fire on a handful of
  // channels; it needs MIN_SAMPLES positive gaps to fit a background,
  // and six channels rarely supply them.)
  const values = usable.map((c) => c.value).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < values.length; i++) gaps.push(values[i] - values[i - 1]);
  const sortedGaps = gaps.slice().sort((a, b) => a - b);
  const medianGap = sortedGaps.length
    ? sortedGaps.length % 2
      ? sortedGaps[sortedGaps.length >> 1]
      : (sortedGaps[(sortedGaps.length >> 1) - 1] + sortedGaps[sortedGaps.length >> 1]) / 2
    : 0;
  // GAP = 2.5 is the same elbow multiple extreme-value.js uses; the
  // tolerance floor makes the degenerate all-identical-gaps case (a
  // clean partition, median gap 0) still breakable.
  const breakAt = Math.max(2.5 * medianGap, tolerance);

  let support = 0;
  let run = 1;
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > breakAt) { support = Math.max(support, run); run = 1; }
    else run++;
  }
  support = Math.max(support, run);
  const hasMajority = support * 2 > usable.length;

  const numericAgreement =
    outOfRange.length === 0 &&
    hasMajority &&
    (isolable ? corrupted.length === 0 : maxDeviation <= tolerance);

  // Vacuous agreement: the channels concur, but none of them knows
  // anything. Unanimity among uniform folds is the Born rule reporting
  // 1.0 for two states that share no evidence, and it must never be
  // returned as `agreed`.
  const informative = deviations.filter((d) => Number.isFinite(d.informativeness));
  const informativenessChecked = informative.length === deviations.length && deviations.length > 0;
  const meanInformativeness = informative.length
    ? informative.reduce((s, d) => s + d.informativeness, 0) / informative.length
    : null;
  const vacuous = informativenessChecked && numericAgreement && meanInformativeness <= minInformativeness;
  const agreed = numericAgreement && !vacuous;

  return Object.freeze({
    agreed,
    // True when the numbers concur but carry no evidence to concur about.
    vacuous,
    informativenessChecked,
    meanInformativeness,
    consensus,
    channels: Object.freeze(deviations),
    dropped: Object.freeze(dropped),
    maxDeviation,
    // Whether the disagreement can be attributed to specific channels,
    // or only observed in aggregate.
    isolable,
    threshold: line,
    // Size of the largest mutually-agreeing group, and whether it holds
    // a strict majority. An even partition has no majority cluster.
    support,
    hasMajority,
    corrupted: Object.freeze(allCorrupt),
    // Three independent paths is the minimum that survives one liar —
    // but only if they are independent WITNESSES. Three channels that
    // all fell back to uniform are one silence counted three times, so
    // vacuous agreement is not fault tolerance.
    faultTolerant: usable.length >= 3 && !vacuous,
    // What a caller should reset a corrupted channel to.
    resetTo: consensus,
  });
}

// The cross-modal cycle closed: verify, and where a channel is
// isolable and corrupt, reset it to consensus and re-verify. Returns
// the repaired projections plus the evidence for the repair.
export function crossModalRepair(projections, opts = {}) {
  const before = crossModalConsensus(projections, opts);
  if (before.agreed || !before.isolable || before.corrupted.length === 0) {
    return Object.freeze({ projections: Object.freeze({ ...projections }), before, after: before, repaired: Object.freeze([]) });
  }
  // A majority must remain to define the consensus being reset to; if
  // most channels are corrupt there is no majority to trust and the
  // system must not "repair" itself into agreeing with a minority.
  if (before.corrupted.length * 2 >= before.channels.length) {
    return Object.freeze({
      projections: Object.freeze({ ...projections }),
      before,
      after: before,
      repaired: Object.freeze([]),
      reason: 'no-majority',
    });
  }
  const repaired = { ...projections };
  for (const c of before.corrupted) repaired[c.name] = before.consensus;
  const after = crossModalConsensus(repaired, opts);
  return Object.freeze({
    projections: Object.freeze(repaired),
    before,
    after,
    repaired: Object.freeze(before.corrupted.map((c) => c.name)),
  });
}

// ── The three cycles as one report ───────────────────────────────
//
// The system is robust not because it does many things, but because
// every state must satisfy multiple independent constraints. This runs
// whichever cycles the caller has the inputs for and reports which
// invariants ended up covered by at least one cycle — the redundancy
// count that actually matters.
export function runCycles({ born, entropyPhase, crossModal } = {}) {
  const cycles = {};
  const covered = new Set();

  if (born) {
    cycles.bornContinuity = bornContinuityCycle(born.fold, born.basis, born.measure, born.options);
    covered.add('probability');
    covered.add('continuity');
  }
  if (entropyPhase) {
    cycles.entropyPhase = entropyPhaseCycle(entropyPhase.store, entropyPhase.query, entropyPhase.ops, entropyPhase.options);
    covered.add('thermodynamic');
    covered.add('phase');
  }
  if (crossModal) {
    cycles.crossModal = crossModalConsensus(crossModal.projections, crossModal.options);
    covered.add('probability');
  }

  const satisfied =
    (cycles.bornContinuity?.settled ?? true) &&
    (cycles.entropyPhase?.satisfied ?? true) &&
    (cycles.crossModal?.agreed ?? true);

  return Object.freeze({
    cycles: Object.freeze(cycles),
    covered: Object.freeze([...covered]),
    // How many of the four invariants have at least one live check.
    coverage: covered.size / 4,
    satisfied,
  });
}

export { checkContinuity, checkFoldContinuity, amplitudeEntropy };
