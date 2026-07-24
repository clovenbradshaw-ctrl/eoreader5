// Reliability battery — TERRAIN / INDIVIDUATION GATE (the Ground → Figure cut).
//
// This is the sibling the read-path battery (reliability-read-path.test.js)
// points at. The read path proves the reader is deterministic, anchored, and
// honest about absence, and it records — as a documented pending — that
// individuation typing is not yet wired end-to-end. This file closes that
// reference honestly: it exercises the individuation gate directly, so the
// battery does not merely claim "the gate is proven elsewhere" but proves it
// here as a battery member.
//
// The unit-level normative coverage of the gate lives in
// referents/individuation.test.js (per-threshold, spec-section by spec-section).
// This file is deliberately not a duplicate of that: it pins the two
// reliability guarantees the battery cares about across the whole gate —
//   * completeness: every one of the four terrain types (field / protogon /
//     emanon / holon) is reachable from the same call surface with only the
//     mass × coupling × named observables changing; and
//   * safety: the gate never admits a figure on ambient material, and never
//     defaults admission to true when the boundary evidence is missing.
//
// Grounded in packages/engine/referents/individuation.js (spec section 13,
// "EO Terrain Promotion and Predictive Prior Induction v0.2").

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INDIVIDUATION_TYPES,
  classifyIndividuationType,
  individuateReferent,
  applyNameBind,
} from "@eoreader/engine/referents";

// Born-null sample sets (spec 12.8): thresholds are quantiles of these, never
// hand-set constants. A value near the top of the range reads as "high".
const MASS_NULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const COUPLING_NULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const STABLE_BOUNDARY = {
  observedDisplacements: [0.05, 0.08, 0.06],
  nullDisplacements: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85],
  quantile: 0.9,
};

// The four terrain cases, one per individuation type, described the way the
// evidence talks about them. Only mass/coupling/named change.
const TERRAINS = [
  { type: "field", mass: 3, coupling: 3, named: false, gloss: "ambient, not individuated" },
  { type: "protogon", mass: 3, coupling: 9.5, named: false, gloss: "orbited but absent (Kurtz)" },
  { type: "emanon", mass: 9.5, coupling: 9.5, named: false, gloss: "present, agentive, unnamed" },
  { type: "holon", mass: 9.5, coupling: 9.5, named: true, gloss: "present and name-bound" },
];

test("[terrain] the four individuation types are exactly field/emanon/protogon/holon", () => {
  assert.deepEqual(INDIVIDUATION_TYPES, ["field", "emanon", "protogon", "holon"]);
});

test("[terrain] completeness: every terrain type is reachable from one call surface", () => {
  const seen = new Set();
  for (const t of TERRAINS) {
    const result = classifyIndividuationType({
      mass: t.mass,
      coupling: t.coupling,
      named: t.named,
      massNullSamples: MASS_NULL,
      couplingNullSamples: COUPLING_NULL,
      quantile: 0.9,
    });
    assert.equal(result.individuation_type, t.type, `${t.gloss} must type as ${t.type}`);
    seen.add(result.individuation_type);
  }
  assert.deepEqual([...seen].sort(), [...INDIVIDUATION_TYPES].sort(), "all four types were produced");
});

test("[terrain] safety: ambient material (low mass, low coupling) is never admitted as a figure", () => {
  const result = individuateReferent({
    referentId: "referent:ambient",
    mass: 3, coupling: 3, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: STABLE_BOUNDARY,
  });
  assert.equal(result.individuation_type, "field");
  assert.equal(result.gate_result.admitted, false, "field is ground, not figure");
});

test("[terrain] safety: with no boundary evidence, admission is pending — never defaulted to true", () => {
  const result = individuateReferent({
    referentId: "referent:unreviewed",
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
  });
  assert.equal(result.individuation_type, "emanon");
  assert.equal(result.gate_result.admitted, false, "missing evidence must not admit");
  assert.equal(result.gate_result.status, "pending");
});

test("[terrain] an emanon with a stable boundary is admitted; a name-bind promotes it to holon", () => {
  const emanon = individuateReferent({
    referentId: "referent:the-creature",
    mass: 9.5, coupling: 9.5, named: false,
    massNullSamples: MASS_NULL, couplingNullSamples: COUPLING_NULL, quantile: 0.9,
    boundary: STABLE_BOUNDARY,
  });
  assert.equal(emanon.individuation_type, "emanon");
  assert.equal(emanon.gate_result.admitted, true);

  const holon = applyNameBind(emanon);
  assert.equal(holon.individuation_type, "holon", "the name-bind is what turns emanon into holon");
  assert.equal(holon.mass, emanon.mass, "promotion changes identity, not mass");
  assert.equal(holon.coupling, emanon.coupling, "promotion changes identity, not coupling");
  assert.equal(holon.gate_result.admitted, true);
});
