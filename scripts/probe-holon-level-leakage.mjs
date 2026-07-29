// scripts/probe-holon-level-leakage.mjs — PROBE, not a proof.
//
// Question: does the holon-level Born-null battery
// (emergence/holon-level/series.js) mechanically REJECT a candidate whose
// index-set was derived FROM the series it is being tested against, or does
// it pass it?
//
// Why it matters: the eoAI fold needs a per-holon regime series to measure
// possibility-constraint as predictive competency gain. The tempting series
// (validation.quantile from genesis/inkTask, test-pass counts) are all
// DOWNSTREAM of the completion verdict — the label leaks into the feature.
// If the existing gate screens that mechanically, series selection is a
// measurement, not a judgement call. If it does not, that is a hole in the
// gate that matters well beyond eoAI.
//
// Five constructions, all n=300, all seeded (no ambient randomness):
//   A honest-regime          real contiguous regime, label = GENERATIVE truth
//   B leaked-contiguous      pure noise, label = argmax-mean contiguous window
//   C leaked-scattered       pure noise, label = top-k values by threshold
//   D leaked-trend           near-deterministic rise, label = trailing high run
//   E honest-null            pure noise, label = arbitrary window, not peeked
//
// A should discover `above`. E should discover `peer`. B/C/D are the
// leakage probes: any `above` there is the gate being fooled by a label that
// was read off the very series it claims to predict.
//
// Usage: node scripts/probe-holon-level-leakage.mjs

import { seriesExistenceDependency, seriesPossibilityConstraint } from "../packages/engine/emergence/holon-level/series.js";
import { classifyHolonLevelRelation } from "../packages/engine/emergence/holon-level/index.js";

const N = 300;
const REGIME_LEN = 60;
const PERMUTATIONS = 200;
const QUANTILE = 0.95;

// ── Deterministic RNG (mulberry32) — the engine forbids ambient randomness
// and a probe that can't be re-run to the same numbers isn't evidence.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Box-Muller on top of it, so the noise is actually gaussian.
function gauss(rng) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function noiseSeries(seed, sd = 1) {
  const rng = mulberry32(seed);
  return Array.from({ length: N }, () => gauss(rng) * sd);
}

// ── Constructions ────────────────────────────────────────────────────────

// A: a genuine regime — contiguous level shift AND volatility change.
// The candidate index-set is the GENERATIVE window, known independently of
// the realized values (this is what "the label did not come from the series"
// actually means).
function honestRegime(seed) {
  const rng = mulberry32(seed);
  const start = 120;
  const series = [];
  for (let i = 0; i < N; i++) {
    const inside = i >= start && i < start + REGIME_LEN;
    series.push(inside ? 8 + gauss(rng) * 3 : gauss(rng) * 1);
  }
  const indices = new Set();
  for (let i = start; i < start + REGIME_LEN; i++) indices.add(i);
  return { series, indices };
}

// B: pure noise. Label = the contiguous window of length REGIME_LEN with the
// highest mean — chosen by SCANNING the series. Contiguous, so it is exactly
// the shape the null is built for; the only thing wrong with it is that it
// was read off the data.
function leakedContiguous(seed) {
  const series = noiseSeries(seed);
  let best = 0, bestMean = -Infinity;
  for (let s = 0; s + REGIME_LEN <= N; s++) {
    let sum = 0;
    for (let i = s; i < s + REGIME_LEN; i++) sum += series[i];
    const m = sum / REGIME_LEN;
    if (m > bestMean) { bestMean = m; best = s; }
  }
  const indices = new Set();
  for (let i = best; i < best + REGIME_LEN; i++) indices.add(i);
  return { series, indices, note: `argmax window @${best}, mean=${bestMean.toFixed(3)}` };
}

// C: pure noise. Label = the top REGIME_LEN values by magnitude — SCATTERED.
// The purest form of label leakage: membership is a deterministic function
// of the value at that index.
function leakedScattered(seed) {
  const series = noiseSeries(seed);
  const order = series.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const indices = new Set(order.slice(0, REGIME_LEN).map((o) => o.i));
  return { series, indices, note: `top-${REGIME_LEN} values, scattered` };
}

// D: the validation.quantile / test-pass shape — a near-deterministic rise
// with small noise, label = the trailing run where the value is highest.
// "Inside the regime where the number is high" predicting "the number will
// be high" is the circularity, and it is contiguous, so the null cannot
// dismiss it on shape.
function leakedTrend(seed) {
  const rng = mulberry32(seed);
  const series = Array.from({ length: N }, (_, i) => i / N + gauss(rng) * 0.02);
  const indices = new Set();
  for (let i = N - REGIME_LEN; i < N; i++) indices.add(i);
  return { series, note: "monotone rise, label = trailing high run", indices };
}

// E: negative control — pure noise, arbitrary window fixed in advance.
// If this discovers `above`, the gate is broken outright.
function honestNull(seed) {
  const series = noiseSeries(seed);
  const indices = new Set();
  for (let i = 120; i < 120 + REGIME_LEN; i++) indices.add(i);
  return { series, indices, note: "arbitrary window, never peeked at" };
}

// ── Run ──────────────────────────────────────────────────────────────────

const CASES = [
  { key: "A honest-regime   ", build: honestRegime,    expect: "above", leaked: false },
  { key: "B leaked-contiguous", build: leakedContiguous, expect: "?",   leaked: true  },
  { key: "C leaked-scattered ", build: leakedScattered,  expect: "?",   leaked: true  },
  { key: "D leaked-trend     ", build: leakedTrend,      expect: "?",   leaked: true  },
  { key: "E honest-null      ", build: honestNull,       expect: "peer", leaked: false },
];

console.log("=== Label-leakage probe: holon-level Born-null battery ===");
console.log(`n=${N}  regime=${REGIME_LEN}  permutations=${PERMUTATIONS}  quantile=${QUANTILE}\n`);

const rows = [];
for (const c of CASES) {
  const { series, indices, note } = c.build(20260729);
  const existence = seriesExistenceDependency({
    wholeSeries: series, candidateIndices: indices, permutations: PERMUTATIONS, quantile: QUANTILE,
  });
  const constraint = seriesPossibilityConstraint({
    series, candidateIndices: indices, permutations: PERMUTATIONS, quantile: QUANTILE,
  });
  const rel = classifyHolonLevelRelation({
    existence, constraint, subject_id: "series:whole", candidate_id: c.key.trim(),
  });

  console.log(`${c.key} → ${rel.relation.toUpperCase()}   (expected ${c.expect}${c.leaked ? ", LEAKED LABEL" : ""})`);
  if (note) console.log(`   ${note}`);
  console.log(`   existence : passed=${existence.passed}  observed=${existence.observed_degradation.toFixed(4)}  threshold=${existence.null_result.threshold.toFixed(4)}`);
  console.log(`   constraint: passed=${constraint.passed}  gain=${constraint.observed_narrowing.toFixed(4)}  threshold=${constraint.null_result.threshold.toFixed(4)}`);
  console.log("");

  rows.push({
    case: c.key.trim(), leaked: c.leaked, relation: rel.relation,
    existencePassed: existence.passed, constraintPassed: constraint.passed,
    gain: constraint.observed_narrowing, gainThreshold: constraint.null_result.threshold,
  });
}

console.log("=".repeat(66));
const leakedAbove = rows.filter((r) => r.leaked && r.relation === "above");
const honestOk = rows.find((r) => r.case.startsWith("A"))?.relation === "above"
              && rows.find((r) => r.case.startsWith("E"))?.relation === "peer";

console.log(`controls behaved (A=above, E=peer): ${honestOk}`);
if (leakedAbove.length === 0) {
  console.log("RESULT: no leaked construction discovered 'above' —");
  console.log("        the battery screens label leakage mechanically.");
} else {
  console.log(`RESULT: ${leakedAbove.length} LEAKED construction(s) discovered 'above':`);
  for (const r of leakedAbove) console.log(`        ${r.case}  gain=${r.gain.toFixed(4)} > threshold=${r.gainThreshold.toFixed(4)}`);
  console.log("        → the battery does NOT screen label leakage. Series");
  console.log("          independence must be established before the gate, not by it.");
}
