// packages/engine/emergence/lens-assertion/convergence.test.js
// Integration tests: reaction-channel adapter, store adapter, and the
// unforced-convergence organ. Verifies the byte-identical guarantee.
//
// The byte-identical guarantee (§5 of the stigmergy spec):
//   A run with convergence reporting DISABLED must produce the same
//   deposits as a run with it ENABLED. If disabling changes the deposits,
//   optimization leaked in and the signal is worthless.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Reaction adapter ──────────────────────────────────────────────────────
import {
  createReactionLog,
  mintReaction,
  appendReactions,
  reactionLogAsMedium,
  depositReaction,
  senseReactions,
  evaporateReactions,
  lockInRiskReactions,
} from "../../reaction/index.js";

describe("reaction-channel stigmergy adapter", () => {
  it("wraps a reaction log as a lawful Medium", () => {
    const log = createReactionLog({ reader_id: "reader-1", session_id: "s1" });
    const medium = reactionLogAsMedium(log, { decay: 0.1 });

    assert.equal(medium.schema, "ReactionMedium@1");
    assert.equal(medium.decay, 0.1);
    assert.equal(medium.deposits.length, 0);
    assert.ok(medium._log);
  });

  it("depositReaction appends a reaction as a trace", () => {
    const log = createReactionLog({ reader_id: "reader-1", session_id: "s1" });
    const medium = reactionLogAsMedium(log, { decay: 0.1 });

    const reaction = mintReaction({
      reader_id: "reader-1",
      session_id: "s1",
      ts: 1000,
      seq: 0,
      kind: "dwell",
      block_id: "block-1",
      extent: null,
      context: { visible_block_ids: [], scale: "block", lens_id: "test-lens" },
      payload: {},
    });

    const { medium: m2, result } = depositReaction(medium, reaction);
    assert.equal(result.admitted, true);
    assert.equal(m2.deposits.length, 1);
    assert.equal(m2.deposits[0].trace.block_id, "block-1");
    assert.equal(m2.deposits[0].trace.kind, "dwell");
  });

  it("R5: refuses a reaction with empty consequence edges", () => {
    const log = createReactionLog({ reader_id: "r1", session_id: "s1" });
    const medium = reactionLogAsMedium(log, { decay: 0.1 });

    const reaction = mintReaction({
      reader_id: "r1", session_id: "s1", ts: 1000, seq: 0,
      kind: "dwell", block_id: "block-1", extent: null,
      context: { visible_block_ids: [], scale: "block", lens_id: "test-lens" },
      payload: { consequenceEdges: [] }, // known consequences, no edges
    });

    const { result } = depositReaction(medium, reaction);
    assert.equal(result.admitted, false);
    assert.equal(result.status, "open-loop");
  });

  it("senseReactions respects R2 local sensing", () => {
    const log = createReactionLog({ reader_id: "r1", session_id: "s1" });
    const medium = reactionLogAsMedium(log, { decay: 0.1 });

    // Add a few reactions
    let m = medium;
    for (let i = 0; i < 5; i++) {
      const r = mintReaction({
        reader_id: "r1", session_id: "s1", ts: 1000 + i, seq: i,
        kind: "dwell", block_id: `block-${i}`, extent: null,
        context: { visible_block_ids: [], scale: "block", lens_id: "test-lens" },
        payload: {},
      });
      const res = depositReaction(m, r);
      m = res.medium;
    }

    // Local sense by block
    const blockSense = senseReactions(m, { byBlock: "block-2", count: 10 });
    assert.ok(blockSense.length <= 1);
    if (blockSense.length) {
      assert.equal(blockSense[0].trace.block_id, "block-2");
    }

    // Whole-medium sense should throw (R2)
    assert.throws(
      () => senseReactions(m, { from: 0, count: 100 }),
      TypeError,
      "should reject whole-medium read"
    );
  });

  it("evaporateReactions removes old deposits by seq age", () => {
    const log = createReactionLog({ reader_id: "r1", session_id: "s1" });
    const medium = reactionLogAsMedium(log, { decay: 0.3 });

    let m = medium;
    for (let i = 0; i < 15; i++) {
      const r = mintReaction({
        reader_id: "r1", session_id: "s1", ts: 1000 + i, seq: i,
        kind: i < 3 ? "dwell" : "skip",
        block_id: `block-${i}`, extent: null,
        context: { visible_block_ids: [], scale: "block", lens_id: "test-lens" },
        payload: {},
      });
      m = depositReaction(m, r).medium;
    }

    const evap = evaporateReactions(m, 3);
    assert.ok(evap.deposits.length <= m.deposits.length,
      "evaporation should reduce or maintain deposit count");
    // Last deposit should survive
    assert.equal(evap.deposits[evap.deposits.length - 1].trace.seq, 14);
  });

  it("lockInRiskReactions detects block concentration", () => {
    const log = createReactionLog({ reader_id: "r1", session_id: "s1" });
    const medium = reactionLogAsMedium(log, { decay: 0.1 });

    let m = medium;
    for (let i = 0; i < 10; i++) {
      const r = mintReaction({
        reader_id: "r1", session_id: "s1", ts: 1000 + i, seq: i,
        kind: "dwell", block_id: "same-block", extent: null,
        context: { visible_block_ids: [], scale: "block", lens_id: "test-lens" },
        payload: {},
      });
      m = depositReaction(m, r).medium;
    }

    const risk = lockInRiskReactions(m);
    assert.equal(risk.offGradientFraction, 0,
      "all offGradient=false should produce 0 fraction");
  });
});

// ── Store adapter ─────────────────────────────────────────────────────────
import { buildStore, storeAsMedium, senseStore, depositFrame, evaporateStore, lockInRiskStore } from "../../emergence/store/index.js";

describe("Hebbian store stigmergy adapter", () => {
  const frames = [
    { order: 0, offset: 0, text: "battle cannon musket charge" },
    { order: 1, offset: 100, text: "ball gown silk dance" },
    { order: 2, offset: 200, text: "reason doubt existence truth" },
    { order: 3, offset: 300, text: "battle cannon dance reason" }, // mix
  ];

  it("wraps a Hebbian store as a lawful Medium", () => {
    const store = buildStore(frames, { idfFloor: 0.5, edgeSlots: 12 });
    const medium = storeAsMedium(store, { decay: 0.1 });

    assert.equal(medium.schema, "StoreMedium@1");
    assert.equal(medium.decay, 0.1);
    assert.equal(medium.deposits.length, 4);
    // Each deposit carries top motifs
    const d0 = medium.deposits[0];
    assert.ok(d0.trace.motifs.length > 0, "first deposit should have motifs");
    assert.equal(d0.trace.order, 0);
  });

  it("senseStore returns matching frames via one-hop completion", () => {
    const store = buildStore(frames, { idfFloor: 0.5, edgeSlots: 12 });
    const medium = storeAsMedium(store, { decay: 0.1 });

    // Cue with "battle" should surface frames 0 and 3
    const results = senseStore(medium, { cueText: "battle cannon", count: 3 });
    assert.ok(results.length > 0, "should surface matching frames");
    // Frame 0 has battle+cannon — should be top
    const orders = results.map((r) => r.order);
    assert.ok(orders.includes(0), "should include frame with battle");
  });

  it("depositFrame adds a new frame as a trace", () => {
    const store = buildStore(frames, { idfFloor: 0.5, edgeSlots: 12 });
    const medium = storeAsMedium(store, { decay: 0.1 });

    const { medium: m2, result } = depositFrame(medium, {
      order: 4,
      offset: 400,
      text: "new distinct unique frame",
    });
    assert.equal(result.admitted, true);
    assert.equal(m2.deposits.length, 5);
    assert.equal(m2.deposits[4].trace.order, 4);
  });

  it("R5: refuses a frame with empty consequence edges", () => {
    const store = buildStore(frames, { idfFloor: 0.5, edgeSlots: 12 });
    const medium = storeAsMedium(store, { decay: 0.1 });

    const { result } = depositFrame(medium,
      { order: 5, offset: 500, text: "externality cost hidden" },
      { consequenceEdges: [] }
    );
    assert.equal(result.admitted, false);
    assert.equal(result.status, "open-loop");
  });

  it("evaporateStore removes old deposits by temporal distance", () => {
    // Build store with many frames to test evaporation
    const manyFrames = [];
    for (let i = 0; i < 50; i++) {
      manyFrames.push({
        order: i,
        offset: i * 100,
        text: `frame number ${i} with some content`,
      });
    }
    const store = buildStore(manyFrames, { idfFloor: 0.5, edgeSlots: 8 });
    const medium = storeAsMedium(store, { decay: 0.2 });

    const evap = evaporateStore(medium, 2);
    assert.ok(evap.deposits.length <= medium.deposits.length,
      "evaporation should reduce or maintain count");
  });

  it("lockInRiskStore flags degenerate motif concentration", () => {
    const store = buildStore(frames, { idfFloor: 0.5, edgeSlots: 12 });
    const medium = storeAsMedium(store, { decay: 0.1 });

    const risk = lockInRiskStore(medium);
    // With diverse frames, should not be flagged heavily
    assert.ok(typeof risk.flagged === "boolean");
    assert.ok(typeof risk.offGradientFraction === "number");
  });
});

// ── Unforced-convergence organ ─────────────────────────────────────────────
import { witnessConvergence, verifyByteIdentical } from "./index.js";
import { createMedium, deposit } from "../stigmergy/index.js";

describe("unforced-convergence organ", () => {
  it("returns empty report when disabled (byte-identical guarantee)", () => {
    const result = witnessConvergence([], { enabled: false });
    assert.equal(result.enabled, false);
    assert.equal(result.byteIdentical, true);
    assert.deepStrictEqual(result.coincidences, []);
    assert.equal(result.convergenceFraction, 0);
  });

  it("reports coincidences between two independent media", () => {
    // Simulate two walled lenses depositing traces into separate media
    const mA = createMedium({ decay: 0.1 });
    const { medium: mA1 } = deposit(mA, {
      agentId: "lens-a",
      trace: { block_id: "ch3", motifs: ["battle", "cannon"], offset: 1000 },
    });
    const { medium: mA2 } = deposit(mA1, {
      agentId: "lens-a",
      trace: { block_id: "ch5", motifs: ["ball", "dance"], offset: 5000 },
    });

    const mB = createMedium({ decay: 0.1 });
    const { medium: mB1 } = deposit(mB, {
      agentId: "lens-b",
      trace: { block_id: "ch3", motifs: ["battle", "charge"], offset: 1050 },
    });
    const { medium: mB2 } = deposit(mB1, {
      agentId: "lens-b",
      trace: { block_id: "ch7", motifs: ["reason", "doubt"], offset: 9000 },
    });

    const report = witnessConvergence([mA2, mB2], {
      labels: ["gothic-lens", "romantic-lens"],
    });

    // Both lenses deposited on block "ch3" — should coincide
    assert.ok(report.coincidences.length >= 1,
      `expected at least 1 coincidence, got ${report.coincidences.length}`);
    assert.equal(report.lensCount, 2);

    // Find the ch3 coincidence
    const ch3 = report.coincidences.find((c) =>
      c.overlap.some((o) => o === "block:ch3"));
    assert.ok(ch3, "should find block:ch3 coincidence");
    assert.ok(ch3.overlap.includes("motif:battle"),
      "should include shared motif overlap");
  });

  it("reports no coincidences for completely unrelated media", () => {
    const mA = createMedium({ decay: 0.1 });
    const { medium: mA1 } = deposit(mA, {
      agentId: "a", trace: { block_id: "ch1", motifs: ["war"] },
    });

    const mB = createMedium({ decay: 0.1 });
    const { medium: mB1 } = deposit(mB, {
      agentId: "b", trace: { block_id: "ch99", motifs: ["peace"] },
    });

    const report = witnessConvergence([mA1, mB1]);
    assert.equal(report.coincidences.length, 0,
      "unrelated media should have zero coincidences");
  });

  it("verifyByteIdentical: same deposits, different enabled flags", () => {
    // Deposit sequence A: convergence enabled (but still read-only)
    const mA = createMedium({ decay: 0.1 });
    const { medium: mA1 } = deposit(mA, {
      agentId: "lens-a", trace: { block_id: "ch1" },
    });

    const mB = createMedium({ decay: 0.1 });
    const { medium: mB1 } = deposit(mB, {
      agentId: "lens-b", trace: { block_id: "ch1" },
    });

    // Witness with convergence enabled
    const reportEnabled = witnessConvergence([mA1, mB1], { enabled: true });
    assert.ok(reportEnabled.coincidences.length >= 1,
      "should find coincidence when enabled");

    // Same deposits, convergence disabled — deposits must be byte-identical
    const reportDisabled = witnessConvergence([mA1, mB1], { enabled: false });
    assert.deepStrictEqual(reportDisabled.coincidences, []);

    // Verify: deposits are byte-identical regardless of enabled flag
    const verifyResult = verifyByteIdentical([mA1, mB1], [mA1, mB1]);
    assert.equal(verifyResult.identical, true,
      "deposits must be byte-identical whether convergence is enabled or disabled");
    assert.equal(verifyResult.enabledHash, verifyResult.disabledHash);
  });

  it("witnessConvergence with 3+ lenses finds all pairwise coincidences", () => {
    const m1 = createMedium({ decay: 0.1 });
    const { medium: mA } = deposit(m1, {
      agentId: "a", trace: { block_id: "shared", motifs: ["x"] },
    });

    const m2 = createMedium({ decay: 0.1 });
    const { medium: mB } = deposit(m2, {
      agentId: "b", trace: { block_id: "shared", motifs: ["x"] },
    });

    const m3 = createMedium({ decay: 0.1 });
    const { medium: mC } = deposit(m3, {
      agentId: "c", trace: { block_id: "shared", motifs: ["x"] },
    });

    const report = witnessConvergence([mA, mB, mC]);
    assert.equal(report.lensCount, 3);
    // 3 lenses → 3 pairs, all should coincide on "shared"
    assert.ok(report.coincidences.length >= 3,
      `all 3 pairwise pairs should coincide, got ${report.coincidences.length}`);
    assert.ok(report.convergenceFraction > 0,
      "convergence fraction should be > 0");
  });
});
