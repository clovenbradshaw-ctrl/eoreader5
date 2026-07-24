import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePrior,
  priorPredictor,
  blendedPriorPredictor,
  uniformPredictor,
  surpriseReduction,
  sequenceSurpriseReduction,
} from "./index.js";
import { logLoss } from "../scoring/index.js";

test("normalizePrior turns weights into a smoothed pmf that sums to 1", () => {
  const p = normalizePrior({ a: 3, b: 1 });
  assert.ok(Math.abs(p.a + p.b - 1) < 1e-12);
  assert.ok(p.a > p.b);
});

test("normalizePrior floors zero-weight categories so they stay scoreable", () => {
  const p = normalizePrior({ a: 1, b: 0 });
  assert.ok(p.b > 0, "a never-seen category keeps positive mass");
  assert.ok(Number.isFinite(logLoss({ kind: "categorical", probs: p }, "b").loss));
});

test("priorPredictor emits a categorical output the scoring rules accept", () => {
  const pred = priorPredictor({ a: 1, b: 1, c: 2 });
  assert.equal(pred.kind, "categorical");
  const r = logLoss(pred, "c");
  assert.equal(r.proper, true);
  assert.ok(Number.isFinite(r.loss));
});

test("a prior that matches the truth is less surprising than uniform", () => {
  // Observations mostly land on 'a'; a prior weighted toward 'a' should reduce surprise.
  const prior = { a: 8, b: 1, c: 1 };
  const r = surpriseReduction(prior, "a");
  assert.ok(r.reductionBits > 0, "matching prior removes surprise vs cold uniform");
  assert.ok(r.lossUnderPrior < r.lossUnderUniform);
});

test("a prior that mispredicts increases surprise (negative reduction)", () => {
  const prior = { a: 8, b: 1, c: 1 };
  const r = surpriseReduction(prior, "b"); // observed the unlikely category
  assert.ok(r.reductionBits < 0, "a confidently wrong prior costs more than uniform");
});

test("uniformPredictor is the zero-reduction baseline against itself", () => {
  const cats = ["a", "b", "c"];
  const r = surpriseReduction({ a: 1, b: 1, c: 1 }, "a", { categories: cats });
  assert.ok(Math.abs(r.reductionBits) < 1e-9, "a uniform prior reduces no surprise vs uniform");
});

test("blendedPriorPredictor is the prior at cold start, local as history grows", () => {
  const prior = { a: 1, b: 9 };
  // Cold start: no local history -> the blend leans on the prior (b dominant).
  const cold = blendedPriorPredictor({}, prior, { alpha: 4 });
  assert.ok(cold.probs.b > cold.probs.a, "cold-start blend follows the prior");
  // Rich local history contradicting the prior -> local wins.
  const warm = blendedPriorPredictor({ a: 100, b: 1 }, prior, { alpha: 1 });
  assert.ok(warm.probs.a > warm.probs.b, "accumulated local evidence overrides the prior");
});

test("blended cold-start reduces surprise more than the far tail of local history", () => {
  const prior = { a: 9, b: 1 };
  const coldPred = blendedPriorPredictor({}, prior, { alpha: 4 });
  const coldLoss = logLoss(coldPred, "a").loss;
  const uniformLoss = logLoss(uniformPredictor(["a", "b"]), "a").loss;
  assert.ok(coldLoss < uniformLoss, "reading the opening under the prior beats reading it cold");
});

test("sequenceSurpriseReduction sums and means per-observation reductions", () => {
  const prior = { a: 6, b: 3, c: 1 };
  const obs = ["a", "a", "b"];
  const agg = sequenceSurpriseReduction(prior, obs);
  assert.equal(agg.n, 3);
  const manual = obs.reduce((s, o) => s + surpriseReduction(prior, o).reductionBits, 0);
  assert.ok(Math.abs(agg.totalBits - manual) < 1e-12);
  assert.ok(Math.abs(agg.meanBits - manual / 3) < 1e-12);
});

test("reductionBits equals reductionNats / ln2", () => {
  const r = surpriseReduction({ a: 3, b: 1 }, "a");
  assert.ok(Math.abs(r.reductionBits - r.reductionNats / Math.LN2) < 1e-12);
});

test("normalizePrior rejects an empty prior and non-object input", () => {
  assert.throws(() => normalizePrior({}), /at least one category/);
  assert.throws(() => normalizePrior(null), /must be a/);
});
