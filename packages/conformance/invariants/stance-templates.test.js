// Row-stance fabrication firewall (spec §5 / retirement gate item 2 -- HARD
// BLOCKER, fabrication firewall, per docs/eoreader5-parity-checklist.md).
//
// Ported from eoreader4.2:docs/generate-row-stance-templates.md
// + src/weave/generate-row/{stance,tokenize}.js + src/enactor/ground/row-veto.js.
// See docs/row-stance-templates.md and packages/spec/row-shapes/index.js for
// the full contract and why the spectral stanceLegality chooser itself is
// deferred (needs the terrain/stance enums + diagonal-coherence validator,
// parity checklist §3, not yet ported).
//
// No generated-prose surface exists in eoreader5 or eoreaderapp yet. This
// file exists anyway, ahead of one, per the retirement gate: "no surface
// needs this yet, but the contract must exist before eoreaderapp builds its
// first gloss/blurb/caption feature -- not retrofitted after."

import { test } from "node:test";
import assert from "node:assert/strict";
import { SHAPES, DESERT_CELL, isDesertCell, legalCellFor, bidirectionallyEntails, checkTraceCoverage, runRowVetoes } from "@eoreader/spec/row-shapes";

test("no row shape's legal cell is ever the forbidden desert cell SYN(Field, Cultivating)", () => {
  for (const shape of SHAPES) {
    assert.equal(isDesertCell(legalCellFor(shape)), false, `shape ${shape} must not resolve to the desert cell`);
  }
});

test("Cultivating survey is the universal honest fallback and lands at REC(Atmosphere, Cultivating), never SYN(Field, Cultivating)", () => {
  const cultivatingCell = legalCellFor("cultivating");
  assert.equal(cultivatingCell.op, "REC");
  assert.equal(cultivatingCell.stance, "Cultivating");
  assert.notEqual(cultivatingCell.terrain, DESERT_CELL.terrain);
});

test("bidirectional-entailment veto: a rendered row may not drop a declared proposition (dropped counter-reading)", () => {
  const propositions = [{ id: "p-15m" }, { id: "p-18m" }];
  const row = { renderedText: "$15 million", trace: [{ tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p-15m" }] };
  assert.equal(bidirectionallyEntails(row, propositions), false);
  const { refuse, fired } = runRowVetoes({ row, propositions });
  assert.equal(refuse, true);
  assert.ok(fired.some((f) => f.id === "row-entailment-mismatch"));
});

test("bidirectional-entailment veto: a rendered row may not add an unfounded hedge/connective word", () => {
  const propositions = [{ id: "p1" }];
  const row = {
    renderedText: "clearly Grete",
    trace: [
      { tokenStart: 0, tokenEnd: 1, source: "connective", refId: "clearly" },
      { tokenStart: 1, tokenEnd: 2, source: "proposition", refId: "p1" },
    ],
  };
  assert.equal(bidirectionallyEntails(row, propositions), false);
});

test("bidirectional-entailment veto does not false-positive on a correctly traced row", () => {
  const propositions = [{ id: "p-board" }, { id: "p-financing" }];
  const row = {
    renderedText: "The board approved the deal, because financing had closed",
    trace: [
      { tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p-board" },
      { tokenStart: 1, tokenEnd: 2, source: "connective", refId: "because" },
      { tokenStart: 2, tokenEnd: 3, source: "proposition", refId: "p-financing" },
    ],
  };
  // Not a full trace-coverage exercise (see the fabrication test below for that) --
  // just confirms the entailment check alone passes a correctly declared row.
  assert.equal(bidirectionallyEntails(row, propositions), true);
});

test("fabrication veto: exactly-1 token-trace coverage rejects a token with zero trace pointers", () => {
  const row = { renderedText: "Grete is present", trace: [{ tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" }] };
  assert.equal(checkTraceCoverage(row).covered, false);
  const { refuse, fired } = runRowVetoes({ row, propositions: [{ id: "p1" }] });
  assert.equal(refuse, true);
  assert.ok(fired.some((f) => f.id === "row-fabrication"));
});

test("fabrication veto: exactly-1 token-trace coverage rejects a token double-counted by two trace spans", () => {
  const row = {
    renderedText: "Grete is present",
    trace: [
      { tokenStart: 0, tokenEnd: 1, source: "proposition", refId: "p1" },
      { tokenStart: 0, tokenEnd: 2, source: "connective", refId: "is" },
      { tokenStart: 2, tokenEnd: 3, source: "proposition", refId: "p1" },
    ],
  };
  assert.equal(checkTraceCoverage(row).covered, false);
});

// Trace coverage is a strict bijection (§8: "tokenCount(renderedText) ===
// row.trace.length"): one TraceRef PER TOKEN, not one per phrase. A
// multi-token proposition repeats the same refId across consecutive
// one-token-wide entries. This helper builds that shape from a list of
// {count, source, refId} runs so the worked examples below stay readable.
function tracedRow(renderedText, runs) {
  const trace = [];
  let i = 0;
  for (const { count, source, refId } of runs) {
    for (let k = 0; k < count; k += 1) {
      trace.push({ tokenStart: i, tokenEnd: i + 1, source, refId });
      i += 1;
    }
  }
  return { renderedText, trace };
}

test("a correctly traced row of each worked shape passes both vetoes (no false positive)", () => {
  const cases = [
    {
      shape: "readout",
      propositions: [{ id: "p1" }],
      row: tracedRow("Axon acquired Fusus", [{ count: 3, source: "proposition", refId: "p1" }]),
    },
    {
      shape: "making",
      propositions: [{ id: "p-board" }, { id: "p-financing" }],
      row: tracedRow("The board approved the deal because financing had closed", [
        { count: 5, source: "proposition", refId: "p-board" }, // The board approved the deal
        { count: 1, source: "connective", refId: "because" },
        { count: 3, source: "proposition", refId: "p-financing" }, // financing had closed
      ]),
    },
    {
      shape: "composing",
      propositions: [{ id: "p1" }, { id: "p2" }],
      row: tracedRow("$15M then $18M", [
        { count: 1, source: "proposition", refId: "p1" },
        { count: 1, source: "ordinal", refId: "then" },
        { count: 1, source: "proposition", refId: "p2" },
      ]),
    },
  ];
  for (const { shape, propositions, row } of cases) {
    assert.equal(checkTraceCoverage(row).covered, true, `expected shape ${shape}'s worked example to have exactly-1 trace coverage`);
    const result = runRowVetoes({ row, propositions });
    assert.deepEqual(result, { fired: [], refuse: false }, `expected shape ${shape}'s worked example to pass both vetoes`);
  }
});
