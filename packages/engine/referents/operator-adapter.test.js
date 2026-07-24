import { test } from "node:test";
import assert from "node:assert/strict";
import { induceOperators } from "../emergence/operators/index.js";
import { createSeededRng } from "../emergence/nulls/index.js";
import { operatorCandidateToReferentArgs, individuateOperatorCandidate } from "./operator-adapter.js";
import { validateIndividuationResult } from "@eoreader/spec";

// Same fixture as emergence/operators/index.test.js: a trend + seasonal cycle
// so at least one operator is promoted.
function trendSeason(length = 48) {
  const rng = createSeededRng("ts");
  return Array.from({ length }, (_, t) => 2 + 1.5 * t + 8 * Math.sin((2 * Math.PI * t) / 6) + (rng() - 0.5));
}
const TS_OPTS = { population: "series:trend-season", shuffles: 30, enumeration: { lags: [1, 6], maxSeriesDepth: 2 }, seasonalPeriod: 6 };

function promotedOperator() {
  const { operators } = induceOperators(trendSeason(), TS_OPTS);
  assert.ok(operators.length >= 1, "fixture must promote at least one operator");
  return operators[0];
}

test("operatorCandidateToReferentArgs maps an OperatorCandidate onto individuateReferent's args", () => {
  const op = promotedOperator();
  const args = operatorCandidateToReferentArgs(op);

  assert.equal(args.referentId, op.id);
  assert.equal(args.mass, op.transfer_gain);
  assert.equal(args.coupling, op.reference_gain);
  assert.equal(args.named, true, 'a promoted operator re-enters as "INS" - it has a stable handle, i.e. is named');
  assert.equal(args.massNullSamples, op.promotion_null.null_samples);
  assert.equal(args.couplingNullSamples, op.promotion_null.null_samples);
  assert.equal(args.quantile, op.promotion_null.quantile);
});

test("operatorCandidateToReferentArgs refuses anything that isn't an OperatorCandidate@1", () => {
  assert.throws(() => operatorCandidateToReferentArgs({ schema: "Something@1" }), /OperatorCandidate@1/);
  assert.throws(() => operatorCandidateToReferentArgs(null), /OperatorCandidate@1/);
});

test("individuateOperatorCandidate runs a promoted operator through the same gate narrative referents use", () => {
  const op = promotedOperator();
  const result = individuateOperatorCandidate(op);

  assert.equal(result.schema, "IndividuationResult@1");
  assert.equal(result.referent_id, op.id);
  // Every promoted operator already cleared a transfer gate (transfer_gain >
  // 0), so mass types high; with no boundary evidence yet the gate must stay
  // pending, never silently admitted (spec 4.4).
  assert.notEqual(result.individuation_type, "field");
  assert.equal(result.gate_result.status, "pending");
  assert.equal(result.gate_result.admitted, false);
  assert.deepEqual(validateIndividuationResult(result), result);
});

test("individuateOperatorCandidate admits once boundary evidence is supplied via extra", () => {
  const op = promotedOperator();
  const result = individuateOperatorCandidate(op, {
    boundary: { observedDisplacements: [0.05, 0.06, 0.04], nullDisplacements: [0.4, 0.5, 0.45, 0.6] },
  });

  assert.equal(result.gate_result.status, "active");
  assert.equal(result.gate_result.admitted, true);
  assert.deepEqual(validateIndividuationResult(result), result);
});
