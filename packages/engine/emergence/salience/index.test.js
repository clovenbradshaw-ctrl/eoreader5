import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAgainstBasis, bornSalience, relax, routeDecision } from "./index.js";
import { wordFrequencies } from "../surprise/index.js";

test("scoreAgainstBasis returns 0 for empty inputs", () => {
  assert.equal(scoreAgainstBasis("", { frequencies: new Map(), label: "test" }), 0);
  assert.equal(scoreAgainstBasis("hello", null), 0);
  assert.equal(scoreAgainstBasis(null, { frequencies: new Map(), label: "test" }), 0);
});

test("scoreAgainstBasis returns high score for matching content", () => {
  const basis = {
    frequencies: wordFrequencies("the cat sat on the mat the cat"),
    label: "cat-text",
  };
  const score = scoreAgainstBasis("the cat sat on the mat", basis);
  assert.ok(score > 0.5, `score should be high for matching content, got ${score}`);
});

test("scoreAgainstBasis returns low score for divergent content", () => {
  const basis = {
    frequencies: wordFrequencies("the cat sat on the mat"),
    label: "cat-text",
  };
  const score = scoreAgainstBasis("quantum entanglement physics particles", basis);
  assert.ok(score < 0.1, `score should be low for divergent content, got ${score}`);
});

test("bornSalience returns unknown for empty inputs", () => {
  const result = bornSalience("", []);
  assert.equal(result.route, "unknown");
  assert.equal(result.score, 0);
});

test("bornSalience scores content against bases and returns route", () => {
  const bases = [
    { frequencies: wordFrequencies("Roman Empire military conquest war battle"), label: "military" },
    { frequencies: wordFrequencies("philosophy thinking ideas knowledge wisdom"), label: "philosophy" },
  ];
  const result = bornSalience("Caesar conquered Gaul in battle", bases);
  assert.ok(typeof result.score === "number");
  assert.ok(["proceed", "refine", "drill", "unknown"].includes(result.route));
  assert.equal(result.bestBasis, "military");
});

test("relax settles toward target", () => {
  const settled = relax(1.0, 0.0, 0.5);
  assert.equal(settled, 0.5);
  const noChange = relax(1.0, 1.0, 0.5);
  assert.equal(noChange, 1.0);
  const fullSnap = relax(1.0, 0.0, 1.0);
  assert.equal(fullSnap, 1.0);
  const noMove = relax(1.0, 0.0, 0.0);
  assert.equal(noMove, 0.0);
});

test("relax clamps factor to [0, 1]", () => {
  const over = relax(1.0, 0.0, 2.0);
  assert.equal(over, 1.0);
  const under = relax(1.0, 0.0, -1.0);
  assert.equal(under, 0.0);
});

test("routeDecision returns proceed for high settled score", () => {
  const salienceResult = { score: 0.9, route: "proceed", bestBasis: "military" };
  const decision = routeDecision(salienceResult, 500);
  assert.equal(decision.action, "proceed");
  assert.equal(decision.params.foldBudget, 500);
});

test("routeDecision returns drill for low settled score", () => {
  const salienceResult = { score: 0.1, route: "drill", bestBasis: "military" };
  const decision = routeDecision(salienceResult, 500);
  assert.equal(decision.action, "drill");
  assert.equal(decision.params.field_id, "military");
});
