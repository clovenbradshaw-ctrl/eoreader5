import { test } from "node:test";
import assert from "node:assert/strict";
import { INDIVIDUATION_TYPES, classifyIndividuationType, individuateReferent, applyNameBind } from "./individuation.js";

const MASS_NULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const COUPLING_NULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const STABLE_BOUNDARY = { observedDisplacements: [0.05, 0.08, 0.06], nullDisplacements: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85], quantile: 0.9 };
const UNSTABLE_BOUNDARY = { observedDisplacements: [0.68, 0.7, 0.66], nullDisplacements: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85], quantile: 0.9 };

test("INDIVIDUATION_TYPES enumerates the four terrain types from spec 13.2", () => {
  assert.deepEqual(INDIVIDUATION_TYPES, ["field", "emanon", "protogon", "holon"]);
});

test("classifyIndividuationType: low mass + low coupling types field", () => {
  const result = classifyIndividuationType({
    mass: 3, coupling: 3, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
  });
  assert.equal(result.individuation_type, "field");
  assert.equal(result.high_mass, false);
  assert.equal(result.high_coupling, false);
});

test("classifyIndividuationType: low mass + high coupling types protogon (orbited but absent, e.g. Kurtz)", () => {
  const result = classifyIndividuationType({
    mass: 3, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
  });
  assert.equal(result.individuation_type, "protogon");
});

test("classifyIndividuationType: high mass + unnamed types emanon (present, agentive, never name-admitted)", () => {
  const result = classifyIndividuationType({
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
  });
  assert.equal(result.individuation_type, "emanon");
});

test("classifyIndividuationType: high mass + named types holon (name-bound)", () => {
  const result = classifyIndividuationType({
    mass: 9.5, coupling: 9.5, named: true,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
  });
  assert.equal(result.individuation_type, "holon");
});

test("individuateReferent: an emanon whose boundary stays put under re-segmentation is admitted (spec 20.2, 'the creature')", () => {
  const result = individuateReferent({
    referentId: "referent:the-creature",
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: STABLE_BOUNDARY,
  });
  assert.equal(result.individuation_type, "emanon");
  assert.equal(result.gate_result.admitted, true);
  assert.equal(result.gate_result.status, "active");
});

test("individuateReferent: a protogon (rarely present, heavily discussed, e.g. Kurtz) is admitted without high mass", () => {
  const result = individuateReferent({
    referentId: "referent:kurtz",
    mass: 3, coupling: 9.5, named: true,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: STABLE_BOUNDARY,
  });
  assert.equal(result.individuation_type, "protogon");
  assert.equal(result.gate_result.admitted, true);
});

test("individuateReferent: low mass and low coupling never admits, regardless of boundary", () => {
  const result = individuateReferent({
    referentId: "referent:boilerplate-footer",
    mass: 3, coupling: 3, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: STABLE_BOUNDARY,
  });
  assert.equal(result.individuation_type, "field");
  assert.equal(result.gate_result.admitted, false);
});

test("individuateReferent: high-mass boilerplate that fails boundary stability remains field, not admitted (spec 20.2)", () => {
  const result = individuateReferent({
    referentId: "referent:recurring-phrase",
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: UNSTABLE_BOUNDARY,
  });
  assert.equal(result.individuation_type, "field", "boundary failure downgrades the type, not just the status");
  assert.equal(result.gate_result.admitted, false);
  assert.equal(result.gate_result.status, "field");
});

test("individuateReferent: without a boundary result, admission is pending, never defaulted to true", () => {
  const result = individuateReferent({
    referentId: "referent:unreviewed",
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
  });
  assert.equal(result.individuation_type, "emanon");
  assert.equal(result.gate_result.admitted, false);
  assert.equal(result.gate_result.status, "pending");
});

test("applyNameBind promotes emanon -> holon without changing mass or coupling (spec 13.5)", () => {
  const emanon = individuateReferent({
    referentId: "referent:the-creature",
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: STABLE_BOUNDARY,
  });
  const holon = applyNameBind(emanon);
  assert.equal(holon.individuation_type, "holon");
  assert.equal(holon.mass, emanon.mass);
  assert.equal(holon.coupling, emanon.coupling);
  assert.equal(holon.gate_result.admitted, true);
});

test("applyNameBind refuses to promote a non-emanon referent", () => {
  const protogon = individuateReferent({
    referentId: "referent:kurtz",
    mass: 3, coupling: 9.5, named: true,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: STABLE_BOUNDARY,
  });
  assert.throws(() => applyNameBind(protogon), /only applies to an emanon/);
});
