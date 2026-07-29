// packages/engine/emergence/holon-level/series.test.js
// Acceptance tests for series.js — docs/holon-level.md's predictive-
// competency operationalization of possibility-constraint for numeric
// series (never a static similarity proxy).
//
// Battery:
//   - A genuine regime (a contiguous index range with its own local
//     dynamics) discovers "above": the whole series' summary depends on it
//     (existence) AND conditioning on it beats chance regime-conditioning
//     for one-step prediction (constraint = competency gain).
//   - Pure noise with an arbitrary "regime" label discovers "peer" — no
//     false positive from a meaningless index range.
//   - Real output validates as HolonLevelRelation@1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  seriesExistenceDependency,
  seriesPossibilityConstraint,
  discoverSeriesLevelRelation,
} from "./series.js";
import { createSeededRng } from "../nulls/index.js";
import { validateHolonLevelRelation } from "@eoreader/spec";

function buildRegimeSeries() {
  // Baseline noise around 10; a contiguous "storm" regime (indices 200-299)
  // with its own, genuinely different, mean-reverting local dynamics.
  const series = [];
  for (let i = 0; i < 400; i++) {
    if (i >= 200 && i < 300) {
      series.push(100 + Math.sin(i * 0.3) * 5 + ((i % 7) - 3));
    } else {
      series.push(10 + ((i % 5) - 2));
    }
  }
  return series;
}

const REGIME_INDICES = Array.from({ length: 100 }, (_, i) => 200 + i);

describe("seriesExistenceDependency", () => {
  it("discovers dependency on a genuine regime beyond a random same-size subset", () => {
    const series = buildRegimeSeries();
    const result = seriesExistenceDependency({ wholeSeries: series, candidateIndices: REGIME_INDICES, permutations: 100 });
    assert.equal(result.passed, true,
      `expected existence-dependency to pass (observed=${result.observed_degradation}, threshold=${result.null_result.threshold})`);
  });
});

describe("seriesPossibilityConstraint", () => {
  it("discovers that conditioning on a genuine regime beats chance regime-conditioning (competency gain)", () => {
    const series = buildRegimeSeries();
    const result = seriesPossibilityConstraint({ series, candidateIndices: REGIME_INDICES, permutations: 100 });
    assert.equal(result.passed, true,
      `expected possibility-constraint to pass (observed=${result.observed_narrowing}, threshold=${result.null_result.threshold})`);
  });

  it("does not discover constraint for an arbitrary regime label over pure noise", () => {
    const rng = createSeededRng("series-test-no-structure");
    const series = Array.from({ length: 400 }, () => 10 + (rng() - 0.5) * 4);
    const result = seriesPossibilityConstraint({ series, candidateIndices: REGIME_INDICES, permutations: 100 });
    assert.equal(result.passed, false,
      `expected no constraint signal from a meaningless regime label (observed=${result.observed_narrowing}, threshold=${result.null_result.threshold})`);
  });
});

describe("discoverSeriesLevelRelation", () => {
  it("discovers 'above' for a genuine regime", () => {
    const series = buildRegimeSeries();
    const relation = discoverSeriesLevelRelation({ series, candidateIndices: REGIME_INDICES, permutations: 100 });
    assert.equal(relation.relation, "above");
  });

  it("discovers 'peer' for an arbitrary regime label over pure noise — no false positive", () => {
    const rng = createSeededRng("series-test-peer-control");
    const series = Array.from({ length: 400 }, () => 10 + (rng() - 0.5) * 4);
    const relation = discoverSeriesLevelRelation({ series, candidateIndices: REGIME_INDICES, permutations: 100 });
    assert.equal(relation.relation, "peer");
  });

  it("real output validates as HolonLevelRelation@1", () => {
    const series = buildRegimeSeries();
    const relation = discoverSeriesLevelRelation({
      series,
      candidateIndices: REGIME_INDICES,
      permutations: 100,
      subject_id: "whole-series",
      candidate_id: "storm-regime",
    });
    assert.deepEqual(validateHolonLevelRelation(relation), relation);
  });
});
