import { test } from "node:test";
import assert from "node:assert/strict";
import { detectMotifs } from "./index.js";

const unit = (type, field, extra = {}) => ({ type, field, ...extra });

function cards(count, extra = () => []) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(
      unit("kicker", [0.1], { className: `x-${i}` }),
      unit("title", [0.2 + i / 100], { className: `y-${i}` }),
      unit("summary", [0.4 + i / 200], { className: `z-${i}` }),
      unit("time", [0.8]),
      ...extra(i),
    );
  }
  return out;
}

test("twenty repeated records produce one stable motif", () => {
  const motifs = detectMotifs(cards(20), { maxPeriodUnits: 6, nullIterations: 32 });
  assert.equal(motifs.length, 1);
  assert.equal(motifs[0].period_units, 4);
  assert.ok(motifs[0].instances.length >= 18);
  assert.ok(motifs[0].schema.length >= 4 && motifs[0].schema.length <= 6);
});

test("prose-like type variation does not clear the shuffled null", () => {
  const units = Array.from({ length: 30 }, (_, i) => unit(`phrase-${i % 7}-${i}`, [i / 30]));
  assert.deepEqual(detectMotifs(units, { maxPeriodUnits: 6, nullIterations: 32 }), []);
});

test("repeated verse form clears the null", () => {
  const stanza = [unit("refrain", [0.1]), unit("turn", [0.5]), unit("refrain", [0.1])];
  const units = Array.from({ length: 6 }, () => stanza).flat();
  const motifs = detectMotifs(units, { maxPeriodUnits: 4, nullIterations: 32 });
  assert.equal(motifs[0].period_units, 3);
  assert.ok(motifs[0].null_p <= 0.05);
});

test("variable-depth threaded replies align as non-contiguous instances", () => {
  const units = cards(8, (i) => (i % 2 === 0 ? [unit("reply-depth", [0.9])] : []));
  const motifs = detectMotifs(units, { maxPeriodUnits: 5, nullIterations: 32 });
  assert.ok(motifs.length >= 1);
  assert.ok(motifs[0].instances.some((span, i, spans) => i > 0 && span.start !== spans[i - 1].end));
});

test("display class randomization does not affect motif output", () => {
  const first = detectMotifs(cards(20), { maxPeriodUnits: 6, nullIterations: 32, seed: "same" });
  const randomized = detectMotifs(cards(20).map((u, i) => ({ ...u, className: `random-${80 - i}` })), {
    maxPeriodUnits: 6,
    nullIterations: 32,
    seed: "same",
  });
  assert.deepEqual(
    randomized.map(({ period_units, instances, schema, regularity, null_p }) => ({ period_units, instances, schema, regularity, null_p })),
    first.map(({ period_units, instances, schema, regularity, null_p }) => ({ period_units, instances, schema, regularity, null_p })),
  );
});

test("seasonal records clear without medium-specific paths", () => {
  const years = 5;
  const seasons = ["winter", "spring", "summer", "fall"];
  const units = [];
  for (let year = 0; year < years; year += 1) {
    for (let i = 0; i < seasons.length; i += 1) units.push(unit("season", [i / 10, year / 100]));
  }
  const motifs = detectMotifs(units, { maxPeriodUnits: 4, nullIterations: 32 });
  assert.equal(motifs[0].period_units, 4);
  assert.equal(motifs[0].instances.length, years);
});
