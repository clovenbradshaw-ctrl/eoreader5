// End-to-end demo: drive a full public-domain text through the pure engine.
// Builds one ObservationEnvelope@1 (paragraph axis, byte-anchored) the way an
// app sense organ would, then streams it through createEOReaderEngine and
// reports the deterministic event tape plus a few anchored queries.
//
// Usage: node scripts/read-book-demo.mjs <path-to-text> "<query>" ["<query>" ...]

import { readFileSync } from "node:fs";
import { createEOReaderEngine, blockContentHash } from "@eoreader/engine";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";

const [, , bookPath, ...queries] = process.argv;
if (!bookPath) {
  console.error('usage: node scripts/read-book-demo.mjs <path-to-text> "<query>" ...');
  process.exit(2);
}

const raw = readFileSync(bookPath);
// Normalize CRLF/CR to LF so paragraph splitting and byte offsets are consistent.
const text = raw.toString("utf8").replace(/\r\n?/g, "\n");

// Paragraph segmentation with real byte offsets, so anchors round-trip to source.
const paragraphs = [];
const selectors = [];
{
  const re = /\n[ \t]*\n/g;
  let start = 0;
  let m;
  const pushSpan = (from, to) => {
    const slice = text.slice(from, to).trim();
    if (!slice) return;
    const byte_start = Buffer.byteLength(text.slice(0, from), "utf8");
    const byte_end = byte_start + Buffer.byteLength(text.slice(from, to), "utf8");
    paragraphs.push(slice.replace(/\s+/g, " "));
    selectors.push({ byte_start, byte_end });
  };
  while ((m = re.exec(text))) {
    pushSpan(start, m.index);
    start = re.lastIndex;
  }
  pushSpan(start, text.length);
}

const block = {
  schema: "ObservationBlock@1",
  block_id: `block:${canonicalHashSync({ source: bookPath, values: paragraphs })}`,
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
  source_id: `source:${bookPath.split("/").pop()}`,
  source_media_type: "text/plain",
  decoder: { id: "plain-text", version: "1", loss: [{ kind: "none" }] },
  axes: [{ axis_id: "paragraph", topology: "ordered", unit: "paragraph" }],
  fields: [{ field_id: "paragraph:text", value_type: "string", block_id: block.block_id, axes: ["paragraph"] }],
  anchors: { scheme: "byte", selectors: { "paragraph:text": selectors } },
  source_content_hash: canonicalHashSync({ bytes: raw.toString("base64") }),
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

const request = {
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
  queries: queries.map((q) => ({ schema: "QueryRequest@1", query: q, limit: 3 })),
};

async function drain(engine) {
  const events = [];
  for await (const event of engine.read(request)) events.push(event);
  return events;
}

const engine = createEOReaderEngine();
const run1 = await drain(engine);
const run2 = await drain(engine);

const counts = run1.reduce((acc, e) => ((acc[e.type] = (acc[e.type] || 0) + 1), acc), {});
const deterministic = JSON.stringify(run1) === JSON.stringify(run2);

console.log(`\n=== ${envelope.source_id} ===`);
console.log(`paragraphs (observation units): ${paragraphs.length}`);
console.log(`event tape: ${run1.length} events`, counts);
console.log(`deterministic replay (run1 === run2): ${deterministic}`);
console.log(`final semantic_head: ${run1.at(-1).semantic_head}`);

const snapshot = run1.find((e) => e.type === "snapshot")?.snapshot;
if (snapshot) {
  console.log(`reading snapshot head: ${snapshot.semantic_head ?? snapshot.head ?? "(n/a)"}`);
  console.log(`snapshot keys: ${Object.keys(snapshot).join(", ")}`);
}
for (const e of run1.filter((e) => e.type === "query")) {
  const r = e.reading ?? {};
  const q = r.request?.query ?? r.query ?? "";
  const p = r.passages ?? [];
  // Search granularity today is per-source-field: a matching source returns its
  // whole text as one anchored unit. Localize the query term within that unit's
  // paragraph values so the demo shows a concrete, source-anchored hit.
  console.log(`\nquery "${q}": ${p.length} matching source-unit(s)`);
  for (const hit of p.slice(0, 1)) {
    const vals = hit.anchors?.exact_text ?? [];
    const sels = hit.anchors?.selectors ?? [];
    const idx = vals.findIndex((v) => v.toLowerCase().includes(q.toLowerCase()));
    if (idx >= 0) {
      const sel = sels[idx];
      const snippet = vals[idx].slice(0, 160);
      console.log(`  · localized to paragraph #${idx} [bytes ${sel?.byte_start}-${sel?.byte_end}]: ${snippet}${vals[idx].length > 160 ? "…" : ""}`);
    } else {
      console.log(`  · source matched but term not found in any paragraph value (coarse match).`);
    }
  }
}
