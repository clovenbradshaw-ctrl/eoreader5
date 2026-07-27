// text-organ.js — Thin bridge between the perceiver and the engine.
//
// The perceiver (perceiver/text/) does modality-specific extraction:
//   text-signal.js — field vectors from raw text (char-3gram, word length)
//   surfaces.js    — capitalized spans + co-occurrence records
//
// The engine (emergence/summary/) does structure-finding:
//   entity-kinds.js — entity equivalence through co-occurrence clustering
//   kernel.js       — universal fold logic
//
// This module is the thin bridge that adapts the perceiver's output
// to the interface the engine expects. It does NOT duplicate the
// perceiver's extraction work — it just re-exports and adapts.

import { extractSurfaces, buildSurfaceMap, buildEntityRecords } from "../../perceiver/text/surfaces.js";
import { cosineSimilarity } from "../../perceiver/text/text-signal.js";

export { cosineSimilarity };

/**
 * Frame text into chunks for the engine. Delegates to the perceiver's
 * surface extraction — the perceiver finds capitalized entity-name
 * surfaces; the engine clusters and ranks them.
 */
export { extractSurfaces };

import { wordFrequencies, klDivergence } from "../surprise/index.js";

function norm(text) {
  return String(text ?? "").toLowerCase().trim();
}

// ── Frame text (currently inline; will move to perceiver when ready) ──

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

// ── Boundary detection (KL divergence against sliding prior) ──

export function detectBoundaries(frames, options = {}) {
  const { zThreshold = 2.5, window = 20 } = options;
  if (frames.length < window) return [];
  const scores = [];
  for (let i = 0; i < frames.length; i++) {
    if (i < window) {
      const priorStart = Math.max(0, i - window);
      const priorFrames = frames.slice(priorStart, i);
      const score = priorFrames.length > 0
        ? klDivergence(frames[i].dist, frames[i - 1].dist)
        : 0;
      scores.push({ order: frames[i].order, offset: frames[i].offset, score, text: frames[i].text });
    } else {
      const priorFrames = frames.slice(i - window, i);
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

// ── Entity discovery (co-occurrence) ──

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

// ── Extract typed events ──

const EVENT_TYPE_KEYWORDS = {
  love: ["love", "dance", "beautiful", "charming", "enchant", "kiss", "embrace", "passion", "adore", "captivate"],
  death: ["die", "death", "dead", "wound", "kill", "suffer", "pain", "ill", "sick", "fever", "blood", "corpse"],
  marriage: ["marry", "married", "wedding", "husband", "wife", "bride", "groom", "proposal", "engage"],
  war: ["war", "battle", "army", "soldier", "fight", "enemy", "attack", "retreat", "invade", "regiment"],
  dance: ["dance", "dancing", "ball", "waltz", "polonaise", "orchestra", "music", "sing"],
  elopement: ["elope", "escape", "secret", "abduct", "run away", "flee", "hide", "whisper"],
  nursing: ["nurse", "care", "tend", "wounded", "sick", "fever", "hospital", "medicine"],
};

function typeBoundary(boundaryText, priorText) {
  const text = norm(boundaryText);
  let bestType = "shift", bestCount = 0;
  for (const [type, keywords] of Object.entries(EVENT_TYPE_KEYWORDS)) {
    const count = keywords.filter((kw) => text.includes(kw)).length;
    if (count > bestCount) { bestCount = count; bestType = type; }
  }
  return bestType;
}

export function extractEvents(frames, boundaries, entities, entityName, options = {}) {
  const { maxEvents = 12 } = options;
  const en = norm(entityName);
  const entityTokens = en.split(/\s+/).filter((t) => t.length > 2);
  const entityPositions = new Set();
  for (const f of frames) {
    const text = norm(f.text);
    if (entityTokens.some((t) => text.includes(t))) entityPositions.add(f.order);
  }
  const proximityWindow = 5;
  const filtered = boundaries.filter((b) => {
    for (let d = -proximityWindow; d <= proximityWindow; d++) {
      if (entityPositions.has(b.order + d)) return true;
    }
    return false;
  });
  const frameByPos = new Map(frames.map((f) => [f.order, f]));
  return filtered.slice(0, maxEvents).map((b, i) => {
    const f = frameByPos.get(b.order);
    const prior = frameByPos.get(b.order - 1);
    const type = f ? typeBoundary(f.text, prior?.text ?? "") : "shift";
    return {
      offset: b.offset, order: b.order, type,
      text: f?.text ?? "", score: b.score, zScore: b.z, idx: i,
    };
  });
}

// ── Entity-kinds boosting ──
// Use the perceiver's surface extraction to boost entity-kinds clustering.
// Takes the engine's discovered entities and boosts their salience if they
// appear in the perceiver's surface map (capitalized spans that co-occur).

export function boostFromSurfaces(entities, surfaces, entityName) {
  const surfaceSet = new Set(surfaces);
  const en = norm(entityName);

  return entities.map((e) => {
    const needsBoost = !surfaceSet.has(e.word) && norm(e.word) !== en;
    return {
      ...e,
      surfaceBoost: needsBoost ? 0 : e.salience,
      isSurface: surfaceSet.has(e.word),
    };
  }).sort((a, b) => (b.surfaceBoost || b.salience) - (a.surfaceBoost || a.salience));
}

// ── Bridge: findEntityMentions ──

export function findEntityMentions(chunks, entityName) {
  if (!chunks.length) return [];
  const en = norm(entityName);
  const tokens = en.split(/\s+/).filter(Boolean);
  return chunks.filter((c) => {
    const t = norm(c.text);
    return tokens.some((token) => t.includes(token));
  }).map((c) => ({ text: c.text, idx: c.idx }));
}

// ── Legacy bridges ──

export function segmentSentences(text) {
  return frameText(text).map((f) => ({ text: f.text, idx: f.order }));
}

export function extractRelations() { return []; }
export function extractTemporalMarker() { return null; }
export function extractTemporalMarkers() { return new Map(); }
