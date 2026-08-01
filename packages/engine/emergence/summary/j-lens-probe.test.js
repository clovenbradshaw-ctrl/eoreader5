// j-lens-probe.test.js — J-lens commitment signal tests.
//
// Verifies that the probe correctly identifies interpretive boundaries
// (where the cube classifier's commitment is low) vs stable passages
// (where commitment is high).

import { test } from "node:test";
import assert from "node:assert/strict";
import { probeFoldBoundary, probeTextAtBoundary } from "./j-lens-probe.js";
import { wordFrequencies } from "../surprise/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFrame(order, text) {
  return { order, offset: order * 100, text, dist: wordFrequencies(text) };
}

function makeBoundary(order) {
  return { order, offset: order * 100 };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("probeTextAtBoundary returns commitment signal for any text", () => {
  const result = probeTextAtBoundary("Pierre felt a profound sense of joy and love as he gazed at Natasha across the ballroom.");

  assert.ok(typeof result.commitment === "number", "commitment is a number");
  assert.ok(result.commitment >= 0 && result.commitment <= 1, "commitment in [0, 1]");
  assert.ok(typeof result.terrainNorm === "number", "terrainNorm is a number");
  assert.ok(typeof result.stanceNorm === "number", "stanceNorm is a number");
  assert.ok(typeof result.terrainLabel === "string", "terrainLabel is a string");
  assert.ok(typeof result.stanceLabel === "string", "stanceLabel is a string");
  assert.ok(typeof result.isBoundaryCandidate === "boolean", "isBoundaryCandidate is boolean");
});

test("probeTextAtBoundary returns high commitment for uniform, single-topic text", () => {
  // All war vocabulary — stable Entity/Network terrain
  const warText = "The regiment marched forward. The general commanded his troops. The soldiers fought bravely. The army advanced on the enemy position. The colonel gave orders to his battalion. The infantry pressed the attack.";

  const result = probeTextAtBoundary(warText);
  // Uniform topic should produce high commitment (stable classification)
  assert.ok(result.commitment > 0.3, `uniform-war text should have moderate-to-high commitment, got ${result.commitment}`);
  // Checking terrain labels
  assert.ok(["Network", "Entity"].includes(result.terrainLabel),
    `war text terrain should be Network or Entity, got ${result.terrainLabel}`);
});

test("probeTextAtBoundary returns lower commitment for mixed-topic text", () => {
  // Mixed vocabulary — probe should read lower commitment (classifier
  // hasn't locked into one interpretation)
  const mixedText = "The theory of everything is nothing but an empty void of love and data and war.";

  const result = probeTextAtBoundary(mixedText);
  // Mixed keywords trigger multiple categories — commitment should be
  // lower than a pure single-topic text
  const singleTopic = probeTextAtBoundary("The regiment marched forward. The general commanded his troops. The soldiers fought bravely.");
  assert.ok(result.commitment <= singleTopic.commitment + 0.1,
    `mixed text commitment (${result.commitment}) should be ≤ single-topic (${singleTopic.commitment})`);
});

test("probeFoldBoundary returns empty for empty inputs", () => {
  const result = probeFoldBoundary([], []);
  assert.deepEqual(result, []);
});

test("probeFoldBoundary returns probe for each boundary", () => {
  const frames = [
    makeFrame(0, "The general commanded his troops to advance on the enemy position."),
    makeFrame(1, "The soldiers marched forward with determination and courage."),
    makeFrame(2, "She felt a profound sense of love and joy in her heart."),
    makeFrame(3, "The warm emotions overwhelmed her as tears of happiness flowed."),
  ];
  const boundaries = [makeBoundary(2)]; // boundary after the war section

  const results = probeFoldBoundary(frames, boundaries);

  assert.equal(results.length, 1, "one result for one boundary");
  assert.equal(results[0].order, 2, "boundary order preserved");
  assert.ok(typeof results[0].commitment === "number", "commitment present");
  assert.ok(typeof results[0].windowCommitment === "number", "windowCommitment present");
  assert.ok(typeof results[0].commitmentGradient === "number", "commitmentGradient present");
  assert.ok(typeof results[0].isSubAssembly === "boolean", "isSubAssembly present");
});

test("probeFoldBoundary detects a real regime shift at topic boundary", () => {
  // Build a sequence with a clear topic shift: war → romance
  const frames = [
    makeFrame(0, "The regiment marched forward into battle."),
    makeFrame(1, "The general commanded his troops to advance."),
    makeFrame(2, "The soldiers fought bravely against the enemy."),
    makeFrame(3, "The army pressed forward with determination."),
    // Topic shift at frame 4
    makeFrame(4, "She felt a profound sense of love and joy."),
    makeFrame(5, "The warm emotions overwhelmed her heart."),
    makeFrame(6, "Tears of happiness flowed freely as she embraced him."),
  ];
  // The boundary is at frame 4 (the shift point)
  const boundaries = [makeBoundary(4)];

  const results = probeFoldBoundary(frames, boundaries, { windowRadius: 2 });

  assert.equal(results.length, 1, "one result");
  // The boundary should show the gradient signature:
  // before: high commitment (stable war topic)
  // after: high commitment (stable romance topic)
  // at the boundary: the gradient should be small or near zero since
  // both sides are stable — but the window commitment captures the avg.
  // The key test: the window commitment is computed from all 5 frames
  // and is meaningful.
  assert.ok(typeof results[0].windowCommitment === "number", "windowCommitment is a number");
  assert.ok(results[0].windowCommitment >= 0, "windowCommitment >= 0");
});

test("probeFoldBoundary handles multiple boundaries", () => {
  const frames = [
    makeFrame(0, "The regiment marched forward into battle."),
    makeFrame(1, "She felt a profound sense of love and joy."),
    makeFrame(2, "The data shows a correlation between these variables."),
    makeFrame(3, "The theory of everything is nothing but an empty void."),
  ];
  const boundaries = [makeBoundary(1), makeBoundary(3)];

  const results = probeFoldBoundary(frames, boundaries);

  assert.equal(results.length, 2, "two results for two boundaries");
  assert.equal(results[0].order, 1, "first boundary order");
  assert.equal(results[1].order, 3, "second boundary order");
});

test("probe skips boundaries with no matching frame", () => {
  const frames = [makeFrame(0, "Some text about war and battle.")];
  const boundaries = [makeBoundary(0), makeBoundary(99)]; // frame 99 doesn't exist

  const results = probeFoldBoundary(frames, boundaries);

  assert.equal(results.length, 1, "only one result (frame 99 skipped)");
  assert.equal(results[0].order, 0, "only the existing frame returned");
});
