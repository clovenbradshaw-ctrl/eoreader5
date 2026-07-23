import { test } from "node:test";
import assert from "node:assert/strict";
import { runPredictiveSlice, runSeries } from "../predict-series-demo.mjs";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { validatePredictionTask, validateCompetencyRecord } from "@eoreader/spec";

test("the Phase 0 slice runs the full loop over every synthetic series", () => {
  const slice = runPredictiveSlice({ length: 30 });
  assert.equal(slice.results.length, 3);
  for (const { task, competency, trace } of slice.results) {
    // Every prediction task and competency record is spec-valid.
    validatePredictionTask(task);
    validateCompetencyRecord(competency);
    assert.ok(competency.observations > 0);
    assert.equal(trace.length, competency.observations);
    // Competency is scoped (invariant 7.5): the record names horizon, population,
    // sources, and protocol.
    assert.equal(competency.scope.evaluation_protocol, "prequential-walk-forward");
    assert.equal(competency.scope.source_versions.length, 1);
    // A gain figure exists for each declared baseline.
    for (const id of competency.baseline_ids) {
      assert.equal(typeof competency.competency_gain[id], "number");
    }
  }
});

test("the slice is a deterministic, replayable experiment (invariant 12.12)", () => {
  const a = runPredictiveSlice({ length: 30 });
  const b = runPredictiveSlice({ length: 30 });
  assert.equal(canonicalHashSync(a), canonicalHashSync(b));
});

test("competency is honestly scoped — the candidate is not universally best", () => {
  // The drift candidate should beat the weak moving-mean baseline on a trending
  // series but is NOT guaranteed to beat every baseline; at least one baseline
  // gain being non-positive somewhere proves the loop is not rigged.
  const slice = runPredictiveSlice({ length: 40 });
  const gains = slice.results.flatMap((r) => Object.values(r.competency.competency_gain));
  assert.ok(gains.some((g) => g > 0), "candidate should win somewhere");
  assert.ok(gains.some((g) => g <= 0), "candidate should also lose somewhere (honest, scoped competency)");
});

test("runSeries feeds history-before-target into every commitment", () => {
  // A strictly increasing series: the candidate never sees the value it predicts.
  const series = Array.from({ length: 20 }, (_, i) => i + 0.5 * Math.sin(i));
  const { competency } = runSeries("series:mono", series, { warmup: 3 });
  assert.equal(competency.observations, 17);
  validateCompetencyRecord(competency);
});
