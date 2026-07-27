import { test } from "node:test";
import assert from "node:assert/strict";
import {
  klDivergence,
  wordFrequencies,
  surpriseAt,
  feltSurprise,
  forwardScore,
  noveltyReserve,
  informationContent,
} from "./index.js";

test("wordFrequencies returns a probability distribution", () => {
  const dist = wordFrequencies("the cat sat on the mat");
  assert.ok(dist instanceof Map);
  assert.ok(dist.get("the") > 0);
  assert.ok(dist.get("cat") > 0);
  // Probabilities should sum to 1
  let sum = 0;
  for (const p of dist.values()) sum += p;
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum should be 1, got ${sum}`);
});

test("wordFrequencies handles empty text", () => {
  const dist = wordFrequencies("");
  assert.equal(dist.size, 0);
});

test("klDivergence is 0 for identical distributions", () => {
  const dist = wordFrequencies("the cat sat on the mat");
  const kl = klDivergence(dist, dist);
  assert.ok(Math.abs(kl) < 1e-9, `KL should be ~0 for identical dists, got ${kl}`);
});

test("klDivergence is positive for different distributions", () => {
  const observed = wordFrequencies("dog dog dog");
  const expected = wordFrequencies("cat cat cat");
  const kl = klDivergence(observed, expected);
  assert.ok(kl > 0, `KL should be positive, got ${kl}`);
});

test("surpriseAt returns a non-negative number", () => {
  const bg = new Map([["the", 0.3], ["cat", 0.2], ["sat", 0.2], ["on", 0.15], ["mat", 0.15]]);
  const s = surpriseAt("the cat chased the dog", bg);
  assert.ok(typeof s === "number");
  assert.ok(s >= 0);
});

test("feltSurprise contextualizes surprise by coordinate match", () => {
  const context = { terrain: "Entity", stance: "Tracing", operator: "SIG" };
  const focus = { terrain: "Entity", stance: "Tracing", operator: "SIG" };
  const felt = feltSurprise(5, context, focus);
  // Perfect match: relevance = 1.0, felt = 5 * (0.3 + 0.7*1.0) = 5.0, then min(1, 5/10) = 0.5
  assert.equal(felt, 0.5);

  const unfocused = feltSurprise(5, context, { terrain: "Void", stance: "Clearing", operator: "NUL" });
  assert.ok(unfocused < felt, "unfocused surprise should be less than focused");
});

test("forwardScore returns positive for novel content", () => {
  const history = [{ text: "the cat sat on the mat" }];
  const novel = { text: "quantum entanglement particles" };
  const score = forwardScore(novel, history);
  assert.ok(score > 0, `forward score should be positive for novel content, got ${score}`);
});

test("forwardScore returns low for repeated content", () => {
  const history = [{ text: "the cat sat on the mat the cat sat on the mat" }];
  const repeated = { text: "the cat sat on the mat" };
  const score = forwardScore(repeated, history);
  // Repeated content should have lower score than novel content
  const novel = forwardScore({ text: "quantum entanglement particles" }, history);
  assert.ok(score < novel, `repeated score ${score} should be less than novel score ${novel}`);
});

test("forwardScore handles empty history (self-entropy)", () => {
  const unit = { text: "hello world" };
  const score = forwardScore(unit, []);
  assert.ok(score > 0, "self-entropy should be positive");
});

test("noveltyReserve returns isNew based on threshold", () => {
  const history = [{ text: "the cat sat on the mat" }];
  const novel = { text: "completely different topic about quantum physics" };
  const result = noveltyReserve(novel, history, 0.1);
  assert.ok(typeof result.score === "number");
  assert.ok(typeof result.isNew === "boolean");
  assert.ok(typeof result.reason === "string");
});

test("informationContent returns bits per word", () => {
  const bg = new Map([["the", 0.3], ["cat", 0.2], ["sat", 0.2], ["on", 0.15], ["mat", 0.15]]);
  const ic = informationContent("the cat the cat", bg);
  assert.ok(typeof ic === "number");
  assert.ok(ic > 0);
});
