import { test } from "node:test";
import assert from "node:assert/strict";
import { couplingDispersion } from "./dispersion.js";

test("couplingDispersion: uniform weights over degree n have dispersion exactly 1", () => {
  assert.equal(couplingDispersion([4, 4, 4, 4]), 1);
});

test("couplingDispersion: one dominant edge trends toward zero", () => {
  assert.ok(couplingDispersion([1_000_000, 1, 1, 1]) < 0.01);
});

test("couplingDispersion: degree zero and one are undefined as null", () => {
  assert.equal(couplingDispersion([]), null);
  assert.equal(couplingDispersion([10]), null);
  assert.doesNotThrow(() => couplingDispersion([]));
  assert.ok(!Number.isNaN(couplingDispersion([1, 1])));
});
