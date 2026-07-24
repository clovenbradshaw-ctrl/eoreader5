// Reliability battery — READ PATH (end to end, what the engine emits TODAY).
//
// This is the "book run" from docs/evidence/book-run-2026-07-23.md turned into
// assertions, but self-contained: it builds its own small byte-anchored
// document rather than depending on the eoreader4.2 golden fixtures, which are
// not vendored into this repo. It drives a full ObservationEnvelope@1 through
// createEOReaderEngine().read() and pins the reliability guarantees the reader
// path currently makes:
//   * deterministic replay (the headline property in today's evidence);
//   * a well-formed event tape (progress → semantic → snapshot → projection →
//     query → complete);
//   * a schema-valid reading snapshot that carries the pinned prior identity
//     (the eoprior boundary: the engine consumes, never builds, a prior);
//   * anchored queries that localize a mention to the one source unit holding
//     it;
//   * a projection bundle whose referent/relation surface is well-formed.
//
// It also marks, honestly, the seam that today's evidence names: individuation
// typing (holon/emanon/protogon/field) is NOT yet wired into this path. That
// gate is exercised directly in reliability-terrains.test.js; here it is a
// documented pending, not a silent gap.
//
// Grounded in scripts/read-book-demo.mjs and packages/engine/runner.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEOReaderEngine, blockContentHash } from "@eoreader/engine";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";

// A synthetic four-paragraph document. "Kurtz" appears in exactly one
// paragraph so a query for it must localize to a single source unit.
const DOC = [
  "The station lay quiet under a heavy sky and no one spoke of the river.",
  "In the interior you will no doubt meet Mr. Kurtz, the agent said without lifting his head.",
  "Ivory moved downstream in a steady stream while the manager watched and said nothing.",
  "At the last the whisper came twice, a cry that was no more than a breath.",
].join("\n\n");

function buildRequest(text, queries) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const paragraphs = [];
  const selectors = [];
  const re = /\n[ \t]*\n/g;
  let start = 0;
  let m;
  const pushSpan = (from, to) => {
    const slice = normalized.slice(from, to).trim();
    if (!slice) return;
    const byte_start = Buffer.byteLength(normalized.slice(0, from), "utf8");
    const byte_end = byte_start + Buffer.byteLength(normalized.slice(from, to), "utf8");
    paragraphs.push(slice.replace(/\s+/g, " "));
    selectors.push({ byte_start, byte_end });
  };
  while ((m = re.exec(normalized))) {
    pushSpan(start, m.index);
    start = re.lastIndex;
  }
  pushSpan(start, normalized.length);

  const block = {
    schema: "ObservationBlock@1",
    block_id: `block:${canonicalHashSync({ source: "synthetic", values: paragraphs })}`,
    value_type: "string",
    shape: [paragraphs.length],
    axis_order: ["paragraph"],
    values: paragraphs,
    selectors,
    loss: [{ kind: "none" }],
  };
  block.content_hash = blockContentHash(block);
  const blocks_hash = canonicalHashSync([{ block_id: block.block_id, content_hash: block.content_hash }]);

  const envelope = {
    schema: "ObservationEnvelope@1",
    source_id: "source:synthetic.txt",
    source_media_type: "text/plain",
    decoder: { id: "plain-text", version: "1", loss: [{ kind: "none" }] },
    axes: [{ axis_id: "paragraph", topology: "ordered", unit: "paragraph" }],
    fields: [{ field_id: "paragraph:text", value_type: "string", block_id: block.block_id, axes: ["paragraph"] }],
    anchors: { scheme: "byte", selectors: { "paragraph:text": selectors } },
    source_content_hash: canonicalHashSync({ bytes: Buffer.from(normalized, "utf8").toString("base64") }),
    blocks_hash,
  };

  const priorSnapshot = {
    schema_version: "PriorSnapshot@1",
    prior_id: "prior:sha256:" + "0".repeat(64),
    operator_epoch: CURRENT_OPERATOR_EPOCH,
    ledger_head: "head:empty",
    basis_id: "basis:none",
    content_hash: "sha256:" + "1".repeat(64),
  };

  return {
    request: {
      schema: "RunRequest@1",
      context: {
        schema: "RunContext@1",
        frame_id: "frame:default",
        lens_ids: ["lens:neutral"],
        horizon: {},
        prior_snapshot_id: priorSnapshot.prior_id,
        engine_version: "0.1.0",
        operator_epoch: CURRENT_OPERATOR_EPOCH,
        source_null_policy: {},
        validation_risk_budget: {},
        compute_budget: { max_events: 64 },
        requested_projections: ["default"],
      },
      prior: { schema: "ResolvedPriorBundle@1", snapshot: priorSnapshot, packs: [], content_hash: priorSnapshot.content_hash },
      observations: [{ envelope, blocks: [block] }],
      queries: (queries ?? []).map((q) => ({ schema: "QueryRequest@1", query: q, limit: 3 })),
    },
    paragraphs,
    priorSnapshot,
  };
}

async function drain(engine, request) {
  const events = [];
  for await (const event of engine.read(request)) events.push(event);
  return events;
}

test("[read] deterministic replay: two runs of the same request are byte-identical", async () => {
  const { request } = buildRequest(DOC, ["Kurtz"]);
  const engine = createEOReaderEngine();
  const run1 = await drain(engine, request);
  const run2 = await drain(engine, request);
  assert.equal(JSON.stringify(run1), JSON.stringify(run2), "the reader path must replay deterministically");
});

test("[read] K-run stability: the final semantic_head is stable across many reads", async () => {
  const { request } = buildRequest(DOC, ["Kurtz"]);
  const engine = createEOReaderEngine();
  const heads = new Set();
  for (let i = 0; i < 8; i++) {
    const run = await drain(engine, request);
    heads.add(run.at(-1).semantic_head);
  }
  assert.equal(heads.size, 1, `expected one stable head across 8 reads, got ${heads.size}`);
});

test("[read] event tape carries the full ordered phase set", async () => {
  const { request } = buildRequest(DOC, ["Kurtz"]);
  const run = await drain(createEOReaderEngine(), request);
  const types = run.map((e) => e.type);
  for (const phase of ["progress", "semantic", "snapshot", "projection", "query", "complete"]) {
    assert.ok(types.includes(phase), `tape is missing a "${phase}" event`);
  }
  assert.equal(types.at(-1), "complete", "the tape must end on complete");
  assert.ok(
    types.indexOf("snapshot") < types.indexOf("projection"),
    "snapshot must precede projection",
  );
});

test("[read] the reading snapshot is schema-valid, one unit per field, each grounded", async () => {
  const { request } = buildRequest(DOC, []);
  const run = await drain(createEOReaderEngine(), request);
  const snapshot = run.find((e) => e.type === "snapshot")?.snapshot;
  assert.ok(snapshot, "a snapshot event must be emitted");
  assert.equal(snapshot.schema_version, "ReadingSnapshot@1");
  // Reading units are per FIELD (the paragraph:text field over the paragraph
  // axis), not per individual paragraph value — paragraph-level localization
  // happens through query anchors, not snapshot units.
  assert.ok(snapshot.units.length >= 1, "at least one reading unit is emitted");
  for (const unit of snapshot.units) {
    assert.ok(unit.unit_id, "each unit carries an id");
    assert.ok(unit.provenance?.source_id, "each unit carries source provenance");
  }
});

test("[read] the pinned prior identity is threaded through the snapshot (eoprior boundary)", async () => {
  const { request, priorSnapshot } = buildRequest(DOC, []);
  const run = await drain(createEOReaderEngine(), request);
  const snapshot = run.find((e) => e.type === "snapshot")?.snapshot;
  assert.equal(snapshot.prior_id, priorSnapshot.prior_id, "the engine must report the prior it read under, unchanged");
});

test("[read] an anchored query localizes a mention to a source unit with byte anchors", async () => {
  const { request } = buildRequest(DOC, ["Kurtz"]);
  const run = await drain(createEOReaderEngine(), request);
  const query = run.find((e) => e.type === "query");
  assert.ok(query, "a query event must be emitted");
  assert.equal(query.reading.schema_version, "QueryReading@1");
  const passages = query.reading.passages ?? [];
  assert.equal(passages.length, 1, "\"Kurtz\" is present, so the query must localize to its one source unit");
  const hit = passages[0];
  assert.equal(hit.source_id, "source:synthetic.txt", "the passage is anchored to the real source");
  assert.ok(Array.isArray(hit.anchors?.selectors) && hit.anchors.selectors.length > 0, "the hit carries byte selectors back to source");
});

test("[read] a query for absent text returns no passages (silence, not a fabricated match)", async () => {
  const { request } = buildRequest(DOC, ["Nashville"]);
  const run = await drain(createEOReaderEngine(), request);
  const query = run.find((e) => e.type === "query");
  const passages = query.reading.passages ?? [];
  assert.equal(passages.length, 0, "a term that never appears must return nothing, not a nearest guess");
  // Absence is a first-class output: the reading still exists, it just carries
  // no passages (and may carry gaps), rather than being an error.
  assert.ok(Array.isArray(query.reading.gaps), "absence is reported as a structured gaps field, not thrown");
});

test("[read] the projection bundle is well-formed (spans + referent relations)", async () => {
  const { request } = buildRequest(DOC, []);
  const run = await drain(createEOReaderEngine(), request);
  const projection = run.find((e) => e.type === "projection")?.projection;
  assert.ok(projection, "a projection event must be emitted");
  assert.equal(projection.schema, "ProjectionBundle@1");
  assert.ok(Array.isArray(projection.spans), "spans is an array");
  assert.ok(Array.isArray(projection.relations), "relations is an array");
  // Every emitted relation must be a typed, grounded edge (from/to present) —
  // no dangling name relations.
  for (const rel of projection.relations) {
    assert.ok(rel.from && rel.to && rel.type, "each relation carries from/to/type");
  }
});

// --- Honest seam marker -------------------------------------------------
// docs/evidence/book-run-2026-07-23.md: "the per-medium signal layer
// (waveform/individuation) is not built yet." Until the read path feeds
// row-supplied observables (mass/coupling/named/boundary) into the
// individuation gate, we do NOT get typed figures (holon/emanon/protogon)
// out of an end-to-end read. The gate itself is proven in
// reliability-terrains.test.js. This is recorded as a pending so the battery
// tells the truth about the seam rather than pretending it is closed.
test.todo(
  "[read] end-to-end read emits individuation-typed figures once the signal layer is wired",
);
