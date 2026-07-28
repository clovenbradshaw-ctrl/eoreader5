import { test } from "node:test";
import assert from "node:assert/strict";
import { regionOverlap } from "./index.js";

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
