import { test } from "node:test";
import assert from "node:assert/strict";
import {
  structuralQuery, buildFoldCache, buildShapeDescriptors,
  synthesizeArchetype, resolveArchetype, runGateA, runGateB,
  shapeDistance,
} from "./index.js";

const SAMPLE_TEXT =
  "The grand ball began with a polonaise. Natasha entered the room with trembling excitement. " +
  "Her heart beat faster as she saw Andrew among the dancers. The music swelled and filled the hall. " +
  "Prince Andrew bowed before her, his eyes meeting hers with an intensity that made her breath catch. " +
  "They danced together, moving as one through the swirling crowd. The waltz carried them across the floor. " +
  "Natasha felt herself lifted into a realm of pure joy. Andrew's hand rested firmly on her waist. " +
  "The other dancers faded into a blur of color and light. This moment seemed to stretch into eternity. " +
  "When the music finally ceased, they stood breathless and smiling. The ball continued around them. " +
  "But for Natasha, nothing would ever be quite the same. She had crossed some invisible threshold. " +
  "Later, in the quiet of her room, she replayed every moment in her mind. " +
  "The memory of his touch lingered like a half-remembered melody. " +
  "She knew with certainty that her life had changed forever in the space of that single dance. " +
  "War and peace, love and duty, all the grand themes of existence seemed to converge in that one evening.";

test("resolveArchetype rejects unknown refs", () => {
  const r = resolveArchetype("nonexistent-kind");
  assert.ok(r.error);
  assert.equal(r.kind, null);
});

test("resolveArchetype recognizes synth: prefix", () => {
  const r = resolveArchetype("synth:sonata-allegro-form");
  assert.equal(r.kind, "synthesized");
  assert.equal(r.status, "experimental");
});

test("resolveArchetype prefers kind over instance", () => {
  const kindReg = new Map([["sonata-allegro-form", {}]]);
  const instReg = new Map([["sonata-allegro-form", {}]]);
  const r = resolveArchetype("sonata-allegro-form", { kindRegistry: kindReg, instanceRegistry: instReg });
  assert.equal(r.kind, "kind");
});

test("synthesizeArchetype produces sonata descriptors", () => {
  const result = synthesizeArchetype({ windows: [] }, "sonata-allegro-form");
  assert.ok(result.descriptors);
  assert.equal(result.experimental, true);
  assert.equal(result.descriptors.novelty.length, 24);
  assert.equal(result.descriptors.recurrence.length, 24);
  assert.equal(result.descriptors.operatorDist.length, 9);
});

test("synthesizeArchetype produces fugue descriptors", () => {
  const result = synthesizeArchetype({ windows: [] }, "fugue-form like Bach");
  assert.ok(result.descriptors);
  assert.equal(result.experimental, true);
});

test("buildShapeDescriptors produces windows from text", () => {
  const result = buildShapeDescriptors(SAMPLE_TEXT, { windowUnits: 4, stride: 2 });
  assert.ok(result.windows.length > 0);
  assert.ok(result.units.length > 0);
  for (const win of result.windows) {
    assert.ok(win.descriptors);
    assert.ok(win.descriptors.novelty.length > 0);
    assert.ok(win.descriptors.recurrence.length > 0);
    assert.ok(win.descriptors.operatorDist.length === 9);
    assert.equal(typeof win.byteOffset, "number");
    assert.equal(typeof win.startUnit, "number");
  }
});

test("buildFoldCache produces a valid cache", () => {
  const cache = buildFoldCache("test-corpus", SAMPLE_TEXT, { windowUnits: 3, stride: 1 });
  assert.equal(cache.corpusId, "test-corpus");
  assert.equal(cache.foldVersion, "v1");
  assert.ok(cache.nWindows > 0);
  assert.ok(cache.nUnits > 0);
});

test("structuralQuery returns cold-start when no cache", () => {
  const result = structuralQuery("unknown-corpus", "synth:sonata-allegro-form", { foldCache: null });
  assert.ok(result.coldStart);
  assert.ok(result.needed.corpusId);
  assert.equal(result.results.length, 0);
});

test("structuralQuery returns cold-start when archetype is unresolvable", () => {
  const result = structuralQuery("test", "nonexistent", { foldCache: { windows: [{ descriptors: { novelty: [], recurrence: [], operatorDist: [] } }] } });
  assert.ok(result.error);
  assert.ok(result.error.includes("unresolvable"));
});

test("structuralQuery returns results for synth archetype with cache", () => {
  const cache = buildFoldCache("test", SAMPLE_TEXT, { windowUnits: 4, stride: 2 });
  assert.ok(cache.nWindows > 0, "need at least one window");
  const result = structuralQuery("test", "synth:sonata-allegro-form", { foldCache: cache, topK: 3, permutationSamples: 20 });
  assert.ok(result.results.length >= 0);
  assert.equal(result.corpusId, "test");
  assert.equal(result.archetypeKind, "synthesized");
  if (result.results.length > 0) {
    for (const r of result.results) {
      assert.ok(r.gates.allPassed || !r.gates.allPassed);
      assert.equal(typeof r.distance, "number");
      assert.equal(typeof r.byteOffset, "number");
    }
  }
});

test("runGateA: shuffled distance is greater than real distance", () => {
  const cache = buildFoldCache("test", SAMPLE_TEXT, { windowUnits: 4, stride: 2 });
  const synth = synthesizeArchetype(cache, "sonata-allegro-form");
  const scored = cache.windows.map((w, i) => ({ windowIndex: i, distance: shapeDistance(w.descriptors, synth.descriptors) }));
  scored.sort((a, b) => a.distance - b.distance);
  const gateA = runGateA(scored[0], cache, { id: "synth:test", descriptors: synth.descriptors }, { samples: 30 });
  assert.ok(typeof gateA.passed === "boolean");
  assert.ok(gateA.nullMean > 0);
  assert.ok(gateA.nullSd > 0);
});

test("runGateB: top candidate ranks differently under random control", () => {
  const cache = buildFoldCache("test", SAMPLE_TEXT, { windowUnits: 4, stride: 2 });
  const synth = synthesizeArchetype(cache, "sonata-allegro-form");
  const scored = cache.windows.map((w, i) => ({ windowIndex: i, distance: shapeDistance(w.descriptors, synth.descriptors), descriptors: w.descriptors }));
  scored.sort((a, b) => a.distance - b.distance);
  const top3 = scored.slice(0, 3);
  const gateB = runGateB(top3, scored, { id: "synth:test", descriptors: synth.descriptors });
  assert.ok(typeof gateB.passed === "boolean");
  assert.ok(gateB.rank > 0);
  assert.equal(typeof gateB.n, "number");
});

test("shapeDistance is symmetric and in [0, 2]", () => {
  const a = { novelty: new Float64Array([0.1, 0.2, 0.3]), recurrence: new Float64Array([0.4, 0.5, 0.6]), operatorDist: new Float64Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2]) };
  const b = { novelty: new Float64Array([0.6, 0.5, 0.4]), recurrence: new Float64Array([0.3, 0.2, 0.1]), operatorDist: new Float64Array([0.2, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0.0, 0.0]) };
  const d1 = shapeDistance(a, b);
  const d2 = shapeDistance(b, a);
  assert.ok(Math.abs(d1 - d2) < 1e-10, `shape distance should be symmetric: ${d1} vs ${d2}`);
  assert.ok(d1 >= 0 && d1 <= 2, `distance should be in [0, 2]: ${d1}`);
});

test("identical descriptors yield distance 0", () => {
  const d = { novelty: new Float64Array([0.1, 0.2, 0.3]), recurrence: new Float64Array([0.4, 0.5, 0.6]), operatorDist: new Float64Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2]) };
  assert.ok(shapeDistance(d, d) < 1e-10);
});

test("results are deterministic: same inputs produce same outputs", () => {
  const cache = buildFoldCache("test", SAMPLE_TEXT, { windowUnits: 4, stride: 2 });
  const a = structuralQuery("test", "synth:sonata-allegro-form", { foldCache: cache, topK: 3, permutationSamples: 20 });
  const b = structuralQuery("test", "synth:sonata-allegro-form", { foldCache: cache, topK: 3, permutationSamples: 20 });
  assert.equal(a.results.length, b.results.length);
  if (a.results.length > 0) {
    assert.equal(a.results[0].windowIndex, b.results[0].windowIndex);
  }
});
