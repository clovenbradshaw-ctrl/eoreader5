import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIndividuationType, individuateReferent, applyFrameDemotion, applySubjectReentry } from "./individuation.js";

const MASS_NULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const COUPLING_NULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SHARE_NULL = [0.1, 0.2, 0.3, 0.4, 0.5];
const DISPERSION_NULL = [0.1, 0.2, 0.3, 0.4, 0.5];
const STABLE_BOUNDARY = { observedDisplacements: [0.05, 0.08, 0.06], nullDisplacements: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85], quantile: 0.9 };

function holonArgs(overrides = {}) {
  return {
    referentId: "referent:npr",
    mass: 9.5,
    coupling: 9.5,
    named: true,
    massNullSamples: MASS_NULL,
    couplingNullSamples: COUPLING_NULL,
    quantile: 0.9,
    boundary: STABLE_BOUNDARY,
    ...overrides,
  };
}

test("absent predicate evidence fails open and preserves prior typing", () => {
  const result = classifyIndividuationType({ mass: 9.5, coupling: 9.5, named: true, massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9 });
  assert.equal(result.individuation_type, "holon");
  assert.equal(result.attributive_share, null);
  assert.equal(result.coupling_dispersion, null);
});

test("high attributive share plus high coupling dispersion demotes holon to admitted apparatus", () => {
  const result = individuateReferent(holonArgs({ attributiveShare: 1, couplingDispersion: 0.97, attributiveNullSamples: SHARE_NULL, dispersionNullSamples: DISPERSION_NULL }));
  assert.equal(result.individuation_type, "apparatus");
  assert.equal(result.gate_result.admitted, true);
  assert.equal(result.gate_result.status, "apparatus");
});

test("patient subject re-entry blocks apparatus demotion", () => {
  const result = individuateReferent(holonArgs({ attributiveShare: 1, couplingDispersion: 0.97, attributiveNullSamples: SHARE_NULL, dispersionNullSamples: DISPERSION_NULL, patientShare: 0.6, patientNullSamples: SHARE_NULL }));
  assert.equal(result.individuation_type, "holon");
  assert.equal(result.subject_reentry.passed, true);
  const apparatus = individuateReferent(holonArgs({ attributiveShare: 1, couplingDispersion: 0.97, attributiveNullSamples: SHARE_NULL, dispersionNullSamples: DISPERSION_NULL }));
  const reentered = applySubjectReentry(apparatus, { basis: "patient", nullResult: result.subject_reentry.null_result });
  assert.equal(reentered.result.individuation_type, "holon");
  assert.equal(reentered.rec.held, true);
});

test("high attribution without high dispersion is not demoted", () => {
  const result = individuateReferent(holonArgs({ attributiveShare: 1, couplingDispersion: 0.2, attributiveNullSamples: SHARE_NULL, dispersionNullSamples: DISPERSION_NULL }));
  assert.equal(result.individuation_type, "holon");
});

test("high dispersion without high attribution is not demoted", () => {
  const result = individuateReferent(holonArgs({ attributiveShare: 0.1, couplingDispersion: 0.97, attributiveNullSamples: SHARE_NULL, dispersionNullSamples: DISPERSION_NULL }));
  assert.equal(result.individuation_type, "holon");
});

test("undefined dispersion does not demote degree-one referent", () => {
  const result = individuateReferent(holonArgs({ attributiveShare: 1, couplingDispersion: null, attributiveNullSamples: SHARE_NULL }));
  assert.equal(result.individuation_type, "holon");
});

test("field and protogon referents are never demoted", () => {
  const field = classifyIndividuationType({ mass: 3, coupling: 3, named: true, massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9, attributiveShare: 1, couplingDispersion: 0.97, attributiveNullSamples: SHARE_NULL, dispersionNullSamples: DISPERSION_NULL });
  const protogon = classifyIndividuationType({ mass: 3, coupling: 9.5, named: true, massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9, attributiveShare: 1, couplingDispersion: 0.97, attributiveNullSamples: SHARE_NULL, dispersionNullSamples: DISPERSION_NULL });
  assert.equal(field.individuation_type, "field");
  assert.equal(protogon.individuation_type, "protogon");
});

test("applyFrameDemotion refuses field referents", () => {
  const field = individuateReferent(holonArgs({ mass: 3, coupling: 3 }));
  assert.throws(() => applyFrameDemotion(field, {}), /only applies to a holon or emanon/);
});

test("applyFrameDemotion retains deep-frozen pre and post results", () => {
  const holon = individuateReferent(holonArgs());
  const demoted = applyFrameDemotion(holon, { attributiveShare: 1, couplingDispersion: 0.97 });
  assert.ok(Object.isFrozen(demoted.rec.pre));
  assert.ok(Object.isFrozen(demoted.rec.post));
  assert.equal(demoted.rec.pre.individuation_type, "holon");
  assert.equal(demoted.rec.post.individuation_type, "apparatus");
});

test("determinism: same inputs produce byte-identical results including null samples", () => {
  const a = individuateReferent(holonArgs({ attributiveShare: 1, couplingDispersion: 0.97, attributiveNullSamples: SHARE_NULL, dispersionNullSamples: DISPERSION_NULL }));
  const b = individuateReferent(holonArgs({ attributiveShare: 1, couplingDispersion: 0.97, attributiveNullSamples: SHARE_NULL, dispersionNullSamples: DISPERSION_NULL }));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
