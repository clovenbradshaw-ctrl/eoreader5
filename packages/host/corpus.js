// Host-side corpus adapter: the ONLY surface a host (proxy, MCP server, chat
// app) should use to put text into the engine and get grounded spans back.
//
// Why this exists. Every host previously reached into the engine by relative
// filesystem path — `../../eoreader5/packages/engine/replay/index.js` — which
// bypasses the `exports` map entirely and makes the directory layout the de
// facto API. Each then hand-rolled its own `ObservationBlock@1` construction.
// That produced four divergent copies of the admission format and one silent
// correctness regression: `eoreader-mcp/lib/engine-bridge.js` wrote
// `byte_start: 0` for every chunk, so no quote could be checked against its
// source file, while `eoreader-proxy/proxy.js` had independently fixed the
// same bug. Schema construction has to happen in one place, inside a package
// that declares what it exports.
//
// Hosts get: admit text, search it, read a span verbatim, fold a selection.
// Hosts do NOT get `state.blockStore`, raw envelopes, or any path into
// `replay/`, `search/`, `emergence/`. Those are internals and may move.
//
// This is a HOST package, so unlike the engine it may touch the filesystem —
// reading files and walking directories live here, at the boundary, the same
// way `video.js` owns ffmpeg subprocesses. The engine stays pure.

import fs from 'node:fs';
import path from 'node:path';
import { createState, applyCommand } from '@eoreader/engine/replay';
import { search as engineSearch } from '@eoreader/engine/search';
import { fold as compressFold } from '@eoreader/engine/emergence/fold';
import { blockContentHash } from '@eoreader/engine/observation-index';
import { canonicalHashSync } from '@eoreader/spec/canonical-json';
import { CURRENT_OPERATOR_EPOCH } from '@eoreader/spec/operators';

// Bumped when the shape of anything returned here changes. Hosts should
// assert on it at startup, so a mismatch fails at boot with a clear message
// instead of surfacing as a wrong answer inside a chat turn weeks later —
// which is precisely how the byte_start regression stayed invisible.
export const CORPUS_API_VERSION = 1;

// Defaults named once, so the hosts stop each picking their own and drifting.
const DEFAULT_CHUNK_SIZE = 2000;
const DEFAULT_MIN_CHUNK_CHARS = 50;
const DEFAULT_SPAN_CAP = 2000;
const DEFAULT_PREVIEW_CHARS = 110;
const DEFAULT_SPAN_MAX_BYTES = 4000;

const SOURCE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.json', '.md', '.py', '.rs',
  '.go', '.rb', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
]);

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

const byteLength = (text) => utf8.encode(text).length;

// A host session: engine state plus the span registry that makes readSpan
// possible. `state` is replaced (not mutated) on each admit — applyCommand is
// immutable — so this object is the holder that saves every host from
// threading the new state back by hand.
export function createSession({ engineVersion = '0.1.0', spanCap = DEFAULT_SPAN_CAP } = {}) {
  const priorSnapshot = {
    schema_version: 'PriorSnapshot@1',
    prior_id: 'prior:sha256:' + '0'.repeat(64),
    operator_epoch: CURRENT_OPERATOR_EPOCH,
    ledger_head: 'head:empty',
    basis_id: 'basis:none',
    content_hash: 'sha256:' + '1'.repeat(64),
  };
  return {
    apiVersion: CORPUS_API_VERSION,
    state: createState({ engineVersion, operatorEpoch: CURRENT_OPERATOR_EPOCH, priorSnapshot }),
    spans: new Map(),
    spanCap,
  };
}

// Build the observation bundle for one span of text.
//
// `byteStart` is the offset of `text` within its SOURCE DOCUMENT, not within
// the chunk. Hardcoding it to 0 is the regression this module exists to make
// unrepeatable: anchors that all say "byte 0" look fine until something tries
// to verify a quote against the original file, at which point every citation
// is unfalsifiable.
//
// `capture` records the capture chain that produced this observation — which
// ingest holon, through what lens, what transformations happened, and what was
// dropped. It is optional; absence means "capture provenance was not recorded,"
// never "no mediation happened."
function bundle(text, sourceId, byteStart, capture = null) {
  const block = {
    schema: 'ObservationBlock@1',
    block_id: `block:${canonicalHashSync({ source: sourceId, values: [text] })}`,
    value_type: 'string',
    shape: [1],
    axis_order: ['paragraph'],
    values: [text],
    selectors: [{ byte_start: byteStart, byte_end: byteStart + byteLength(text) }],
    loss: [{ kind: 'none' }],
  };
  block.content_hash = blockContentHash(block);
  const blocks_hash = canonicalHashSync([
    { block_id: block.block_id, content_hash: block.content_hash },
  ]);
  const envelope = {
    schema: 'ObservationEnvelope@1',
    source_id: sourceId,
    source_media_type: 'text/plain',
    decoder: { id: 'plain-text', version: '1', loss: [{ kind: 'none' }] },
    axes: [{ axis_id: 'paragraph', topology: 'ordered', unit: 'paragraph' }],
    fields: [
      { field_id: 'paragraph:text', value_type: 'string', block_id: block.block_id, axes: ['paragraph'] },
    ],
    anchors: { scheme: 'byte', selectors: { 'paragraph:text': block.selectors } },
    source_content_hash: canonicalHashSync({ text }),
    blocks_hash,
    capture_provenance: capture ?? [
      { step_id: "step:plain-text:1", holon_id: "holon:host:plain-text-decode", lens_id: "lens:neutral" },
    ],
  };
  return { envelope, blocks: [block] };
}

// Admit one span of text as its own observation. Returns the ids so a host
// can log provenance without inspecting `state`.
export function admitText(session, { text, sourceId, byteStart = 0, capture } = {}) {
  if (typeof text !== 'string' || !text.length) {
    throw new TypeError('admitText requires non-empty { text }');
  }
  if (typeof sourceId !== 'string' || !sourceId.length) {
    throw new TypeError('admitText requires a { sourceId }');
  }
  const { envelope, blocks } = bundle(text, sourceId, byteStart, capture);
  session.state = applyCommand(session.state, {
    type: 'observation.admit',
    payload: { envelope, blocks },
  });
  return {
    sourceId,
    blockId: blocks[0].block_id,
    byteStart,
    byteEnd: blocks[0].selectors[0].byte_end,
  };
}

// Split text into ~chunkSize line-runs and admit each as its own observation,
// so search retrieves a paragraph rather than a whole document. This is the
// "file into the fold, not into the prompt" path: content lands in the
// session, never in a chat message.
//
// The cursor arithmetic is load-bearing and is why this is one function rather
// than four. split("\n")/join("\n") round-trips byte-for-byte (a CR stays
// inside the line), so advancing by the joined byte length plus one separator
// tracks the original document exactly. Leading whitespace trimmed off a chunk
// is added back onto the offset, so byteStart still points at the first
// retained byte.
// `baseByteStart` is the offset of `text` within the file it came from. It is
// non-zero whenever a caller trims something off the front before admitting —
// stripping Gutenberg boilerplate, skipping a header, decoding a sub-range.
// Without it, offsets address the TRIMMED STRING while `source_id` names the
// FILE, so every anchor is silently shifted by the length of what was removed.
// Measured on pg84.txt: spans came back verbatim but 686 bytes early, which
// looks correct in every test that only re-reads through this process and is
// wrong the moment anyone opens the file.
export function admitChunked(
  session,
  {
    text,
    sourceId,
    chunkSize = DEFAULT_CHUNK_SIZE,
    minChars = DEFAULT_MIN_CHUNK_CHARS,
    baseByteStart = 0,
  } = {},
) {
  if (typeof text !== 'string') throw new TypeError('admitChunked requires { text }');
  if (typeof sourceId !== 'string' || !sourceId.length) {
    throw new TypeError('admitChunked requires a { sourceId }');
  }

  const lines = text.split('\n');
  const admitted = [];
  let chunk = [];
  let size = 0;
  let count = 0;
  let cursor = baseByteStart;

  const flush = () => {
    const raw = chunk.join('\n');
    const body = raw.trim();
    if (body.length > minChars) {
      const lead = raw.length - raw.trimStart().length;
      admitted.push(admitText(session, {
        text: body,
        sourceId: `${sourceId}:chunk-${count}`,
        byteStart: cursor + byteLength(raw.slice(0, lead)),
      }));
      count++;
    }
    cursor += byteLength(raw) + 1; // +1 for the consumed "\n"
    chunk = [];
    size = 0;
  };

  for (const line of lines) {
    chunk.push(line);
    size += line.length;
    if (size > chunkSize) flush();
  }
  if (chunk.length > 0) flush();

  return { chunks: count, admitted };
}

// Read a file and admit it, chunked. Gutenberg boilerplate is stripped when
// present — the markers bracket the actual work, and leaving them in put
// license text into search results.
export function ingestFile(session, filePath, { sourceId, chunkSize, minChars } = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const start = raw.indexOf('*** START OF THE PROJECT GUTENBERG');
  const end = raw.indexOf('*** END OF THE PROJECT GUTENBERG');
  const trimmed = start >= 0 && end >= 0;
  const text = trimmed ? raw.slice(start, end) : raw;
  return admitChunked(session, {
    text,
    sourceId: sourceId || `source:${filePath}`,
    chunkSize,
    minChars,
    // indexOf gives a CHARACTER index; anchors are byte offsets. Measuring the
    // discarded prefix in bytes is what keeps a multi-byte character anywhere
    // in the boilerplate from shifting every anchor in the file.
    baseByteStart: trimmed ? byteLength(raw.slice(0, start)) : 0,
  });
}

// Walk a directory and admit every source file. Dotfiles and node_modules are
// skipped; unreadable entries are stepped over rather than aborting the walk.
export function ingestDir(session, dirPath, { extensions, chunkSize, minChars } = {}) {
  const allowed = extensions
    ? new Set(extensions.map((e) => (e.startsWith('.') ? e : '.' + e)))
    : SOURCE_EXTENSIONS;
  let chunks = 0;
  let files = 0;

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())) {
        try {
          chunks += ingestFile(session, full, { chunkSize, minChars }).chunks;
          files++;
        } catch {
          // An unreadable or undecodable file is not a reason to abandon the
          // rest of the tree.
        }
      }
    }
  };

  walk(dirPath);
  return { chunks, files };
}

// Register a passage so its bytes can be read back later.
//
// Everything needed already rides on the passage (anchors.selectors,
// anchors.exact_text), so nothing here touches state.blockStore. Hosts that
// reached into the block store were duplicating what search had already handed
// them, and doing it behind `?.` — so an engine refactor degraded into a wrong
// answer instead of an error.
function registerSpan(session, passage, previewChars) {
  const selector = passage.anchors?.selectors?.[0] ?? {};
  const values = passage.anchors?.exact_text ?? [];
  const record = {
    span_id: passage.passage_id,
    source_id: passage.source_id,
    block_id: passage.block_id,
    byte_start: selector.byte_start ?? null,
    byte_end: selector.byte_end ?? null,
    score: passage.score,
    // Why this passage ranked where it did — rarity-weighted term coverage and
    // the contiguous-phrase bonus, carried through from search. A ranked list
    // without its reasons is an assertion; with them a reader can check the
    // engine's work instead of trusting it.
    coverage: passage.coverage ?? null,
    phrase: passage.phrase ?? null,
    // The verbatim value, kept whole. exact_text is an array of block values;
    // joining it inserts separators that are not in the source — fine for a
    // preview, wrong for a quote.
    text: typeof values[0] === 'string' ? values[0] : null,
    // Retrieval preview ONLY: deliberately short and elided. At 200 chars this
    // read as a quotable excerpt and callers quoted it directly, shipping the
    // lossy join(" ") reconstruction as if it were source text. A preview has
    // to be long enough to choose by and too short to quote.
    preview: values.join(' ').slice(0, previewChars).trim() + ' …',
  };
  if (session.spans.size >= session.spanCap) {
    session.spans.delete(session.spans.keys().next().value);
  }
  session.spans.set(record.span_id, record);
  return record;
}

// Search the session. Returns span descriptors — ids, anchors, previews —
// never quotable text. Call readSpan to get bytes.
export function searchSpans(session, { query, limit = 5, previewChars = DEFAULT_PREVIEW_CHARS } = {}) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return { spans: [], gaps: [], quotable: false };

  const result = engineSearch(session.state, {
    query: q,
    limit: Math.min(Math.max(Number(limit) || 5, 1), 40),
  });

  const spans = (result.passages || []).map((p) => {
    const rec = registerSpan(session, p, previewChars);
    return {
      span_id: rec.span_id,
      source_id: rec.source_id,
      byte_start: rec.byte_start,
      byte_end: rec.byte_end,
      score: rec.score,
      coverage: rec.coverage,
      phrase: rec.phrase,
      preview: rec.preview,
    };
  });

  return { spans, gaps: result.gaps || [], quotable: false };
}

// Return the exact bytes of a previously-searched span.
//
// The block's stored value is the text that was admitted, and its selectors
// are byte offsets of that value in the source document — so this is verbatim
// AND checkable: open source_id at byte_start and you get this text back.
// corpus.test.js enforces that round-trip against a real file.
export function readSpan(session, { spanId, maxBytes = DEFAULT_SPAN_MAX_BYTES } = {}) {
  const rec = session.spans.get(spanId);
  if (!rec) return { error: `unknown span_id ${spanId}. Search first.` };
  if (typeof rec.text !== 'string') {
    return { error: `span ${spanId} has no stored bytes (block ${rec.block_id})` };
  }

  const cap = Math.min(
    Math.max(Number(maxBytes) || DEFAULT_SPAN_MAX_BYTES, 1),
    DEFAULT_SPAN_MAX_BYTES * 4,
  );
  const bytes = utf8.encode(rec.text);
  const truncated = bytes.length > cap;
  const text = truncated ? utf8Decoder.decode(bytes.subarray(0, cap)) : rec.text;

  return {
    span_id: rec.span_id,
    source_id: rec.source_id,
    byte_start: rec.byte_start,
    // Narrow the anchor to what was actually returned, so the byte range always
    // describes the text in hand rather than the untruncated span.
    byte_end: truncated ? (rec.byte_start ?? 0) + cap : rec.byte_end,
    verbatim: true,
    truncated,
    text,
  };
}

// Convert span descriptors into fold units carrying VERBATIM text.
//
// Multi-round search loops accumulate: round N folds the previous round's
// selection together with new hits. Without this, callers reconstructed unit
// text by joining `exact_text` with spaces — inserting separators that are not
// in the source, so what got folded (and then quoted) was subtly not the
// document. The registry already holds the exact admitted value; use it.
export function spanUnits(session, spans = []) {
  return spans
    .map((s) => session.spans.get(s?.span_id ?? s))
    .filter((rec) => rec && typeof rec.text === 'string')
    .map((rec) => ({
      text: rec.text,
      coord: null,
      meta: { source_id: rec.source_id, score: rec.score, span_id: rec.span_id },
    }));
}

// Compress a selection under a token budget. Accepts span descriptors from
// searchSpans, bare span ids, or raw { text, meta } units.
export function foldSpans(session, { spans, units, query, tokenBudget = 600, maxUnits = 8 } = {}) {
  const source = units ?? (spans || []).map((s) => {
    const rec = session.spans.get(s?.span_id ?? s);
    return {
      text: rec?.text ?? '',
      coord: null,
      meta: { source_id: rec?.source_id, score: rec?.score },
    };
  });

  const result = compressFold(
    { units: source.filter((u) => u.text), query },
    { tokenBudget, maxUnits },
  );

  return {
    summary: result.summary,
    // The units the fold kept, as an ARRAY — multi-round callers feed the
    // previous round's selection back in alongside new hits, so this has to
    // stay re-foldable. The forked bridges returned `.length` here, which
    // silently turned an accumulating search loop into a single-round one.
    selected: result.selected,
    selectedCount: result.selected.length,
    tokens: result.totalTokens,
    budget: result.budget,
    dropped: result.dropped,
  };
}
