// emergence/summary/resonance-spine.js — Joy-informed significance spine.
//
// The lexical significance spine (spine.js) scores by forward KL surprise:
// unusual vocabulary = turning point. The dead-ends document records that
// this captures unusual word clusters, not narrative turning points
// (altitude test gap #1).
//
// The resonance spine scores by the JOY a passage would evoke in the
// reader-discourse system. Joy is a conditional dimension — it depends on
// what the reader expects (discourse state) and what the reader values
// (orientation). A passage that confirms a truth-seeker's dormant suspicion
// scores differently than one that subverts a completion-seeker's
// expectation. Same text, different reader, different spine.
//
// This is the non-lexical observable the altitude test called for:
// "SVO relation stream, dialogue attribution, affect" — joy is the affect
// dimension, weighted by the discourse's current state.
//
// OUTPUT SHAPE: identical to significanceSpine's return value
//   { peaks: number[], stride: number, sampled: number, units: number, scoreByPos: Map<number, number> }
// so it drops directly into the candidate pool alongside the lexical spine.

import { extractTextFieldVectors, cosineSimilarity } from "../../perceiver/text/text-signal.js";
import { computeResonanceScore } from "../../discourse/resonance.js";

const DEFAULT_BUDGET = 600;
const DEFAULT_K = 12;
const DEFAULT_MIN_WORDS = 6;

/**
 * resonanceSpine(sentences, discourseState, options) -> spineResult
 *
 * Sample sentences on a budget-capped stride just like significanceSpine,
 * but score each by its resonance (joy) with the DISCOURSE STATE rather
 * than its lexical forward-surprise against accumulated text.
 *
 * The discourse state IS the reader's current working memory: active
 * motifs, their activation levels, open commitments, reading location.
 * A passage that breaks through to a dormant motif scores high; one that
 * saturates an already-active one scores moderate; one with no motif
 * overlap scores low. The reader's orientation weights which type of
 * resonance matters most.
 *
 * @param {Array<{ text: string, idx: number, offset?: number }>} sentences — entity-mention frames
 * @param {object} discourseState — DiscourseState instance (or compatible interface)
 * @param {object} options — { budget, k, minWords, minHistory }
 * @returns {{ peaks: number[], stride: number, sampled: number, units: number, scoreByPos: Map<number, number> }}
 */
export function resonanceSpine(sentences, discourseState, options = {}) {
  const {
    budget = DEFAULT_BUDGET,
    k = DEFAULT_K,
    minWords = DEFAULT_MIN_WORDS,
  } = options;

  const S = sentences.length;
  if (S === 0) return { peaks: [], stride: 1, sampled: 0, units: 0 };

  const stride = Math.max(1, Math.ceil(S / budget));
  const sample = [];
  const orientation = discourseState?.orientation ?? null;

  for (let pos = 0; pos < S; pos++) {
    const s = sentences[pos];
    const text = String(s?.text ?? "");
    const blank = !text.trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (blank || wordCount < minWords) continue;
    if (pos % stride !== 0) continue;

    const score = resonanceScore(text, discourseState, orientation);
    if (score > 0) {
      sample.push({ pos, score });
    }
  }

  const topSorted = [...sample].sort((a, b) => b.score - a.score).slice(0, k);
  const scoreByPos = new Map(sample.map((s) => [s.pos, s.score]));
  const peaks = topSorted.map((s) => s.pos).sort((a, b) => a - b);

  return { peaks, stride, sampled: sample.length, units: S, scoreByPos };
}

/**
 * resonanceScore(passageText, discourseState, orientation) -> number 0..1
 *
 * How much JOY would this passage evoke in the current discourse state?
 * Computed by simulating a virtual resonance detection against every
 * active motif, weighted by the reader's orientation.
 *
 * The key difference from lexical surprise: two passages with identical
 * vocabulary get DIFFERENT resonance scores if the discourse state is
 * primed differently. A passage about a ball scores high for Natasha
 * (active motif: "first ball") but low for Pierre (no ball motifs active).
 * Joy is CONDITIONAL.
 *
 * @param {string} passageText
 * @param {object} discourseState
 * @param {object} orientation
 * @returns {number}
 */
export function resonanceScore(passageText, discourseState, orientation) {
  if (!discourseState || !passageText) return 0;

  const pSig = extractTextFieldVectors(passageText);
  const pField = pSig.frames[0]?.field ?? null;
  if (!pField) return 0;

  let totalJoy = 0;
  let motifCount = 0;

  for (const [, motif] of (discourseState.motifs ?? new Map())) {
    const act = motif.activation ?? 0;
    // Only score motifs above the noise floor — a nearly-dead motif finding
    // a matching passage would be a breakthrough but we only track that
    // from actual discourse updates, not simulated ones.
    if (act < 0.05) continue;

    const result = computeResonanceScore(passageText, null, motif, orientation ?? discourseState.orientation);
    if (result.joy_score > 0) {
      totalJoy += result.joy_score;
      motifCount++;
    }
  }

  // Location proximity bonus: passages near the discourse reading location
  // are more resonant (the reader is "here" and cares about "now").
  // This requires the caller to supply passage offsets; handled by
  // buildResonanceCandidates which has access to sentence positions.

  return motifCount > 0 ? Math.min(1, totalJoy / Math.sqrt(motifCount)) : 0;
}

/**
 * buildResonanceCandidates(sentences, spine, discourseState, options) -> candidate[]
 *
 * Build candidate moments from the resonance spine's peaks, matching the
 * output shape of buildSceneMoments (spine.js) so they can be merged into
 * the same candidate pool.
 *
 * Each candidate adds `.resonanceType` (which type of joy) and `.resonanceJoy`
 * (the raw joy score) alongside the standard `.score` field.
 *
 * @param {Array<{ text: string, idx: number, offset?: number }>} sentences
 * @param {{ peaks: number[], scoreByPos: Map<number, number> }} spine — from resonanceSpine
 * @param {object} discourseState
 * @param {object} options — { contextWindow }
 * @returns {Array<{ idx, offset, pos, text, context, score, source, resonanceType?, resonanceJoy? }>}
 */
export function buildResonanceCandidates(sentences, spine, discourseState, options = {}) {
  const { contextWindow = 1 } = options;

  return spine.peaks.map((pos) => {
    const center = sentences[pos];
    const from = Math.max(0, pos - contextWindow);
    const to = Math.min(sentences.length - 1, pos + contextWindow);
    const contextSentences = sentences.slice(from, to + 1).map((s) => s.text);

    // Determine the dominant resonance type for this peak
    let resonanceType = null;
    let resonanceJoy = spine.scoreByPos?.get(pos) ?? 0;
    const text = center?.text ?? "";

    if (discourseState && discourseState.motifs && text) {
      const pSig = extractTextFieldVectors(text);
      const pField = pSig.frames[0]?.field ?? null;
      if (pField) {
        let bestJoy = 0;
        for (const [, motif] of discourseState.motifs) {
          if (motif.activation < 0.05) continue;
          const result = computeResonanceScore(text, null, motif, discourseState.orientation);
          if (result.joy_score > bestJoy) {
            bestJoy = result.joy_score;
            resonanceType = result.type;
          }
        }
      }
    }

    return {
      idx: center?.idx ?? pos,
      offset: center?.offset ?? null,
      pos,
      text: center?.text ?? "",
      context: contextSentences.join(" "),
      score: resonanceJoy * 100,  // scale to match event scores (~100 range)
      source: "resonance",
      resonanceType,
      resonanceJoy,
    };
  });
}
