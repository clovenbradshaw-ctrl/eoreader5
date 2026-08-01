// intuition/working-memory.test.js — structural assay for the WorkingMemoryBuffer.
//
// Tests the four invariants:
//   1. Capacity — never exceeds MAX_MOTIFS (25)
//   2. Specturm schema — every candidate has {probability, possibility, novelty, compositeScore}
//   3. Gap honesty — every typed gap is a gap, never a fake probability
//   4. Turns increment — each update advances the turn clock
//
// The store surfaced frames are mocked: we create a minimal Hebbian store with
// a few frames and verify that the buffer surfaces them and ranks them correctly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WorkingMemoryBuffer, IntuitionItem } from "./working-memory.js";
import { buildStore } from "../store/index.js";

function makeFrames(texts) {
  return texts.map((text, i) => ({
    order: i,
    offset: i * 200,
    text,
  }));
}

// Build a store with enough frames (≥15) so that the idf≥2.0 AND df≥2 band
// gate can admit recurring rare words. With N=15, a word appearing in 2 frames
// has idf = log(15/2) ≈ 2.015 ≥ 2.0. With fewer frames, no word passes both
// conditions — the store correctly reports no associations.
function makeSufficientStore() {
  const texts = [
    "The wedding grandeur of Natasha and Pierre was a splendid affair.",
    "Pierre felt nervous before the ceremony began in earnest.",
    "The wedding ceremony was held in the old chapel on the hill.",
    "Natasha wore a magnificent white gown for the occasion.",
    "Pierre stumbled over his vows but Natasha smiled warmly.",
    "The reception was held at the Rostov estate with dancing.",
    "Old Count Rostov wept tears of joy at the celebration.",
    "Andrei had died before he could see this glorious day.",
    "Marya welcomed Natasha to the family with open arms.",
    "The grandeur of the moment was felt by everyone present.",
    "Pierre and Natasha danced together under the chandeliers.",
    "The wedding feast lasted well into the night hours.",
    "Guests toasted the couple with champagne and laughter.",
    "Natasha remembered her first love as she danced with Pierre.",
    "The splendor and grandeur of the event was unforgettable.",
  ];
  return { store: buildStore(makeFrames(texts)), texts };
}

function makeDiscourseState({ turnCount = 1, motifs = null, topicStack = null, location = null } = {}) {
  const motifMap = new Map();
  if (motifs) {
    for (const m of motifs) {
      motifMap.set(m.id, m);
    }
  }
  return Object.freeze({
    turnCount,
    motifs: motifMap,
    topicStack: topicStack ?? [],
    location,
    locationRadius: 50000,
  });
}

describe("WorkingMemoryBuffer", () => {
  it("creates empty buffer with defaults", () => {
    const buf = new WorkingMemoryBuffer();
    assert.equal(buf.turn, 0);
    assert.equal(buf.capacity, 25);
    assert.equal(buf.items.size, 0);
  });

  it("increments turn and returns IntuitionReport@1 schema", () => {
    const buf = new WorkingMemoryBuffer();
    const result = buf.update({});
    assert.equal(buf.turn, 1);
    assert.equal(result.schema, "IntuitionReport@1");
    assert.equal(result.turn, 1);
    assert.equal(result.totalItems, 0);
    assert.ok(Array.isArray(result.spectrum));
    assert.ok(Array.isArray(result.gaps));
  });

  it("surfaces store associations when cue and frames provided", () => {
    const { store } = makeSufficientStore();
    const buf = new WorkingMemoryBuffer({ store });

    const result = buf.update({ cueText: "ceremony", store });

    assert.ok(result.totalItems > 0, "should surface at least one item");
    const storeItems = result.spectrum.filter(s => s.candidate.source === "store");
    assert.ok(storeItems.length > 0, "should include store-sourced items");
    for (const item of result.spectrum) {
      assert.ok(typeof item.probability.estimate === "number");
      assert.ok(item.probability.estimate >= 0);
      assert.ok(item.probability.estimate <= 1);
      assert.ok(typeof item.possibility.exists === "boolean");
      assert.ok(typeof item.novelty === "number");
      assert.ok(typeof item.compositeScore === "number");
    }
  });

  it("reports typed gap when store has no frames", () => {
    const buf = new WorkingMemoryBuffer();
    const result = buf.update({ cueText: "Pierre" });
    const hasStoreGap = result.gaps.some(g => g.reason === "store_unavailable");
    assert.ok(hasStoreGap, "should report store_unavailable gap");
  });

  it("reports typed gap when cue surfaces no associations", () => {
    const { store } = makeSufficientStore();
    const buf = new WorkingMemoryBuffer({ store });

    const result = buf.update({ cueText: "quantum electrodynamics perturbation theory renormalization", store });
    assert.equal(result.schema, "IntuitionReport@1");
    const storeGap = result.gaps.some(g => g.reason === "store_no_associations");
    assert.ok(storeGap, "should report store_no_associations gap for unrelated cue");
  });

  it("injects discourse motifs into spectrum", () => {
    const buf = new WorkingMemoryBuffer();
    const motif = {
      id: "test:1",
      activation: 0.8,
      signal: null,
      fold: { terrain: { Entity: 0.6, Field: 0.4 }, operator: {}, stance: {} },
      source: "delta",
      face: "Entity",
      isAlive: true,
      lastSeen: 1,
      firstSeen: 1,
      reinforcements: 3,
    };
    const ds = makeDiscourseState({ motifs: [motif] });

    const result = buf.update({ discourseState: ds });
    const hasMotif = result.spectrum.some(s => s.candidate.id === "discourse:test:1");
    assert.ok(hasMotif, "should include discourse motif in spectrum");
  });

  it("injects topic stack items", () => {
    const buf = new WorkingMemoryBuffer();
    const ds = makeDiscourseState({
      topicStack: [{ label: "War and Peace", fold: { terrain: {}, operator: {}, stance: {} }, opened: 1, motif: { signal: null } }],
    });

    const result = buf.update({ discourseState: ds });
    const hasTopic = result.spectrum.some(s => s.candidate.id === "topic:War and Peace");
    assert.ok(hasTopic, "should include topic in spectrum");
  });

  it("never exceeds capacity", () => {
    const texts = Array.from({ length: 50 }, (_, i) => `Frame number ${i} with unique content ${i} ${Math.random().toString(36).slice(2)}`);
    const store = buildStore(makeFrames(texts));
    const buf = new WorkingMemoryBuffer({ capacity: 10 });

    for (let i = 0; i < 20; i++) {
      buf.update({ cueText: `unique cue ${i} ${Math.random().toString(36).slice(2)}`, store });
    }

    assert.ok(buf.items.size <= 10, "items should not exceed capacity");
  });

  it("evicts dead items below threshold", () => {
    const buf = new WorkingMemoryBuffer({ capacity: 25 });

    // Add items directly
    const item = new IntuitionItem({
      id: "test:dead", label: "dead", source: "store",
      activation: 0.01, probabilityEstimate: 0.01,
      possibility: { exists: true, nullGatePassed: true },
      noveltyScore: 0, compositeScore: 0.01,
      signal: null, frameOrder: 0, offset: 0,
      text: "dead text", turn: 1,
    });
    buf.items.set(item.id, item);

    // Update triggers eviction
    buf.update({});
    assert.ok(!buf.items.has("test:dead"), "should evict item below threshold");
  });

  it("ranks by composite score descending", () => {
    const buf = new WorkingMemoryBuffer({ capacity: 25 });

    for (let i = 0; i < 5; i++) {
      buf.items.set(`test:${i}`, new IntuitionItem({
        id: `test:${i}`, label: `item ${i}`, source: "store",
        activation: 0.5, probabilityEstimate: 0.5,
        possibility: { exists: true, nullGatePassed: true },
        noveltyScore: i / 10, compositeScore: i / 10,
        signal: null, frameOrder: i, offset: i * 100,
        text: `item ${i}`, turn: 1,
      }));
    }

    const sorted = buf.itemsSorted();
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i - 1].compositeScore >= sorted[i].compositeScore,
        `item ${i - 1} (${sorted[i - 1].compositeScore}) should rank >= item ${i} (${sorted[i].compositeScore})`);
    }
  });

  it("returns null intuition before first update", () => {
    const buf = new WorkingMemoryBuffer();
    assert.equal(buf.getIntuition(), null);
  });

  it("reinforcements increment on repeat surface", () => {
    const { store } = makeSufficientStore();
    const buf = new WorkingMemoryBuffer({ store });

    buf.update({ cueText: "ceremony held", store });
    const first = buf.getIntuition();

    buf.update({ cueText: "ceremony held", store });
    const second = buf.getIntuition();

    const storeRefs = second.spectrum
      .filter(s => s.candidate.source === "store")
      .map(s => s.reinforcements);
    assert.ok(storeRefs.length > 0, "should have store items after two updates");
    const maxRef = Math.max(...storeRefs);
    assert.ok(maxRef >= 1, `expected reinforcements >= 1, got ${maxRef}`);
  });
});
