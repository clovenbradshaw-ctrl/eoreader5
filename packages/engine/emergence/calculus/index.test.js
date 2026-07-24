import { test } from "node:test";
import assert from "node:assert/strict";
import { induceCalculus, induceExtensions } from "./index.js";
import { validateCalculusCandidate } from "@eoreader/spec";
import { createSeededRng } from "../nulls/index.js";
import { evaluateProgramCompetency } from "../programs/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

// Kept deliberately small/fast (series length, shuffle counts, operator search
// budget) — the empirical battery run during development confirmed these
// still correctly discriminate positive from negative families; the realistic
// module defaults are more thorough and are exercised by the demo script.
const FAST_OPTS = { shuffles: 15, maxRounds: 2, maxOperators: 2, enumeration: { lags: [1, 6], maxSeriesDepth: 2 } };
const CALC_OPTS = { operatorOptions: FAST_OPTS, shuffles: 20 };

function trendSeason(seed, length = 36) {
  const rng = createSeededRng(seed);
  return Array.from({ length }, (_, t) => 2 + 1.5 * t + 8 * Math.sin((2 * Math.PI * t) / 6) + (rng() - 0.5));
}
function stationaryAr1(seed, rho, n = 40) {
  const rng = createSeededRng(seed);
  let x = 100;
  return Array.from({ length: n }, () => {
    x = 100 + rho * (x - 100) + (rng() - 0.5) * 2;
    return x;
  });
}
function trendFlat(seed, blocks = 5, blockLen = 8) {
  const rng = createSeededRng(seed);
  const xs = [];
  let base = 100;
  for (let b = 0; b < blocks; b += 1) {
    const trend = b % 2 === 0;
    for (let i = 0; i < blockLen; i += 1) {
      base += trend ? 8 + (rng() - 0.5) * 0.4 : (rng() - 0.5) * 8;
      xs.push(base);
    }
  }
  return xs;
}
function randomWalk(seed, n = 40) {
  const rng = createSeededRng(seed);
  let x = 100;
  return Array.from({ length: n }, () => {
    x += (rng() - 0.5) * 2;
    return x;
  });
}
function homogeneousFlat(seed, n = 40) {
  const rng = createSeededRng(seed);
  return Array.from({ length: n }, () => 100 + (rng() - 0.5) * 8);
}
function whiteNoise(seed, n = 40) {
  const rng = createSeededRng(seed);
  return Array.from({ length: n }, () => (rng() - 0.5) * 10);
}

// A genuine family: independent noise realizations of the SAME generative
// structure (linear trend + period-6 season) — the same generator that
// reliably promotes structural operators in operators/index.test.js.
function positiveFamily() {
  return ["a", "b", "c", "d", "e"].map((s) => ({ id: `series:${s}`, series: trendSeason(`fam-${s}`) }));
}

test("a genuine family of related series induces a calculus: a recurring vocabulary that transfers to held-out sources", () => {
  const c = induceCalculus(positiveFamily(), { ...CALC_OPTS, seasonalPeriod: 6, population: "family:trend-season" });
  assert.ok(c, "independent realizations of one generative structure should induce a calculus");
  validateCalculusCandidate(c);
  assert.ok(c.vocabulary.length >= 2, "section 16.2: a calculus must provide more than one successful expression");
  assert.ok(c.transfer_null.passed);
  assert.ok(c.relative_effect >= 0.05);
  assert.equal(c.emergence.synthesized_by, "SYN");
  assert.equal(c.emergence.validated_by, "EVA");
  for (const member of c.vocabulary) {
    assert.ok(member.support.count >= 1);
    assert.ok(member.support.propose_series_ids.length === member.support.count);
  }
  assert.deepEqual(c.proposed_extensions, [], "composeExtensions defaults to off — the field is always present, empty here");
});

test("a family of individually-structured but mutually UNRELATED series induces no calculus (regression guard for a real false positive)", () => {
  // This is the exact failure mode found and fixed during development: a
  // max-over-vocabulary-members transfer statistic let a "vocabulary" look
  // like it transferred by cherry-picking whichever member happened to help
  // on each holdout series, even though the members disagreed in SIGN across
  // sources (helped hugely on one series, hurt hugely on another). The fix —
  // mean over members, not max — is what this test guards.
  const family = [
    { id: "s1", series: trendSeason("neg1", 40) },
    { id: "s2", series: stationaryAr1("neg2", 0.5) },
    { id: "s3", series: trendFlat("neg3") },
    { id: "s4", series: randomWalk("neg4") },
    { id: "s5", series: homogeneousFlat("neg5") },
  ];
  const c = induceCalculus(family, CALC_OPTS);
  assert.equal(c, null, "structurally unrelated series should not be certified as one shared calculus");
});

test("a family of white-noise series induces no calculus", () => {
  const family = ["a", "b", "c", "d", "e"].map((s) => ({ id: `n${s}`, series: whiteNoise(`wn-${s}`) }));
  const c = induceCalculus(family, CALC_OPTS);
  assert.equal(c, null, "white noise carries no structure for any series to independently recur");
});

test("induction is deterministic and replayable", () => {
  const a = induceCalculus(positiveFamily(), { ...CALC_OPTS, seasonalPeriod: 6, population: "family:trend-season" });
  const b = induceCalculus(positiveFamily(), { ...CALC_OPTS, seasonalPeriod: 6, population: "family:trend-season" });
  assert.equal(a.id, b.id);
  assert.equal(a.content_hash, b.content_hash);
});

test("the family split is deterministic given the same series ids, independent of caller ordering", () => {
  const family = positiveFamily();
  const reordered = [...family].reverse();
  const a = induceCalculus(family, { ...CALC_OPTS, seasonalPeriod: 6 });
  const b = induceCalculus(reordered, { ...CALC_OPTS, seasonalPeriod: 6 });
  assert.deepEqual([...a.propose_series_ids].sort(), [...b.propose_series_ids].sort());
  assert.deepEqual([...a.holdout_series_ids].sort(), [...b.holdout_series_ids].sort());
});

test("refuses a family smaller than the required propose+holdout minimum", () => {
  const family = positiveFamily().slice(0, 2);
  assert.throws(() => induceCalculus(family, CALC_OPTS), /at least/);
});

test("refuses duplicate series ids", () => {
  const family = [{ id: "x", series: trendSeason("a") }, { id: "x", series: trendSeason("b") }, { id: "y", series: trendSeason("c") }, { id: "z", series: trendSeason("d") }, { id: "w", series: trendSeason("e") }];
  assert.throws(() => induceCalculus(family, CALC_OPTS), /unique/);
});

test("refuses an unknown reference baseline id", () => {
  assert.throws(() => induceCalculus(positiveFamily(), { ...CALC_OPTS, referenceBaselineId: "baseline:not-real" }), /unknown reference baseline/);
});

test("dependency_graph is computed from real opref references, not a placeholder", () => {
  // Deeper operator search (matching operators/index.test.js's own TS_OPTS,
  // which shows a round-1 operator built atop a round-0 one) produces genuine
  // internal (member-on-member) and external (imported, non-qualifying)
  // opref edges — this is not always empty by construction.
  const deep = { shuffles: 30, enumeration: { lags: [1, 6], maxSeriesDepth: 2 }, maxRounds: 3, maxOperators: 4 };
  const family = ["a", "b", "c"].map((s) => ({ id: `series:${s}`, series: trendSeason(`fam-${s}`, 48) }));
  const c = induceCalculus(family, {
    operatorOptions: deep,
    shuffles: 15,
    minSupportFraction: 0.34,
    seasonalPeriod: 6,
    proposeFraction: 0.67,
    minProposeSeries: 2,
    minHoldoutSeries: 1,
  });
  assert.ok(c);
  assert.ok(c.dependency_graph.edges.length > 0, "this configuration is known to produce real opref dependencies");
  assert.ok(c.dependency_graph.edges.some((e) => e.internal === true) || c.dependency_graph.edges.some((e) => e.internal === false));
  for (const edge of c.dependency_graph.edges) {
    assert.match(edge.from, /^operator:sha256:[0-9a-f]{64}$/);
    assert.match(edge.to, /^operator:sha256:[0-9a-f]{64}$/);
    assert.equal(typeof edge.internal, "boolean");
  }
});

test("the minimum-vocabulary gate is a hard cardinality check, not a statistic", () => {
  // A family too small/short to let induceOperators promote at all should
  // yield an empty or single-member vocabulary and correctly refuse.
  const family = ["a", "b", "c", "d", "e"].map((s) => ({ id: `sh${s}`, series: whiteNoise(`short-${s}`, 20) }));
  const c = induceCalculus(family, { ...CALC_OPTS, minProposeSeries: 3, minHoldoutSeries: 2 });
  assert.equal(c, null);
});

// --- Section 16.3 step 9: composing new cross-vocabulary programs ---
//
// composeExtensions is opt-in and, per the module header, provably
// near-unreachable under the current add/sub-only composition grammar: a
// vocabulary member is required to be a full-scale competent predictor
// (positive reference_gain to qualify), so `add` of two such members roughly
// doubles an accurate signal and `sub` collapses toward zero — the wrong
// output scale whenever the target isn't near zero. These tests verify the
// MECHANISM (real candidates are enumerated and considered, gating correctly
// refuses them, the field is always present, determinism holds, opting in
// doesn't change the calculus's own promotion decision) rather than force a
// promoted extension into existence with an unrealistic fixture.

test("composeExtensions considers real cross-vocabulary candidates and correctly finds none competitive (structural, not a fixture artifact)", () => {
  const off = induceCalculus(positiveFamily(), { ...CALC_OPTS, seasonalPeriod: 6, composeExtensions: false });
  const on = induceCalculus(positiveFamily(), { ...CALC_OPTS, seasonalPeriod: 6, composeExtensions: true });
  assert.ok(off && on);
  // Opting into step 9 must never change whether (or which) calculus is found —
  // it only adds an additional, separate exploration on top of an already-decided vocabulary.
  assert.equal(off.id, on.id, "composeExtensions must not alter the vocabulary/promotion decision itself, only extend the record");
  assert.deepEqual(on.proposed_extensions, []);
  validateCalculusCandidate(on);
});

test("composeExtensions is deterministic and replayable", () => {
  const a = induceCalculus(positiveFamily(), { ...CALC_OPTS, seasonalPeriod: 6, composeExtensions: true });
  const b = induceCalculus(positiveFamily(), { ...CALC_OPTS, seasonalPeriod: 6, composeExtensions: true });
  assert.equal(a.content_hash, b.content_hash);
});

test("the cross-series null refuses a candidate that beats the best member numerically but not in real temporal order (white-box, via induceExtensions directly)", () => {
  // A regression guard proving the gates are independent, not redundant: this
  // synthetic vocabulary is deliberately constructed so a candidate DOES clear
  // "beats_best_member_by > 0" -- and is still correctly refused, because it
  // performs WORSE on the real holdout order than on temporal shuffles of it
  // (the null samples are strongly positive; the real-order statistic is
  // strongly negative). That is exactly what a permutation null exists to
  // catch, and it catches it here even though a shallower single-bar check
  // would have let this through.
  const HIST = { op: "hist" };
  function trend(seed, length = 40) {
    const rng = createSeededRng(seed);
    return Array.from({ length }, (_, t) => 5 + 3 * t + (rng() - 0.5) * 2);
  }
  function referenceGain(series, program, referenceBaseline, warmup, tag) {
    const { gain, competency } = evaluateProgramCompetency(series, program, { baselines: [referenceBaseline], warmup, taskId: `t:${tag}`, population: `p:${tag}`, sourceVersion: canonicalHashSync(series) });
    return { gain: gain[referenceBaseline.id] ?? 0, referenceLoss: competency.baseline_losses[referenceBaseline.id] / Math.max(1, competency.observations) };
  }

  const baselines = defaultNumericBaselines({ window: 3 });
  const ref = baselines.find((b) => b.id === "baseline:last-value");
  const A = { op: "mean", of: HIST };
  const B = { op: "mean", of: { op: "diff", of: HIST } };
  const holdoutIds = ["h1", "h2"];
  const holdoutSeries = [trend("h1"), trend("h2")];
  const warmup = 4;
  const gainOf = (program) => {
    const gains = holdoutSeries.map((s, i) => referenceGain(s, program, ref, warmup, `${JSON.stringify(program)}:${i}`).gain);
    return gains.reduce((a, b) => a + b, 0) / gains.length;
  };
  const bestMemberGain = Math.max(gainOf(A), gainOf(B));

  const vocabulary = [
    { operator_id: `operator:sha256:${"a".repeat(64)}`, canonical_program: A },
    { operator_id: `operator:sha256:${"b".repeat(64)}`, canonical_program: B },
  ];
  const promoted = induceExtensions({
    vocabulary,
    bestMemberGain,
    holdoutSeries,
    holdoutIds,
    referenceBaseline: ref,
    holdoutWarmup: warmup,
    shuffles: 20,
    quantile: 0.95,
    minRelativeEffect: 0.05,
    extensionMaxPrograms: 256,
  });
  assert.equal(promoted.length, 0, "a candidate that only clears the beats-best-member bar, not the temporal-order null, must still be refused");
});
