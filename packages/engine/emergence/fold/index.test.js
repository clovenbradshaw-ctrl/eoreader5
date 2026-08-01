import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fold,
  foldReadingSnapshot,
  scoreChunk,
  declareOccasionGrain,
  computeResidual,
  resolveFoldPhase,
  phaseWeights,
  andCompletion,
  FOLD_PHASES,
} from "./index.js";

// ── Spec 1.2: Atomic occasion grain ──

test("declareOccasionGrain fixes an atomic grain at DEF", () => {
  const grain = declareOccasionGrain("unit");
  assert.equal(grain.schema, "OccasionGrain@1");
  assert.equal(grain.grain, "unit");
  assert.equal(grain.atomic, true);
  assert.equal(grain.indivisible, true);
});

test("declareOccasionGrain resolves all grain types", () => {
  assert.equal(declareOccasionGrain("unit").grain, "unit");
  assert.equal(declareOccasionGrain("chunk").grain, "chunk");
  assert.equal(declareOccasionGrain("fold").grain, "fold");
  assert.equal(declareOccasionGrain("task").grain, "task");
  assert.equal(declareOccasionGrain("branch").grain, "branch");
  assert.equal(declareOccasionGrain("project").grain, "project");
});

test("declareOccasionGrain defaults to unit for unknown grains", () => {
  const grain = declareOccasionGrain("unknown");
  assert.equal(grain.grain, "unit");
});

// ── Spec 1.3: Precision-weighted residual ──

test("computeResidual returns done=true for empty residuals", () => {
  const result = computeResidual([]);
  assert.equal(result.done, true);
});

test("computeResidual detects convergence when residual bottoms out", () => {
  const result = computeResidual([1.0, 0.5, 0.2, 0.05], 1.0, { floor: 0.1 });
  assert.equal(result.done, true);
  assert.equal(result.escalate, false);
});

test("computeResidual detects stall under high precision (escalation)", () => {
  const result = computeResidual([0.5, 0.48, 0.47, 0.46], 0.95, { floor: 0.05 });
  assert.equal(result.done, true, "high precision + stalled should trigger completion");
  assert.equal(result.escalate, true, "stalled under high precision should escalate");
  assert.ok(result.relativeImprovement < 0.05, "improvement should be below floor");
});

// ── Spec 1.4: Phase-aware fold objectives ──

test("resolveFoldPhase assigns exploratory to early folds", () => {
  assert.equal(resolveFoldPhase(0, 4), FOLD_PHASES.EXPLORATORY);
  assert.equal(resolveFoldPhase(1, 4), FOLD_PHASES.EXPLORATORY);
});

test("resolveFoldPhase assigns expository to late folds", () => {
  assert.equal(resolveFoldPhase(2, 4), FOLD_PHASES.EXPOSITORY);
  assert.equal(resolveFoldPhase(3, 4), FOLD_PHASES.EXPOSITORY);
});

test("resolveFoldPhase accepts explicit phase override", () => {
  assert.equal(resolveFoldPhase(0, 4, "expository"), FOLD_PHASES.EXPOSITORY);
  assert.equal(resolveFoldPhase(3, 4, "exploratory"), FOLD_PHASES.EXPLORATORY);
});

test("phaseWeights differ by phase", () => {
  const expWeights = phaseWeights(FOLD_PHASES.EXPLORATORY);
  const expoWeights = phaseWeights(FOLD_PHASES.EXPOSITORY);
  assert.ok(expWeights.surprise > expoWeights.surprise, "exploratory should weight surprise higher");
  assert.ok(expoWeights.relevance > expWeights.relevance, "expository should weight relevance higher");
});

// ── Spec 2.5: AND completion ──

test("andCompletion requires both channels above threshold", () => {
  const both = andCompletion(0.8, 0.3, { groundingThreshold: 0.7, surplusThreshold: 0.1 });
  assert.equal(both.converged, true);
  assert.equal(both.groundingMet, true);
  assert.equal(both.surplusMet, true);
});

test("andCompletion fails when surplus is below threshold", () => {
  const lowSurplus = andCompletion(0.9, 0.01, { groundingThreshold: 0.7, surplusThreshold: 0.1 });
  assert.equal(lowSurplus.converged, false);
  assert.equal(lowSurplus.surplusMet, false);
});

test("andCompletion fails when grounding is below threshold", () => {
  const lowGrounding = andCompletion(0.3, 0.5, { groundingThreshold: 0.7, surplusThreshold: 0.1 });
  assert.equal(lowGrounding.converged, false);
  assert.equal(lowGrounding.groundingMet, false);
});

// ── Legacy fold contract (unchanged) ──

test("fold returns empty result for empty units", () => {
  const result = fold({ units: [], query: "test" });
  assert.equal(result.selected.length, 0);
  assert.equal(result.summary, "");
  assert.equal(result.totalTokens, 0);
});

test("fold selects units within token budget", () => {
  const units = [
    { text: "Caesar was a great general" },
    { text: "Brutus betrayed him" },
    { text: "The Roman Empire fell" },
  ];
  const result = fold({ units, query: "Caesar" }, { tokenBudget: 20, maxUnits: 10 });
  assert.ok(result.selected.length > 0, "should select at least one unit");
  assert.ok(result.totalTokens <= 20, `tokens ${result.totalTokens} should be <= 20`);
});

test("fold respects maxUnits limit", () => {
  const units = Array.from({ length: 20 }, (_, i) => ({ text: `unit ${i} content` }));
  const result = fold({ units, query: "unit" }, { tokenBudget: 1000, maxUnits: 5 });
  assert.ok(result.selected.length <= 5, `selected ${result.selected.length} should be <= 5`);
});

test("fold scores units by query relevance", () => {
  const units = [
    { text: "the weather is nice today" },
    { text: "Caesar conquered Gaul in 50 BC" },
    { text: "Caesar was assassinated by Brutus" },
  ];
  const result = fold({ units, query: "Caesar" }, { tokenBudget: 100, maxUnits: 10 });
  const texts = result.selected.map((u) => u.text);
  assert.ok(texts.some((t) => t.includes("Caesar")), "should include Caesar-related content");
});

test("fold carries phase metadata", () => {
  const units = [{ text: "test content" }];
  const result = fold({ units, query: "test" }, { index: 0, total: 2 });
  assert.ok(result.phase, "should carry phase metadata");
  assert.ok(result.weights, "should carry phase weights");
  assert.ok(result.occasionGrain, "should carry occasion grain declaration");
  assert.ok(result.completion, "should carry completion residual");
});

test("foldReadingSnapshot works with snapshot structure", () => {
  const snapshot = {
    request: { query: "Caesar" },
    passages: [
      { anchors: { exact_text: ["Caesar conquered Gaul"] }, source_id: "src1", score: 5 },
      { anchors: { exact_text: ["The empire fell"] }, source_id: "src2", score: 2 },
    ],
  };
  const result = foldReadingSnapshot(snapshot, { tokenBudget: 50 });
  assert.equal(result.schema, "FoldedReading@1");
  assert.ok(result.selected.length > 0);
});
