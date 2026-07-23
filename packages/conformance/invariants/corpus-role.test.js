// Corpus-role citation firewall (spec §4.2 / retirement gate item 1 -- HARD
// BLOCKER, non-negotiable per docs/eoreader5-parity-checklist.md).
//
// Ported from eoreader4.2:tests/corpus-role.test.js against eoreader4.2's own
// src/core/log.js + src/core/project.js. eoreader5 has a different event
// model (SemanticEvent over an event-sourced replay reducer, not an
// op-tagged append-only log folded by a bespoke projectGraph), so this is a
// concept port, not a byte-for-byte transcription: the same two guarantees
// 4.2 pins are re-pinned here against packages/engine/replay's actual
// primitives.
//
//   1. The mark is sealed at the command->event chokepoint (applyCommand's
//      `role` passthrough in packages/engine/replay/index.js), never
//      trusted from anywhere else, and never present on a plain event.
//   2. F4, the projection firewall: a role:'corpus' event must never mint
//      an observation/referent/relation/merge/hypothesis/frame/resolution
//      that project()/readingSnapshot() (the citing surfaces) can see --
//      however the event came to share a ledger with document events.
//   3. F6: the ledger itself never refuses to store a role:'corpus' event
//      (it still appears in project()'s evidence_links, same as 4.2 keeps
//      it in the raw log).
//
// This is the firewall every downstream prior/lens/eoPriors-content feature
// must sit behind; nothing that touches reference-corpus content may ship
// until this file passes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createState } from "@eoreader/engine/replay";
import { project as projectBundle } from "@eoreader/engine/projection";

const priorSnapshot = {
  schema_version: "PriorSnapshot@1",
  prior_id: "prior:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  operator_epoch: "eo-2026-07",
  ledger_head: "head:empty",
  basis_id: "basis:test",
  content_hash: "sha256:11111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

function freshState() {
  return createState({ engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot });
}

function observation(sourceId, referentId, text) {
  return {
    schema: "ObservationEnvelope@1",
    source_id: sourceId,
    source_media_type: "text/plain",
    decoder: { id: "test", version: "1" },
    axes: [{ axis_id: "line", topology: "ordered" }],
    fields: [{ field_id: "f1", value_type: "text", block_id: "b1", axes: ["line"] }],
    anchors: { scheme: "test", surfaces: [{ referent_id: referentId, text }] },
    source_content_hash: `sha256:${"b".repeat(64)}`,
    blocks_hash: `sha256:${"c".repeat(64)}`,
  };
}

test("plain command produces an event with no role key at all, not even a false-y one", () => {
  const next = applyCommand(freshState(), { type: "observation.admit", payload: observation("doc:1", "ref:doc1", "Grete") });
  assert.equal("role" in next.events[0], false);
});

test("command.role:'corpus' seals role:'corpus' onto the event it produces", () => {
  const next = applyCommand(freshState(), { type: "observation.admit", role: "corpus", payload: observation("corpus:1", "ref:corp1", "Ambrose") });
  assert.equal(next.events[0].role, "corpus");
});

test("an unrecognized command.role is never trusted onto the event", () => {
  const next = applyCommand(freshState(), { type: "observation.admit", role: "definitely-not-corpus", payload: observation("doc:1", "ref:doc1", "Grete") });
  assert.equal("role" in next.events[0], false);
});

test("a role:'corpus' observation never mints a referent", () => {
  let next = freshState();
  next = applyCommand(next, { type: "observation.admit", payload: observation("doc:1", "ref:doc1", "Grete") });
  next = applyCommand(next, { type: "observation.admit", role: "corpus", payload: observation("corpus:1", "ref:corp1", "Ambrose") });
  assert.equal(next.referents.has("ref:doc1"), true);
  assert.equal(next.referents.has("ref:corp1"), false, "a corpus-tagged observation must not reach the referent projection");
  assert.equal(next.referents.size, 1);
});

test("a role:'corpus' observation never mints a citable span/relation in project()", () => {
  let next = freshState();
  next = applyCommand(next, { type: "observation.admit", payload: observation("doc:1", "ref:doc1", "Grete") });
  next = applyCommand(next, { type: "observation.admit", role: "corpus", payload: observation("corpus:1", "ref:corp1", "Ambrose") });
  const bundle = projectBundle(next);
  assert.equal(bundle.spans.length, 1);
  assert.equal(bundle.spans[0].source_id, "doc:1");
  assert.equal(bundle.navigation_hints.some((hint) => hint.target === "ref:corp1"), false);
});

test("a role:'corpus' referent.merge never merges document referents", () => {
  let next = freshState();
  next = applyCommand(next, { type: "observation.admit", payload: { ...observation("doc:1", "ref:a", "Grete"), anchors: { scheme: "test", surfaces: [{ referent_id: "ref:a", text: "Grete" }, { referent_id: "ref:b", text: "Margarethe" }] } } });
  const admitEventId = next.events[0].event_id;
  next = applyCommand(next, { type: "referent.merge", role: "corpus", payload: { into_id: "ref:a", from_ids: ["ref:b"] }, inputs: [admitEventId] });
  assert.equal(next.referents.has("ref:a"), true);
  assert.equal(next.referents.has("ref:b"), true, "a corpus-tagged merge must not fire on document referents");
  assert.equal(next.referents.size, 2);
});

test("a role:'corpus' hypothesis never surfaces as an accepted/competing/held parameter", () => {
  let next = freshState();
  next = applyCommand(next, { type: "hypothesis.accept", role: "corpus", payload: { hypothesis_id: "hyp:corpus", evidence: { event_ids: [] } } });
  assert.equal(next.hypotheses.accepted.length, 0);
  assert.equal(next.hypotheses.competing.length, 0);
  assert.equal(next.hypotheses.held.length, 0);
});

test("a role:'corpus' event is retained in the ledger and its evidence trail (F6) but never in the projected reading (F4)", () => {
  let next = freshState();
  next = applyCommand(next, { type: "observation.admit", role: "corpus", payload: observation("corpus:1", "ref:corp1", "Ambrose") });
  assert.equal(next.events.length, 1, "the ledger never refuses to store a role:'corpus' event");
  assert.equal(next.events[0].role, "corpus");
  const bundle = projectBundle(next);
  assert.equal(bundle.evidence_links.length, 1, "the raw evidence trail still names the event");
  assert.equal(bundle.evidence_links[0].event_id, next.events[0].event_id);
  assert.equal(bundle.spans.length, 0, "but it mints nothing in the citable projection");
  assert.equal(next.referents.size, 0);
});

test("an entire role:'corpus' ledger replays to an empty projected reading", () => {
  let next = freshState();
  next = applyCommand(next, { type: "observation.admit", role: "corpus", payload: observation("corpus:1", "ref:a", "Ambrose") });
  next = applyCommand(next, { type: "observation.admit", role: "corpus", payload: observation("corpus:2", "ref:b", "Ledger") });
  const admitB = next.events[1].event_id;
  next = applyCommand(next, { type: "referent.merge", role: "corpus", payload: { into_id: "ref:a", from_ids: ["ref:b"] }, inputs: [admitB] });
  assert.equal(next.referents.size, 0);
  assert.equal(next.observations.length, 0);
  const bundle = projectBundle(next);
  assert.equal(bundle.spans.length, 0);
  assert.equal(bundle.relations.length, 0);
});
