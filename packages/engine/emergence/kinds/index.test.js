import { test } from "node:test";
import assert from "node:assert/strict";
import { induceKind } from "./index.js";
import { validateKindCandidate } from "@eoreader/spec";
import { createSeededRng } from "../nulls/index.js";

const HIST = { op: "hist" };
const SELECTOR = { op: "mean", of: { op: "diff", of: HIST } }; // windowed tendency (see induceKind's selectorWindow)
const PREDICTOR = { op: "last", of: HIST }; // persistence
const REFERENCE = "baseline:moving-mean-3"; // lags a slope, so it loses in trend legs and wins in flat legs
const OPTS = { selector: SELECTOR, predictor: PREDICTOR, referenceBaselineId: REFERENCE, permutations: 300 };

// Alternating trend legs (steep, low noise -> persistence wins big over a
// lagging moving average) and flat legs (no slope, larger noise -> the moving
// average smooths noise better than persistence). moving-mean-3 only needs
// recent history, so the series is free to drift without corrupting the
// reference (unlike baseline:global-mean, which a genuine trend would corrupt).
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
function homogeneousFlat(seed, n = 240) {
  const rng = createSeededRng(seed);
  const base = 100;
  return Array.from({ length: n }, () => base + (rng() - 0.5) * 8);
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

test("a genuine regime-switching series induces a kind: SEG carves it, EVA reports differing competency", () => {
  const k = induceKind(trendFlat("tf-test"), { ...OPTS, population: "series:trend-flat" });
  assert.ok(k, "a regime-conditioned competency difference should be found");
  validateKindCandidate(k);
  assert.equal(k.emergence.carved_by, "SEG");
  assert.ok(k.holdout_differential > 0, "the effect must survive on the held-out tail (invariant 7.6)");
  assert.ok(k.partition_null.passed);
  assert.ok(k.relative_effect >= 0.05, "the effect must clear the relative-effect floor");
  assert.ok(k.regimes.above.n > 0 && k.regimes.below.n > 0, "both regimes must be populated");
  assert.notEqual(k.regimes.above.mean_gain, k.regimes.below.mean_gain);
});

test("a single homogeneous trend induces NO kind, even though the null alone would pass it", () => {
  // Regression guard for the exact failure mode this module was built to
  // refuse: a near-deterministic series has near-zero-variance gains, so its
  // permutation null is near-zero too, and a microscopic differential can
  // clear it. The relative-effect floor (not the null) is what refuses this.
  const k = induceKind(homogeneousTrend("ht-test"), { ...OPTS, population: "series:homog-trend" });
  assert.equal(k, null);
});

test("homogeneous flat noise induces no kind", () => {
  const k = induceKind(homogeneousFlat("hf-test"), { ...OPTS, population: "series:homog-flat" });
  assert.equal(k, null);
});

test("a stationary AR(1) process induces no kind at two different persistence strengths", () => {
  for (const rho of [0.3, 0.6]) {
    const k = induceKind(stationaryAr1(`ar-${rho}-test`, rho), { ...OPTS, population: `series:ar1-${rho}` });
    assert.equal(k, null, `rho=${rho} is stationary and should carry no transferable regime`);
  }
});

test("white noise induces no kind", () => {
  const k = induceKind(whiteNoise("wn-test"), { ...OPTS, population: "series:white-noise" });
  assert.equal(k, null);
});

test("induction is deterministic and replayable", () => {
  const a = induceKind(trendFlat("tf-test"), { ...OPTS, population: "series:trend-flat" });
  const b = induceKind(trendFlat("tf-test"), { ...OPTS, population: "series:trend-flat" });
  assert.equal(a.id, b.id);
  assert.equal(a.content_hash, b.content_hash);
});

test("a promoted operator can be threaded through as the selector, with provenance recorded", () => {
  const operatorProgram = { op: "mean", of: { op: "diff", of: HIST } };
  const k = induceKind(trendFlat("tf-test"), {
    ...OPTS,
    selector: operatorProgram,
    selectorOperatorId: "operator:sha256:" + "a".repeat(64),
    population: "series:trend-flat",
  });
  assert.ok(k);
  assert.equal(k.selector_operator_id, "operator:sha256:" + "a".repeat(64));
  assert.equal(k.emergence.from_selector, "operator:sha256:" + "a".repeat(64));
});

test("refuses a series too short to hold out a fit/holdout split", () => {
  assert.throws(() => induceKind([1, 2, 3, 4, 5]), /too short/);
});

test("refuses an unknown reference baseline id", () => {
  assert.throws(() => induceKind(trendFlat("tf-test"), { referenceBaselineId: "baseline:not-real" }), /unknown reference baseline/);
});
