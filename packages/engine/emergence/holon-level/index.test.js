// packages/engine/emergence/holon-level/index.test.js
// Acceptance tests for the holon-level module — docs/holon-level.md.
//
// Discovery battery:
//   - Both gates pass -> "above"
//   - Neither gate discriminates -> "peer" (polycentric, no level)
//   - Gates disagree -> "unstable" (typed gap, never silently resolved)
//
// Tick battery (signal from noise, per holon):
//   - Insufficient history -> no verdict, not a forced "no tick"
//   - An observation consistent with the holon's own history -> not a tick
//   - An observation genuinely novel against the holon's own history -> a tick
//
// Hysteresis battery (Zollman-delay pattern, reused from paradigm gate):
//   - A single trailing flip in the relation history is NOT accepted as change
//   - A sustained run of the new relation IS accepted as change
//
// Schema conformance:
//   - classifyHolonLevelRelation's real output validates as HolonLevelRelation@1

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existenceDependencyTest,
  possibilityConstraintTest,
  classifyHolonLevelRelation,
  holonTick,
  appendHolonLevelTick,
  checkHolonLevelStability,
} from "./index.js";
import { validateHolonLevelRelation } from "@eoreader/spec";

const TEN_ONES = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

// ── Discovery ────────────────────────────────────────────────────────────

describe("classifyHolonLevelRelation", () => {
  it("discovers 'above' when both existence-dependency and possibility-constraint pass", () => {
    const existence = existenceDependencyTest({ observedDegradation: 5, nullDegradations: TEN_ONES });
    const constraint = possibilityConstraintTest({ observedNarrowing: 5, nullNarrowings: TEN_ONES });
    assert.equal(existence.passed, true);
    assert.equal(constraint.passed, true);

    const result = classifyHolonLevelRelation({ existence, constraint, subject_id: "holon", candidate_id: "part" });
    assert.equal(result.relation, "above");
    assert.equal(result.schema, "HolonLevelRelation@1");
    assert.ok(result.reason.includes("above"));
  });

  it("discovers 'peer' when neither test discriminates from chance — polycentric, no level assigned", () => {
    const existence = existenceDependencyTest({ observedDegradation: 0.1, nullDegradations: TEN_ONES });
    const constraint = possibilityConstraintTest({ observedNarrowing: 0.1, nullNarrowings: TEN_ONES });
    assert.equal(existence.passed, false);
    assert.equal(constraint.passed, false);

    const result = classifyHolonLevelRelation({ existence, constraint });
    assert.equal(result.relation, "peer");
    assert.ok(result.reason.includes("polycentric"));
  });

  it("discovers 'unstable' when the two gates disagree — a typed gap, never silently resolved", () => {
    const existence = existenceDependencyTest({ observedDegradation: 5, nullDegradations: TEN_ONES });
    const constraint = possibilityConstraintTest({ observedNarrowing: 0.1, nullNarrowings: TEN_ONES });
    assert.equal(existence.passed, true);
    assert.equal(constraint.passed, false);

    const result = classifyHolonLevelRelation({ existence, constraint });
    assert.equal(result.relation, "unstable");
    assert.ok(result.reason.includes("disagree"));
  });

  it("real output validates as HolonLevelRelation@1", () => {
    const existence = existenceDependencyTest({ observedDegradation: 5, nullDegradations: TEN_ONES });
    const constraint = possibilityConstraintTest({ observedNarrowing: 5, nullNarrowings: TEN_ONES });
    const result = classifyHolonLevelRelation({ existence, constraint, subject_id: "holon", candidate_id: "part-a" });
    assert.deepEqual(validateHolonLevelRelation(result), result);
  });
});

// ── Ticks: signal from noise, per holon ─────────────────────────────────

const GARDEN_HISTORY = [
  { text: "the garden was full of roses and lilies in the warm afternoon sun" },
  { text: "roses bloomed beside the old stone wall near the garden gate" },
  { text: "lilies and daisies lined the path through the quiet garden" },
  { text: "the afternoon sun warmed the roses growing along the garden wall" },
  { text: "birds sang near the roses and lilies in the peaceful garden" },
  { text: "the old garden wall was covered in blooming roses and ivy" },
];

describe("holonTick", () => {
  it("returns no verdict when the holon has insufficient history to build a conditional null", () => {
    const result = holonTick({ observation: { text: "anything" }, holonHistory: [GARDEN_HISTORY[0]] });
    assert.equal(result.is_tick, null);
    assert.equal(result.null_result, null);
    assert.ok(result.reason.includes("insufficient"));
  });

  it("is NOT a tick when the observation is consistent with the holon's own history", () => {
    const observation = { text: "another rose bloomed near the garden wall in the sun" };
    const result = holonTick({ observation, holonHistory: GARDEN_HISTORY });
    assert.equal(result.is_tick, false,
      `expected no tick for an on-topic observation (score=${result.score}, threshold=${result.null_result.threshold})`);
  });

  it("IS a tick when the observation is genuinely novel against the holon's own history (signal from noise)", () => {
    const observation = { text: "the stock market crashed as investors panicked over interest rate hikes" };
    const result = holonTick({ observation, holonHistory: GARDEN_HISTORY });
    assert.equal(result.is_tick, true,
      `expected a tick for an off-topic observation (score=${result.score}, threshold=${result.null_result.threshold})`);
  });
});

// ── Hysteresis: a lone flip is noise, a sustained run is change ────────

describe("checkHolonLevelStability (Zollman-delay pattern)", () => {
  it("does NOT accept a single trailing flip as a relationship change", () => {
    const relations = ["above", "above", "above", "above", "above", "peer"];
    const history = relations.map((relation, tick) => ({ tick, relation, existence: null, constraint: null }));

    const result = checkHolonLevelStability({ history });
    assert.equal(result.run_length, 1);
    assert.equal(result.passed, false,
      `a lone trailing flip should not clear the Born-null threshold: ${result.reason}`);
    assert.equal(result.stable_relation, null);
  });

  it("DOES accept a sustained run of the new relation as a relationship change", () => {
    const relations = ["above", "above", "peer", "peer", "peer", "peer", "peer"];
    const history = relations.map((relation, tick) => ({ tick, relation, existence: null, constraint: null }));

    const result = checkHolonLevelStability({ history });
    assert.equal(result.run_length, 5);
    assert.equal(result.passed, true,
      `a sustained run should clear the Born-null threshold: ${result.reason}`);
    assert.equal(result.stable_relation, "peer");
  });

  it("appendHolonLevelTick is append-only and never mutates prior entries", () => {
    const existence = existenceDependencyTest({ observedDegradation: 5, nullDegradations: TEN_ONES });
    const constraint = possibilityConstraintTest({ observedNarrowing: 5, nullNarrowings: TEN_ONES });
    const classification = classifyHolonLevelRelation({ existence, constraint });

    const h0 = Object.freeze([]);
    const h1 = appendHolonLevelTick(h0, classification);
    const h2 = appendHolonLevelTick(h1, classification);

    assert.equal(h0.length, 0, "original empty history is untouched");
    assert.equal(h1.length, 1);
    assert.equal(h2.length, 2);
    assert.equal(h2[0], h1[0], "the first entry is the same frozen object, never copied or mutated");
    assert.equal(h2[0].tick, 0);
    assert.equal(h2[1].tick, 1);
    assert.ok(Object.isFrozen(h2), "history array is frozen");
    assert.ok(Object.isFrozen(h2[0]), "each history entry is frozen");
  });
});
