// text-organ.js — Text as a signal, not as language.
//
// Port of the music-extraction approach to text. The music system
// succeeded by measuring the signal's own statistics and letting
// structure emerge — no hardcoded thresholds, no pattern templates.
// This module does the same for text:
//
//   Music           → Text
//   ─────────────────────────────────
//   STFT frames     → fixed-char windows ($frameText)
//   Chroma vectors  → word probability distributions
//   Chord change    → KL elbow between windows ($detectBoundaries)
//   Note discovery  → entity co-occurrence ($discoverEntities)
//   Simultaneous    → PMI-based relation discovery ($discoverRelations)
//   notes
//
// The old approach (sentence boundaries, SVO regex, event patterns)
// is replaced entirely. The kernel interface is preserved so
// entity-fold.js and kernel.js don't need rewriting.

import { wordFrequencies, klDivergence, forwardScore } from "../surprise/index.js";

const DIACRITICAL_RE = /\p{Diacritic}/gu;

function strip(text) {
  return String(text ?? "").normalize("NFD").replace(DIACRITICAL_RE, "").normalize("NFC");
}

function norm(text) {
  return strip(text).toLowerCase().trim();
}

// ── 1. Frame text (like STFT) ──────────────────────────────────

export function frameText(text, options = {}) {
  const windowSize = options.windowSize ?? 400;
  const hopSize = options.hopSize ?? 200;
  const s = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = [];
  for (let offset = 0; offset < s.length; offset += hopSize) {
    const chunk = s.slice(offset, offset + windowSize);
    const trimmed = chunk.trim();
    if (trimmed.length < 20) continue;
    const dist = wordFrequencies(trimmed);
    if (dist.size < 3) continue;
    frames.push({ offset, order: frames.length, text: trimmed, dist });
  }
  return frames;
}

// ── 2. Boundary detection (forward-surprise against running prior) ──
// Like the music extraction's chord-change detection: measure how
// surprising each frame is given everything that came before. A
// spike in forward-surprise = the topic shifted = a narrative event.
// Operates on filtered frames (entity-relevant only) so structural
// text like chapter headings is already excluded.

export function detectBoundaries(frames, options = {}) {
  const { zThreshold = 2.5, window = 5 } = options;
  if (frames.length < window) return [];

  // Measure forward-surprise of each frame against the running prior
  const history = [];
  const scores = [];
  for (let i = 0; i < frames.length; i++) {
    const score = history.length > 0 ? forwardScore(frames[i], history) : 0;
    scores.push({ order: frames[i].order, offset: frames[i].offset, score, text: frames[i].text });
    history.push(frames[i]);
  }

  // Z-score normalize to find spikes
  const boundaries = [];
  for (let i = 0; i < scores.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(scores.length, i + window + 1);
    const local = scores.slice(start, end);
    const mean = local.reduce((s, d) => s + d.score, 0) / local.length;
    const variance = local.reduce((s, d) => s + (d.score - mean) ** 2, 0) / local.length;
    const std = Math.sqrt(variance) || 1;
    const z = (scores[i].score - mean) / std;
    if (z > zThreshold) {
      boundaries.push({ order: scores[i].order, offset: scores[i].offset, score: scores[i].score, z, text: scores[i].text });
    }
  }

  return boundaries;
}

// ── 3. Entity discovery (co-occurrence) ─────────────────────────

export function discoverEntities(frames, options = {}) {
  const { minFrames = 3 } = options;
  if (frames.length < minFrames) return [];
  const wordFrames = new Map();
  for (const f of frames) {
    for (const word of f.dist.keys()) {
      const set = wordFrames.get(word) ?? new Set();
      set.add(f.order);
      wordFrames.set(word, set);
    }
  }
  const total = frames.length;
  const uniform = 1 / total;
  const candidates = [];
  for (const [word, set] of wordFrames) {
    const n = set.size;
    if (n < minFrames || n > total * 0.8 || word.length < 2 || /^\d+$/.test(word)) continue;
    let kl = 0;
    for (let i = 0; i < total; i++) {
      const p = set.has(i) ? 1 / n : 0;
      if (p > 0) kl += p * Math.log2(p / uniform);
    }
    candidates.push({ word, frames: [...set], salience: kl * Math.log(1 + n) });
  }
  return candidates.sort((a, b) => b.salience - a.salience).slice(0, 100);
}

// ── 4. Relation discovery (PMI) ─────────────────────────────────

export function discoverRelations(frames, entities, options = {}) {
  const { topN = 20, minJoint = 2 } = options;
  if (entities.length < 2) return [];
  const ef = new Map(entities.map((e) => [e.word, new Set(e.frames)]));
  const total = frames.length;
  const pairs = [];
  for (let i = 0; i < Math.min(entities.length, 50); i++) {
    for (let j = i + 1; j < Math.min(entities.length, 50); j++) {
      const a = entities[i].word, b = entities[j].word;
      const sa = ef.get(a), sb = ef.get(b);
      let joint = 0;
      for (const f of sa) if (sb.has(f)) joint++;
      if (joint < minJoint) continue;
      const pAB = joint / total, pA = sa.size / total, pB = sb.size / total;
      pairs.push({ a, b, pmi: Math.log2(pAB / (pA * pB)), joint });
    }
  }
  return pairs.sort((a, b) => b.pmi - a.pmi).slice(0, topN);
}

// ── 5. Match entity by name ─────────────────────────────────────

export function matchTargetEntity(entities, name) {
  const n = norm(name);
  const tokens = n.split(/\s+/).filter(Boolean);
  let best = null, bestScore = 0;
  for (const e of entities) {
    const en = norm(e.word);
    const matched = tokens.filter((t) => en.includes(t) || t.includes(en)).length;
    if (matched > bestScore) { bestScore = matched; best = e; }
  }
  return best;
}

// ── 6. Extract events (boundary-derived) ────────────────────────

export function extractEvents(frames, boundaries, entityName, options = {}) {
  const { maxEvents = 12 } = options;
  const en = norm(entityName);
  const filtered = boundaries.filter((b) => {
    // Only keep boundaries near the entity's frames
    const f = frames.find((f) => f.offset >= b.offset);
    if (!f) return false;
    return norm(f.text).includes(en);
  });
  return filtered.slice(0, maxEvents).map((b) => {
    const f = frames.find((f) => f.offset >= b.offset) || frames[frames.length - 1];
    return { offset: b.offset, type: "shift", text: f.text, score: b.score, zScore: b.z };
  });
}

// ── KERNEL INTERFACE ────────────────────────────────────────────
// These functions produce the interface the kernel expects:
//   chunks: [{ text, idx }]
//   relations: [{ subject, verb, object, polarity, idx, text }]
//   events: [{ type, text, participants, idx }]
//   temporalMarkers: Map<idx, { type, value, raw }>

/**
 * Segment text into chunks the kernel can consume.
 * Returns { text, idx } frames — the same interface as the old
 * segmentSentences, but derived from signal windows, not regex.
 */
export function segmentSentences(text) {
  return frameText(text).map((f) => ({ text: f.text, idx: f.order }));
}

/**
 * Find chunks relevant to the entity — direct name matching
 * (the entity discovery path is used for FIGURES, not for
 * initial filtering). The name is a given — we know who we're
 * looking for — so we find frames containing that name directly.
 */
export function findEntityMentions(chunks, entityName) {
  if (!chunks.length) return [];
  const en = norm(entityName);
  const tokens = en.split(/\s+/).filter(Boolean);
  return chunks.filter((c) => {
    const t = norm(c.text);
    return tokens.some((token) => t.includes(token));
  }).map((c) => ({ text: c.text, idx: c.idx }));
}

export function extractRelations(/* not needed — relations from graph */) { return []; }
export function extractTemporalMarker() { return null; }
export function extractTemporalMarkers() { return new Map(); }

export { strip as stripDiacritics };
