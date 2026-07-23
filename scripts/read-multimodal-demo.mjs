// Omnimodal probe: drive the SAME pure engine with non-text observation
// envelopes (tabular / audio / image / binary) to test eoreader5's core claim
// that one modality-neutral engine ingests every medium into one fold-grid.
//
// Each medium is shaped the way an app sense organ would emit it: neutral
// ObservationEnvelope@1 + ObservationBlock@1, no semantic labels. We report the
// event tape, determinism, snapshot shape, and whether search discriminates.

import { createEOReaderEngine, blockContentHash } from "@eoreader/engine";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";

const priorSnapshot = {
  schema_version: "PriorSnapshot@1",
  prior_id: "prior:sha256:" + "0".repeat(64),
  operator_epoch: CURRENT_OPERATOR_EPOCH,
  ledger_head: "head:empty",
  basis_id: "basis:none",
  content_hash: "sha256:" + "1".repeat(64),
};

function makeBundle({ source_id, media_type, decoder_id, axes, value_type, values, selectors }) {
  const block = {
    schema: "ObservationBlock@1",
    block_id: `block:${canonicalHashSync({ source_id, values })}`,
    value_type,
    shape: [values.length],
    axis_order: [axes[0].axis_id],
    values,
    selectors,
    loss: [{ kind: "none" }],
  };
  block.content_hash = blockContentHash(block);
  const blocks_hash = canonicalHashSync([{ block_id: block.block_id, content_hash: block.content_hash }]);
  const envelope = {
    schema: "ObservationEnvelope@1",
    source_id,
    source_media_type: media_type,
    decoder: { id: decoder_id, version: "1", loss: [{ kind: "none" }] },
    axes,
    fields: [{ field_id: `${axes[0].axis_id}:value`, value_type, block_id: block.block_id, axes: [axes[0].axis_id] }],
    anchors: { scheme: "index", selectors: { [`${axes[0].axis_id}:value`]: selectors } },
    source_content_hash: canonicalHashSync({ source_id, n: values.length }),
    blocks_hash,
  };
  return { envelope, blocks: [block] };
}

function seqSelectors(n) {
  return Array.from({ length: n }, (_, i) => ({ index_start: i, index_end: i + 1 }));
}

// ---- Tabular: a small numeric table, one column as a signed-integer field ----
const tabularVals = [12, 7, 9, 42, 5, 41, 40, 3];
const tabular = makeBundle({
  source_id: "source:quarterly.csv",
  media_type: "text/csv",
  decoder_id: "csv",
  axes: [{ axis_id: "row", topology: "ordered", unit: "row" }],
  value_type: "signed-integer",
  values: tabularVals,
  selectors: seqSelectors(tabularVals.length),
});

// ---- Audio: quantized 1-D samples of a sine burst (int16-ish) --------------
const audioVals = Array.from({ length: 64 }, (_, i) => Math.round(1000 * Math.sin(i / 3)));
const audio = makeBundle({
  source_id: "source:tone.wav",
  media_type: "audio/wav",
  decoder_id: "wav-pcm",
  axes: [{ axis_id: "sample", topology: "ordered", unit: "sample" }],
  value_type: "signed-integer",
  values: audioVals,
  selectors: seqSelectors(audioVals.length),
});

// ---- Image: flattened grayscale gradient, unsigned-integer pixels -----------
const W = 8, H = 8;
const imageVals = Array.from({ length: W * H }, (_, i) => (Math.floor(i / W) * 32 + (i % W) * 4) % 256);
const image = makeBundle({
  source_id: "source:gradient.pgm",
  media_type: "image/x-portable-graymap",
  decoder_id: "pgm",
  axes: [{ axis_id: "pixel", topology: "grid", unit: "pixel" }],
  value_type: "unsigned-integer",
  values: imageVals,
  selectors: seqSelectors(imageVals.length),
});

// ---- Binary: raw bytes of a tiny payload, unsigned-integer bytes ------------
const bytes = [...Buffer.from("EOREADER5\x00\x01\x02\x03omnimodal", "latin1")];
const binary = makeBundle({
  source_id: "source:blob.bin",
  media_type: "application/octet-stream",
  decoder_id: "raw-bytes",
  axes: [{ axis_id: "byte", topology: "ordered", unit: "byte" }],
  value_type: "unsigned-integer",
  values: bytes,
  selectors: seqSelectors(bytes.length),
});

function requestFor(bundle, queries) {
  return {
    schema: "RunRequest@1",
    context: {
      schema: "RunContext@1", frame_id: "frame:default", lens_ids: ["lens:neutral"], horizon: {},
      prior_snapshot_id: priorSnapshot.prior_id, engine_version: "0.1.0", operator_epoch: CURRENT_OPERATOR_EPOCH,
      source_null_policy: {}, validation_risk_budget: {}, compute_budget: { max_events: 64 }, requested_projections: ["default"],
    },
    prior: { schema: "ResolvedPriorBundle@1", snapshot: priorSnapshot, packs: [], content_hash: priorSnapshot.content_hash },
    observations: [bundle],
    queries: (queries ?? []).map((q) => ({ schema: "QueryRequest@1", query: q, limit: 3 })),
  };
}

async function run(label, bundle, queries) {
  const engine = createEOReaderEngine();
  const drain = async () => { const ev = []; for await (const e of engine.read(requestFor(bundle, queries))) ev.push(e); return ev; };
  let events, err = null;
  try { const a = await drain(); const b = await drain(); events = a; events.__det = JSON.stringify(a) === JSON.stringify(b); }
  catch (e) { err = e; }
  console.log(`\n=== ${label}: ${bundle.envelope.source_id} (${bundle.envelope.source_media_type}) ===`);
  if (err) { console.log(`  ADMIT FAILED: ${err.message}`); return; }
  const counts = events.reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a), {});
  const snap = events.find((e) => e.type === "snapshot")?.snapshot;
  console.log(`  units: ${bundle.blocks[0].values.length} | tape: ${events.length} events`, counts);
  console.log(`  deterministic: ${events.__det} | head: ${events.at(-1).semantic_head?.slice(0, 24)}…`);
  console.log(`  snapshot units field: ${snap ? (Array.isArray(snap.units) ? snap.units.length + " unit(s)" : typeof snap.units) : "(no snapshot)"}`);
  for (const e of events.filter((e) => e.type === "query")) {
    const r = e.reading ?? {};
    console.log(`  query "${r.request?.query ?? ""}": ${(r.passages ?? []).length} matching source-unit(s)`);
  }
}

await run("TABULAR", tabular, ["42"]);
await run("AUDIO", audio, ["1000"]);
await run("IMAGE", image, ["128"]);
await run("BINARY", binary, ["omnimodal"]);

console.log(`\nNote: search tokenizes string values only, so numeric-medium queries`);
console.log(`match at source granularity or not at all — the ingest/discovery/`);
console.log(`snapshot/projection fold-grid is shared across every medium; the`);
console.log(`per-medium *signal* layer (waveform/individuation) is not built yet.`);
