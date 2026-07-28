import { test } from "node:test";
import assert from "node:assert/strict";
import { veto } from "./index.js";
import { tokenize } from "@eoreader/spec/row-shapes";

// The read path's declared cell — SIG(Field, Tracing), as runner.js declares.
const OK_CELL = { operator: "SIG", terrain: "Field", stance: "Tracing" };

const SRC = "The council approved the budget on Tuesday. Members raised concerns about the timeline.";
const SPANS = { s1: { text: "The council approved the budget on Tuesday." } };
const PROPS = [{ id: "p1", provenance: { span_ids: ["s1"] } }];

/** one trace entry per token, all citing p1 except registered connectives */
const traceFor = (text, connectives = {}) =>
  tokenize(text).map((tok, i) => {
    const id = connectives[i];
    return id
      ? { tokenStart: i, tokenEnd: i + 1, source: "connective", refId: id }
      : { tokenStart: i, tokenEnd: i + 1, source: "proposition", refId: "p1" };
  });

// ── A1 ── grounded output, correct cell, complete per-token trace
test("A1 grounded output with a correct cell and complete trace passes", () => {
  const out = "The council approved the budget on Tuesday";
  const r = veto(out, { source: SRC, declaredCell: OK_CELL, propositions: PROPS, trace: traceFor(out), spans: SPANS });
  assert.equal(r.passed, true, JSON.stringify(r.vetoes));
  assert.equal(r.vetoes.length, 0);
});

// ── A2 ── invented figure
test("A2 an invented figure is refused as ungrounded-span", () => {
  const out = "The council approved the budget of 4.2 million on Tuesday";
  const r = veto(out, { source: SRC, declaredCell: OK_CELL, propositions: PROPS, trace: traceFor(out), spans: SPANS });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "ungrounded-span"), JSON.stringify(r.vetoes));
});

// ── A3 ── invented actor
test("A3 an invented actor is refused as ungrounded-span", () => {
  const out = "The Mayor approved the budget on Tuesday";
  const r = veto(out, { source: SRC, declaredCell: OK_CELL, propositions: PROPS, trace: traceFor(out), spans: SPANS });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "ungrounded-span"), JSON.stringify(r.vetoes));
});

// ── A4 ── a token citing an unregistered connective
test("A4 a token citing an unregistered connective is refused", () => {
  const out = "The council approved the budget on Tuesday to avoid a shutdown";
  const t = traceFor(out);
  t[t.length - 3] = { tokenStart: t.length - 3, tokenEnd: t.length - 2, source: "connective", refId: "in-order-to" };
  const r = veto(out, { source: SRC, declaredCell: OK_CELL, propositions: PROPS, trace: t, spans: SPANS });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "row-entailment-mismatch"), JSON.stringify(r.vetoes));
});

// ── A5 ── undeclared emission
test("A5 an emission with no declaredCell is refused", () => {
  const r = veto("Caesar conquered Gaul", { source: "Julius Caesar conquered Gaul in 50 BC" });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "undeclared-emission"));
});

// ── A6 ── declared cell outside the allowed terrains
test("A6 a declared terrain outside the contract is refused and named", () => {
  const r = veto("Caesar conquered Gaul", {
    source: "Julius Caesar conquered Gaul in 50 BC",
    declaredCell: { operator: "SIG", terrain: "Paradigm", stance: "Tracing" },
  });
  assert.equal(r.passed, false);
  const v = r.vetoes.find((x) => x.id === "constraint-violation");
  assert.ok(v && v.message.includes("Paradigm"), JSON.stringify(r.vetoes));
});

// ── A7 ── the desert cell
test("A7 SYN(Field, Cultivating) is refused as the desert cell", () => {
  const r = veto("anything at all", {
    source: "anything at all",
    declaredCell: { operator: "SYN", terrain: "Field", stance: "Cultivating" },
    allowedOps: new Set(["SYN"]), allowedTerrains: new Set(["Field"]), allowedStances: new Set(["Cultivating"]),
  });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "desert-cell"));
});

// ── A8 ── shape/cell mismatch
test("A8 a cell that is not the shape's legal cell is refused", () => {
  const r = veto("some readout", {
    source: "some readout",
    shape: "readout",
    declaredCell: OK_CELL,
    allowedOps: new Set(["SIG", "CON"]), allowedTerrains: new Set(["Field", "Link"]), allowedStances: new Set(["Tracing", "Binding"]),
  });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "shape-cell-mismatch"), JSON.stringify(r.vetoes));
});

// ── A9 ── propositions without a trace
test("A9 propositions supplied without a trace is a hard veto, not a silent skip", () => {
  const r = veto("The council approved the budget", { source: SRC, declaredCell: OK_CELL, propositions: PROPS });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "missing-trace"));
});

// ── A10 ── trace citing an undeclared proposition
test("A10 a trace citing an undeclared proposition is refused", () => {
  const out = "The council approved the budget";
  const t = traceFor(out).map((x) => ({ ...x, refId: "p-nonexistent" }));
  const r = veto(out, { source: SRC, declaredCell: OK_CELL, propositions: PROPS, trace: t, spans: SPANS });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "row-entailment-mismatch"));
});

// ── A13 ── the veto's verdict no longer moves with keyword frequency
test("A13 scrambling the output's word order does not change the verdict", () => {
  const out = "The council approved the budget on Tuesday";
  const scrambled = "budget the on approved Tuesday council The";
  const base = { source: SRC, declaredCell: OK_CELL };
  const a = veto(out, base), b = veto(scrambled, base);
  assert.equal(a.passed, b.passed);
  assert.deepEqual(a.vetoes.map((v) => v.id).sort(), b.vetoes.map((v) => v.id).sort());
});

// ── preserved from the original battery ──
test("veto catches invented entities", () => {
  const r = veto("The FOO Corp acquired BAR Inc in a merger", { source: "Newton discovered gravity on Earth", declaredCell: OK_CELL });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "invented-fact"));
});

test("veto catches polarity flips", () => {
  const r = veto("Caesar definitely is alive and breathing", { source: "Caesar definitely is not alive", declaredCell: OK_CELL });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "polarity-flip"));
});

test("veto catches thesis injection", () => {
  const r = veto("I think Caesar was the best leader ever", { source: "Caesar was a leader of Rome", declaredCell: OK_CELL });
  assert.equal(r.passed, false);
  assert.ok(r.vetoes.some((v) => v.id === "thesis-injection"));
});

test("veto passes when source also has opinion markers", () => {
  const r = veto("I think Caesar was great", { source: "I think Caesar was a leader", declaredCell: OK_CELL });
  assert.ok(!r.vetoes.some((v) => v.id === "thesis-injection"));
});

test("veto returns schema version", () => {
  const r = veto("test", { source: "test", declaredCell: OK_CELL });
  assert.equal(r.schema, "VetoResult@1");
  assert.ok(typeof r.output_tokens === "number");
});

test("veto with no source skips invented-fact and polarity checks", () => {
  const r = veto("Einstein discovered gravity", { declaredCell: OK_CELL });
  assert.ok(!r.vetoes.some((v) => v.id === "invented-fact"));
  assert.ok(!r.vetoes.some((v) => v.id === "polarity-flip"));
});
