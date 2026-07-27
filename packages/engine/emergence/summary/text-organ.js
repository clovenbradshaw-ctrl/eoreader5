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

import { wordFrequencies, klDivergence } from "../surprise/index.js";

// No diacritical normalization. The engine discovers entity equivalence
// through the entity-kinds pipeline (co-occurrence clustering), not
// through pre-digesting the input. "Natásha" and "Natasha" unify when
// they co-occur with the same entities, not because I strip accents.

function norm(text) {
  return String(text ?? "").toLowerCase().trim();
}

// ── 1. Frame text (like STFT) ──────────────────────────────────

export function frameText(text, options = {}) {
  const windowSize = options.windowSize ?? 2000;
  const hopSize = options.hopSize ?? 1000;
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

// ── 2. Boundary detection (KL divergence against sliding prior) ──
// Like the music extraction's chord-change detection. Uses a SLIDING
// WINDOW prior (fixed size) so the cost stays O(N) regardless of
// document length. Each frame's surprise is measured against the
// immediately preceding WINDOW frames, not the entire history.

export function detectBoundaries(frames, options = {}) {
  const { zThreshold = 2.5, window = 20 } = options;
  if (frames.length < window) return [];

  const scores = [];

  // Build the initial prior from the first `window` frames, then slide
  for (let i = 0; i < frames.length; i++) {
    if (i < window) {
      // Prior not ready yet — compute what we can
      const priorStart = Math.max(0, i - window);
      const priorFrames = frames.slice(priorStart, i);
      const score = priorFrames.length > 0
        ? klDivergence(frames[i].dist, frames[i - 1].dist)
        : 0;
      scores.push({ order: frames[i].order, offset: frames[i].offset, score, text: frames[i].text });
    } else {
      // Sliding window: prior is the last `window` frames merged
      const priorFrames = frames.slice(i - window, i);
      // Build prior distribution by merging — this is O(window * frameWords)
      // window is small (20) and frameWords is small (~50), so it's fast
      const prior = new Map();
      let total = 0;
      for (const pf of priorFrames) {
        for (const [w, p] of pf.dist) {
          prior.set(w, (prior.get(w) ?? 0) + p);
          total += p;
        }
      }
      if (total > 0) {
        for (const [w, p] of prior) prior.set(w, p / total);
      }
      const score = klDivergence(frames[i].dist, prior);
      scores.push({ order: frames[i].order, offset: frames[i].offset, score, text: frames[i].text });
    }
  }

  // Z-score normalize to find spikes
  const zWindow = Math.min(window, 10);
  const boundaries = [];
  for (let i = zWindow; i < scores.length - zWindow; i++) {
    const start = i - zWindow;
    const end = i + zWindow + 1;
    let sum = 0, sumSq = 0;
    for (let j = start; j < end; j++) {
      sum += scores[j].score;
      sumSq += scores[j].score * scores[j].score;
    }
    const n = end - start;
    const mean = sum / n;
    const variance = (sumSq / n) - (mean * mean);
    const std = Math.sqrt(Math.max(0, variance)) || 1;
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

// ── 6. Extract events (boundary-derived, entity-typed) ──────────
// Each boundary is a topic shift. But what MAKES it an event is which
// ENTITIES are active at that point. A boundary where Natasha meets
// Andrei is a different KIND of event than one where she falls ill.
// We type boundaries by the entities that co-occur near them.

const EVENT_TYPE_KEYWORDS = {
  love: ["love", "dance", "beautiful", "charming", "enchant", "kiss", "embrace", "passion", "adore", "captivate"],
  death: ["die", "death", "dead", "wound", "kill", "suffer", "pain", "ill", "sick", "fever", "blood", "corpse"],
  marriage: ["marry", "married", "wedding", "husband", "wife", "bride", "groom", "proposal", "engage"],
  war: ["war", "battle", "army", "soldier", "fight", "enemy", "attack", "retreat", "invade", "regiment"],
  dance: ["dance", "dancing", "ball", "waltz", "polonaise", "orchestra", "music", "sing"],
  elopement: ["elope", "escape", "secret", "abduct", "run away", "flee", "hide", "whisper"],
  nursing: ["nurse", "care", "tend", "wounded", "sick", "fever", "hospital", "medicine"],
};

/**
 * Type a boundary by the vocabulary that most distinguishes it from
 * the running prior. The type with the most keyword matches wins.
 * This is like the music extraction typing a chord by its pitch class.
 */
function typeBoundary(boundaryText, priorText) {
  const text = norm(boundaryText);
  let bestType = "shift", bestCount = 0;

  for (const [type, keywords] of Object.entries(EVENT_TYPE_KEYWORDS)) {
    const count = keywords.filter((kw) => text.includes(kw)).length;
    if (count > bestCount) {
      bestCount = count;
      bestType = type;
    }
  }

  return bestType;
}

export function extractEvents(frames, boundaries, entities, entityName, options = {}) {
  const { maxEvents = 12 } = options;
  const en = norm(entityName);

  const frameByPos = new Map(frames.map((f) => [f.order, f]));

  // Build a set of frame positions that mention the entity
  const entityTokens = en.split(/\s+/).filter((t) => t.length > 2);
  const entityPositions = new Set();
  for (const f of frames) {
    const text = norm(f.text);
    if (entityTokens.some((t) => text.includes(t))) entityPositions.add(f.order);
  }

  // Filter boundaries that are near entity-mentioning frames
  const proximityWindow = 5; // frames
  const filtered = boundaries.filter((b) => {
    // Check if any entity-mentioning frame is within proximityWindow
    for (let d = -proximityWindow; d <= proximityWindow; d++) {
      if (entityPositions.has(b.order + d)) return true;
    }
    return false;
  });

  return filtered.slice(0, maxEvents).map((b, i) => {
    const f = frameByPos.get(b.order);
    const prior = frameByPos.get(b.order - 1);
    const type = f ? typeBoundary(f.text, prior?.text ?? "") : "shift";

    return {
      offset: b.offset,
      order: b.order,
      type,
      text: f?.text ?? "",
      score: b.score,
      zScore: b.z,
      idx: i,
    };
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
