import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNullProtocol, validateIndividuationResult } from "./index.js";

const VALID_NULL_PROTOCOL = Object.freeze({
  schema: "NullProtocol@1",
  null_protocol: { name: "shuffled-sighting-mass" },
  null_samples: [1, 2, 3],
  sample_count: 3,
  quantile: 0.95,
  tail_direction: "greater",
  threshold: 2.9,
  observed_statistic: 5,
  passed: true,
  p_value: 0.05,
});

test("validateNullProtocol accepts a well-formed record", () => {
  assert.deepEqual(validateNullProtocol(VALID_NULL_PROTOCOL), VALID_NULL_PROTOCOL);
});

test("validateNullProtocol rejects the wrong schema tag", () => {
  assert.throws(() => validateNullProtocol({ ...VALID_NULL_PROTOCOL, schema: "wrong" }), /schema must be NullProtocol@1/);
});

test("validateNullProtocol rejects an out-of-range quantile", () => {
  assert.throws(() => validateNullProtocol({ ...VALID_NULL_PROTOCOL, quantile: 1.5 }), /quantile must be in/);
});

test("validateNullProtocol rejects an invalid tail_direction", () => {
  assert.throws(() => validateNullProtocol({ ...VALID_NULL_PROTOCOL, tail_direction: "sideways" }), /tail_direction/);
});

test("validateIndividuationResult accepts a well-formed field/emanon-shaped record", () => {
  const value = Object.freeze({
    schema: "IndividuationResult@1",
    referent_id: "referent:the-creature",
    individuation_type: "emanon",
    mass: 9.5,
    coupling: 9.5,
    agency_signal: null,
    named: false,
    mass_null: VALID_NULL_PROTOCOL,
    coupling_null: VALID_NULL_PROTOCOL,
    attributive_share: null,
    coupling_dispersion: null,
    attributive_null: null,
    dispersion_null: null,
    subject_reentry: null,
    boundary_stability: null,
    gate_result: { admitted: false, status: "pending", reason: "boundary not yet evaluated" },
  });
  assert.deepEqual(validateIndividuationResult(value), value);
});

test("validateIndividuationResult rejects an unknown individuation_type", () => {
  const value = {
    schema: "IndividuationResult@1",
    referent_id: "r1",
    individuation_type: "protagonist",
    mass: 1,
    coupling: 1,
    agency_signal: null,
    named: false,
    mass_null: VALID_NULL_PROTOCOL,
    coupling_null: VALID_NULL_PROTOCOL,
    attributive_share: null,
    coupling_dispersion: null,
    attributive_null: null,
    dispersion_null: null,
    subject_reentry: null,
    boundary_stability: null,
    gate_result: { admitted: false, status: "pending", reason: "x" },
  };
  assert.throws(() => validateIndividuationResult(value), /invalid individuation_type/);
});

test("validateIndividuationResult rejects an invalid gate_result.status", () => {
  const value = {
    schema: "IndividuationResult@1",
    referent_id: "r1",
    individuation_type: "field",
    mass: 1,
    coupling: 1,
    agency_signal: null,
    named: false,
    mass_null: VALID_NULL_PROTOCOL,
    coupling_null: VALID_NULL_PROTOCOL,
    attributive_share: null,
    coupling_dispersion: null,
    attributive_null: null,
    dispersion_null: null,
    subject_reentry: null,
    boundary_stability: null,
    gate_result: { admitted: false, status: "promoted", reason: "x" },
  };
  assert.throws(() => validateIndividuationResult(value), /invalid gate_result.status/);
});
