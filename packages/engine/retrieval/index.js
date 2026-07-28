// retrieval/index.js — Signal-based retrieval with fold for context.
//
// The fold at sentence resolution is useless — all sentences produce
// Entity:1.000 terrain because any personal pronoun triggers it.
// The char-n-gram SIGNAL (128-bin character trigram hash + word length
// stats) discriminates much better at short text lengths.
//
// Pipeline:
//   1. Index: extract signal vectors for every sentence (O(1) per sentence)
//   2. Query: extract signal vector for query, cosine against index
//   3. Verify: fold the span for context verification and scene walking
//   4. Brain: DEF(query signal) → EVA(cosine) → VERIFY(context walk) → REC(abs)

import { fold } from "../quantum/index.js";
import { extractTextFieldVectors, cosineSimilarity } from "../perceiver/text/text-signal.js";

// ── Sentence index ───────────────────────────────────────────────────────────

export function buildSentenceIndex(text) {
  const s = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const entries = [];
  const re = /(?<=[.!?])\s+(?=["'""''«»]?\p{Lu})/gu;
  let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    const raw = s.slice(last, m.index + 1).trim();
    if (raw.length > 0) {
      const signal = extractTextFieldVectors(raw);
      entries.push({
        offset: last,
        length: raw.length,
        text: raw,
        signal: signal.frames[0]?.field ?? null,
        fold: fold(raw),
      });
    }
    last = m.index + 1;
  }
  const tail = s.slice(last).trim();
  if (tail.length > 0) {
    const signal = extractTextFieldVectors(tail);
    entries.push({
      offset: last,
      length: tail.length,
      text: tail,
      signal: signal.frames[0]?.field ?? null,
      fold: fold(tail),
    });
  }
  return entries;
}

// ── Query ────────────────────────────────────────────────────────────────────

function scoreEntry(querySignal, entry) {
  if (!querySignal || !entry.signal) return 0;
  return cosineSimilarity(querySignal, entry.signal);
}

/**
 * Query the sentence index using char-n-gram signal similarity.
 *
 * @param {object} options.context — discourse context from DiscourseState.getContext()
 *   When provided, the query signal is blended with the context fold's terrain
 *   to bias results toward the ongoing discourse.
 */
export function queryIndex(index, queryText, options = {}) {
  const { limit = 10, minScore = 0, context = null } = options;
  const qText = String(queryText ?? "").trim();
  if (!qText) return [];

  const qSignal = extractTextFieldVectors(qText);
  let qField = qSignal.frames[0]?.field ?? null;
  if (!qField) return [];

  // Condition the query signal on discourse context.
  // The context fold's terrain face tells us what DOMAIN the conversation
  // is currently in (Entity, Link, Atmosphere, etc.). We blend this into
  // the query's word-length stats (the last 2 dimensions of the signal)
  // to bias toward the current topic.
  if (context?.contextFold) {
    const terrain = context.contextFold.terrain ?? {};
    // Find the dominant terrain in the context
    let bestTer = null, bestAmp = 0;
    for (const [k, v] of Object.entries(terrain)) {
      if (v > bestAmp) { bestAmp = v; bestTer = k; }
    }
    if (bestTer) {
      // Encode terrain into the word-length features (last 2 dims)
      // Word-length signal: [mean/20, var/100] — inject terrain bias
      const terIdx = ["Void","Entity","Kind","Field","Link","Network","Atmosphere","Lens","Paradigm"].indexOf(bestTer);
      if (terIdx >= 0) {
        // Shift word-length mean by terrain bias: Entity→higher, Void→lower
        const bias = (terIdx - 4) / 10; // -0.4 to +0.4
        qField[qField.length - 2] = (qField[qField.length - 2] + bias) / 2;
        qField[qField.length - 1] = qField[qField.length - 1] * 0.5 + 0.5 * (context.nActive / 25);
      }
    }
  }

  // Location bias: if discourse has a recent offset (from previous results),
  // boost entries near that offset. This is the "walk to the chapter" mechanic:
  // once you know Natasha's ball is at ~1.18M, questions about it should
  // search near that region, not the whole book.
  const locBias = context?.location != null ? context.location : null;
  const locRadius = context?.locationRadius ?? 50000; // chars

  const results = [];
  for (const entry of index) {
    let score = scoreEntry(qField, entry);
    if (score >= minScore) {
      // Apply location bias if available
      if (locBias != null) {
        const dist = Math.abs(entry.offset - locBias);
        if (dist < locRadius) {
          score = score * (1 + (1 - dist / locRadius) * 0.5);
        }
      }
      results.push({ ...entry, score });
    }
  }

  results.sort((a, b) => b.score - a.score || a.offset - b.offset);
  return results.slice(0, limit);
}

// ── Retrieval Session (DEF → EVA → REC) ──────────────────────────────────────

export class RetrievalSession {
  constructor() {
    this.priors = { termFreq: new Map(), entities: new Set() };
    this.loops = 0;
    this.viewedSpans = [];
  }

  query(index, queryText, options = {}) {
    const r = queryIndex(index, queryText, options);
    this.loops++;
    return r;
  }

  absorbSpan(text) {
    const words = String(text ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    for (const w of words) this.priors.termFreq.set(w, (this.priors.termFreq.get(w) ?? 0) + 1);
    const caps = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
    if (caps) {
      for (const c of caps) {
        if (c.length > 2) this.priors.entities.add(c.toLowerCase());
      }
    }
    this.viewedSpans.push(text);
  }

  get termCount() { return this.priors.termFreq.size; }
  get entityCount() { return this.priors.entities.size; }
}

export { cosineSimilarity };
