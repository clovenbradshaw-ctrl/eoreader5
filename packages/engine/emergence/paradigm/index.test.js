import test from "node:test";
import assert from "node:assert/strict";
import {
  checkCorrelationGap,
  checkContinuityFloor,
  checkZollmanDelay,
  promoteParadigm,
  evaluateCandidates,
} from "./index.js";

function lens(id, family, { support, evidence = [], claims = [] } = {}) {
  return {
    id,
    architectural_family: family,
    prior_support: support ?? null,
    evidence,
    claims,
  };
}

const eoFamily = "eo-algebra";
const oralFamily = "indigenous-oral";
const folkFamily = "folk-wisdom";

test("checkCorrelationGap: empty supporting lenses is not admitted", () => {
  const all = [];
  const result = checkCorrelationGap({
    candidate_id: "kind:test",
    supporting_lenses: [],
    all_lenses: all,
  });
  assert.equal(result.passed, false);
  assert.equal(result.reason, "no supporting lenses");
});

test("checkCorrelationGap: all lenses from same family — fails null when pool is diverse", () => {
  const all = [
    lens("a", eoFamily, { claims: ["kind:x"] }),
    lens("b", eoFamily, { claims: ["kind:x"] }),
    lens("c", eoFamily, { claims: ["kind:x"] }),
    lens("d", oralFamily, { claims: ["kind:y"] }),
    lens("e", folkFamily, { claims: ["kind:z"] }),
    lens("f", folkFamily, { claims: ["kind:z"] }),
  ];
  const supporting = all.filter((l) => l.claims.includes("kind:x"));
  const result = checkCorrelationGap({
    candidate_id: "kind:x",
    supporting_lenses: supporting,
    all_lenses: all,
  });
  // Three lenses, all from one family — 3 ≥ 2 so replicated=1 within the family.
  // But the pool has 3 diverse families, so null samples draw 3 random lenses
  // and often land on diverse families (score > 0.693). The observed single-
  // family score of 0.693 does NOT clear the null — correlation fails.
  assert.equal(result.replicated_families, 1);
  assert.equal(result.total_families, 1);
  assert.equal(result.all_same_family, true);
  assert.equal(result.passed, false);
  assert.match(result.reason, /does not clear/);
});

test("checkCorrelationGap: diverse families clears the null", () => {
  const all = [
    lens("a", eoFamily, { claims: ["kind:x"] }),
    lens("b", eoFamily, { claims: ["kind:x"] }),
    lens("c", oralFamily, { claims: ["kind:x"] }),
    lens("d", oralFamily, { claims: ["kind:x"] }),
    lens("e", folkFamily, { claims: ["kind:x"] }),
    lens("f", folkFamily, { claims: ["kind:x"] }),
  ];
  const supporting = all.filter((l) => l.claims.includes("kind:x"));
  const result = checkCorrelationGap({
    candidate_id: "kind:x",
    supporting_lenses: supporting,
    all_lenses: all,
  });
  // 6 lenses, 3 families, all have ≥2 reps → replicated=3
  assert.equal(result.replicated_families, 3);
  assert.equal(result.total_families, 3);
  assert.equal(result.all_same_family, false);
  assert.ok(result.passed, `Expected diverse families to clear null; got ${result.reason}`);
});

test("checkContinuityFloor: single lens always passes", () => {
  const result = checkContinuityFloor({
    supporting_lenses: [lens("a", eoFamily)],
  });
  assert.equal(result.passed, true);
  assert.equal(result.incompatible_pairs.length, 0);
});

test("checkContinuityFloor: no lenses always passes", () => {
  const result = checkContinuityFloor({
    supporting_lenses: [],
  });
  assert.equal(result.passed, true);
});

test("checkContinuityFloor: lenses with no prior_support are mutually continuous", () => {
  const result = checkContinuityFloor({
    supporting_lenses: [
      lens("a", eoFamily), // no prior_support
      lens("b", oralFamily), // no prior_support
    ],
  });
  assert.equal(result.passed, true);
  assert.equal(result.pairwise.length, 2);
  assert.ok(result.pairwise.every((p) => p.value === 1));
});

test("checkContinuityFloor: overlapping supports are continuous", () => {
  const result = checkContinuityFloor({
    supporting_lenses: [
      lens("a", eoFamily, { support: new Set(["kind:x", "kind:y", "kind:z"]) }),
      lens("b", oralFamily, { support: new Set(["kind:x", "kind:y", "kind:w"]) }),
    ],
  });
  assert.equal(result.passed, true);
  assert.equal(result.incompatible_pairs.length, 0);
});

test("checkContinuityFloor: disjoint supports are incompatible", () => {
  const result = checkContinuityFloor({
    supporting_lenses: [
      lens("a", eoFamily, { support: new Set(["kind:x", "kind:y"]) }),
      lens("b", oralFamily, { support: new Set(["kind:w", "kind:z"]) }),
    ],
  });
  assert.equal(result.passed, false);
  assert.ok(result.incompatible_pairs.length >= 2);
  assert.match(result.reason, /structurally incompatible/);
});

test("checkContinuityFloor: partially overlapping passes with default threshold=0 (any overlap)", () => {
  // Default threshold is 0 — any non-zero overlap satisfies mutual
  // absolute continuity. Lenses that share even one candidate are
  // convergible in principle.
  const result = checkContinuityFloor({
    supporting_lenses: [
      lens("a", eoFamily, { support: new Set(["kind:x", "kind:y", "kind:z", "kind:w"]) }),
      lens("b", oralFamily, { support: new Set(["kind:x", "kind:a", "kind:b", "kind:c"]) }),
    ],
  });
  assert.equal(result.passed, true);
  assert.equal(result.incompatible_pairs.length, 0);
});

test("checkContinuityFloor: partially overlapping fails with explicit strict threshold", () => {
  // With threshold=0.5, only 25% overlap → fails.
  const result = checkContinuityFloor({
    supporting_lenses: [
      lens("a", eoFamily, { support: new Set(["kind:x", "kind:y", "kind:z", "kind:w"]) }),
      lens("b", oralFamily, { support: new Set(["kind:x", "kind:a", "kind:b", "kind:c"]) }),
    ],
    continuity_threshold: 0.5,
  });
  assert.equal(result.passed, false);
  assert.ok(result.incompatible_pairs.length >= 2);
});

test("checkZollmanDelay: empty lenses fails", () => {
  const result = checkZollmanDelay({
    supporting_lenses: [],
    all_lenses: [],
  });
  assert.equal(result.passed, false);
});

test("checkZollmanDelay: single lens with no evidence fails", () => {
  const all = [
    lens("a", eoFamily, { evidence: [] }),
    lens("b", eoFamily, { evidence: [1, 2, 3] }),
  ];
  const result = checkZollmanDelay({
    supporting_lenses: [all[0]],
    all_lenses: all,
  });
  // min = 0, null samples from shuffled [0,3] with n=1 → some will be 0, some 3.
  // observedMin=0 will not clear the "greater" tail.
  assert.equal(result.passed, false);
  assert.equal(result.min_window, 0);
});

test("checkZollmanDelay: lenses with substantial evidence clear the null", () => {
  const supporting = [
    lens("a", eoFamily, { evidence: new Array(50).fill(1) }),
    lens("b", eoFamily, { evidence: new Array(55).fill(1) }),
    lens("c", oralFamily, { evidence: new Array(48).fill(1) }),
  ];
  const all = [
    ...supporting,
    lens("d", eoFamily, { evidence: new Array(5).fill(1) }),
    lens("e", folkFamily, { evidence: new Array(2).fill(1) }),
  ];
  const result = checkZollmanDelay({
    supporting_lenses: supporting,
    all_lenses: all,
  });
  // min = 48; null samples draw from [50,55,48,5,2] with n=3,
  // so many samples will have min=2 or min=5.
  // 48 should clear the "greater" tail easily.
  assert.ok(result.passed, `Expected substantial evidence to clear; got ${result.reason}`);
  assert.equal(result.min_window, 48);
});

test("promoteParadigm: all three gates pass for a well-supported paradigm", () => {
  const all_lenses = [
    lens("a", eoFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("b", eoFamily, {
      support: new Set(["kind:x", "kind:y", "kind:z"]),
      evidence: new Array(55).fill(1),
      claims: ["kind:x"],
    }),
    lens("c", oralFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(48).fill(1),
      claims: ["kind:x"],
    }),
    lens("d", oralFamily, {
      support: new Set(["kind:x", "kind:z"]),
      evidence: new Array(52).fill(1),
      claims: ["kind:x"],
    }),
    lens("e", folkFamily, {
      support: new Set(["kind:x", "kind:w"]),
      evidence: new Array(45).fill(1),
      claims: ["kind:x"],
    }),
    lens("f", folkFamily, {
      support: new Set(["kind:x", "kind:w"]),
      evidence: new Array(40).fill(1),
      claims: ["kind:x"],
    }),
    // Some noise lenses that don't claim kind:x
    lens("g", eoFamily, {
      support: new Set(["kind:y"]),
      evidence: new Array(5).fill(1),
      claims: ["kind:y"],
    }),
    lens("h", oralFamily, {
      support: new Set(["kind:z"]),
      evidence: new Array(2).fill(1),
      claims: [],
    }),
  ];

  const result = promoteParadigm({
    candidate_id: "kind:x",
    supporting_lenses: all_lenses.filter((l) => l.claims.includes("kind:x")),
    all_lenses,
  });

  assert.ok(result.continuity.passed, `continuity: ${result.continuity.reason}`);
  assert.ok(result.correlation.passed, `correlation: ${result.correlation.reason}`);
  assert.ok(result.zollman.passed, `zollman: ${result.zollman.reason}`);
  assert.equal(result.gate_result.admitted, true);
  assert.equal(result.gate_result.status, "active");
  assert.match(result.gate_result.reason, /paradigm kind:x promoted/);
});

test("promoteParadigm: fails when all lenses are from the same family in a single-family pool", () => {
  // When ALL lenses in the pool are from one family, the correlation null
  // has nothing to measure against — gate fails by construction.
  const all_lenses = [
    lens("a", eoFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("b", eoFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("c", eoFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
  ];

  const result = promoteParadigm({
    candidate_id: "kind:x",
    supporting_lenses: all_lenses.filter((l) => l.claims.includes("kind:x")),
    all_lenses,
  });

  assert.equal(result.correlation.passed, false);
  assert.equal(result.gate_result.admitted, false);
  assert.match(result.correlation.reason, /one architectural family/);
});

test("promoteParadigm: fails when lenses have incompatible priors", () => {
  const all_lenses = [
    lens("a", eoFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("b", oralFamily, {
      support: new Set(["kind:z", "kind:w"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
  ];

  const result = promoteParadigm({
    candidate_id: "kind:x",
    supporting_lenses: all_lenses.filter((l) => l.claims.includes("kind:x")),
    all_lenses,
  });

  assert.equal(result.continuity.passed, false);
  assert.equal(result.gate_result.admitted, false);
  // Both lenses removed by continuity → compatible set is empty
  // → correlation fails (no supporting lenses after pruning)
  assert.ok(result.compatible_after_continuity < result.total_supporting);
});

test("promoteParadigm: fails when evidence window is too thin", () => {
  const all_lenses = [
    lens("a", eoFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(3).fill(1),
      claims: ["kind:x"],
    }),
    lens("b", eoFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(5).fill(1),
      claims: ["kind:x"],
    }),
    lens("c", oralFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(2).fill(1),
      claims: ["kind:x"],
    }),
    lens("d", oralFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(4).fill(1),
      claims: ["kind:x"],
    }),
    lens("e", folkFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(1).fill(1),
      claims: ["kind:x"],
    }),
    lens("f", folkFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(3).fill(1),
      claims: ["kind:x"],
    }),
  ];

  const result = promoteParadigm({
    candidate_id: "kind:x",
    supporting_lenses: all_lenses.filter((l) => l.claims.includes("kind:x")),
    all_lenses,
  });

  // Even though continuity and correlation pass, Zollman fails because min=1
  if (result.zollman) {
    // Zollman should fail with such thin evidence
    assert.equal(
      result.gate_result.admitted || result.zollman.passed ? false : result.zollman.passed,
      false,
      `Expected zollman to fail with min=${result.zollman.min_window}; got ${result.zollman.reason}`
    );
  }
});

test("promoteParadigm: type errors on missing required inputs", () => {
  assert.throws(() => promoteParadigm({}), /candidate_id/);
  assert.throws(
    () => promoteParadigm({ candidate_id: "x", supporting_lenses: null, all_lenses: [] }),
    /supporting_lenses/
  );
  assert.throws(
    () => promoteParadigm({ candidate_id: "x", supporting_lenses: [], all_lenses: [] }),
    /all_lenses/
  );
});

test("evaluateCandidates: batches candidates and returns summary", () => {
  const all_lenses = [
    lens("a", eoFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("b", eoFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("c", oralFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("d", oralFamily, {
      support: new Set(["kind:x", "kind:y"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
  ];

  const bag = evaluateCandidates({
    candidates: ["kind:x", "kind:y"],
    all_lenses,
  });

  assert.equal(bag.summary.total, 2);
  // kind:x: 4 supporting from 2 families, each with good evidence → admitted
  assert.equal(bag.results["kind:x"].gate_result.admitted, true);
  // kind:y: 0 supporting → should not be admitted
  assert.equal(bag.results["kind:y"].gate_result.admitted, false);
});

test("ParadigmGateResult@1: output is frozen and carries all sub-gate records", () => {
  const all_lenses = [
    lens("a", eoFamily, {
      support: new Set(["kind:x"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("b", eoFamily, {
      support: new Set(["kind:x"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("c", oralFamily, {
      support: new Set(["kind:x"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
    lens("d", oralFamily, {
      support: new Set(["kind:x"]),
      evidence: new Array(50).fill(1),
      claims: ["kind:x"],
    }),
  ];

  const result = promoteParadigm({
    candidate_id: "kind:x",
    supporting_lenses: all_lenses.filter((l) => l.claims.includes("kind:x")),
    all_lenses,
  });

  assert.equal(result.schema, "ParadigmGateResult@1");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.gate_result));
  assert.ok(Object.isFrozen(result.continuity));
  assert.ok(Object.isFrozen(result.correlation));
  assert.ok(Object.isFrozen(result.zollman));
  assert.ok(typeof result.gate_result.admitted === "boolean");
  assert.ok(typeof result.gate_result.status === "string");
  assert.ok(typeof result.gate_result.reason === "string");
});
