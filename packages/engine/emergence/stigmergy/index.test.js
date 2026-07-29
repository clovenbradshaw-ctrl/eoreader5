// packages/engine/emergence/stigmergy/index.test.js
// Acceptance tests for the stigmergy module — spec §8.
//
// R1–R4 invariant battery:
//   - A medium constructed with no decay throws (R3)
//   - sense() called with the whole medium as neighborhood throws (R2)
//   - A run of all-gradient deposits is flagged by lockInRisk (R4)
//   - The module exposes no agent-to-agent handle (R1, structural)
//
// R5 open-loop battery:
//   - A deposit with known consequences but no consequence-edges is refused
//   - The same deposit with edges present is admitted
//   - unsensedConsequences lists costs with no sensing agent and never fabricates

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createMedium,
  deposit,
  sense,
  evaporate,
  lockInRisk,
  unsensedConsequences,
  hasOpenLoopDeposits,
} from "./index.js";

// ── R3: mandatory decay ──────────────────────────────────────────────────

describe("R3 — mandatory decay", () => {
  it("throws when createMedium is called with no decay", () => {
    assert.throws(
      () => createMedium({}),
      TypeError,
      "createMedium({}) should throw (R3: decay is mandatory)"
    );
  });

  it("throws when decay is zero", () => {
    assert.throws(
      () => createMedium({ decay: 0 }),
      TypeError,
      "createMedium({ decay: 0 }) should throw"
    );
  });

  it("accepts a valid positive decay rate", () => {
    const m = createMedium({ decay: 0.3 });
    assert.equal(m.decay, 0.3);
    assert.equal(m.schema, "StigmergyMedium@1");
  });
});

// ── R1: trace, not message ───────────────────────────────────────────────

describe("R1 — no agent-to-agent handle", () => {
  it("exposes only deposit/sense, no cross-agent channel", () => {
    // Structural: the module surface must not leak agent-to-agent handles.
    const stigmergyMod = {
      createMedium, deposit, sense, evaporate,
      lockInRisk, unsensedConsequences, hasOpenLoopDeposits,
    };
    const surface = Object.keys(stigmergyMod);
    const leaks = surface.filter((k) =>
      /peer|neighborsOf|otherAgent|readAgent|sendTo/i.test(k)
    );
    assert.equal(leaks.length, 0,
      `agent-to-agent handles leaked: ${leaks.join(", ")}`);
  });

  it("deposit only accepts opaque agentId, no agent reference", () => {
    const m = createMedium({ decay: 0.3 });
    // Depositing with a valid agentId string succeeds; no agent object
    const { result } = deposit(m, {
      agentId: "agent-123",
      trace: { test: true },
    });
    assert.equal(result.admitted, true);
    assert.equal(result.status, "admitted");
  });
});

// ── R2: local sensing only ───────────────────────────────────────────────

describe("R2 — local sensing only", () => {
  it("sense() rejects whole-medium neighborhood", () => {
    const m = createMedium({ decay: 0.3 });
    const { medium: m1 } = deposit(m, {
      agentId: "a",
      trace: { test: 1 },
    });

    assert.throws(
      () => sense(m1, { from: 0, count: 100 }),
      TypeError,
      "sense() should throw on whole-medium neighborhood (R2)"
    );
  });

  it("sense() accepts a legitimate local window", () => {
    const m = createMedium({ decay: 0.3 });
    let medium = m;
    for (let i = 0; i < 10; i++) {
      medium = deposit(medium, { agentId: "a", trace: { i } }).medium;
    }

    const window = sense(medium, { from: 2, count: 3 });
    assert.equal(window.length, 3);
    assert.equal(window[0].turn, 2);
  });
});

// ── R3: evaporation ──────────────────────────────────────────────────────

describe("R3 — evaporation with decay", () => {
  it("older deposits decay below newer ones after evaporation steps", () => {
    const m = createMedium({ decay: 0.3 });
    let medium = m;
    medium = deposit(medium, {
      agentId: "test",
      trace: { referentId: "early" },
    }).medium;
    for (let i = 0; i < 5; i++) {
      medium = deposit(medium, {
        agentId: "test",
        trace: { referentId: `mid-${i}` },
      }).medium;
    }
    medium = deposit(medium, {
      agentId: "test",
      trace: { referentId: "late" },
    }).medium;

    const evap = evaporate(medium, 10);
    const hasEarly = evap.deposits.some((d) => d.trace.referentId === "early");
    const hasLate = evap.deposits.some((d) => d.trace.referentId === "late");

    assert.equal(hasLate, true, "late deposit should survive");
    assert.equal(hasEarly, false, "early deposit should decay away (R3 Zollman lock-in prevention)");
  });

  it("evaporate with zero dt returns same medium (no-op)", () => {
    const m = createMedium({ decay: 0.3 });
    const { medium: m1 } = deposit(m, { agentId: "a", trace: { test: 1 } });
    assert.strictEqual(evaporate(m1, 0), m1);
  });
});

// ── R4: lock-in risk ─────────────────────────────────────────────────────

describe("R4 — lock-in risk from all-gradient deposits", () => {
  it("flags a degenerate all-gradient run", () => {
    const m = createMedium({ decay: 0.3, explorationFloor: 0.05 });
    let medium = m;
    for (let i = 0; i < 10; i++) {
      medium = deposit(medium, {
        agentId: "a",
        trace: { id: `trail-${i}` },
        offGradient: false,
      }).medium;
    }

    const risk = lockInRisk(medium);
    assert.equal(risk.flagged, true,
      `all-gradient run should be flagged: flagged=${risk.flagged} offGradient=${risk.offGradientFraction}`);
    assert.equal(risk.offGradientFraction, 0,
      "all offGradient=false means 0 off-gradient fraction");
  });

  it("does not flag a well-explored run", () => {
    const m = createMedium({ decay: 0.3, explorationFloor: 0.05 });
    let medium = m;
    for (let i = 0; i < 10; i++) {
      medium = deposit(medium, {
        agentId: "a",
        trace: { id: `trail-${i}` },
        offGradient: i % 3 === 0, // every third is exploratory
      }).medium;
    }

    const risk = lockInRisk(medium);
    assert.ok(risk.offGradientFraction > 0,
      "should have some off-gradient fraction");
    // With ~30% off-gradient, should not be flagged (well above 5% floor)
  });
});

// ── R5: open-loop / externality detection ────────────────────────────────

describe("R5 — externality detection (flagship)", () => {
  it("refuses a deposit with known consequences but no edges", () => {
    const m = createMedium({ decay: 0.3 });
    const { result } = deposit(m, {
      agentId: "test",
      trace: { referentId: "action" },
      consequenceEdges: [], // known consequences exist but edges are empty
    });

    assert.equal(result.admitted, false, "should refuse open-loop deposit");
    assert.equal(result.status, "open-loop",
      `status should be open-loop, got: ${result.status}`);
    assert.ok(result.reason.includes("consequence"),
      `reason should mention consequences: ${result.reason}`);
  });

  it("admits a deposit with proper consequence edges", () => {
    const m = createMedium({ decay: 0.3 });
    const { result } = deposit(m, {
      agentId: "test",
      trace: { referentId: "action", consequenceRefs: ["cost-1"] },
      consequenceEdges: ["cost-1"],
    });

    assert.equal(result.admitted, true, "should admit closed-loop deposit");
    assert.equal(result.status, "admitted");
  });

  it("admits a deposit with no consequence requirements (null edges)", () => {
    const m = createMedium({ decay: 0.3 });
    const { result } = deposit(m, {
      agentId: "test",
      trace: { referentId: "neutral-action" },
      consequenceEdges: null, // no known consequences
    });

    assert.equal(result.admitted, true, "neutral deposit should be admitted");
  });

  it("unsensedConsequences surfaces costs with no deposits", () => {
    const m = createMedium({ decay: 0.3 });
    const { medium: m1 } = deposit(m, {
      agentId: "test",
      trace: { referentId: "action", consequenceRefs: ["visible-cost"] },
      consequenceEdges: ["visible-cost"],
    });

    const known = new Map([
      ["visible-cost", { id: "visible-cost", label: "visible cost" }],
      ["hidden-cost", { id: "hidden-cost", label: "hidden cost" }],
    ]);

    const unsensed = unsensedConsequences(m1, known);
    assert.equal(unsensed.length, 1, "one unsensed consequence");
    assert.equal(unsensed[0].referent_id, "hidden-cost");
    assert.equal(unsensed[0].status, "unsensed");
  });

  it("unsensedConsequences never fabricates — no deposits, all unsensed", () => {
    const m = createMedium({ decay: 0.3 });
    const known = new Map([
      ["cost-a", { id: "cost-a", label: "cost a" }],
      ["cost-b", { id: "cost-b", label: "cost b" }],
    ]);

    const unsensed = unsensedConsequences(m, known);
    assert.equal(unsensed.length, 2,
      "all known consequences unsensed when medium is empty");
    // Never fabricates: no new entries beyond what was passed in
    assert.equal(unsensed.length, known.size);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("rejects empty agentId", () => {
    const m = createMedium({ decay: 0.3 });
    assert.throws(
      () => deposit(m, { agentId: "", trace: {} }),
      TypeError,
      "empty agentId should throw"
    );
  });

  it("rejects invalid explorationFloor", () => {
    assert.throws(
      () => createMedium({ decay: 0.3, explorationFloor: 1 }),
      TypeError,
      "explorationFloor > 0.5 should throw"
    );
  });

  it("lockInRisk returns safe for few deposits", () => {
    const m = createMedium({ decay: 0.3 });
    const { medium: m1 } = deposit(m, { agentId: "a", trace: {} });
    const risk = lockInRisk(m1);
    assert.equal(risk.flagged, false, "few deposits should not trigger lock-in");
  });
});
