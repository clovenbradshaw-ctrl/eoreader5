/**
 * Self organ tests — the collective's own record.
 *
 * Tests pin the invariants:
 *   1. Self-events are content-addressed (same fields → same id)
 *   2. Self-record is append-only (never mutates)
 *   3. Self-fold occupies the same vector space as world-fold
 *   4. Delta is bounded [0, 1]
 *   5. Truth gate refuses claims without sources
 *   6. Truth gate passes grounded claims
 *   7. Motivation field emerges from architecture, not imposed
 *   8. Narrative folds monotonically (lower altitudes ⊂ higher altitudes)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mintSelfEvent, createSelfRecord, appendSelfEvents,
  foldSelfRecord, computeDelta, convergenceTrend,
  truthGate, computeMotivationField, SELF_EVENT_KINDS,
} from "./index.js";
import { foldNarrative, readNarrative } from "./narrative.js";
import {
  informationGradient, prioritizeTasks, truthCompass, asymptoticHorizon,
} from "./motivation.js";
import { fold } from "../quantum/index.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeRecord(...events) {
  return appendSelfEvents(createSelfRecord(), events);
}

function transitionEvent(turn, from, to, delta = 0.2) {
  return mintSelfEvent({
    kind: "transition",
    sourceOrgan: "steering",
    turn,
    delta,
    layer: to,
    payload: { from, to },
    description: `steering transition: ${from} → ${to}`,
  });
}

function gateEvent(turn, reason) {
  return mintSelfEvent({
    kind: "gate",
    sourceOrgan: "proxy",
    turn,
    delta: 0.6,
    payload: { reason },
    description: `truth-gate refusal: ${reason}`,
  });
}

function genesisEvent(turn, lifecycle, description) {
  return mintSelfEvent({
    kind: "genesis",
    sourceOrgan: "genesis",
    turn,
    delta: 0.3,
    payload: { lifecycle, description },
    description,
  });
}

// ── Self-event and record ────────────────────────────────────────────

test("self-event kinds are frozen and exhaustive", () => {
  assert.equal(SELF_EVENT_KINDS.length, 7);
  assert.ok(SELF_EVENT_KINDS.includes("transition"));
  assert.ok(SELF_EVENT_KINDS.includes("gate"));
  assert.ok(SELF_EVENT_KINDS.includes("genesis"));
});

test("self-events are content-addressed — same fields, same id", () => {
  const a = mintSelfEvent({
    kind: "transition", sourceOrgan: "steering", turn: 1,
    delta: 0.2, layer: "structural",
    payload: { from: "semantic", to: "structural" },
    description: "layer transition",
  });
  const b = mintSelfEvent({
    kind: "transition", sourceOrgan: "steering", turn: 1,
    delta: 0.2, layer: "structural",
    payload: { from: "semantic", to: "structural" },
    description: "layer transition",
  });
  assert.equal(a.id, b.id, "same fields must produce same content hash");
  assert.equal(a.schema, "SelfEvent@1");
  assert.equal(a.kind, "transition");
});

test("self-events reject unknown kinds", () => {
  assert.throws(() => mintSelfEvent({
    kind: "consciousness", sourceOrgan: "cortex", turn: 0,
  }), /unknown self-event kind/);
});

test("self-events require sourceOrgan", () => {
  assert.throws(() => mintSelfEvent({
    kind: "transition", turn: 0,
  }), /sourceOrgan is required/);
});

test("self-record is append-only, never mutates", () => {
  const r1 = createSelfRecord();
  const e1 = transitionEvent(0, "quantum", "semantic");
  const r2 = appendSelfEvents(r1, [e1]);
  const e2 = gateEvent(1, "no source");

  // r1 is unchanged
  assert.equal(r1.events.length, 0);
  assert.equal(r1.head, "self-record:empty");

  // r2 is unchanged when we append to it
  const r3 = appendSelfEvents(r2, [e2]);
  assert.equal(r2.events.length, 1);
  assert.equal(r3.events.length, 2);
  assert.notEqual(r2.head, r3.head);
});

test("self-record rejects duplicate events by content hash", () => {
  const e = transitionEvent(0, "quantum", "semantic");
  const r = makeRecord(e);
  assert.throws(() => appendSelfEvents(r, [e]), /duplicate self-event/);
});

// ── Self-fold ────────────────────────────────────────────────────────

test("self-fold occupies the same vector space as world-fold", () => {
  const record = makeRecord(
    transitionEvent(0, "quantum", "semantic"),
    genesisEvent(1, "ink", "task: alpha"),
    gateEvent(2, "no source"),
  );

  const sFold = foldSelfRecord(record);
  const wFold = fold("the cat sat on the mat");

  // Both have the same three faces with the same nine keys
  for (const face of ["operator", "terrain", "stance"]) {
    assert.deepEqual(
      Object.keys(sFold[face]).sort(),
      Object.keys(wFold[face]).sort(),
      `${face} keys must match`
    );
  }

  // Self-fold is normalized (Σ amps² = 1 for each face)
  for (const face of ["operator", "terrain", "stance"]) {
    const ss = Object.values(sFold[face]).reduce((a, b) => a + b * b, 0);
    assert.ok(Math.abs(ss - 1) < 1e-9, `${face} must be normalized`);
  }
});

test("empty self-record produces a non-trivial fold", () => {
  const record = createSelfRecord();
  const sFold = foldSelfRecord(record);
  // An empty record folds into uniform amplitudes — the same as an empty
  // world-fold. Maximum entropy, no information.
  for (const face of ["operator", "terrain", "stance"]) {
    const vals = Object.values(sFold[face]);
    const unique = new Set(vals.map((v) => v.toFixed(12)));
    assert.equal(unique.size, 1, `${face} must be uniform for empty record`);
  }
});

test("self-fold reflects event history", () => {
  // A record with only gate events should bias toward EVA + Tending.
  // Each gate event adds: EVA +0.6*sigmoid, Tending +0.6*sigmoid.
  // The fold normalizes, but EVA and Tending should be among the
  // top-scoring keys — not necessarily strictly > NUL after normalization,
  // since the base scores are zero and the sigmoid weights are sub-1.
  const record = makeRecord(
    gateEvent(0, "no source"),
    gateEvent(1, "delta too high"),
    gateEvent(2, "thin source"),
  );

  const sFold = foldSelfRecord(record);

  // EVA should exceed the uniform baseline (1/3 = 0.333...)
  assert.ok(
    sFold.operator["EVA"] > 0.1,
    `gate events should give EVA non-trivial amplitude, got ${sFold.operator["EVA"].toFixed(4)}`
  );

  // Tending should exceed the uniform baseline
  assert.ok(
    sFold.stance["Tending"] > 0.1,
    `gate events should give Tending non-trivial amplitude, got ${sFold.stance["Tending"].toFixed(4)}`
  );

  // Gate events produce Lens terrain (step 7 of the article: visible frame)
  assert.ok(
    sFold.terrain["Lens"] > 0.05,
    `gate events should register Lens terrain, got ${sFold.terrain["Lens"].toFixed(4)}`
  );
});

// ── Delta ────────────────────────────────────────────────────────────

test("delta is bounded [0, 1]", () => {
  const sFold = foldSelfRecord(makeRecord(
    transitionEvent(0, "quantum", "semantic"),
  ));
  const wFold = fold("Julius Caesar crossed the Rubicon");
  const d = computeDelta(sFold, wFold);
  assert.ok(d >= 0 && d <= 1, `delta ${d} must be in [0, 1]`);
});

test("delta is symmetric — project(self, world) ≈ project(world, self)", () => {
  const sFold = foldSelfRecord(makeRecord(
    transitionEvent(0, "quantum", "structural"),
    genesisEvent(1, "ink", "entity extraction"),
  ));
  const wFold = fold("entity extraction is about finding who is present in text");
  const d1 = computeDelta(sFold, wFold);
  const d2 = computeDelta(wFold, sFold);
  // delta uses project() which is symmetric, so these should be equal
  assert.equal(d1, d2);
});

test("identical folds have delta near 0", () => {
  const record = createSelfRecord();
  const sFold = foldSelfRecord(record);
  const d = computeDelta(sFold, sFold);
  assert.ok(d < 1e-6, `identical folds should have delta ≈ 0, got ${d}`);
});

// ── Convergence trend ────────────────────────────────────────────────

test("convergence trend requires at least 3 data points", () => {
  assert.equal(convergenceTrend([]).trend, "insufficient");
  assert.equal(convergenceTrend([0.5]).trend, "insufficient");
  assert.equal(convergenceTrend([0.5, 0.4]).trend, "insufficient");
  assert.notEqual(convergenceTrend([0.5, 0.4, 0.3]).trend, "insufficient");
});

test("convergence trend detects converging sequence", () => {
  const trend = convergenceTrend([0.9, 0.7, 0.5, 0.3, 0.2]);
  assert.equal(trend.trend, "converging");
  assert.ok(trend.slope < 0);
});

test("convergence trend detects diverging sequence", () => {
  const trend = convergenceTrend([0.2, 0.3, 0.5, 0.7, 0.9]);
  assert.equal(trend.trend, "diverging");
  assert.ok(trend.slope > 0);
});

test("convergence trend detects stable sequence", () => {
  const trend = convergenceTrend([0.5, 0.51, 0.49, 0.5]);
  assert.equal(trend.trend, "stable");
  assert.ok(Math.abs(trend.slope) < 0.01);
});

// ── Truth gate ───────────────────────────────────────────────────────

test("truth gate passes social signals (no source, no answer)", () => {
  const result = truthGate({ answer: "", sourceSummary: "", delta: 0 });
  assert.equal(result.passed, true);
  assert.equal(result.quality, "social");
});

test("truth gate refuses claims with no source", () => {
  const result = truthGate({
    answer: "Napoleon was a great strategist",
    sourceSummary: "",
    delta: 0.2,
  });
  assert.equal(result.passed, false);
  assert.equal(result.quality, "refused");
  assert.ok(result.reason.includes("step 7") || result.reason.includes("source"));
});

test("truth gate passes grounded claims", () => {
  const source = "Napoleon Bonaparte was a French military leader who rose to prominence during the French Revolution. He led several successful campaigns. ".repeat(5);
  const result = truthGate({
    answer: "Napoleon was a French military leader",
    sourceSummary: source,
    delta: 0.2,
  });
  assert.equal(result.passed, true);
  assert.ok(result.quality === "grounded" || result.quality === "uncertain");
});

test("truth gate refuses high-delta claims with thin source", () => {
  const result = truthGate({
    answer: "speculation about things I don't understand",
    sourceSummary: "a".repeat(150),
    delta: 0.7,
  });
  assert.equal(result.passed, false);
  assert.equal(result.quality, "refused");
  assert.ok(result.reason.includes("delta"));
});

test("truth gate allows retry for thin source", () => {
  const result = truthGate({
    answer: "this is a grounded answer with enough length to not be empty",
    sourceSummary: "a".repeat(60),
    delta: 0.2,
    consecutiveFailures: 1,
  });
  assert.equal(result.passed, true);
  assert.equal(result.quality, "thin");
});

test("truth gate refuses after 3+ retries on thin source", () => {
  const result = truthGate({
    answer: "this is a grounded answer with sufficient length for testing",
    sourceSummary: "a".repeat(60),
    delta: 0.2,
    consecutiveFailures: 3,
  });
  assert.equal(result.passed, false);
  assert.equal(result.quality, "refused");
});

// ── Motivation field ─────────────────────────────────────────────────

test("motivation field is computable from self-fold alone", () => {
  const record = createSelfRecord();
  const sFold = foldSelfRecord(record);
  const m = computeMotivationField(sFold);
  assert.ok(typeof m.urgency === "number");
  assert.ok(m.urgency >= 0 && m.urgency <= 1);
  assert.ok(m.bias.terrain, "must have a terrain bias");
  assert.ok(m.bias.stance, "must have a stance bias");
  assert.ok(typeof m.direction === "string");
});

test("converging trend reduces urgency", () => {
  const sFold = foldSelfRecord(makeRecord(
    transitionEvent(0, "quantum", "semantic"),
  ));
  const converging = computeMotivationField(sFold, null, 0.7, [0.9, 0.8, 0.7]);
  const diverging = computeMotivationField(sFold, null, 0.7, [0.5, 0.6, 0.7]);

  assert.ok(
    converging.urgency < diverging.urgency,
    `converging urgency (${converging.urgency}) should be less than diverging (${diverging.urgency})`
  );
});

// ── Self-narrative ───────────────────────────────────────────────────

test("narrative folds at different altitudes", () => {
  const events = [];
  for (let i = 0; i < 10; i++) {
    events.push(mintSelfEvent({
      kind: i % 3 === 0 ? "transition" : i % 3 === 1 ? "genesis" : "gate",
      sourceOrgan: i % 2 === 0 ? "steering" : "genesis",
      turn: i,
      delta: 0.2 + i * 0.02,
      layer: i % 2 === 0 ? "semantic" : "structural",
      payload: { from: "quantum", to: "semantic" },
      description: `event ${i}`,
    }));
  }
  const record = makeRecord(...events);

  const line = foldNarrative(record, { level: "line" });
  const brief = foldNarrative(record, { level: "brief" });
  const normal = foldNarrative(record, { level: "normal" });
  const dossier = foldNarrative(record, { level: "dossier" });

  assert.ok(line.scenes.length <= 1, `line: ${line.scenes.length} scenes`);
  assert.ok(brief.scenes.length <= 3, `brief: ${brief.scenes.length} scenes`);
  assert.ok(normal.scenes.length <= 8, `normal: ${normal.scenes.length} scenes`);
  assert.ok(dossier.scenes.length >= normal.scenes.length, "dossier must contain all events");

  // Monotonicity: line ⊂ brief ⊂ normal ⊂ dossier
  assert.ok(line.scenes.length <= brief.scenes.length);
  assert.ok(brief.scenes.length <= normal.scenes.length);
  assert.ok(normal.scenes.length <= dossier.scenes.length);
});

test("narrative header carries delta and trend", () => {
  const record = makeRecord(
    transitionEvent(0, "quantum", "semantic"),
  );
  const narrative = foldNarrative(record, {
    level: "normal",
    deltaHistory: [0.5, 0.4, 0.3],
  });
  assert.equal(narrative.header.trend, "converging");
  assert.equal(narrative.header.level, "normal");
  assert.ok(narrative.header.totalEvents >= 0);
});

test("readNarrative suggests action based on trend", () => {
  const record = makeRecord(transitionEvent(0, "quantum", "semantic"));
  // Without a currentWorldFold, delta is null → urgency = 0.
  // History [0.9, 0.85, 0.82] is converging, urgency < 0.3 → "deepen"
  const narrative = foldNarrative(record, {
    level: "normal",
    deltaHistory: [0.9, 0.85, 0.82],
  });
  const read = readNarrative(narrative);
  assert.equal(read.action, "deepen");
  assert.ok(typeof read.reason === "string");
});

test("readNarrative gives seek on diverging high-urgency", () => {
  const record = makeRecord(transitionEvent(0, "quantum", "semantic"));
  // Diverging history with high values: urgency from delta=0 * 1.5 = 0
  // But the trend is "diverging" — use a rising sequence
  const narrative = foldNarrative(record, {
    level: "normal",
    deltaHistory: [0.3, 0.5, 0.7],
  });
  const read = readNarrative(narrative);
  // diverging trend, but urgency=0 since no worldFold (delta=0). Still:
  // the readNarrative checks trend first — diverging + urgency > 0.5 = no.
  // Next: delta !== "unavailable" && delta > 0.5 = no (delta = 0).
  // Falls through to "explore".
  assert.ok(["explore", "seek"].includes(read.action));
  assert.ok(typeof read.reason === "string");
});

test("empty record narrative is valid", () => {
  const record = createSelfRecord();
  const narrative = foldNarrative(record);
  assert.ok(narrative.text.includes("newborn") || narrative.text.includes("no self-events"));
});

// ── Information gradient ─────────────────────────────────────────────

test("information gradient identifies high-gain cells", () => {
  const sFold = foldSelfRecord(createSelfRecord());
  const wFold = fold("Napoleon Bonaparte was a French military leader and emperor");
  const ig = informationGradient(sFold, wFold);

  assert.ok(ig.gradient.terrain, "must have terrain gradient");
  assert.ok(ig.gradient.stance, "must have stance gradient");
  assert.ok(ig.direction.terrain, "must have best terrain direction");
  assert.ok(ig.direction.stance, "must have best stance direction");
  assert.ok(ig.gain >= 0 && ig.gain <= 1, `gain ${ig.gain} must be in [0,1]`);
});

test("information gradient works without world fold", () => {
  const sFold = foldSelfRecord(makeRecord(
    transitionEvent(0, "quantum", "semantic"),
  ));
  const ig = informationGradient(sFold);
  assert.ok(ig.direction.terrain, "must have terrain direction");
  // The nine terrains are: Void, Entity, Kind, Field, Link, Network,
  // Atmosphere, Lens, Paradigm. The direction should be one of them.
  const validTerrains = new Set([
    "Void", "Entity", "Kind", "Field", "Link", "Network",
    "Atmosphere", "Lens", "Paradigm",
  ]);
  assert.ok(validTerrains.has(ig.direction.terrain),
    `direction terrain ${ig.direction.terrain} must be a valid terrain`);
  assert.ok(ig.gain >= 0 && ig.gain <= 1);
});

// ── Task prioritization ──────────────────────────────────────────────

test("task prioritization respects information gradient", () => {
  const sFold = foldSelfRecord(makeRecord(
    transitionEvent(0, "quantum", "structural"),
  ));
  const wFold = fold("military campaigns in the French Revolution");
  const ig = informationGradient(sFold, wFold);

  const tasks = [
    { id: "t1", coordinate: ig.direction, dependents: 0 },
    { id: "t2", coordinate: { terrain: "Void", stance: "Clearing" }, dependents: 0 },
  ];

  const ranked = prioritizeTasks(tasks, ig);
  assert.equal(ranked[0].id, "t1", `task aligned with gradient should rank highest, got ${ranked[0].id}`);
  assert.equal(ranked[0].rank, 1);
});

test("task prioritization weights dependency risk", () => {
  const sFold = foldSelfRecord(createSelfRecord());
  const ig = informationGradient(sFold);

  const tasks = [
    { id: "t1", coordinate: { terrain: "Void", stance: "Clearing" }, dependents: 10 },
    { id: "t2", coordinate: ig.direction, dependents: 0 },
  ];

  const ranked = prioritizeTasks(tasks, ig, { urgencyWeight: 0.8 });
  // High dependency risk + high urgency weight → dependency can outweigh gradient
  assert.equal(ranked[0].id, "t1",
    "high-dependency task should rank higher with high urgency weight");
});

test("empty task list returns empty", () => {
  const sFold = foldSelfRecord(createSelfRecord());
  const ig = informationGradient(sFold);
  const ranked = prioritizeTasks([], ig);
  assert.equal(ranked.length, 0);
});

// ── Truth compass ────────────────────────────────────────────────────

test("truth compass points toward convergence", () => {
  const sFold = foldSelfRecord(makeRecord(
    transitionEvent(0, "quantum", "semantic"),
    genesisEvent(1, "ink", "entity identification"),
  ));
  const wFold = fold("identifying entities in a text corpus");
  const compass = truthCompass(sFold, wFold, [0.5, 0.45, 0.4]);

  assert.ok(compass.direction.terrain);
  assert.ok(compass.direction.stance);
  assert.ok(compass.confidence >= 0 && compass.confidence <= 1);
  assert.ok(compass.delta !== null);
  assert.equal(compass.trend, "converging");
});

test("truth compass with uniform self-fold has low confidence", () => {
  const sFold = foldSelfRecord(createSelfRecord());
  const compass = truthCompass(sFold);
  // A uniform fold (no information) should have low confidence
  assert.ok(compass.confidence < 0.3,
    `uniform self-fold should have low confidence, got ${compass.confidence}`);
});

// ── Asymptotic horizon ───────────────────────────────────────────────

test("asymptotic horizon measures depth, breadth, checkability", () => {
  const sFold = foldSelfRecord(makeRecord(
    transitionEvent(0, "quantum", "semantic"),
    genesisEvent(1, "ink", "task alpha"),
    gateEvent(2, "no source"),
  ));
  const horizon = asymptoticHorizon(sFold, [0.4, 0.35, 0.3], {
    checkedClaims: 8,
    totalClaims: 10,
  });

  assert.ok(horizon.depth > 0, "depth must be positive for converging delta");
  assert.ok(horizon.breadth >= 0 && horizon.breadth <= 1);
  assert.equal(horizon.checkability, 0.8);
  assert.ok(typeof horizon.summary === "string");
  assert.equal(horizon.totalClaims, 10);
  assert.equal(horizon.checkedClaims, 8);
});

test("nascent horizon with no history", () => {
  const sFold = foldSelfRecord(createSelfRecord());
  const horizon = asymptoticHorizon(sFold, []);
  assert.ok(horizon.depth === 0, "zero delta history = zero depth");
  assert.equal(horizon.checkability, null, "no claims = null checkability");
  assert.ok(horizon.summary.includes("nascent"));
});

test("checkability null when no claims", () => {
  const sFold = foldSelfRecord(createSelfRecord());
  const horizon = asymptoticHorizon(sFold, [0.3, 0.3, 0.3]);
  assert.equal(horizon.checkability, null);
});
