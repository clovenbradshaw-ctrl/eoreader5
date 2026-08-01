import { test } from "node:test";
import assert from "node:assert/strict";
import { playMode, asPlayFold } from "./index.js";

test("playMode returns a play report when given a reading and lenses", () => {
  const report = playMode(
    { units: [{ text: "The novel explores themes of free will." }] },
    [{ id: "lens-a", label: "Critical", deposit: () => null }],
  );
  assert.equal(report.schema, "PlayReport@1");
  assert.equal(typeof report, "object");
});

test("playMode runs without a pragmatic term (no query)", () => {
  const report = playMode(
    { units: [
      { text: "Chapter one: The beginning." },
      { text: "The story unfolds through several events." },
      { text: "Characters develop over time." },
      { text: "The ending resolves the central conflict." },
      { text: "Themes of love and loss emerge." },
    ] },
    [{ id: "lens-a", label: "Critical", deposit: () => null }],
    { steps: 3 },
  );
  assert.ok(report.steps > 0, "play mode should complete steps");
  assert.equal(report.error, undefined, "should have no error");
});

test("playMode rejects a reading with a query (pragmatic term)", () => {
  const report = playMode(
    { query: "What is the theme?", units: [{ text: "content" }] },
    [],
  );
  assert.ok(report.error, "should error on query");
  assert.ok(report.error.includes("no query"), "error should mention no query");
});

test("asPlayFold wraps a fold function with play mode protection", () => {
  const mockFold = (reading, options) => ({ selected: [], summary: "", totalTokens: 0 });
  const playFn = asPlayFold(mockFold);
  const result = playFn({ units: [{ text: "test" }] }, { play: true });
  assert.equal(result._play, true, "play mode should be tagged");
  assert.equal(result._querySuppressed, true, "query should be suppressed");
});

test("asPlayFold passes through non-play calls unchanged", () => {
  const mockFold = (reading, options) => ({ selected: [], summary: "normal", totalTokens: 10 });
  const playFn = asPlayFold(mockFold);
  const result = playFn({ units: [{ text: "test" }], query: "test" }, {});
  assert.equal(result._play, undefined, "non-play should not be tagged");
  assert.equal(result.summary, "normal");
});
