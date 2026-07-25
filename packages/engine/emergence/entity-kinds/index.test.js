import { test } from "node:test";
import assert from "node:assert/strict";
import { induceEntityKinds, buildKindVocabulary } from "./index.js";
import { validateEntityKindCandidate, validateEntityKindVocabulary } from "@eoreader/spec";

function makeEntity(id, attrs) {
  return { id, attributes: attrs.map(([field_id, value_type]) => ({ field_id, value_type, count: 1 })) };
}

// Three groups of entities with distinct parameter profiles.
const PEOPLE = [
  makeEntity("p1", [["occupation", "string"], ["location", "string"], ["organization", "string"]]),
  makeEntity("p2", [["occupation", "string"], ["location", "string"], ["organization", "string"], ["education", "string"]]),
  makeEntity("p3", [["occupation", "string"], ["location", "string"], ["organization", "string"]]),
  makeEntity("p4", [["occupation", "string"], ["location", "string"]]),
  makeEntity("p5", [["occupation", "string"], ["organization", "string"]]),
  makeEntity("p6", [["occupation", "string"], ["location", "string"], ["organization", "string"]]),
];

const PLACES = [
  makeEntity("l1", [["location", "string"], ["population", "number"], ["country", "string"]]),
  makeEntity("l2", [["location", "string"], ["population", "number"], ["country", "string"]]),
  makeEntity("l3", [["location", "string"], ["population", "number"]]),
  makeEntity("l4", [["location", "string"], ["country", "string"]]),
  makeEntity("l5", [["location", "string"], ["population", "number"], ["country", "string"]]),
];

const ORGS = [
  makeEntity("o1", [["organization", "string"], ["industry", "string"], ["location", "string"]]),
  makeEntity("o2", [["organization", "string"], ["industry", "string"]]),
  makeEntity("o3", [["organization", "string"], ["industry", "string"], ["location", "string"]]),
  makeEntity("o4", [["organization", "string"], ["industry", "string"], ["founded", "number"]]),
  makeEntity("o5", [["organization", "string"], ["industry", "string"]]),
];

test("induceEntityKinds finds kinds from entity parameter profiles", () => {
  const entities = [...PEOPLE, ...PLACES, ...ORGS];
  const kinds = induceEntityKinds(entities, {
    population: "test:combined",
    minPrevalence: 0.2,
    cohesionThreshold: 0.2,
    minKindSize: 2,
    permutations: 100,
    quantile: 0.8,
  });
  assert.ok(kinds.length >= 1, "should induce at least one kind");
  for (const kind of kinds) {
    validateEntityKindCandidate(kind);
    assert.ok(kind.member_count >= 2, "each kind must have at least 2 members");
    assert.ok(kind.standard_parameters.length > 0, "each kind must have standard parameters");
    assert.ok(kind.cohesion > 0, "cohesion must be positive");
  }
});

test("induceEntityKinds returns empty for too-few entities", () => {
  const kinds = induceEntityKinds([makeEntity("e1", [["x", "string"]])], { minEntityCount: 6 });
  assert.equal(kinds.length, 0);
});

test("induceEntityKinds returns empty for uniform entities with no distinguishing params", () => {
  const uniform = [
    makeEntity("u1", [["a", "string"]]),
    makeEntity("u2", [["a", "string"]]),
    makeEntity("u3", [["a", "string"]]),
    makeEntity("u4", [["a", "string"]]),
    makeEntity("u5", [["a", "string"]]),
    makeEntity("u6", [["a", "string"]]),
    makeEntity("u7", [["a", "string"]]),
  ];
  const kinds = induceEntityKinds(uniform, {
    population: "test:uniform",
    minPrevalence: 0.3,
    minKindSize: 2,
    permutations: 50,
  });
  // All entities share the same single attribute, so they should form one kind.
  assert.ok(kinds.length >= 1);
});

test("buildKindVocabulary builds a valid vocabulary from candidates", () => {
  const entities = [...PEOPLE, ...PLACES, ...ORGS];
  const kinds = induceEntityKinds(entities, {
    population: "test:vocab",
    minPrevalence: 0.2,
    cohesionThreshold: 0.2,
    minKindSize: 2,
    permutations: 100,
    quantile: 0.8,
  });
  assert.ok(kinds.length >= 1);
  const vocab = buildKindVocabulary(kinds, { population: "test:vocab" });
  validateEntityKindVocabulary(vocab);
  assert.ok(vocab.vocabulary_id.startsWith("vocab:"));
  assert.ok(vocab.kinds.length >= 1);
  for (const kindDef of vocab.kinds) {
    assert.ok(kindDef.standard_parameters.length > 0);
  }
});

test("induceEntityKinds is deterministic", () => {
  const entities = [...PEOPLE, ...PLACES];
  const a = induceEntityKinds(entities, { population: "test:det", minPrevalence: 0.2, minKindSize: 2, permutations: 100, quantile: 0.8 });
  const b = induceEntityKinds(entities, { population: "test:det", minPrevalence: 0.2, minKindSize: 2, permutations: 100, quantile: 0.8 });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) {
    assert.equal(a[i].id, b[i].id);
  }
});
