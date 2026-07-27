// spine.js — significance spine: document-scale turning points via forward surprise.
//
// Ported from eoreader4.2:src/perceiver/spine.js. The original samples cursors
// on a budget-capped stride and reads Bayesian surprise (D_KL(posterior||prior))
// at each via readingAt(doc, cursor), which needs the full parse/log/graph
// substrate. v5 has no such substrate — but forwardScore(unit, history) computes
// the same thing (KL divergence of a unit's word distribution against the
// cumulative distribution of everything read before it), so the spine ports
// as a pure function over sentences instead of over a log.
//
// The insight carries over unchanged: the sentences where forward surprise
// peaks are where the entity's story was "rewritten" — new vocabulary entering
// (an elopement, a wound, a wedding) that the accumulated history didn't
// predict. Those peaks are the entity's key moments / scene detection.
//
// BOUNDED: samples on a stride sized to a fixed budget so cost stays flat
// regardless of document length. A short list of sentences (below budget)
// is read in full (stride 1).

import { forwardScore } from "../surprise/index.js";

const DEFAULT_BUDGET = 600; // at most this many surprise readings
const DEFAULT_K = 12; // at most this many peaks returned
const DEFAULT_WINDOW = 60; // sliding history window (approximates γ-decay)
const DEFAULT_MIN_WORDS = 6; // ignore fragments too short to be a scene

// Short fragments ("Natásha...", "Go, Natásha!") get inflated KL scores:
// a handful of words each carrying high individual probability mass looks
// "surprising" against any background, regardless of narrative content.
// A minimum word-count floor keeps the spine scoring real sentences, not
// interjections and dialogue tags.

// Without a decay, forwardScore's cumulative background dilutes toward a
// stable average and (worse) starts nearly empty — so the FIRST sentences
// of a long entity-mention stream always look most "surprising" simply
// because the background hasn't accumulated yet. eoreader4.2's readingAt
// solves this with a γ-decayed prior (older evidence down-weighted, not
// just diluted by more mass). Without that infrastructure, a bounded
// sliding window over recent history is the direct analogue: it keeps the
// "expected" distribution fresh relative to what's just been read, so a
// scene's novelty is measured against its immediate narrative neighborhood,
// not the whole book's accumulated vocabulary.

/**
 * Find the document-scale turning points: sentences of highest forward
 * surprise relative to everything read before them.
 *
 * @param {Array<{ text: string, idx: number }>} sentences - in reading order
 * @param {object} options - { budget, k }
 * @returns {{ peaks: number[], stride: number, sampled: number, units: number }}
 *   peaks   — the k sentence indices of highest forward surprise, in reading
 *             order (a forward tour of turning points, not a ranked list)
 *   stride  — the sampling grain (1 = every sentence read)
 *   sampled — how many sentences were actually scored
 *   units   — total sentence count
 */
export function significanceSpine(sentences, options = {}) {
  const {
    budget = DEFAULT_BUDGET,
    k = DEFAULT_K,
    window = DEFAULT_WINDOW,
    minWords = DEFAULT_MIN_WORDS,
    // Cold-start mask. Forward surprise against an empty/thin history is
    // inflated by construction — the first statements of a motif score high
    // because there is nothing to compare them to, not because they are
    // turning points (measured: unmasked, 12/12 selected spans fell in the
    // first 27.5% of War and Peace). With minHistory = h, a unit is scored
    // only once h prior units have accumulated. Default 0 preserves the
    // legacy behavior for existing consumers.
    minHistory = 0,
  } = options;
  const S = sentences.length;
  if (S === 0) return { peaks: [], stride: 1, sampled: 0, units: 0 };

  const stride = Math.max(1, Math.ceil(S / budget));

  // History is a bounded sliding window over recent non-blank sentences
  // (see DEFAULT_WINDOW note above) — not the full accumulation. Positions
  // (array indices into `sentences`) are used throughout — NOT the
  // sentence's own `.idx` field, which may be a sparse document-wide index
  // when `sentences` is a filtered subset (e.g. only entity mentions).
  const history = [];
  const sample = [];

  for (let pos = 0; pos < S; pos++) {
    const s = sentences[pos];
    const text = String(s?.text ?? "");
    const blank = !text.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (!blank && wordCount >= minWords && pos % stride === 0 && history.length >= minHistory) {
      const score = forwardScore(s, history);
      sample.push({ pos, score });
    }

    if (!blank) {
      history.push(s);
      if (history.length > window) history.shift();
    }
  }

  const topSorted = [...sample].sort((a, b) => b.score - a.score).slice(0, k);
  // Expose EVERY sampled score, not only the top-k: a downstream selector
  // that re-weights (e.g. by referent presence) needs the whole field —
  // truncating here would silently pre-decide significance by surprise alone.
  const scoreByPos = new Map(sample.map((s) => [s.pos, s.score]));
  const peaks = topSorted.map((s) => s.pos).sort((a, b) => a - b);

  return { peaks, stride, sampled: sample.length, units: S, scoreByPos };
}

/**
 * Build key moments from spine peaks: each peak sentence plus its immediate
 * context (a few sentences before/after by array position), scored by its
 * forward surprise.
 *
 * @param {Array<{ text: string, idx: number, offset?: number }>} sentences - in reading order
 * @param {{ peaks: number[], scoreByPos: Map<number, number> }} spine - from significanceSpine
 * @param {object} options - { contextWindow }
 * @returns {Array<{ idx: number, offset: number|null, pos: number, text: string, context: string, score: number }>}
 */
export function buildSceneMoments(sentences, spine, options = {}) {
  const { contextWindow = 2 } = options;

  return spine.peaks.map((pos) => {
    const center = sentences[pos];
    const from = Math.max(0, pos - contextWindow);
    const to = Math.min(sentences.length - 1, pos + contextWindow);
    const contextSentences = sentences.slice(from, to + 1).map((s) => s.text);

    return {
      idx: center?.idx ?? pos, // original document sentence index (provenance)
      offset: center?.offset ?? null, // character offset into the source text
      pos, // array position within the input sentences
      text: center?.text ?? "",
      context: contextSentences.join(" "),
      score: spine.scoreByPos?.get(pos) ?? 0,
    };
  });
}
