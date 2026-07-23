import { test } from "node:test";
import assert from "node:assert/strict";
import { induceOperators, behavioralFingerprint } from "./index.js";
import { validateCompetencyRecord } from "@eoreader/spec";
import { createSeededRng } from "../nulls/index.js";

// A hierarchical series: a linear trend plus a seasonal cycle, so a single
// operator cannot capture everything and a genuine two-structure re-entry exists.
function trendSeason(length = 48) {
  const rng = createSeededRng("ts");
  return Array.from({ length }, (_, t) => 2 + 1.5 * t + 8 * Math.sin((2 * Math.PI * t) / 6) + (rng() - 0.5));
}
const TS_OPTS = { population: "series:trend-season", shuffles: 30, enumeration: { lags: [1, 6], maxSeriesDepth: 2 }, seasonalPeriod: 6 };

function whiteNoise(length = 40) {
  const rng = createSeededRng("noise");
  return Array.from({ length }, () => (rng() - 0.5) * 10);
}

test("induction promotes structural compositions, each lens-explicit and epoch-tagged", () => {
  const { operators } = induceOperators(trendSeason(), TS_OPTS);
  assert.ok(operators.length >= 1, "at least one operator should be promoted on a structured series");
  for (const op of operators) {
    assert.equal(op.schema, "OperatorCandidate@1");
    assert.match(op.id, /^operator:sha256:[0-9a-f]{64}$/);
    assert.ok(op.description_length >= 3, "only genuine compositions are promoted, not bare leaves");
    // A promoted operator combines two structural sub-results, never a bare
    // reducer or a reducer +/- const (a variant, section 22.4).
    assert.ok(["add", "sub", "mul", "div"].includes(op.canonical_program.op));
    assert.notEqual(op.canonical_program.a.op, "const");
    assert.notEqual(op.canonical_program.b.op, "const");
    // It cleared the held-out transfer gate (invariant 7.6).
    assert.ok(op.transfer_gain > 0);
    // Lens is stored, not argued: the operator names what it was surprising against.
    assert.equal(op.lens.scoring_rule, "crps");
    assert.ok(op.lens.baseline_ids.includes(op.reference_baseline_id));
    // The operator-epoch acts: REC promoted it, it re-enters as INS.
    assert.deepEqual({ by: op.emergence.promoted_by, re: op.emergence.reenters_as }, { by: "REC", re: "INS" });
    assert.equal(op.emergence.operator_epoch, "eo-2026-07");
    validateCompetencyRecord(op.competency);
  }
});

test("the helix recurses: a later operator is built ON an earlier promoted operator (REC -> INS)", () => {
  const { operators, rounds } = induceOperators(trendSeason(), TS_OPTS);
  const reused = operators.filter((op) => JSON.stringify(op.canonical_program).includes('"op":"opref"'));
  assert.ok(reused.length >= 1, "at least one operator should compose atop a previously promoted one");
  // That reuse must appear in a round after the operator it references was minted.
  assert.ok(rounds.length >= 2, "induction should run more than one pass when re-entry is productive");
  for (const op of reused) assert.ok(op.emergence.round >= 1, "a reused operator is minted in a later pass");
});

test("the promotion gates refuse structureless noise (no operator on chance fits)", () => {
  const { operators } = induceOperators(whiteNoise(), { population: "series:noise", shuffles: 40 });
  assert.equal(operators.length, 0, "white noise carries no transferable temporal structure to promote");
});

test("every promoted operator cleared its own born-null threshold", () => {
  const { operators } = induceOperators(trendSeason(), TS_OPTS);
  for (const op of operators) {
    assert.equal(op.promotion_null.passed, true);
    assert.equal(op.promotion_null.schema, "NullProtocol@1");
    assert.equal(op.promotion_null.null_protocol.name, "series-shuffle");
  }
});

test("induction is deterministic and replayable", () => {
  const a = induceOperators(trendSeason(), TS_OPTS);
  const b = induceOperators(trendSeason(), TS_OPTS);
  assert.deepEqual(a.operators.map((o) => o.id), b.operators.map((o) => o.id));
});

test("behavioral fingerprint collapses a trivial variant onto its equivalent", () => {
  const series = trendSeason(20);
  const last = { op: "last", of: { op: "hist" } };
  const lastPlusZero = { op: "add", a: last, b: { op: "const", value: 0 } };
  assert.equal(behavioralFingerprint(last, series, 4), behavioralFingerprint(lastPlusZero, series, 4));
});

test("induction refuses a series too short for the requested warmup", () => {
  assert.throws(() => induceOperators([1, 2, 3, 4], { warmup: 6 }), /too short/);
});
