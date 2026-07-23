// Confirms the real gate output in ./individuation.js actually satisfies
// the IndividuationResult@1 / NullProtocol@1 contract in @eoreader/spec -
// the schema and the implementation are not allowed to drift apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateIndividuationResult } from "@eoreader/spec";
import { individuateReferent, applyNameBind } from "./individuation.js";

const MASS_NULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const COUPLING_NULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const STABLE_BOUNDARY = { observedDisplacements: [0.05, 0.08, 0.06], nullDisplacements: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85], quantile: 0.9 };

test("individuateReferent output validates as IndividuationResult@1, with and without a boundary result", () => {
  const withBoundary = individuateReferent({
    referentId: "referent:the-creature",
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: STABLE_BOUNDARY,
  });
  assert.deepEqual(validateIndividuationResult(withBoundary), withBoundary);

  const pending = individuateReferent({
    referentId: "referent:unreviewed",
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
  });
  assert.deepEqual(validateIndividuationResult(pending), pending);
});

test("applyNameBind output also validates as IndividuationResult@1", () => {
  const emanon = individuateReferent({
    referentId: "referent:the-creature",
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: STABLE_BOUNDARY,
  });
  const holon = applyNameBind(emanon);
  assert.deepEqual(validateIndividuationResult(holon), holon);
});
