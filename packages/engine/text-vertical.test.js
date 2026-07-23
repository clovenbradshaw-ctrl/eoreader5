import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { applyCommand, blockContentHash, createEOReaderEngine, createState, search } from "./index.js";

const priorSnapshot = { schema_version: "PriorSnapshot@1", prior_id: "prior:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", operator_epoch: "eo-2026-07", ledger_head: "head:empty", basis_id: "basis:test", content_hash: "sha256:11111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
function makeBundle() {
  const block = { schema: "ObservationBlock@1", block_id: "block:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", value_type: "string", shape: [2], axis_order: ["paragraph"], values: ["Victor Frankenstein left Geneva.", "The creature, called the wretch, watched Victor."], selectors: [{ byte_start: 0, byte_end: 33 }, { byte_start: 34, byte_end: 88 }], loss: [{ kind: "none" }] };
  block.content_hash = blockContentHash(block);
  const blocks_hash = canonicalHashSync([{ block_id: block.block_id, content_hash: block.content_hash }]);
  const envelope = { schema: "ObservationEnvelope@1", source_id: "source:frankenstein:test", source_media_type: "text/plain", decoder: { id: "plain-text", version: "1", loss: [{ kind: "none" }] }, axes: [{ axis_id: "paragraph", topology: "ordered", unit: "paragraph" }, { axis_id: "sentence", topology: "ordered", unit: "sentence" }], fields: [{ field_id: "paragraph:text", value_type: "string", block_id: block.block_id, axes: ["paragraph"] }], anchors: { scheme: "byte", selectors: { "paragraph:text": block.selectors } }, source_content_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", blocks_hash };
  return { envelope, blocks: [block] };
}
function state() { return createState({ engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot }); }

test("engine indexes resolved observation text and search returns exact anchored passages", () => {
  const bundle = makeBundle();
  const next = applyCommand(state(), { type: "observation.admit", payload: bundle });
  assert.equal(next.observationIndex.values.length, 2);
  const reading = search(next, { schema: "QueryRequest@1", query: "Victor", limit: 5 });
  assert.equal(reading.passages.length, 1);
  assert.deepEqual(reading.passages[0].anchors.exact_text, bundle.blocks[0].values);
  assert.deepEqual(reading.passages[0].anchors.selectors, bundle.blocks[0].selectors);
});

test("createEOReaderEngine streams semantic events, snapshot, projection, query, and completion deterministically", async () => {
  const request = { schema: "RunRequest@1", context: { schema: "RunContext@1", frame_id: "frame:default", lens_ids: ["lens:neutral"], horizon: {}, prior_snapshot_id: priorSnapshot.prior_id, engine_version: "0.1.0", operator_epoch: "eo-2026-07", source_null_policy: {}, validation_risk_budget: {}, compute_budget: { max_events: 8 }, requested_projections: ["default"] }, prior: { schema: "ResolvedPriorBundle@1", snapshot: priorSnapshot, packs: [], content_hash: priorSnapshot.content_hash }, observations: [makeBundle()], queries: [{ schema: "QueryRequest@1", query: "creature" }] };
  const engine = createEOReaderEngine();
  const first = [];
  for await (const event of engine.read(request)) first.push(event);
  const second = [];
  for await (const event of engine.read(request)) second.push(event);
  assert.deepEqual(second, first);
  assert.ok(first.some((event) => event.type === "snapshot"));
  assert.ok(first.some((event) => event.type === "projection"));
  assert.ok(first.some((event) => event.type === "query" && event.reading.passages.length === 1));
  assert.equal(first.at(-1).type, "complete");
});
