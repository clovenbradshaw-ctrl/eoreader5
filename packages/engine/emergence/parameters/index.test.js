import { test } from "node:test";
import assert from "node:assert/strict";
import { induceParameters, parameterProfiles, profileJaccard } from "./index.js";

function makeEntity(id, attrs) {
  return { id, attributes: attrs.map(([field_id, value_type, count]) => ({ field_id, value_type, count: count ?? 1 })) };
}

const PEOPLE = [
  makeEntity("e1", [["occupation", "string"], ["location", "string"], ["organization", "string"]]),
  makeEntity("e2", [["occupation", "string"], ["location", "string"], ["organization", "string"], ["education", "string"]]),
  makeEntity("e3", [["occupation", "string"], ["location", "string"], ["organization", "string"]]),
  makeEntity("e4", [["occupation", "string"], ["location", "string"]]),
  makeEntity("e5", [["occupation", "string"], ["organization", "string"]]),
  makeEntity("e6", [["occupation", "string"], ["location", "string"], ["organization", "string"]]),
  makeEntity("e7", [["occupation", "string"], ["location", "string"]]),
  makeEntity("e8", [["occupation", "string"], ["location", "string"], ["organization", "string"], ["education", "string"]]),
];

test("induceParameters finds prevalent attributes", () => {
  const params = induceParameters(PEOPLE, { population: "test:people", minPrevalence: 0.25 });
  assert.ok(params.length > 0, "should find at least one parameter");
  const occupation = params.find((p) => p.domain.attribute === "occupation");
  assert.ok(occupation, "occupation should be a parameter (100% prevalence)");
  assert.ok(occupation._prevalence === 1, "occupation should have 100% prevalence");
  assert.ok(occupation.null_comparison.passed, "occupation should pass the null");
});

test("induceParameters returns empty for too-few entities", () => {
  const params = induceParameters([makeEntity("e1", [["x", "string"]])], { minEntityCount: 6 });
  assert.equal(params.length, 0);
});

test("induceParameters rejects attributes below prevalence threshold", () => {
  const manyEntities = [
    ...PEOPLE,
    makeEntity("e9", [["rare_attr", "string"]]),
    makeEntity("e10", [["rare_attr", "string"]]),
  ];
  const params = induceParameters(manyEntities, { population: "test:prevalence", minPrevalence: 0.5 });
  const rare = params.find((p) => p.domain.attribute === "rare_attr");
  assert.equal(rare, undefined, "rare_attr should not meet 50% prevalence threshold");
});

test("parameterProfiles builds binary vectors", () => {
  const keys = ["occupation", "location", "organization"];
  const profiles = parameterProfiles(PEOPLE, keys);
  assert.equal(profiles.size, PEOPLE.length);
  const profile = profiles.get("e1");
  assert.deepEqual([...profile], [1, 1, 1]);
  const profile4 = profiles.get("e4");
  assert.deepEqual([...profile4], [1, 1, 0]);
});

test("profileJaccard computes similarity", () => {
  const a = new Float64Array([1, 1, 1]);
  const b = new Float64Array([1, 1, 0]);
  const c = new Float64Array([0, 0, 0]);
  assert.equal(profileJaccard(a, a), 1);
  assert.equal(profileJaccard(a, b), 2 / 3);
  assert.equal(profileJaccard(a, c), 0);
  assert.equal(profileJaccard(c, c), 0);
});

test("induceParameters is deterministic", () => {
  const a = induceParameters(PEOPLE, { population: "test:deterministic", minPrevalence: 0.25 });
  const b = induceParameters(PEOPLE, { population: "test:deterministic", minPrevalence: 0.25 });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) {
    assert.equal(a[i].parameter_id, b[i].parameter_id);
  }
});
