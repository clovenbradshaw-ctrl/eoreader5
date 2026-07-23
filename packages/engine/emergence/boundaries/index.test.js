import { test } from "node:test";
import assert from "node:assert/strict";
import { jaccardDistance, computeBoundaryStabilityGate } from "./index.js";

test("jaccardDistance: identical boundaries have zero displacement", () => {
  assert.equal(jaccardDistance(["a", "b", "c"], ["a", "b", "c"]), 0);
});

test("jaccardDistance: disjoint boundaries have maximal displacement", () => {
  assert.equal(jaccardDistance(["a", "b"], ["c", "d"]), 1);
});

test("jaccardDistance: partial overlap is the symmetric-difference fraction", () => {
  assert.equal(jaccardDistance(["a", "b", "c"], ["b", "c", "d"]), 0.5);
});

test("computeBoundaryStabilityGate passes when real displacement stays well below the random-boundary null", () => {
  const observedDisplacements = [0.05, 0.08, 0.06];
  const nullDisplacements = [0.5, 0.55, 0.6, 0.62, 0.65, 0.7, 0.72, 0.75, 0.8, 0.85];
  const result = computeBoundaryStabilityGate({ observedDisplacements, nullDisplacements, quantile: 0.9 });
  assert.equal(result.passed, true);
  assert.ok(result.boundary_stability > 0.5, "a stable boundary should score well above zero");
});

test("computeBoundaryStabilityGate fails when displacement is indistinguishable from random boundaries", () => {
  const observedDisplacements = [0.68, 0.7, 0.66];
  const nullDisplacements = [0.5, 0.55, 0.6, 0.62, 0.65, 0.7, 0.72, 0.75, 0.8, 0.85];
  const result = computeBoundaryStabilityGate({ observedDisplacements, nullDisplacements, quantile: 0.9 });
  assert.equal(result.passed, false);
});

test("computeBoundaryStabilityGate requires at least one observed displacement", () => {
  assert.throws(() => computeBoundaryStabilityGate({ observedDisplacements: [], nullDisplacements: [0.5] }), TypeError);
});
