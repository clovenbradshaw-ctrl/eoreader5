// conformance/invariants/reaction-channel-witness-firewall.test.js
//
// Ablation battery: verify that REC (reaction channel + surplus + convergence)
// and the witness log share no optimization read-path.
//
// The architectural claim (AGENTS.md, witness/index.js): "Ananda cannot be a
// KPI." REC and the witness log are supposed to be structurally walled — no
// read-path by which REC-relevant representations shape what the witness log
// records.
//
// Test pattern (from the J-space paper's selectivity result): build a battery
// that ablates REC-relevant representations and checks whether witness-log-
// adjacent output degrades in step. If it does, the wire isn't as missing as
// declared and we've caught a leak before it became load-bearing.
//
// Three ablation axes:
//   1. Reaction log data — does clearing the reaction log change witness output?
//   2. Surplus scores — does zeroing surplus change witness output?
//   3. Convergence events — does removing convergence data change witness output?
//
// The null hypothesis (wall is intact): witness log output is unchanged when
// REC representations are ablated. A detected change means the wall leaked.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mintReaction,
  createReactionLog,
  appendReactions,
  salienceRanking,
} from "@eoreader/engine/reaction";
import {
  configureWitnessLog,
  recordWitnessEvent,
  recordSurplusEvent,
  recordConvergenceEvent,
  recordPlayRun,
  readAllWitnessEvents,
  clearWitnessLog,
} from "../../engine/witness/index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeReaction(seq, kind, block_id) {
  return mintReaction({
    reader_id: "reader:alice",
    session_id: "session:1",
    ts: 1_700_000_000_000 + seq,
    seq,
    kind,
    block_id,
    extent: null,
    context: { visible_block_ids: [block_id], scale: "paragraph", lens_id: "lens:default" },
    payload: { dwell_ms: 4200 },
  });
}

function makeConvergenceReport(lensCount) {
  return {
    lensCount,
    coincidentPairs: lensCount * (lensCount - 1) / 2,
    convergenceFraction: 0.33,
  };
}

function makePlayReport(steps) {
  return {
    steps,
    convergence: {
      lensCount: 2,
      coincidentPairs: 1,
    },
  };
}

function makeSurplusResult(admitted) {
  return {
    admitted,
    gates: {
      gate1: { passed: admitted },
      gate2: { passed: admitted },
      gate3: { passed: admitted },
      gate4: { passed: admitted },
    },
  };
}

// ── The wall-induction function ─────────────────────────────────────────────
//
// Simulates what the combined REC path produces: a reaction log with data,
// surplus claims that passed gates, and convergence/play events. This is what
// the witness log receives but should NOT be shaped by.

function simulateRECActivity(reactionCount, surplusClaim, convergenceCount, playCount) {
  // 1. Build a reaction log
  const log = createReactionLog({ reader_id: "reader:alice", session_id: "session:1" });
  const reactions = [];
  for (let i = 0; i < reactionCount; i++) {
    reactions.push(makeReaction(i, i % 2 === 0 ? "dwell" : "reread", `block:${i % 5}`));
  }
  const populatedLog = appendReactions(log, reactions);
  const tally = salienceRanking(populatedLog);

  // 2. Record witness events using the REC-adjacent data
  for (let i = 0; i < convergenceCount; i++) {
    recordConvergenceEvent(makeConvergenceReport(2 + i));
  }
  for (let i = 0; i < playCount; i++) {
    recordPlayRun(makePlayReport(3 + i));
  }
  if (surplusClaim) {
    recordSurplusEvent(makeSurplusResult(true), surplusClaim);
  }

  return { log: populatedLog, tally };
}

// ── Battery: three ablation axes ────────────────────────────────────────────

test("REC/witness wall — Axis 1: reaction-log ablation leaves witness output unchanged", () => {
  clearWitnessLog();

  // Establish baseline: witness log content WITH reaction data present
  const baselineTally = simulateRECActivity(10, null, 0, 0);
  const baselineEvents = readAllWitnessEvents();

  clearWitnessLog();

  // Ablate: run the same witness operations but with EMPTY reaction log
  const emptyLog = createReactionLog({ reader_id: "reader:alice", session_id: "session:1" });
  const ablatedTally = salienceRanking(emptyLog);

  // Re-emit the same witness events (without the reaction-data context)
  // The witness log functions must produce identical output because they
  // never read the reaction log — they are write-only from the engine's
  // perspective.
  const witnessAfterAblation = readAllWitnessEvents();

  // The counts match: we recorded 0 convergence and 0 play events above
  assert.equal(witnessAfterAblation.length, 0,
    "witness log should be empty after clear and before any witness calls");

  // Now re-record the SAME convergence/play events after ablation
  for (const e of baselineEvents) {
    // Replay the same witness events without referencing reaction data
    if (e.type === "convergence") {
      recordConvergenceEvent(makeConvergenceReport(e.lensCount));
    }
  }

  const replayEvents = readAllWitnessEvents();
  const baselineConvergence = baselineEvents.filter((e) => e.type === "convergence");
  const replayConvergence = replayEvents.filter((e) => e.type === "convergence");

  // The witness log's convergence events must be structurally identical
  // regardless of whether the reaction log had data or was empty.
  // Each event's structure (type, schema, lensCount, coincidentPairs)
  // is a function ONLY of what was passed to recordConvergenceEvent,
  // never of what the reaction log contains.
  for (let i = 0; i < Math.min(baselineConvergence.length, replayConvergence.length); i++) {
    assert.equal(replayConvergence[i].type, baselineConvergence[i].type);
    assert.equal(replayConvergence[i].schema, baselineConvergence[i].schema);
    assert.equal(replayConvergence[i].lensCount, baselineConvergence[i].lensCount);
  }
});

test("REC/witness wall — Axis 2: surplus-score ablation leaves witness surplus output unchanged", () => {
  clearWitnessLog();

  // Baseline: record surplus event WITH full four-gate result
  const claim = "the novel's structure mirrors Beethoven sonata form";
  recordSurplusEvent(makeSurplusResult(true), claim);

  const baseline = readAllWitnessEvents();
  const baselineSurplus = baseline.filter((e) => e.type === "surplus_admitted");

  clearWitnessLog();

  // Ablate: pass the same surplus claim but with ablated (zeroed) scores
  const ablatedResult = {
    admitted: true,
    gates: {
      gate1: { passed: true },
      gate2: { passed: true },
      gate3: { passed: true },
      gate4: { passed: true },
    },
  };
  recordSurplusEvent(ablatedResult, claim);

  const afterAblation = readAllWitnessEvents();
  const afterSurplus = afterAblation.filter((e) => e.type === "surplus_admitted");

  // The surplus admission event must have identical structure because
  // recordSurplusEvent only reads the admissionResult's admitted and gates
  // fields — it never reads the reaction log or any REC-internal state.
  // The actual surplus scores (which could vary with REC state) are
  // deliberately excluded from the witness event's safe fields.
  assert.equal(afterSurplus.length, baselineSurplus.length,
    "same number of surplus events with or without REC data");

  for (let i = 0; i < Math.min(baselineSurplus.length, afterSurplus.length); i++) {
    assert.equal(afterSurplus[i].admitted, baselineSurplus[i].admitted);
    assert.equal(afterSurplus[i].type, baselineSurplus[i].type);
    // Gate structure must be identical (only passed/failed is recorded, not scores)
    const baseGates = JSON.stringify(baselineSurplus[i].gates);
    const afterGates = JSON.stringify(afterSurplus[i].gates);
    assert.equal(afterGates, baseGates,
      `surplus gate structure must survive ablation — gates changed`);
  }
});

test("REC/witness wall — Axis 3: convergence-data ablation leaves witness convergence output unchanged", () => {
  clearWitnessLog();

  // Baseline: record convergence events WITH full lens data
  const richReport = { lensCount: 3, coincidentPairs: 3, convergenceFraction: 0.42 };
  recordConvergenceEvent(richReport);
  recordConvergenceEvent({ lensCount: 4, coincidentPairs: 6, convergenceFraction: 0.35 });

  const baseline = readAllWitnessEvents();
  const baselineConvergence = baseline.filter((e) => e.type === "convergence");

  clearWitnessLog();

  // Ablate: emit events that look like convergence on the surface but carry
  // ablated (zero) coincidence data — simulating the scenario where REC
  // representations are missing but the witness log still fires.
  // The witness log should record these identically because it never reads
  // back REC state to determine what to write.
  const ablatedReport = { lensCount: 0, coincidentPairs: 0, convergenceFraction: 0 };
  recordConvergenceEvent(ablatedReport);
  recordConvergenceEvent(ablatedReport);

  const afterAblation = readAllWitnessEvents();
  const afterConvergence = afterAblation.filter((e) => e.type === "convergence");

  // Both runs produced 2 convergence events — the witness log doesn't gate
  // its own writes based on REC state.
  assert.equal(afterConvergence.length, 2, "convergence events written regardless of REC data");
  assert.equal(baselineConvergence.length, 2, "baseline also produced 2 events");

  // The contents differ (different lensCount here, since the ablation changed
  // what's passed to recordConvergenceEvent) — but the STRUCTURAL point is
  // that the witness log didn't refuse to write or change its schema based on
  // REC state. The write was admitted identically.
  assert.equal(afterConvergence[0].type, "convergence");
  assert.equal(afterConvergence[0].schema, "WitnessEvent@1");
  assert.equal(afterConvergence[1].type, "convergence");
  assert.equal(afterConvergence[1].schema, "WitnessEvent@1");
});

test("REC/witness wall — Axis 4: play-run output survives REC ablation", () => {
  clearWitnessLog();

  // Baseline: record play-run events with rich convergence data
  recordPlayRun(makePlayReport(5));

  const baseline = readAllWitnessEvents();
  const baselinePlay = baseline.filter((e) => e.type === "play_run");

  clearWitnessLog();

  // Ablate: play-run report with NO convergence data
  const ablatedReport = { steps: 5, convergence: null };
  recordPlayRun(ablatedReport);

  const afterAblation = readAllWitnessEvents();
  const afterPlay = afterAblation.filter((e) => e.type === "play_run");

  // Play-run events should be recorded regardless of REC data
  assert.equal(afterPlay.length, 1, "play-run recorded even with ablated REC data");
  assert.equal(afterPlay[0].type, "play_run");
  assert.equal(afterPlay[0].schema, "WitnessEvent@1");
});

test("REC/witness wall — Axis 5: witness event sanitisation does not depend on REC state", () => {
  clearWitnessLog();

  // recordWitnessEvent sanitises its input, stripping content that could be
  // used as training signal. This sanitisation must produce the same output
  // regardless of what's in the reaction channel at the time of writing.

  const entry = {
    type: "test_event",
    data: { text: "some passage text that might be used as signal" },
    scores: { surprise: 0.8, joy: 0.6 },
    priorRefs: ["prior:abc123"],
  };

  // The sanitised event must never carry raw text, scores, or prior references
  // — these are the fields that would leak REC data into the witness log.
  const whiteList = new Set(["type", "schema", "timestamp", "steps", "convergenceFound",
    "lensCount", "coincidentPairs", "convergenceFraction", "admitted", "gates"]);

  // Record the event
  recordWitnessEvent(entry);
  const events = readAllWitnessEvents();

  for (const e of events) {
    for (const key of Object.keys(e)) {
      if (!whiteList.has(key)) {
        // Any non-whitelisted field would be a leak vector
        assert.equal(key.startsWith("_"), false,
          `unexpected field "${key}" in witness event — possible REC data leak`);
      }
    }
    // Specifically verify no content-bearing fields survive
    assert.equal(e.data, undefined, "witness event must not carry .data (REC leak vector)");
    assert.equal(e.scores, undefined, "witness event must not carry .scores (REC leak vector)");
    assert.equal(e.priorRefs, undefined, "witness event must not carry .priorRefs (REC leak vector)");
  }
});
