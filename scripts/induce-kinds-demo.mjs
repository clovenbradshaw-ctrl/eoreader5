// Level-2 mathematical kinds: SEG doing real work (spec "EO Emergent
// Mathematics for Predictive Competency" section 11.3). Once operators exist
// (scripts/induce-operators-demo.mjs), the Structure/Differentiate act SEG can
// draw a boundary on a selector's output — `selector(history) > theta` — and
// EVA reports that a predictor's competency differs on each side. A partition
// under which the same form wins in one regime and loses in another is a
// *kind*: phase-relative state becomes predictively relevant.
//
// This demo runs induceKind across six series: one genuine regime-switch
// (positive) and five negative controls chosen to catch a specific honesty
// failure this module was built to refuse — a near-deterministic series has
// almost-zero-variance competency gains, so its permutation null is almost
// zero too, and a microscopic, practically meaningless split can clear it.
// The relative-effect floor (holdout differential / the reference's own
// typical loss scale) is what tells those two apart, not statistical
// significance alone.

import { induceKind } from "@eoreader/engine/emergence/kinds";
import { createSeededRng } from "@eoreader/engine";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const HIST = { op: "hist" };
const SELECTOR = { op: "mean", of: { op: "diff", of: HIST } };
const PREDICTOR = { op: "last", of: HIST };
const OPTS = { selector: SELECTOR, predictor: PREDICTOR, referenceBaselineId: "baseline:moving-mean-3", permutations: 300 };

function trendFlat(seed, blocks = 16, blockLen = 15) {
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
function homogeneousTrend(seed, n = 240) {
  const rng = createSeededRng(seed);
  let base = 100;
  return Array.from({ length: n }, () => {
    base += 8;
    return base + (rng() - 0.5) * 0.4;
  });
}
function stationaryAr1(seed, rho, n = 240) {
  const rng = createSeededRng(seed);
  let x = 100;
  return Array.from({ length: n }, () => {
    x = 100 + rho * (x - 100) + (rng() - 0.5) * 2;
    return x;
  });
}
function whiteNoise(seed, n = 240) {
  const rng = createSeededRng(seed);
  return Array.from({ length: n }, () => (rng() - 0.5) * 10);
}

export function runKindsDemo() {
  const cases = [
    ["series:trend-flat (genuine regime-switch)", trendFlat("tf-demo")],
    ["series:homog-trend (one steady slope, no regime)", homogeneousTrend("ht-demo")],
    ["series:ar1-0.4 (stationary, no regime)", stationaryAr1("ar-demo", 0.4)],
    ["series:white-noise (no structure at all)", whiteNoise("wn-demo")],
  ];
  return cases.map(([population, series]) => ({ population, kind: induceKind(series, { ...OPTS, population }) }));
}

function present(results) {
  for (const { population, kind } of results) {
    console.log(`\n=== ${population} ===`);
    if (!kind) {
      console.log("  no kind induced — no partition cleared both the permutation null and the effect-size floor");
      continue;
    }
    console.log(`  threshold  : selector > ${kind.threshold.toFixed(3)}`);
    console.log(`  regimes    : above n=${kind.regimes.above.n} mean_gain=${kind.regimes.above.mean_gain.toFixed(3)}  |  below n=${kind.regimes.below.n} mean_gain=${kind.regimes.below.mean_gain.toFixed(3)}`);
    console.log(`  fit diff   : ${kind.differential.toFixed(3)}   holdout diff: ${kind.holdout_differential.toFixed(3)} (invariant 7.6)`);
    console.log(`  null       : p=${kind.partition_null.p_value.toFixed(3)} (${kind.partition_null.null_protocol.name}, ${kind.partition_null.sample_count} permutations)`);
    console.log(`  rel. effect: ${(kind.relative_effect * 100).toFixed(1)}% of the reference's own loss scale`);
    console.log(`  emergence  : SEG carved this boundary; lens = next-value / h=1 / vs ${kind.reference_baseline_id}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = runKindsDemo();
  const b = runKindsDemo();
  present(a);
  const deterministic = canonicalHashSync(a.map((r) => r.kind?.id ?? null)) === canonicalHashSync(b.map((r) => r.kind?.id ?? null));
  console.log(`\ndeterministic replay: ${deterministic}`);
  if (!deterministic) process.exitCode = 1;
}
