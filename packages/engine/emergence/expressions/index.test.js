import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateProgram,
  evalNode,
  isSeriesNode,
  descriptionLength,
  canonicalKey,
  enumeratePrograms,
  predictWith,
} from "./index.js";

const HIST = { op: "hist" };

test("reducible seed operators evaluate correctly (Section 29.4)", () => {
  const history = [2, 4, 6, 8];
  assert.equal(evaluateProgram({ op: "last", of: HIST }, history), 8);
  assert.equal(evaluateProgram({ op: "sum", of: HIST }, history), 20);
  assert.equal(evaluateProgram({ op: "mean", of: HIST }, history), 5);
  // finite difference then last: 8-6 = 2
  assert.equal(evaluateProgram({ op: "last", of: { op: "diff", of: HIST } }, history), 2);
});

test("drift = last + mean(diff) composes from primitives", () => {
  const history = [10, 12, 14, 16]; // diffs all 2 -> drift forecast 18
  const drift = { op: "add", a: { op: "last", of: HIST }, b: { op: "mean", of: { op: "diff", of: HIST } } };
  assert.equal(evaluateProgram(drift, history), 18);
});

test("protected division returns the numerator on a zero denominator", () => {
  assert.equal(evalNode({ op: "div", a: { op: "const", value: 7 }, b: { op: "const", value: 0 } }, []), 7);
});

test("a series op cannot sit where a scalar is required, and vice versa", () => {
  assert.equal(isSeriesNode({ op: "diff", of: HIST }), true);
  assert.equal(isSeriesNode({ op: "mean", of: HIST }), false);
  assert.throws(() => evaluateProgram(HIST, [1, 2, 3]), /scalar-valued at the top/);
});

test("description length counts nodes and canonical keys dedup equivalent trees", () => {
  const p = { op: "add", a: { op: "last", of: HIST }, b: { op: "const", value: 1 } };
  assert.equal(descriptionLength(p), 4); // add, last, hist, const
  assert.equal(canonicalKey(p), canonicalKey({ b: { value: 1, op: "const" }, a: { of: { op: "hist" }, op: "last" }, op: "add" }));
});

test("enumeration is bounded, deduplicated, and deterministic", () => {
  const a = enumeratePrograms({ maxPrograms: 40 });
  const b = enumeratePrograms({ maxPrograms: 40 });
  assert.deepEqual(a.map(canonicalKey), b.map(canonicalKey));
  assert.ok(a.length > 0 && a.length <= 40);
  assert.equal(new Set(a.map(canonicalKey)).size, a.length, "no duplicate programs");
  // The simplest programs (e.g. last(hist), mean(hist)) come first by DL.
  assert.ok(descriptionLength(a[0]) <= descriptionLength(a[a.length - 1]));
});

test("predictWith derives its spread from the program's own residuals", () => {
  // A noisy trend: drift should produce a gaussian with a positive sd.
  const history = [1, 2.1, 2.9, 4.2, 5.0, 6.3, 6.9];
  const drift = { op: "add", a: { op: "last", of: HIST }, b: { op: "mean", of: { op: "diff", of: HIST } } };
  const out = predictWith(drift, history);
  assert.equal(out.kind, "gaussian");
  assert.ok(out.sd > 0);
});
