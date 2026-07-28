// The corpus adapter's one non-negotiable property: a span's byte range must
// address the same bytes in the ORIGINAL FILE that readSpan hands back.
//
// This is the invariant the forked copies broke. `eoreader-mcp`'s
// engine-bridge wrote `byte_start: 0` on every chunk, which is invisible to
// every test that only checks "did I get text back" and fatal to the one thing
// spans exist for — checking a quote against its source. The round-trip below
// fails loudly on that bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CORPUS_API_VERSION,
  createSession,
  admitText,
  admitChunked,
  ingestFile,
  searchSpans,
  readSpan,
  foldSpans,
} from './corpus.js';

// Prose with a findable needle far enough in that a naive byte_start of 0
// cannot accidentally be correct.
function fixture() {
  const filler = 'The wind moved over the water and the light changed slowly.\n';
  return [
    filler.repeat(40),
    'A solitary figure kept the lighthouse through the winter of that year.\n',
    filler.repeat(40),
    'The keeper recorded every vessel that passed the northern shoal.\n',
    filler.repeat(40),
  ].join('');
}

function withTempFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-corpus-'));
  const file = path.join(dir, 'fixture.txt');
  fs.writeFileSync(file, contents, 'utf8');
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('exports a version hosts can assert on', () => {
  assert.equal(typeof CORPUS_API_VERSION, 'number');
});

test('admitChunked assigns real, increasing byte offsets', () => {
  const session = createSession();
  const { chunks, admitted } = admitChunked(session, {
    text: fixture(),
    sourceId: 'source:fixture',
  });

  assert.ok(chunks > 1, 'fixture should produce several chunks');
  // The regression: every offset identical (and zero).
  const starts = admitted.map((a) => a.byteStart);
  assert.notDeepEqual(starts, starts.map(() => 0), 'byte_start must not be hardcoded to 0');
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] > starts[i - 1], `offsets must increase: ${starts[i - 1]} -> ${starts[i]}`);
  }
});

test('readSpan returns bytes that match the source file at the reported range', () => {
  const text = fixture();
  withTempFile(text, (file) => {
    const session = createSession();
    ingestFile(session, file, { sourceId: 'source:fixture' });

    const { spans } = searchSpans(session, { query: 'lighthouse winter solitary', limit: 3 });
    assert.ok(spans.length > 0, 'expected the needle to be findable');

    const raw = fs.readFileSync(file); // Buffer — byte-addressed, like the anchors
    for (const s of spans) {
      const span = readSpan(session, { spanId: s.span_id });
      assert.equal(span.verbatim, true);
      assert.equal(span.truncated, false);

      const fromFile = raw.subarray(span.byte_start, span.byte_end).toString('utf8');
      assert.equal(
        fromFile,
        span.text,
        'bytes at [byte_start, byte_end) in the source file must equal the span text',
      );
    }
  });
});

test('anchors survive boilerplate stripping and still address the real file', () => {
  // ingestFile discards Gutenberg front matter before chunking. If the
  // discarded prefix is not added back onto the offsets, spans come back
  // verbatim but shifted — measured at 686 bytes on pg84.txt — which passes
  // every test that only re-reads through this process and fails the moment
  // anyone opens the file at the offsets the anchor claims.
  const header = [
    'The Project Gutenberg eBook of Something',
    'This ebook is for the use of anyone anywhere at no cost.',
    'Título with a multi-byte character, to catch char-vs-byte counting.',
    '',
  ].join('\n');
  const body = '*** START OF THE PROJECT GUTENBERG EBOOK SOMETHING ***\n' + fixture()
    + '\n*** END OF THE PROJECT GUTENBERG EBOOK SOMETHING ***\n';

  withTempFile(header + body, (file) => {
    const session = createSession();
    ingestFile(session, file);

    const { spans } = searchSpans(session, { query: 'lighthouse winter solitary', limit: 3 });
    assert.ok(spans.length > 0);

    const raw = fs.readFileSync(file);
    for (const s of spans) {
      const span = readSpan(session, { spanId: s.span_id });
      assert.equal(
        raw.subarray(span.byte_start, span.byte_end).toString('utf8'),
        span.text,
        'stripped boilerplate must be added back onto the byte offsets',
      );
    }
  });
});

test('a span read back is a substring of the original document', () => {
  const text = fixture();
  const session = createSession();
  admitChunked(session, { text, sourceId: 'source:fixture' });
  const { spans } = searchSpans(session, { query: 'northern shoal vessel', limit: 2 });
  assert.ok(spans.length > 0);

  for (const s of spans) {
    const span = readSpan(session, { spanId: s.span_id });
    assert.ok(text.includes(span.text), 'span text must occur verbatim in the source');
  }
});

test('truncation narrows the anchor to the bytes actually returned', () => {
  const session = createSession();
  admitChunked(session, { text: fixture(), sourceId: 'source:fixture' });
  const { spans } = searchSpans(session, { query: 'lighthouse', limit: 1 });
  assert.ok(spans.length > 0);

  const cap = 64;
  const span = readSpan(session, { spanId: spans[0].span_id, maxBytes: cap });
  assert.equal(span.truncated, true);
  assert.equal(span.byte_end - span.byte_start, cap, 'anchor must describe the text in hand');
  assert.equal(Buffer.byteLength(span.text, 'utf8'), cap);
});

test('previews are too short to quote and are flagged unquotable', () => {
  const session = createSession();
  admitChunked(session, { text: fixture(), sourceId: 'source:fixture' });
  const result = searchSpans(session, { query: 'lighthouse', limit: 2 });

  assert.equal(result.quotable, false);
  for (const s of result.spans) {
    assert.ok(s.preview.length < 200, 'a preview long enough to quote invites quoting it');
    assert.ok(s.preview.endsWith('…'), 'previews must be visibly elided');
  }
});

test('readSpan refuses an unknown span instead of inventing one', () => {
  const session = createSession();
  const result = readSpan(session, { spanId: 'passage:sha256:nope' });
  assert.ok(result.error, 'unknown spans must be a typed error, never empty text');
  assert.equal(result.text, undefined);
});

test('admitText rejects malformed input rather than admitting a bad block', () => {
  const session = createSession();
  assert.throws(() => admitText(session, { text: '', sourceId: 'source:x' }), TypeError);
  assert.throws(() => admitText(session, { text: 'hello', sourceId: '' }), TypeError);
});

test('foldSpans compresses a selection under its token budget', () => {
  const session = createSession();
  admitChunked(session, { text: fixture(), sourceId: 'source:fixture' });
  const { spans } = searchSpans(session, { query: 'lighthouse keeper vessel', limit: 5 });

  const folded = foldSpans(session, { spans, query: 'who kept the lighthouse', tokenBudget: 120 });
  assert.ok(typeof folded.summary === 'string');
  assert.ok(Array.isArray(folded.selected), 'selected must stay re-foldable across rounds');
  assert.equal(folded.selectedCount, folded.selected.length);
  assert.ok(folded.tokens <= 120 || folded.selectedCount <= 1, 'fold must respect its budget');
});

test('a selection can be re-folded with new hits, as a search loop does', () => {
  const session = createSession();
  admitChunked(session, { text: fixture(), sourceId: 'source:fixture' });

  const first = searchSpans(session, { query: 'lighthouse winter', limit: 3 });
  const round0 = foldSpans(session, { spans: first.spans, query: 'the keeper', tokenBudget: 2000 });
  assert.ok(round0.selectedCount >= 1, 'round 0 must select something to carry forward');

  const second = searchSpans(session, { query: 'northern shoal', limit: 3 });
  const carried = foldSpans(session, {
    units: [...round0.selected, ...second.spans.map((s) => {
      const rec = session.spans.get(s.span_id);
      return { text: rec.text, coord: null, meta: { source_id: rec.source_id } };
    })],
    query: 'the keeper',
    // Chunks here run ~2KB (~500 tokens); a budget below one whole unit makes
    // the fold correctly select nothing, which would test the wrong thing.
    tokenBudget: 2000,
  });

  assert.ok(typeof carried.summary === 'string');
  assert.ok(carried.selectedCount >= 1, 'accumulated rounds must still select');
});

test('the span registry evicts rather than growing without bound', () => {
  const session = createSession({ spanCap: 3 });
  admitChunked(session, { text: fixture(), sourceId: 'source:fixture' });
  searchSpans(session, { query: 'wind water light', limit: 10 });
  assert.ok(session.spans.size <= 3, 'registry must honour its cap');
});
