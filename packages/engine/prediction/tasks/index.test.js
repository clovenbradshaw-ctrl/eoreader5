import { test } from "node:test";
import assert from "node:assert/strict";
import { createPredictionTask, walkForward } from "./index.js";

test("a task must declare its typed target, horizon, scoring rule, baselines, and population", () => {
  assert.throws(() => createPredictionTask({ target_type: "number" }), /must declare/);
  const task = createPredictionTask({
    target_type: "number",
    horizon: { kind: "walk-forward", h: 1 },
    scoring_rule: "log-loss",
    baseline_ids: ["baseline:last-value"],
    population: "series:demo",
  });
  assert.equal(task.schema, "PredictionTask@1");
  assert.match(task.content_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(task.id, `task:${task.content_hash}`);
});

test("walkForward yields history-before-target with a strictly later reveal step", () => {
  const steps = [...walkForward([10, 11, 12, 13], { warmup: 1 })];
  assert.equal(steps.length, 3);
  assert.deepEqual(steps[0], Object.freeze({
    step: 1,
    history: Object.freeze([10]),
    target: 11,
    committed_at_step: 1,
    reveal_not_before_step: 2,
  }));
  for (const s of steps) assert.ok(s.reveal_not_before_step > s.committed_at_step);
  // history at step i is exactly the prefix series[0..i-1]; the target is withheld.
  assert.deepEqual(steps.at(-1).history, [10, 11, 12]);
  assert.equal(steps.at(-1).target, 13);
});

test("walkForward rejects unsupported horizons", () => {
  assert.throws(() => [...walkForward([1, 2, 3], { horizon: 2 })], /horizon = 1 only/);
});
