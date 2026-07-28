import { test } from "node:test";
import assert from "node:assert/strict";
import { regionOverlap, fusionSupplementationGate } from "./index.js";

test("regionOverlap: identical regions fully overlap", () => {
  assert.deepEqual(regionOverlap(["a", "b", "c"], ["a", "b", "c"]), { overlapCount: 3, jaccard: 1 });
});

test("regionOverlap: disjoint regions have zero overlap", () => {
  assert.deepEqual(regionOverlap(["a", "b"], ["c", "d"]), { overlapCount: 0, jaccard: 0 });
});

test("regionOverlap: partial overlap is intersection over union", () => {
  assert.deepEqual(regionOverlap(["a", "b", "c"], ["b", "c", "d"]), { overlapCount: 2, jaccard: 0.5 });
});

test("regionOverlap: two empty regions are defined as fully overlapping", () => {
  assert.deepEqual(regionOverlap([], []), { overlapCount: 0, jaccard: 1 });
});

test("regionOverlap: matches 1 - jaccardDistance on the same fixtures", async () => {
  const { jaccardDistance } = await import("../boundaries/index.js");
  const pairs = [
    [["a", "b", "c"], ["a", "b", "c"]],
    [["a", "b"], ["c", "d"]],
    [["a", "b", "c"], ["b", "c", "d"]],
    [[], []],
  ];
  for (const [a, b] of pairs) {
    assert.equal(regionOverlap(a, b).jaccard, 1 - jaccardDistance(a, b));
  }
});

// docs/mereotopology.md §7 supplementation battery.

test("fusionSupplementationGate: a true composition passes - every member contributes", () => {
  const result = fusionSupplementationGate({
    members: ["a", "b", "c"],
    heldOutScores: [0.32, 0.28, 0.35],
    nullHeldOutScores: [0.01, -0.02, 0.03, 0.0, -0.01, 0.02, 0.04, -0.03, 0.01, 0.0],
    quantile: 0.9,
  });
  assert.equal(result.passed, true);
  assert.equal(result.per_member_contribution.length, 3);
});

test("fusionSupplementationGate: a similarity-only cluster of interchangeable members fails", () => {
  // Removing any member changes nothing about what the group predicts -
  // the members are redundant, not composing a whole (docs/mereotopology.md
  // §2's supplementation principle).
  const result = fusionSupplementationGate({
    members: ["a", "b", "c"],
    heldOutScores: [0.0, 0.0, 0.0],
    nullHeldOutScores: [0.01, -0.02, 0.03, 0.0, -0.01, 0.02, 0.04, -0.03, 0.01, 0.0],
    quantile: 0.9,
  });
  assert.equal(result.passed, false);
});

test("fusionSupplementationGate: a single free-rider reduces but does not necessarily fail the gate", () => {
  // Proportionality, not a hard cliff (doc §7): three genuine contributors
  // plus one member that adds nothing should score lower than the
  // all-genuine case above, but three-out-of-four real contributors can
  // still clear the same null.
  const withFreeRider = fusionSupplementationGate({
    members: ["a", "b", "c", "d"],
    heldOutScores: [0.32, 0.28, 0.35, 0.0],
    nullHeldOutScores: [0.01, -0.02, 0.03, 0.0, -0.01, 0.02, 0.04, -0.03, 0.01, 0.0],
    quantile: 0.9,
  });
  const allGenuine = fusionSupplementationGate({
    members: ["a", "b", "c"],
    heldOutScores: [0.32, 0.28, 0.35],
    nullHeldOutScores: [0.01, -0.02, 0.03, 0.0, -0.01, 0.02, 0.04, -0.03, 0.01, 0.0],
    quantile: 0.9,
  });
  assert.ok(withFreeRider.mean_contribution < allGenuine.mean_contribution, "a free rider should reduce mean contribution");
  assert.equal(withFreeRider.passed, true, "three genuine contributors out of four should still clear the null");
});

test("fusionSupplementationGate requires heldOutScores parallel to members", () => {
  assert.throws(
    () => fusionSupplementationGate({ members: ["a", "b"], heldOutScores: [0.1], nullHeldOutScores: [0] }),
    TypeError
  );
});
