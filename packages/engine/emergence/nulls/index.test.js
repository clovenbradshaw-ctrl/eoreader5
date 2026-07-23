import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveNull, createSeededRng, seededShuffle } from "./index.js";

test("deriveNull rejects an empty null distribution", () => {
  assert.throws(() => deriveNull({ nullSamples: [], observedStatistic: 1 }), TypeError);
});

test("deriveNull: greater tail passes when the observed statistic clears the upper quantile", () => {
  const nullSamples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = deriveNull({ nullSamples, observedStatistic: 9.5, tailDirection: "greater", quantile: 0.9 });
  assert.equal(result.threshold, 9.1);
  assert.equal(result.passed, true);
  assert.equal(result.p_value, 0.1);
  assert.equal(result.sample_count, 10);
  assert.deepEqual(result.null_samples, nullSamples);
});

test("deriveNull: greater tail fails when the observed statistic does not clear the threshold", () => {
  const nullSamples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = deriveNull({ nullSamples, observedStatistic: 5, tailDirection: "greater", quantile: 0.9 });
  assert.equal(result.passed, false);
});

test("deriveNull: less tail mirrors the same quantile from the other end", () => {
  const nullSamples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = deriveNull({ nullSamples, observedStatistic: 1.5, tailDirection: "less", quantile: 0.9 });
  assert.ok(Math.abs(result.threshold - 1.9) < 1e-9, `expected threshold ~1.9, got ${result.threshold}`);
  assert.equal(result.passed, true);
});

test("deriveNull echoes the supplied null protocol verbatim for audit", () => {
  const protocol = { name: "shuffled-sequence", iterations: 200 };
  const result = deriveNull({ nullSamples: [1, 2, 3], observedStatistic: 5, protocol });
  assert.deepEqual(result.null_protocol, protocol);
});

test("createSeededRng is deterministic: same seed, same stream", () => {
  const a = createSeededRng("frankenstein:v1");
  const b = createSeededRng("frankenstein:v1");
  const streamA = Array.from({ length: 5 }, () => a());
  const streamB = Array.from({ length: 5 }, () => b());
  assert.deepEqual(streamA, streamB);
  for (const value of streamA) {
    assert.ok(value >= 0 && value < 1);
  }
});

test("createSeededRng: different seeds diverge", () => {
  const a = createSeededRng("seed-a");
  const b = createSeededRng("seed-b");
  assert.notEqual(a(), b());
});

test("seededShuffle does not mutate its input and is reproducible from the same rng seed", () => {
  const values = [1, 2, 3, 4, 5];
  const shuffled = seededShuffle(values, createSeededRng("shuffle-seed"));
  assert.deepEqual(values, [1, 2, 3, 4, 5]);
  assert.deepEqual(shuffled, seededShuffle(values, createSeededRng("shuffle-seed")));
  assert.deepEqual([...shuffled].sort((x, y) => x - y), values);
});
