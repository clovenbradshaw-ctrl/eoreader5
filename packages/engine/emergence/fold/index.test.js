import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, foldReadingSnapshot, scoreChunk } from "./index.js";

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
  assert.ok(result.schema === "FoldedReading@1");
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
  // Caesar-related units should be selected first
  const texts = result.selected.map((u) => u.text);
  assert.ok(texts.some((t) => t.includes("Caesar")), "should include Caesar-related content");
});

test("fold includes source attribution in summary", () => {
  const units = [
    { text: "Caesar was great", meta: { file: "plutarch/ch1" } },
  ];
  const result = fold({ units, query: "Caesar" }, { tokenBudget: 100 });
  assert.ok(result.summary.includes("[plutarch/ch1]"), "summary should include source");
});

test("scoreChunk returns a number", () => {
  const chunk = { text: "Caesar conquered Gaul" };
  const context = { query: "Caesar" };
  const score = scoreChunk(chunk, context);
  assert.ok(typeof score === "number");
  assert.ok(score > 0, "score should be positive for matching content");
});

test("scoreChunk boosts exact phrase matches", () => {
  const chunk = { text: "Julius Caesar was a Roman general" };
  const context = { query: "Julius Caesar" };
  const score = scoreChunk(chunk, context);
  const chunkNo = { text: "The weather was nice" };
  const scoreNo = scoreChunk(chunkNo, context);
  assert.ok(score > scoreNo, "exact match should score higher");
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
