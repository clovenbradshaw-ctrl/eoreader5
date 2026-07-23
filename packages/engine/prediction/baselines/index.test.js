import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lastValue,
  globalMean,
  movingMean,
  seasonalPersistence,
  randomWalk,
  defaultNumericBaselines,
} from "./index.js";

// Central value of a predictive output, whether it degraded to a point or not.
const central = (d) => (d.kind === "gaussian" ? d.mean : d.value);

test("last-value persistence centers on the most recent observation, with a derived spread", () => {
  const r = lastValue([1, 2, 4, 7]); // diffs [1,2,3] -> positive stdev
  assert.equal(r.kind, "gaussian");
  assert.equal(r.mean, 7);
  assert.ok(r.sd > 0);
});

test("a baseline degrades to a point prediction when spread cannot be derived", () => {
  // A single observation has no differences to derive a spread from.
  const r = lastValue([7]);
  assert.deepEqual(r, { kind: "point", value: 7 });
  // A constant series has zero variance -> honest point prediction, not a fake sd.
  assert.deepEqual(globalMean([5, 5, 5]), { kind: "point", value: 5 });
});

test("global mean averages all history", () => {
  assert.equal(central(globalMean([2, 4, 6])), 4);
});

test("moving mean uses only the trailing window", () => {
  assert.equal(central(movingMean([1, 1, 1, 100, 90, 110], { window: 3 })), 100);
});

test("seasonal persistence predicts one period back and degrades when history is too short", () => {
  assert.equal(central(seasonalPersistence([10, 20, 30, 40], { period: 2 })), 30);
  // history.length <= period -> falls back to last-value
  assert.equal(central(seasonalPersistence([10, 20], { period: 2 })), 20);
});

test("random walk one step coincides with persistence in central value", () => {
  assert.equal(central(randomWalk([3, 6, 9])), 9);
});

test("the default numeric suite is non-empty and adds a seasonal baseline when a period is given", () => {
  const plain = defaultNumericBaselines();
  assert.ok(plain.length >= 4);
  const seasonal = defaultNumericBaselines({ seasonalPeriod: 4 });
  assert.ok(seasonal.some((b) => b.id.startsWith("baseline:seasonal-")));
  for (const b of seasonal) assert.equal(typeof b.predict, "function");
});

test("baselines reject non-finite history", () => {
  assert.throws(() => lastValue([1, NaN, 3]), TypeError);
});
