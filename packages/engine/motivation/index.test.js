// motivation/index.test.js — the motivation organ.
//
// Tests the engine's model of reader drives and orientation, derived
// deterministically from observed reaction behaviour. The key invariants:
//
// 1. A reader with only truth-seeking reactions IS a truth-seeker.
// 2. A reader with only completion reactions IS a completion-seeker.
// 3. Neutral (no reactions) → neutral orientation (0.5 on all drives).
// 4. tierDemand is derived from seek_truth — no hand-set threshold.
// 5. Orientation is deterministic: same log → same orientation, byte-identical.
// 6. motivationalBias is a pure function of entry + orientation.
// 7. tierDemandGap fires when reader demands MODEL but entry is ENGINE.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReaderOrientation,
  readerOrientationFromLog,
  motivationalBias,
  tierDemandGap,
  drivesSummary,
} from "./index.js";
import { mintReaction, createReactionLog, appendReactions } from "../reaction/index.js";

const READER = "reader:alice";
const SESSION = "session:1";

function reaction(overrides = {}) {
  return mintReaction({
    reader_id: READER,
    session_id: SESSION,
    ts: 1_700_000_000_000,
    seq: 0,
    kind: "dwell",
    block_id: "block:a",
    extent: null,
    context: { visible_block_ids: ["block:a"], scale: "paragraph", lens_id: "lens:default" },
    payload: {},
    ...overrides,
  });
}

function log(...events) {
  return appendReactions(createReactionLog({ reader_id: READER, session_id: SESSION }), events);
}

// ── Fresh orientation ────────────────────────────────────────────────────────

test("fresh orientation is neutral on all drives", () => {
  const o = createReaderOrientation();
  assert.equal(o.drive.seek_truth, 0.5);
  assert.equal(o.drive.seek_completion, 0.5);
  assert.equal(o.drive.seek_novelty, 0.5);
  assert.equal(o.tierDemand, 0.5);
  assert.equal(o.evidence.total_reactions, 0);
});

test("fresh orientation drive object is frozen", () => {
  const o = createReaderOrientation();
  assert.throws(() => { o.drive.seek_truth = 1.0; }, /read.only|frozen|assign/i);
});

// ── Orientation from log — deterministic, evidence-accumulating ──────────────

test("empty log → neutral orientation", () => {
  const o = readerOrientationFromLog(createReactionLog({ reader_id: READER, session_id: SESSION }));
  assert.equal(o.drive.seek_truth, 0.5);
  assert.equal(o.drive.seek_completion, 0.5);
  assert.equal(o.tierDemand, 0.5);
  assert.equal(o.evidence.total_reactions, 0);
});

test("all truth-seeking reactions → high seek_truth", () => {
  const events = [
    reaction({ seq: 0, kind: "probe" }),
    reaction({ seq: 1, kind: "verify", block_id: "block:b" }),
    reaction({ seq: 2, kind: "demand_witness", block_id: "block:c" }),
    reaction({ seq: 3, kind: "face_gap", block_id: "block:d" }),
  ];
  const o = readerOrientationFromLog(log(...events));
  assert(o.drive.seek_truth > 0.7, `truth-seeking reader should have seek_truth > 0.7, got ${o.drive.seek_truth}`);
  assert(o.drive.seek_completion < 0.5, `truth-seeking reader should have lower completion`);
  assert(o.tierDemand > 0.7, `truth-seeking reader should demand MODEL tier, got ${o.tierDemand}`);
  assert.equal(o.evidence.total_reactions, 4);
  assert.equal(o.evidence.truth_reactions, 4);
});

test("all completion reactions → high seek_completion", () => {
  const events = [
    reaction({ seq: 0, kind: "dwell" }),
    reaction({ seq: 1, kind: "reread", block_id: "block:b" }),
    reaction({ seq: 2, kind: "follow-figure", block_id: "block:c" }),
    reaction({ seq: 3, kind: "decollapse", block_id: "block:d" }),
  ];
  const o = readerOrientationFromLog(log(...events));
  assert(o.drive.seek_completion > 0.7, `completion-seeking reader, got ${o.drive.seek_completion}`);
  assert(o.drive.seek_novelty < 0.5);
});

test("all novelty reactions → high seek_novelty", () => {
  const events = [
    reaction({ seq: 0, kind: "skip" }),
    reaction({ seq: 1, kind: "scrub", block_id: "block:b" }),
    reaction({ seq: 2, kind: "abandon", block_id: "block:c" }),
  ];
  const o = readerOrientationFromLog(log(...events));
  assert(o.drive.seek_novelty > 0.7, `novelty-seeking reader, got ${o.drive.seek_novelty}`);
  // Disengagement dampens completion
  assert(o.drive.seek_completion < 0.4, `disengagement should dampen completion`);
});

test("disengagement dampens completion drive", () => {
  // One dwell + nine abandons = reader is NOT completion-seeking
  const events = [
    reaction({ seq: 0, kind: "dwell" }),
    ...Array.from({ length: 9 }, (_, i) =>
      reaction({ seq: i + 1, kind: "abandon", block_id: `block:x${i}` })),
  ];
  const o = readerOrientationFromLog(log(...events));
  assert(o.drive.seek_completion < 0.35, `heavy disengagement should crush completion, got ${o.drive.seek_completion}`);
});

test("deterministic: same log → same orientation", () => {
  const buildLog = () => log(
    reaction({ seq: 0, kind: "probe" }),
    reaction({ seq: 1, kind: "verify", block_id: "block:b" }),
    reaction({ seq: 2, kind: "dwell", block_id: "block:c" }),
  );
  const a = readerOrientationFromLog(buildLog());
  const b = readerOrientationFromLog(buildLog());
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

test("more evidence → orientation moves further from neutral", () => {
  const few = readerOrientationFromLog(log(reaction({ seq: 0, kind: "probe" })));
  const many = readerOrientationFromLog(log(
    ...Array.from({ length: 50 }, (_, i) => reaction({ seq: i, kind: "probe", block_id: `block:${i}` })),
  ));
  // More evidence should push seek_truth further from 0.5
  const fewDist = Math.abs(few.drive.seek_truth - 0.5);
  const manyDist = Math.abs(many.drive.seek_truth - 0.5);
  assert(manyDist > fewDist, `50 reactions (${manyDist}) should move further from neutral than 1 (${fewDist})`);
});

test("query and span-select are drive-neutral (do not strongly affect any drive)", () => {
  const events = [
    reaction({ seq: 0, kind: "query" }),
    reaction({ seq: 1, kind: "span-select", block_id: "block:b" }),
  ];
  const o = readerOrientationFromLog(log(...events));
  // Only 2 neutral reactions — stays near neutral
  assert(Math.abs(o.drive.seek_truth - 0.5) < 0.15, `neutral reactions should not shift seek_truth much`);
  assert(Math.abs(o.drive.seek_completion - 0.5) < 0.15);
});

// ── motivationalBias ─────────────────────────────────────────────────────────

test("truth-seeker biases toward gaps and MODEL-tier entries", () => {
  const orientation = createReaderOrientation();
  orientation.drive = Object.freeze({ seek_truth: 1.0, seek_completion: 0.0, seek_novelty: 0.0 });
  orientation.tierDemand = 1.0;

  const gap = motivationalBias({ isGap: true }, orientation);
  assert(gap.bias > 0.5, `truth-seeker should bias toward gaps, got ${gap.bias}`);
  assert(gap.reasons.some((r) => r.includes("gaps are interesting")));

  const witness = motivationalBias({ needsWitness: true, tier: "model" }, orientation);
  assert(witness.bias > 0.3, `truth-seeker should bias toward needsWitness`);
});

test("completion-seeker biases toward grounded, provenanced entries", () => {
  const orientation = createReaderOrientation();
  orientation.drive = Object.freeze({ seek_truth: 0.0, seek_completion: 1.0, seek_novelty: 0.0 });

  const grounded = motivationalBias({ grounded: true, provenance: ["source"], tier: "engine" }, orientation);
  assert(grounded.bias > 0.3, `completion-seeker should bias toward grounded passages`);
  assert(grounded.reasons.some((r) => r.includes("grounded passage")));
});

test("novelty-seeker biases toward surprise and new entities", () => {
  const orientation = createReaderOrientation();
  orientation.drive = Object.freeze({ seek_truth: 0.0, seek_completion: 0.0, seek_novelty: 1.0 });

  const surprise = motivationalBias({ surprise: 0.8 }, orientation);
  assert(surprise.bias > 0.3, `novelty-seeker should bias toward surprise`);

  const newEntity = motivationalBias({ isNew: true }, orientation);
  assert(newEntity.bias > 0.3, `novelty-seeker should bias toward new entities`);
});

test("tierDemandGap fires for tier_demand_not_met entries", () => {
  const orientation = createReaderOrientation();
  orientation.drive = Object.freeze({ seek_truth: 1.0, seek_completion: 0.0, seek_novelty: 0.0 });
  orientation.tierDemand = 1.0;

  const tdg = motivationalBias({ tierDemandGap: true }, orientation);
  assert(tdg.bias > 0.5, `tier demand gap should produce high bias for truth-seeker, got ${tdg.bias}`);
});

test("neutral orientation produces no strong biases", () => {
  const orientation = createReaderOrientation();
  const gap = motivationalBias({ isGap: true }, orientation);
  const grounded = motivationalBias({ grounded: true, provenance: ["source"] }, orientation);
  assert(gap.bias < 0.6, `neutral reader should not strongly bias toward gaps`);
  assert(grounded.bias < 0.6, `neutral reader should not strongly bias toward grounded`);
});

// ── tierDemandGap ────────────────────────────────────────────────────────────

test("no gap when tier demand is at or below 0.5", () => {
  const orientation = createReaderOrientation(); // tierDemand = 0.5
  const gap = tierDemandGap({ tier: "engine" }, orientation);
  assert.equal(gap, null);
});

test("gap fires when reader demands MODEL but entry is ENGINE", () => {
  const orientation = createReaderOrientation();
  orientation.tierDemand = 1.0;
  const gap = tierDemandGap({ tier: "engine" }, orientation);
  assert(gap !== null);
  assert.equal(gap.reason, "tier_demand_not_met");
  assert.equal(gap.actionable, true);
});

test("no gap when entry is already at MODEL tier", () => {
  const orientation = createReaderOrientation();
  orientation.tierDemand = 1.0;
  const gap = tierDemandGap({ tier: "model", needsWitness: true }, orientation);
  assert.equal(gap, null);
});

test("severity scales with tierDemand", () => {
  const lo = createReaderOrientation();
  lo.tierDemand = 0.6;
  const hi = createReaderOrientation();
  hi.tierDemand = 1.0;

  const loGap = tierDemandGap({ tier: "engine" }, lo);
  const hiGap = tierDemandGap({ tier: "engine" }, hi);
  assert(hiGap.severity > loGap.severity, `severity should scale with demand: ${loGap.severity} < ${hiGap.severity}`);
});

// ── drivesSummary ────────────────────────────────────────────────────────────

test("drivesSummary names the dominant drive", () => {
  const o = createReaderOrientation();
  o.drive = Object.freeze({ seek_truth: 0.9, seek_completion: 0.2, seek_novelty: 0.3 });
  o.tierDemand = 0.9;
  const s = drivesSummary(o);
  assert(s.includes("truth-seeking"));
  assert(s.includes("0.90"));
});

// ── Invariant: truth-seeking is structural, not a label ──────────────────────

test("INVARIANT: a reader is a truth-seeker ONLY if their reactions show it", () => {
  // A reader who never probes, verifies, demands witnesses, or faces gaps
  // should NOT have high seek_truth, regardless of what they claim.
  const passiveEvents = Array.from({ length: 20 }, (_, i) =>
    reaction({ seq: i, kind: "dwell", block_id: `block:${i}` }));
  const o = readerOrientationFromLog(log(...passiveEvents));
  assert(o.drive.seek_truth < 0.6, `passive reader should not be truth-seeker, got ${o.drive.seek_truth}`);
});

test("INVARIANT: tierDemand equals seek_truth — the drive IS the demand", () => {
  const truthEvents = [
    reaction({ seq: 0, kind: "probe" }),
    reaction({ seq: 1, kind: "demand_witness", block_id: "block:b" }),
    reaction({ seq: 2, kind: "face_gap", block_id: "block:c" }),
  ];
  const o = readerOrientationFromLog(log(...truthEvents));
  assert.equal(o.tierDemand, o.drive.seek_truth,
    "tierDemand must equal seek_truth — the drive IS the architectural demand");
});

test("INVARIANT: orientation derives from observation, not declaration", () => {
  // The engine observes what the reader DOES, not what they SAY.
  // A fresh orientation is neutral regardless of any claimed preference.
  const o = createReaderOrientation();
  assert.equal(o.drive.seek_truth, 0.5); // Not a truth-seeker by default
  assert.equal(o.evidence.total_reactions, 0); // No evidence yet
});
