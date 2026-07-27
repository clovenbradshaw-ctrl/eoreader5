/**
 * Text signal perceiver: field vectors from raw text.
 *
 * Mirrors the audio signal pipeline (audio/reading.js) — windows the signal
 * into overlapping frames and extracts numerical field vectors per frame.
 * NO structure-finding: no sentence boundaries, no entity extraction, no
 * stop-word lists. Structure is the engine's job via emergence.
 */

const FRAME_CHARS = 512;
const HOP_CHARS = 256;
const HASH_BINS = 128;

function hashCharNgram(ngram, bins = HASH_BINS) {
  let h = 0x811c9dc5;
  for (let i = 0; i < ngram.length; i++) {
    h ^= ngram.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % bins;
}

function normalize(v) {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm < 1e-10) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function charNgramProfile(text, bins = HASH_BINS) {
  const profile = new Float64Array(bins);
  for (let i = 0; i < text.length - 2; i++) {
    const tri = text.slice(i, i + 3);
    profile[hashCharNgram(tri, bins)] += 1;
  }
  return normalize(profile);
}

function wordLenProfile(text) {
  let words = text.split(/\s+/);
  let total = 0, sumLens = 0, sumLens2 = 0;
  for (const w of words) {
    total++;
    sumLens += w.length;
    sumLens2 += w.length * w.length;
  }
  if (total === 0) return [0, 0];
  const mean = sumLens / total;
  const variance = sumLens2 / total - mean * mean;
  return [mean / 20, Math.min(variance, 100) / 100];
}

function frameSignal(text, frameChars, hop) {
  const frames = [];
  for (let start = 0; start < text.length; start += hop) {
    frames.push(text.slice(start, start + frameChars));
  }
  if (frames.length === 0 && text.length > 0) frames.push(text);
  return frames;
}

export const TEXT_FIELD_SPEC = Object.freeze({
  channels: [
    { name: 'char-3gram', dims: HASH_BINS, metric: 'cosine' },
    { name: 'wordlen', dims: 2, metric: 'euclidean-standardised' },
  ],
});

export function extractTextFieldVectors(text, opts = {}) {
  const frameChars = opts.frameChars ?? FRAME_CHARS;
  const hop = opts.hop ?? HOP_CHARS;
  const frames = frameSignal(text, frameChars, hop);

  const perFrame = frames.map((frame, idx) => {
    const char3gram = charNgramProfile(frame, HASH_BINS);
    const wordlen = wordLenProfile(frame);
    return {
      pos: idx * hop,
      span: frame.length,
      field: Array.from(char3gram).concat(wordlen),
      char3gram: Array.from(char3gram),
      wordlen,
    };
  });

  return { frames: perFrame, frameChars, hop };
}

export function buildTextFieldText(text, sourceId, opts = {}) {
  const { frames, frameChars, hop } = extractTextFieldVectors(text, opts);

  const units = frames.map((f, idx) => ({
    source_id: `${sourceId}:frame-${idx}`,
    pos: f.pos,
    span: f.span,
    field: f.field,
    char3gram: f.char3gram,
    wordlen: f.wordlen,
  }));

  const totalChars = text.length;

  return {
    schema: 'TextSignalReading@1',
    medium: 'text',
    axis: { kind: 'character', unit: 'char', extent: totalChars },
    units,
    field_spec: TEXT_FIELD_SPEC,
    perceiver: {
      id: 'text-field-vectors',
      version: '0.1.0',
      params: { frameChars, hop },
    },
  };
}

export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom < 1e-10 ? 0 : dot / denom;
}

export function querySignal(query) {
  const { frames } = extractTextFieldVectors(query);
  if (frames.length === 0) return null;
  const combined = new Float64Array(frames[0].field.length);
  for (const f of frames) {
    for (let i = 0; i < f.field.length; i++) combined[i] += f.field[i];
  }
  return normalize(combined);
}
