import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCompetentPrograms, evaluateProgramCompetency } from "./index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { validateCompetencyRecord } from "@eoreader/spec";

// A clean linear trend: last-value + drift should dominate the global mean.
const TREND = Array.from({ length: 30 }, (_, i) => 3 + 2 * i + 0.3 * Math.sin(i));

test("search returns a deterministic, competency-ranked frontier", () => {
  const a = searchCompetentPrograms(TREND, { population: "series:trend", enumeration: { maxPrograms: 60 } });
  const b = searchCompetentPrograms(TREND, { population: "series:trend", enumeration: { maxPrograms: 60 } });
  assert.deepEqual(a.map((r) => r.key), b.map((r) => r.key));
  assert.ok(a.length > 0);
  // Ranked by utility, descending.
  for (let i = 1; i < a.length; i += 1) assert.ok(a[i - 1].utility >= a[i].utility);
});

test("on a linear trend, the top program beats the global-mean reference", () => {
  const ranked = searchCompetentPrograms(TREND, { population: "series:trend", enumeration: { maxPrograms: 60 } });
  const best = ranked[0];
  assert.ok(best.reference_gain > 0, "the winning program should have positive competency gain vs the global mean");
  validateCompetencyRecord(best.competency);
});

test("the winning program on a trend uses a lag/last or drift structure, not the raw mean", () => {
  const ranked = searchCompetentPrograms(TREND, { population: "series:trend", enumeration: { maxPrograms: 60 } });
  const best = ranked[0];
  const serialized = JSON.stringify(best.program);
  // A pure mean(hist) cannot track a trend; the winner should reference recent
  // structure (last / diff / lag).
  assert.match(serialized, /"last"|"diff"|"lag"/);
});

test("evaluateProgramCompetency produces a scoped, valid CompetencyRecord", () => {
  const baselines = defaultNumericBaselines({ window: 3 });
  const program = { op: "last", of: { op: "hist" } };
  const { competency, gain } = evaluateProgramCompetency(TREND, program, {
    baselines,
    warmup: 4,
    taskId: "task:test",
    population: "series:trend",
    sourceVersion: canonicalHashSync(TREND),
  });
  validateCompetencyRecord(competency);
  assert.equal(typeof gain["baseline:last-value"], "number");
});

test("search refuses a series too short for the requested warmup", () => {
  assert.throws(() => searchCompetentPrograms([1, 2, 3], { warmup: 4 }), /too short/);
});
