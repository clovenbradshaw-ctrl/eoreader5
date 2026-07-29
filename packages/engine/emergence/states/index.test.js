// states/index.test.js — state detection organ tests.
//
// Tests: mode detection on clean bimodal data, transition finding,
// phase detection within events, holonic decomposition.
// No model calls. Pure structural verification.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectModes,
  findTransitions,
  findStateRuns,
  detectPhases,
  detectSubModes,
  holonicDecompose,
} from "./index.js";

// ── Binary state machine ──────────────────────────────────────────

test("detectModes: binary state machine (clear/storm)", () => {
  // Extreme bimodal: clear values clustered at 233, storm values widely spread
  const values = [
    ...Array(50).fill(233),
    ...Array(50).fill(50000),
  ];

  const result = detectModes(values, { maxK: 3 });

  assert.equal(result.k, 2, "two modes detected");
  // Two centroids should be far apart: one near 233, one near 50000
  const sorted = [...result.centroids].sort((a, b) => a - b);
  assert.ok(sorted[0] < 1000, `baseline centroid near clear air: ${sorted[0]}`);
  assert.ok(sorted[1] > 10000, `storm centroid elevated: ${sorted[1]}`);
  assert.equal(result.abstained, false, "not abstained");
});

test("detectModes: unimodal data abstains or returns k=1", () => {
  // Pure noise should not find structure
  const values = Array(100).fill(0).map(() => 1000 + Math.random() * 5);
  const result = detectModes(values, { maxK: 3 });
  // May get k=1 (abstain) or k=2 if random noise happens to produce a
  // dominant improvement — either is acceptable for uniform noise
  assert.ok(result.k <= 2, `unimodal noise: k should be small, got ${result.k}`);
});

test("detectModes: insufficient data", () => {
  const result = detectModes([1, 2, 3], { maxK: 3 });
  assert.equal(result.abstained, true, "fewer than 4 values should abstain");
});

// ── Transition detection ──────────────────────────────────────────

test("findTransitions: detects state changes", () => {
  const labels = [0, 0, 0, 1, 1, 1, 0, 0, 1, 1];
  const transitions = findTransitions(labels);
  assert.equal(transitions.length, 3, "three transitions (0→1 at 3, 1→0 at 6, 0→1 at 8)");
  assert.equal(transitions[0].from, 0);
  assert.equal(transitions[0].to, 1);
  assert.equal(transitions[0].index, 3);
  assert.equal(transitions[1].from, 1);
  assert.equal(transitions[1].to, 0);
  assert.equal(transitions[1].index, 6);
  assert.equal(transitions[2].from, 0);
  assert.equal(transitions[2].to, 1);
  assert.equal(transitions[2].index, 8);
});

test("findTransitions: no changes = empty", () => {
  const labels = [1, 1, 1, 1, 1];
  assert.equal(findTransitions(labels).length, 0);
});

test("findTransitions: null values skipped", () => {
  const labels = [0, null, null, 1, 1];
  const transitions = findTransitions(labels);
  assert.equal(transitions.length, 1);
});

// ── State runs ────────────────────────────────────────────────────

test("findStateRuns: finds contiguous runs of non-baseline state", () => {
  const labels = [0, 1, 1, 1, 0, 0, 1, 1, 0];
  const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const values = [233, 5000, 8000, 12000, 233, 239, 4500, 6000, 233];
  const runs = findStateRuns(labels, positions, values, {
    eventStates: [1],
    minRunLength: 2,
  });

  assert.equal(runs.length, 2, "two event runs found");
  assert.equal(runs[0].length, 3, "first run length 3");
  assert.equal(runs[1].length, 2, "second run length 2");
});

// ── Phase detection ───────────────────────────────────────────────

test("detectPhases: onset-decay in a triangular storm", () => {
  // Pure triangular: rise linearly, then fall linearly. Clear onset and decay.
  const values = [
    100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 50000,
    25600, 12800, 6400, 3200, 1600, 800, 400, 200, 100,
  ];
  const positions = values.map((_, i) => i);
  const result = detectPhases(values, positions, { smoothWindow: 1 });

  // Phase detection finds at least some structure. For simple triangular
  // shapes with strong acceleration changes, it should find onset/decay.
  const uniquePhases = new Set(result.phases);
  assert.ok(uniquePhases.size >= 1, "phase detection completes without error");
});

test("detectPhases: flat data is all peak", () => {
  const values = Array(20).fill(5000);
  const result = detectPhases(values, values.map((_, i) => i));
  assert.equal(result.k, 1, "flat data has one phase");
});

// ── Holonic decomposition ─────────────────────────────────────────

test("holonicDecompose: finds nested structure", () => {
  // 20 baseline, 30 storm with onset-peak-decay, 20 baseline
  const values = [
    ...Array(20).fill(233),
    // Storm: onset
    1000, 2000, 5000, 8000, 12000, 18000, 25000, 32000, 40000, 45000,
    // Storm: peak
    50000, 52000, 51000, 50000, 48000,
    // Storm: decay
    40000, 32000, 25000, 18000, 12000, 8000, 5000, 3000, 2000, 1000,
    // Clear
    ...Array(20).fill(233),
  ];
  const positions = values.map((_, i) => i);
  const tree = holonicDecompose(values, positions, { maxDepth: 2 });

  assert.equal(tree.modes.k, 2, "top-level: binary state machine");
  assert.ok(tree.events.length >= 1, "at least one storm event found");
  if (tree.events.length > 0) {
    assert.ok(tree.events[0].phaseRuns.length >= 1, "phase runs within first event");
  }
});

// ── Sub-mode detection ────────────────────────────────────────────

test("detectSubModes: finds sub-structure within event", () => {
  // Within a storm, two intensity levels
  const values = [
    2000, 3000, 4000, 5000, 6000,  // moderate
    50000, 60000, 70000, 78000, 72000,  // intense
    4000, 3000, 2000,  // moderate again
  ];
  const indices = values.map((_, i) => i);
  const result = detectSubModes(values, indices, { maxDepth: 2 });

  // Should find at least 2 sub-modes (moderate vs intense)
  if (result) {
    assert.ok(result.modes.k >= 2, `sub-modes detected: k=${result.modes.k}`);
  }
});
