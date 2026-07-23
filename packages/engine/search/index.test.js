import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, blockContentHash, createState, search } from "../index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const priorSnapshot = { schema_version: "PriorSnapshot@1", prior_id: "prior:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", operator_epoch: "eo-2026-07", ledger_head: "head:empty", basis_id: "basis:test", content_hash: "sha256:11111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const observation = { schema: "ObservationEnvelope@1", source_id: "source:poem", source_media_type: "text/plain", decoder: { id: "test", version: "1" }, axes: [{ axis_id: "line", topology: "ordered" }], fields: [{ field_id: "line:1", value_type: "string", block_id: "block:sha256:1111111111111111111111111111111111111111111111111111111111111111", axes: ["line"] }], anchors: { scheme: "test", surfaces: [{ referent_id: "ref:alpha", text: "Alpha river" }] }, source_content_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", blocks_hash: "sha256:7dcd8a74ff3827d9214005b36faecb42ef8396997bf5b16bfc6737bb81656e47" };
const block = { schema: "ObservationBlock@1", block_id: "block:sha256:1111111111111111111111111111111111111111111111111111111111111111", value_type: "string", shape: [1], values: ["Alpha river"] };
block.content_hash = blockContentHash(block);
observation.blocks_hash = canonicalHashSync([{ block_id: block.block_id, content_hash: block.content_hash }]);

function state() { return createState({ engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot }); }

test("search returns deterministic QueryReading passages anchored to ledger evidence", () => {
  const next = applyCommand(state(), { type: "observation.admit", payload: { envelope: observation, blocks: [block] } });
  const reading = search(next, { query: "alpha", limit: 5 });
  assert.equal(reading.schema_version, "QueryReading@1");
  assert.equal(reading.passages.length, 1);
  assert.equal(reading.passages[0].source_id, "source:poem");
  assert.deepEqual(reading.passages[0].anchors.exact_text, ["Alpha river"]);
  assert.deepEqual(reading.passages[0].evidence_event_ids, [next.events[0].event_id]);
  assert.deepEqual(search(next, { query: "alpha", limit: 5 }), reading);
});

test("search reports evidence gaps instead of generating answers", () => {
  const next = applyCommand(state(), { type: "observation.admit", payload: { envelope: observation, blocks: [block] } });
  const reading = search(next, { query: "gamma" });
  assert.equal(reading.passages.length, 0);
  assert.equal(reading.gaps[0].reason, "no_evidence_matched");
});
