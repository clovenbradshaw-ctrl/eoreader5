import { test } from "node:test";
import assert from "node:assert/strict";
import { commitPrediction, revealAndScore } from "./index.js";

function baseCommitment(overrides = {}) {
  return commitPrediction({
    task_id: "task:t1",
    candidate_id: "candidate:c1",
    candidate_version_hash: "sha256:" + "a".repeat(64),
    input_snapshot_hash: "sha256:" + "b".repeat(64),
    predictive_output: { kind: "gaussian", mean: 10, sd: 2 },
    committed_at_step: 5,
    reveal_not_before_step: 6,
    ...overrides,
  });
}

test("a commitment is sealed with a content hash and a derived id", () => {
  const c = baseCommitment();
  assert.match(c.commitment_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(c.commitment_id, `commitment:${c.commitment_hash}`);
  assert.equal(c.schema, "PredictionCommitment@1");
});

test("the same committed content always seals to the same hash (deterministic, replayable)", () => {
  assert.equal(baseCommitment().commitment_hash, baseCommitment().commitment_hash);
});

test("a commitment cannot declare a reveal at or before the step it was committed (invariant 7.1)", () => {
  assert.throws(() => baseCommitment({ committed_at_step: 5, reveal_not_before_step: 5 }), RangeError);
  assert.throws(() => baseCommitment({ committed_at_step: 5, reveal_not_before_step: 4 }), RangeError);
});

test("reveal before the eligible step is refused as leakage (invariant 7.1)", () => {
  const c = baseCommitment({ committed_at_step: 5, reveal_not_before_step: 6 });
  assert.throws(
    () => revealAndScore({ commitment: c, observed: 10, revealed_at_step: 5 }),
    /leakage refused/
  );
});

test("reveal at or after the eligible step scores the committed prediction", () => {
  const c = baseCommitment();
  const r = revealAndScore({ commitment: c, observed: 10, revealed_at_step: 6, scoring_rule: "log-loss" });
  assert.equal(r.candidate_id, "candidate:c1");
  assert.equal(r.observed, 10);
  assert.equal(r.rule, "log-loss");
  assert.ok(r.proper);
  assert.ok(Number.isFinite(r.loss));
});

test("a tampered commitment is rejected at reveal time (the seal is checked)", () => {
  const c = baseCommitment();
  const forged = { ...c, predictive_output: { kind: "gaussian", mean: 10, sd: 0.01 } };
  assert.throws(() => revealAndScore({ commitment: forged, observed: 10, revealed_at_step: 6 }), /altered after it was sealed/);
});

test("an unsupported predictive-output kind is refused at commit time", () => {
  assert.throws(() => baseCommitment({ predictive_output: { kind: "tarot" } }), /unsupported predictive_output kind/);
});
