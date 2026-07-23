import { test } from "node:test";
import assert from "node:assert/strict";
import { score, logLoss, brierScore, crps, pinballLoss, squaredError, absoluteError } from "./index.js";

test("log-loss of a gaussian equals the negative log density", () => {
  const r = logLoss({ kind: "gaussian", mean: 0, sd: 1 }, 0);
  // -log N(0|0,1) = 0.5*log(2*pi)
  assert.ok(Math.abs(r.loss - 0.5 * Math.log(2 * Math.PI)) < 1e-9);
  assert.equal(r.proper, true);
});

test("log-loss rewards the sharper correct forecast (proper scoring)", () => {
  const sharp = logLoss({ kind: "gaussian", mean: 10, sd: 1 }, 10).loss;
  const vague = logLoss({ kind: "gaussian", mean: 10, sd: 5 }, 10).loss;
  assert.ok(sharp < vague, "a confident correct prediction should score lower loss than a vague one");
});

test("log-loss of a categorical is -log p(observed)", () => {
  const r = logLoss({ kind: "categorical", probs: { a: 0.25, b: 0.75 } }, "b");
  assert.ok(Math.abs(r.loss - -Math.log(0.75)) < 1e-12);
});

test("log-loss is undefined (improper) for a bare point prediction", () => {
  const r = logLoss({ kind: "point", value: 3 }, 3);
  assert.equal(r.loss, null);
  assert.equal(r.proper, false);
  assert.match(r.note, /gaussian or categorical/);
});

test("brier score is 0 for a perfect categorical forecast and 2 for a confidently wrong one", () => {
  assert.equal(brierScore({ kind: "categorical", probs: { a: 1, b: 0 } }, "a").loss, 0);
  assert.equal(brierScore({ kind: "categorical", probs: { a: 1, b: 0 } }, "b").loss, 2);
});

test("crps for a gaussian at its mean is sd*(1/sqrt(pi))... and lower when sharper", () => {
  const sharp = crps({ kind: "gaussian", mean: 0, sd: 1 }, 0).loss;
  const vague = crps({ kind: "gaussian", mean: 0, sd: 3 }, 0).loss;
  assert.ok(sharp > 0 && sharp < vague);
});

test("crps for an ensemble is the empirical estimator", () => {
  const r = crps({ kind: "samples", values: [1, 1, 1, 1] }, 1);
  assert.ok(Math.abs(r.loss) < 1e-12, "a degenerate ensemble at the observed value has ~0 CRPS");
});

test("pinball loss penalizes an under-forecast quantile asymmetrically", () => {
  const under = pinballLoss({ kind: "quantiles", levels: [{ tau: 0.9, value: 0 }] }, 10).loss;
  const over = pinballLoss({ kind: "quantiles", levels: [{ tau: 0.9, value: 20 }] }, 10).loss;
  assert.ok(under > over, "a 0.9 quantile below the observation should be penalized more than one above it");
});

test("point losses collapse a distribution to its central value", () => {
  assert.equal(squaredError({ kind: "gaussian", mean: 2, sd: 5 }, 5).loss, 9);
  assert.equal(absoluteError({ kind: "point", value: 2 }, 5).loss, 3);
});

test("score dispatches by rule name and rejects unknown rules", () => {
  assert.equal(score({ kind: "point", value: 1 }, 1, { rule: "squared-error" }).loss, 0);
  assert.throws(() => score({ kind: "point", value: 1 }, 1, { rule: "nope" }), /unknown scoring rule/);
});
