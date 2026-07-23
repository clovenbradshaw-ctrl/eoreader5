import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHAPES,
  DESERT_CELL,
  isDesertCell,
  LEGAL_CELLS,
  legalCellFor,
  tokenize,
  tokenCount,
  checkTraceCoverage,
  bidirectionallyEntails,
  ROW_VETOES,
  runRowVetoes,
} from "./index.js";

test("legalCellFor never returns the desert cell, for any known shape", () => {
  for (const shape of SHAPES) {
    const cell = legalCellFor(shape);
    assert.ok(cell, `expected a cell for shape ${shape}`);
    assert.equal(isDesertCell(cell), false);
  }
});

test("legalCellFor returns null for an unknown shape", () => {
  assert.equal(legalCellFor("not-a-shape"), null);
});

test("isDesertCell only flags the exact SYN(Field, Cultivating) cell", () => {
  assert.equal(isDesertCell(DESERT_CELL), true);
  assert.equal(isDesertCell({ op: "SYN", terrain: "Field", stance: "Making" }), false);
  assert.equal(isDesertCell({ op: "REC", terrain: "Field", stance: "Cultivating" }), false);
  assert.equal(isDesertCell(null), false);
});

test("Cultivating's legal cell is the Significance-domain REC(Atmosphere, Cultivating), never the desert cell", () => {
  assert.deepEqual(LEGAL_CELLS.cultivating, { op: "REC", terrain: "Atmosphere", stance: "Cultivating" });
});

test("tokenize splits words and standalone punctuation by character offset", () => {
  const tokens = tokenize("Board, because financing closed.");
  assert.deepEqual(tokens.map((t) => t.text), ["Board", ",", "because", "financing", "closed", "."]);
  assert.equal(tokenCount("Board, because financing closed."), tokens.length);
});

test("tokenize on empty/nullish input returns no tokens", () => {
  assert.equal(tokenCount(""), 0);
  assert.equal(tokenCount(undefined), 0);
});

function row(renderedText, trace) {
  return { renderedText, trace };
}

test("checkTraceCoverage passes a row with exactly one contiguous trace per token", () => {
  const r = row("Grete is present", [
    { tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" },
    { tokenStart: 1, tokenEnd: 2, source: "connective", refId: "is" },
    { tokenStart: 2, tokenEnd: 3, source: "proposition", refId: "p1" },
  ]);
  assert.deepEqual(checkTraceCoverage(r), { covered: true, reason: null });
});

test("checkTraceCoverage fails when a token has no trace pointer (fabrication)", () => {
  const r = row("Grete is present", [
    { tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" },
    { tokenStart: 1, tokenEnd: 2, source: "connective", refId: "is" },
  ]);
  assert.equal(checkTraceCoverage(r).covered, false);
});

test("checkTraceCoverage fails when a trace span double-counts a token", () => {
  const r = row("Grete is present", [
    { tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" },
    { tokenStart: 0, tokenEnd: 2, source: "connective", refId: "is" },
    { tokenStart: 2, tokenEnd: 3, source: "proposition", refId: "p1" },
  ]);
  assert.equal(checkTraceCoverage(r).covered, false);
});

test("bidirectionallyEntails is true when every proposition is traced and every other token is a known connective", () => {
  const propositions = [{ id: "p1" }];
  const r = row("Grete is present", [
    { tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" },
    { tokenStart: 1, tokenEnd: 2, source: "connective", refId: "is" },
    { tokenStart: 2, tokenEnd: 3, source: "proposition", refId: "p1" },
  ]);
  assert.equal(bidirectionallyEntails(r, propositions), true);
});

test("bidirectionallyEntails is false when a declared proposition is never traced (dropped counter-reading)", () => {
  const propositions = [{ id: "p1" }, { id: "p2" }];
  const r = row("$15 million", [{ tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" }]);
  assert.equal(bidirectionallyEntails(r, propositions), false);
});

test("bidirectionallyEntails is false when a traced token points at an undeclared proposition", () => {
  const propositions = [{ id: "p1" }];
  const r = row("Grete", [{ tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p-not-declared" }]);
  assert.equal(bidirectionallyEntails(r, propositions), false);
});

test("bidirectionallyEntails is false when a non-proposition token is not a registered connective (invented hedge word)", () => {
  const propositions = [{ id: "p1" }];
  const r = row("clearly Grete", [
    { tokenStart: 0, tokenEnd: 1, source: "connective", refId: "clearly" },
    { tokenStart: 1, tokenEnd: 2, source: "proposition", refId: "p1" },
  ]);
  assert.equal(bidirectionallyEntails(r, propositions), false);
});

test("ROW_VETOES / runRowVetoes: a clean row fires neither veto", () => {
  const propositions = [{ id: "p1" }];
  const r = row("Grete is present", [
    { tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" },
    { tokenStart: 1, tokenEnd: 2, source: "connective", refId: "is" },
    { tokenStart: 2, tokenEnd: 3, source: "proposition", refId: "p1" },
  ]);
  const result = runRowVetoes({ row: r, propositions });
  assert.deepEqual(result, { fired: [], refuse: false });
});

test("row-entailment-mismatch fires on a Cultivating survey that drops one side of a two-way split", () => {
  const propositions = [{ id: "p-15m" }, { id: "p-18m" }];
  const r = row("$15 million", [{ tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p-15m" }]);
  const result = runRowVetoes({ row: r, propositions });
  assert.equal(result.refuse, true);
  assert.ok(result.fired.some((f) => f.id === "row-entailment-mismatch"));
});

test("row-fabrication fires when a connective token has no trace pointer", () => {
  const propositions = [{ id: "p1" }];
  const r = row("Grete is", [{ tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" }]);
  const result = runRowVetoes({ row: r, propositions });
  assert.equal(result.refuse, true);
  assert.ok(result.fired.some((f) => f.id === "row-fabrication"));
});

test("row-fabrication fires without row-entailment-mismatch when trace coverage alone is broken", () => {
  const propositions = [{ id: "p1" }];
  const r = row("Grete is", [{ tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" }]);
  const result = runRowVetoes({ row: r, propositions });
  assert.deepEqual(result.fired.map((f) => f.id), ["row-fabrication"]);
});

test("ROW_VETOES is exactly the two named vetoes, both refusing", () => {
  assert.deepEqual(ROW_VETOES.map((v) => v.id), ["row-entailment-mismatch", "row-fabrication"]);
  assert.ok(ROW_VETOES.every((v) => v.refuses === true));
});
