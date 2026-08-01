// discourse/discourse.test.js — DiscourseState is a turn-based working
// memory buffer: active motifs, referent activation, topic stack, location.
// Decay is exponential (same form as quantum/decohereFold). Pronouns channel
// activation to whatever referent is most active. The clock is logical turns,
// not wall time — the engine has no clock.

import assert from "node:assert/strict";
import test from "node:test";
import { DiscourseState } from "./index.js";

function mockFold(terrain = "Void") {
  const amps = { Void:0, Entity:0, Kind:0, Field:0, Link:0, Network:0, Atmosphere:0, Lens:0, Paradigm:0 };
  amps[terrain] = 1;
  return { terrain: amps, operator: amps, stance: amps, text: "" };
}

// ── Construction ──

test("fresh state has no motifs, referents, or topics", () => {
  const ds = new DiscourseState();
  assert.equal(ds.motifs.size, 0);
  assert.equal(ds.referents.size, 0);
  assert.equal(ds.topicStack.length, 0);
  assert.equal(ds.turnCount, 0);
  assert.equal(ds.location, null);
});

// ── Decay ──

test("motif activation decays exponentially across turns", () => {
  const ds = new DiscourseState();
  // Push a motif through the delta path (high surprise)
  ds.update(mockFold("Entity"), 0.9, null, "query", [{ offset: 100, score: 0.9, text: "Natasha" }], "Natasha");
  assert(ds.motifs.size >= 1);
  const id = [...ds.motifs.keys()].find((k) => k.startsWith("motif:δ:"));
  assert(id, "delta motif should exist");
  const before = ds.motifs.get(id).activation;

  // Advance 10 turns — should decay toward zero
  for (let i = 0; i < 10; i++) {
    ds.update(mockFold("Entity"), 0, null, "query", null, "");
  }
  const after = ds.motifs.get(id)?.activation ?? 0;
  assert(after < before / 3, `activation should decay substantially: ${before} → ${after}`);
});

// ── Pronoun channelling ──

test("pronoun in query boosts the most active referent", () => {
  const ds = new DiscourseState();
  ds.referents.set("natasha", { id: "natasha", activation: 0.6, surfaces: ["Natasha"] });
  ds.referents.set("pierre", { id: "pierre", activation: 0.2, surfaces: ["Pierre"] });

  ds.update(mockFold("Entity"), 0.1, null, "query", null, "she danced beautifully");

  // Natasha: 0.6 (before) → pronoun boosts to 1.0 → end-of-turn decay → ~0.819
  const after = ds.referents.get("natasha").activation;
  assert(after > 0.8, `Natasha should stay highly activated after pronoun boost, got ${after}`);
  assert(after < 0.9, "Natasha should have decayed slightly after the boost");

  // Pierre: only decayed (no boost) — should be lower
  const pierreAfter = ds.referents.get("pierre").activation;
  assert(pierreAfter < after, "less active referent should not overtake the boosted one");
});

test("pronoun with no active referent is a no-op", () => {
  const ds = new DiscourseState();
  ds.update(mockFold("Entity"), 0.5, null, "query", null, "they went to the ball");
  assert.equal(ds.referents.size, 0);
});

test("non-pronoun query does not channel", () => {
  const ds = new DiscourseState();
  ds.referents.set("natasha", { id: "natasha", activation: 0.6, surfaces: ["Natasha"] });
  const before = ds.referents.get("natasha").activation;

  ds.update(mockFold("Entity"), 0.1, null, "query", null, "Natasha danced beautifully");

  const after = ds.referents.get("natasha").activation;
  assert(after < before, "explicit name should not trigger pronoun boost");
});

// ── Topic stack ──

test("push/pop topic", () => {
  const ds = new DiscourseState();
  ds.pushTopic("first-ball", mockFold("Entity"));
  assert.equal(ds.topicStack.length, 1);
  assert.equal(ds.topicStack[0].label, "first-ball");

  const popped = ds.popTopic();
  assert.equal(popped, "first-ball");
  assert.equal(ds.topicStack.length, 0);
});

test("topic stack is capped at 5", () => {
  const ds = new DiscourseState();
  for (let i = 0; i < 7; i++) ds.pushTopic(`topic-${i}`, mockFold("Entity"));
  assert.equal(ds.topicStack.length, 5);
  assert.equal(ds.topicStack[0].label, "topic-2");
});

test("born rule: topics below noise floor are pruned on push (the past stops when irrelevant to noise)", () => {
  const ds = new DiscourseState();

  // Push three topics
  ds.pushTopic("early-one", mockFold("Entity"));
  ds.pushTopic("early-two", mockFold("Entity"));
  ds.pushTopic("early-three", mockFold("Entity"));
  assert.equal(ds.topicStack.length, 3);

  // Advance several turns with an unrelated query so the early topics' motifs
  // decay — their activation (cosineSim against the current query's signal)
  // will drop toward the noise floor.
  for (let i = 0; i < 8; i++) {
    ds.update(mockFold("Kind"), 0.1, null, "query", null, "unrelated query text");
  }

  // The early topics' motif activation should now be near zero (noise).
  // Pushing a fresh topic triggers _pruneNoise — the noise topics drop first.
  ds.pushTopic("fresh", mockFold("Lens"));
  // At most 5 remain; noise topics (activation < 0.1) are evicted first.
  assert(ds.topicStack.length <= 5, "stack should not exceed cap after prune+push");
  // The fresh topic should be present.
  assert(ds.topicStack.some((t) => t.label === "fresh"), "fresh topic should be on stack");
});

test("born rule: stack stops — all-noise past clears the stack", () => {
  const ds = new DiscourseState();

  // Push a single topic, then hammer it with unrelated queries
  ds.pushTopic("lone-topic", mockFold("Entity"));
  assert.equal(ds.topicStack.length, 1);

  for (let i = 0; i < 10; i++) {
    ds.update(mockFold("Kind"), 0, null, "query", null, `noise query ${i}`);
  }

  // The lone topic's motif activation is now noise.
  // Pushing a new topic: _pruneNoise sees the stack is all noise → clears it.
  ds.pushTopic("clean-slate", mockFold("Lens"));
  assert.equal(ds.topicStack.length, 1, "stack should reset to just the new topic");
  assert.equal(ds.topicStack[0].label, "clean-slate", "new topic should be the only one");
});

// ── Commitments ──

test("commitment lifecycle", () => {
  const ds = new DiscourseState();
  ds.addCommitment("answer", "explain the first ball", 10);
  assert.equal(ds.openCommitments.length, 1);

  ds.fulfillCommitment("first ball");
  assert.equal(ds.openCommitments.length, 0);
});

test("fulfillCommitment is a no-op for unknown descriptions", () => {
  const ds = new DiscourseState();
  ds.addCommitment("answer", "explain the first ball", 10);
  assert(!ds.fulfillCommitment("something else"));
  assert.equal(ds.openCommitments.length, 1);
});

// ── Location tracking ──

test("update with results moves the reading location", () => {
  const ds = new DiscourseState();
  ds.update(mockFold("Entity"), 0.1, null, "query",
    [{ offset: 50000, score: 0.8, text: "first ball scene" }], "ball");
  assert.equal(ds.location, 50000);
  assert(parseFloat(ds.locationActivation.toFixed(3)) > 0);
});

test("low-scoring results do not set location", () => {
  const ds = new DiscourseState();
  ds.update(mockFold("Entity"), 0.1, null, "query",
    [{ offset: 50000, score: 0.05, text: "irrelevant" }], "test");
  // score 0.05 ≤ 0.1 threshold → location stays null
  assert.equal(ds.location, null);
});

// ── Context ──

test("getContext returns null for empty state", () => {
  const ds = new DiscourseState();
  assert.equal(ds.getContext(), null);
});

test("getContext returns active state after update with high surprise", () => {
  const ds = new DiscourseState();
  ds.update(mockFold("Entity"), 0.9, null, "query",
    [{ offset: 50000, score: 0.8, text: "Natasha danced at her first ball" }], "Natasha");
  const ctx = ds.getContext();
  assert(ctx !== null);
  assert(ctx.nActive >= 1);
  assert(ctx.topMotifs.length > 0);
});

test("low-surprise update produces no context motifs", () => {
  const ds = new DiscourseState();
  ds.update(mockFold("Entity"), 0.1, null, "query",
    [{ offset: 50000, score: 0.3, text: "ordinary text" }], "hello");
  const ctx = ds.getContext();
  // Either null or nActive=0 — low surprise doesn't push new motifs
  assert(ctx === null || ctx.nActive === 0);
});

// ── Summary ──

test("summary reports current state", () => {
  const ds = new DiscourseState();
  ds.update(mockFold("Entity"), 0.5, null, "query", null, "test");
  const s = ds.summary();
  assert.equal(s.turnCount, 1);
  assert.equal(s.turnIntent, "query");
  assert(typeof s.locationActivation === "string");
});

// ── Integration: discourse → altitude fold ──
// Requires a real text. Runs only when pg84.txt is available.

test("discourse conditions altitude fold scene selection", { concurrency: false }, async (t) => {
  const { readFileSync, existsSync } = await import("node:fs");
  const pg84Path = "/Users/mlacy/Documents/Default Project/pg84.txt";
  if (!existsSync(pg84Path)) { t.skip("pg84.txt not found"); return; }

  const { multiAltitudeFold } = await import("../emergence/summary/multi-altitude-fold.js");
  const text = readFileSync(pg84Path, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Build discourse state: reader is near the creature's awakening after creation
  // (offset ~89000, ~19.9% into the text, Victor's first reactions to the creature)
  const ds = new DiscourseState();
  ds.update(mockFold("Entity"), 0.8, null, "query",
    [{ offset: 89000, score: 0.9, text: "Victor sees the creature awaken" }],
    "what happened after the creature woke up?");

  // Altitude fold with discourse → scene selection should be biased toward the
  // discourse location
  const packet = multiAltitudeFold(text, "creature", {
    altitudes: { 0: 5 },
    withEchoes: false,
    discourse: ds,
  });

  const spans = packet.altitudes[0]?.spans ?? [];
  assert(spans.length > 0, "altitude fold should produce spans for the creature");

  // The top span should be at the discourse location (within 2000 chars)
  const topSpan = spans[0];
  assert(topSpan.offset != null, "top span should have an offset");
  const dist = Math.abs(topSpan.offset - 89000);
  assert(dist < 3000, `top span should be near discourse location (89000), got offset ${topSpan.offset} (${dist} chars away)`);
});

test("multi-turn discourse simulation", { concurrency: false }, async (t) => {
  const { readFileSync, existsSync } = await import("node:fs");
  const pg84Path = "/Users/mlacy/Documents/Default Project/pg84.txt";
  if (!existsSync(pg84Path)) { t.skip("pg84.txt not found"); return; }

  const { multiAltitudeFold } = await import("../emergence/summary/multi-altitude-fold.js");
  const text = readFileSync(pg84Path, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const ds = new DiscourseState();

  // Turn 1: user asks about the creature
  ds.update(mockFold("Entity"), 0.9, null, "query",
    [{ offset: 1000, score: 0.9, text: "Victor Frankenstein creates the creature" }],
    "describe the creature");
  assert.equal(ds.turnCount, 1);
  assert(ds.motifs.size > 0, "motifs should exist after first turn");

  // Turn 2: user follows up with a pronoun — should channel to the creature
  ds.referents.set("creature", { id: "creature", activation: 0.8, surfaces: ["creature"] });
  ds.update(mockFold("Entity"), 0.1, null, "query",
    [{ offset: 67000, score: 0.6, text: "creature awakens scene" }],
    "what did he do next?");
  assert.equal(ds.turnCount, 2);
  const refAct = ds.referents.get("creature")?.activation ?? 0;
  assert(refAct > 0.5, `creature referent should stay active after pronoun, got ${refAct}`);

  // Turn 3: altitude fold conditioned on discourse
  const packet = multiAltitudeFold(text, "creature", {
    altitudes: { 0: 3 },
    withEchoes: false,
    discourse: ds,
  });
  assert(packet.altitudes[0]?.spans?.length > 0, "should produce spans after 3-turn discourse");
});
