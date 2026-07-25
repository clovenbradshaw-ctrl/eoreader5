// Demo: induce entity kinds from a synthetic population.
// Shows the autopoetic kind discovery pipeline:
//   1. Parameters are induced from entity attribute prevalence.
//   2. Entities are clustered by parameter profile similarity.
//   3. Each validated cluster becomes an EntityKindCandidate with
//      standard parameters (like a Wikipedia infobox schema).
//
// Run: node scripts/induce-entity-kinds-demo.mjs

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { induceParameters, induceEntityKinds, buildKindVocabulary } from "@eoreader/engine";

function entity(id, attrs) {
  return { id, attributes: attrs.map(([f, t]) => ({ field_id: f, value_type: t, count: 1 })) };
}

const PEOPLE = [
  entity("p1", [["occupation","string"],["location","string"],["organization","string"]]),
  entity("p2", [["occupation","string"],["location","string"],["organization","string"],["education","string"]]),
  entity("p3", [["occupation","string"],["location","string"],["organization","string"]]),
  entity("p4", [["occupation","string"],["location","string"]]),
  entity("p5", [["occupation","string"],["organization","string"]]),
  entity("p6", [["occupation","string"],["location","string"],["organization","string"]]),
  entity("p7", [["occupation","string"],["location","string"],["organization","string"],["education","string"]]),
  entity("p8", [["occupation","string"],["location","string"]]),
];

const PLACES = [
  entity("l1", [["location","string"],["population","number"],["country","string"]]),
  entity("l2", [["location","string"],["population","number"],["country","string"]]),
  entity("l3", [["location","string"],["population","number"]]),
  entity("l4", [["location","string"],["country","string"]]),
  entity("l5", [["location","string"],["population","number"],["country","string"]]),
  entity("l6", [["location","string"],["population","number"],["country","string"]]),
];

const ORGS = [
  entity("o1", [["organization","string"],["industry","string"],["location","string"]]),
  entity("o2", [["organization","string"],["industry","string"]]),
  entity("o3", [["organization","string"],["industry","string"],["location","string"]]),
  entity("o4", [["organization","string"],["industry","string"],["founded","number"]]),
  entity("o5", [["organization","string"],["industry","string"]]),
  entity("o6", [["organization","string"],["industry","string"],["founded","number"]]),
];

const entities = [...PEOPLE, ...PLACES, ...ORGS];
console.log(`\nEntity population: ${entities.length} entities\n`);

// Step 1: Induce parameters across the population.
console.log("── Induce parameters ──────────────────────────────");
const params = induceParameters(entities, { population: "demo:entity-kinds", minPrevalence: 0.15 });
console.log(`Found ${params.length} significant parameters:\n`);
for (const p of params) {
  console.log(`  ${p.external_name.padEnd(20)} prevalence: ${(p._prevalence * 100).toFixed(0)}%  (${p._entity_count}/${entities.length} entities)`);
}

// Step 2: Induce entity kinds.
console.log(`\n── Induce entity kinds ──────────────────────────────`);
const kinds = induceEntityKinds(entities, {
  population: "demo:entity-kinds",
  minPrevalence: 0.15,
  cohesionThreshold: 0.2,
  minKindSize: 2,
  permutations: 200,
  quantile: 0.9,
});
console.log(`Induced ${kinds.length} kinds:\n`);
for (const kind of kinds) {
  console.log(`  Kind: ${kind.label}`);
  console.log(`    Members: ${kind.member_count} (${kind.member_entity_ids.join(", ")})`);
  console.log(`    Cohesion: ${kind.cohesion.toFixed(3)} (null passed: ${kind.cohesion_null.passed})`);
  console.log(`    Standard parameters:`);
  for (const p of kind.standard_parameters) {
    console.log(`      ${p.label.padEnd(20)} prevalence: ${(p.prevalence * 100).toFixed(0)}%`);
  }
  console.log();
}

// Step 3: Build vocabulary.
console.log("── Build kind vocabulary ──────────────────────────");
const vocab = buildKindVocabulary(kinds, { population: "demo:entity-kinds" });
console.log(`Vocabulary: ${vocab.vocabulary_id}`);
console.log(`${vocab.kinds.length} kinds defined`);
for (const kd of vocab.kinds) {
  console.log(`  ${kd.label}: ${kd.standard_parameters.length} standard parameters`);
  for (const sp of kd.standard_parameters) {
    console.log(`    - ${sp.label} (${sp.value_type})${sp.required ? " [required]" : ""}`);
  }
}
console.log("\nDone.");
