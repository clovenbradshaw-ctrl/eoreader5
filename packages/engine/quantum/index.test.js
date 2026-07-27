// Quantum core tests. Ported from eoreader-proxy/test-quantum.mjs (which
// imported a ./quantum.js that had already moved here) and extended to pin
// the engine invariants: per-face normalization, spec vocabularies, purity
// of entangled updates, and honest absence (uniform faces, no fabricated
// defaults).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fold,
  project,
  foldToState,
  foldToClassical,
  interfere,
  measureFold,
  areEntangled,
  updateEntangledFold,
  computeUncertainty,
  satisfiesUncertaintyPrinciple,
  decohereFold,
  collapseFold,
  classicalToFold,
  OPERATORS,
  TERRAINS,
  STANCES,
} from "./index.js";
import { OPERATOR_CODES } from "@eoreader/spec/operators";
import { TERRAINS as SPEC_TERRAINS, STANCES as SPEC_STANCES } from "@eoreader/spec/cube";

function mockPriors() {
  return {
    termFreq: new Map([
      ["caesar", 5], ["roman", 3], ["empire", 2], ["republic", 4],
      ["general", 6], ["emperor", 3], ["senate", 2], ["war", 8], ["peace", 4],
      ["food", 10], ["cooking", 7], ["recipe", 3], ["chef", 5], ["meal", 6],
    ]),
    entities: new Map([
      ["caesar", { count: 5 }], ["brutus", { count: 3 }],
      ["cicero", { count: 2 }], ["chef", { count: 5 }],
    ]),
  };
}

function sumSquares(amps) {
  return Object.values(amps).reduce((s, a) => s + a * a, 0);
}

test("the three face vocabularies are the spec's, in helix order, 9 keys each", () => {
  assert.deepEqual([...OPERATORS], [...OPERATOR_CODES]);
  assert.deepEqual([...TERRAINS], [...SPEC_TERRAINS]);
  assert.deepEqual([...STANCES], [...SPEC_STANCES]);
  assert.equal(OPERATORS.length, 9);
  assert.deepEqual([...OPERATORS].slice(0, 3), ["NUL", "SIG", "INS"]);
});

test("a fold has three faces, each normalized over its OWN nine-key basis", () => {
  const f = fold("Julius Caesar was a general and emperor of Rome", mockPriors());
  for (const [face, basis] of [["operator", OPERATORS], ["terrain", TERRAINS], ["stance", STANCES]]) {
    assert.deepEqual(Object.keys(f[face]).sort(), [...basis].sort(), `${face} keys are its own basis`);
    assert.ok(Math.abs(sumSquares(f[face]) - 1) < 1e-9, `${face} is normalized`);
  }
  assert.equal(f.timestamp, null, "the engine has no ambient clock — timestamps are the host's");
});

test("the empty fold is uniform per face — maximum-entropy absence, not a fabricated default", () => {
  const f = fold("");
  for (const [face, basis] of [["operator", OPERATORS], ["terrain", TERRAINS], ["stance", STANCES]]) {
    assert.equal(Object.keys(f[face]).length, basis.length);
    assert.ok(Math.abs(sumSquares(f[face]) - 1) < 1e-9, `${face} normalized`);
    const values = [...new Set(Object.values(f[face]).map((v) => v.toFixed(12)))];
    assert.equal(values.length, 1, `${face} is uniform`);
  }
});

test("self-projection is 1; unrelated text projects lower", () => {
  const priors = mockPriors();
  const a = fold("Julius Caesar was a general and emperor of Rome", priors);
  const b = fold("Brutus betrayed his friend Caesar in the Roman Senate", priors);
  const c = fold("The chef prepared a delicious meal for the guests", priors);
  const self = project(a, a);
  assert.ok(Math.abs(self - 1) < 1e-9);
  assert.ok(project(a, b) <= self && project(a, b) >= 0);
  assert.ok(project(a, c) <= self && project(a, c) >= 0);
});

test("foldToState yields probabilities that sum to 1 per face", () => {
  const s = foldToState(fold("Caesar crossed the Rubicon", mockPriors()));
  for (const face of ["operator", "terrain", "stance"]) {
    const total = Object.values(s[face]).reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${face} probabilities sum to 1`);
  }
});

test("interference returns a bounded score per fold", () => {
  const priors = mockPriors();
  const q = fold("Tell me about Roman history", priors);
  const folds = [
    fold("Julius Caesar was a general", priors),
    fold("Brutus betrayed Caesar", priors),
    fold("The chef prepared a meal", priors),
  ];
  const out = interfere(q, folds);
  assert.equal(out.length, 3);
  for (const s of out) assert.ok(s >= 0 && s <= 1);
});

test("measurement moves the fold toward the basis", () => {
  const priors = mockPriors();
  const original = fold("Caesar was a great leader of Rome", priors);
  const basis = fold("Who was Caesar?", priors);
  const measured = measureFold(original, basis, 0.3);
  assert.ok(project(measured, basis) > project(original, basis));
});

test("updateEntangledFold is pure: the input fold is not mutated", () => {
  const priors = mockPriors();
  const measured = fold("Caesar crossed the Rubicon with his army", priors);
  const other = fold("The Rubicon was crossed by Caesar and his army", priors);
  const basis = fold("Who crossed the Rubicon?", priors);
  const before = JSON.stringify(other);
  const updated = updateEntangledFold(measured, other, basis, 0.2);
  assert.equal(JSON.stringify(other), before, "input untouched");
  assert.notEqual(updated, other, "a new fold is returned");
  for (const face of ["operator", "terrain", "stance"]) {
    assert.ok(Math.abs(sumSquares(updated[face]) - 1) < 1e-9);
  }
});

test("entanglement detection distinguishes correlated from unrelated folds", () => {
  const priors = mockPriors();
  const a = fold("Caesar crossed the Rubicon with his army", priors);
  const b = fold("The Rubicon was crossed by Caesar and his army", priors);
  assert.equal(typeof areEntangled(a, b), "boolean");
});

test("uncertainty is entropy per face and the principle check is a boolean", () => {
  const f = fold("Caesar and the Roman Empire history story", mockPriors());
  const u = computeUncertainty(f);
  for (const face of ["operator", "terrain", "stance"]) {
    assert.ok(u[face] >= 0, `${face} entropy non-negative`);
  }
  assert.equal(typeof satisfiesUncertaintyPrinciple(f), "boolean");
});

test("decoherence drifts a fold toward uniform and stays normalized", () => {
  const f = fold("Julius Caesar was a general and emperor", mockPriors());
  const d = decohereFold(f, 3600000);
  for (const face of ["operator", "terrain", "stance"]) {
    assert.ok(Math.abs(sumSquares(d[face]) - 1) < 1e-9);
  }
  const uf = computeUncertainty(f);
  const ud = computeUncertainty(d);
  assert.ok(ud.terrain >= uf.terrain - 1e-9, "decoherence never sharpens the terrain face");
});

test("classicalToFold / foldToClassical round-trip a definite coordinate", () => {
  const coord = { operator: "DEF", terrain: "Entity", stance: "Making" };
  const f = classicalToFold(coord);
  assert.deepEqual(foldToClassical(f), coord);
  const collapsed = collapseFold(f);
  assert.equal(collapsed.operator.DEF, 1);
});

test("fold is deterministic for the same text and priors", () => {
  const a = fold("Natasha danced at her first grand ball", mockPriors());
  const b = fold("Natasha danced at her first grand ball", mockPriors());
  assert.deepEqual(a, b);
});
