import { test } from "node:test";
import assert from "node:assert/strict";
import { runInductionDemo } from "../induce-operators-demo.mjs";
import { validateCompetencyRecord } from "@eoreader/spec";

test("the induction demo runs the helix, reuses an operator, and refuses noise", () => {
  const { structured, noise } = runInductionDemo();
  assert.ok(structured.operators.length >= 1);
  assert.ok(structured.rounds.length >= 2, "re-entry should drive more than one pass");
  const reused = structured.operators.some((op) => JSON.stringify(op.canonical_program).includes('"op":"opref"'));
  assert.ok(reused, "at least one operator should be built on a previously promoted one (REC -> INS)");
  for (const op of structured.operators) {
    assert.ok(op.transfer_gain > 0);
    assert.equal(op.promotion_null.passed, true);
    validateCompetencyRecord(op.competency);
  }
  assert.equal(noise.operators.length, 0, "structureless noise promotes nothing");
});
