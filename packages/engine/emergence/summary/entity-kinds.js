// entity-kinds.js — Entity equivalence through co-occurrence clustering.
//
// Two spellings of the same entity ("Natásha" vs "Natasha") unify not
// through character-level normalization but through STRUCTURAL similarity:
// they co-occur with the same other entities. If "Natásha" appears near
// Pierre, Andrei, and dance as often as "Natasha" does, they are the
// same entity — even though their character strings differ.
//
// Algorithm:
//   1. For each discovered entity token, build a co-occurrence signature
//      (the set of OTHER entity tokens it appears near, weighted by
//      frequency).
//   2. Compute Jaccard similarity between every pair of entity tokens
//      using their co-occurrence signatures.
//   3. Pairs above threshold are candidates for identity equivalence.
//      Union-find merges them into equivalence classes.
//   4. Returns merged entity map and equivalence classes.
//
// This is the entity analogue of the music extraction's pattern-based
// chord grouping — two chords are the same if their pitch-class sets
// are similar, regardless of octave/voicing.

import { wordFrequencies, klDivergence } from "../surprise/index.js";

function norm(text) {
  return String(text ?? "").toLowerCase().trim();
}

/**
 * Build a frame→entities index for fast co-occurrence lookup.
 * Each frame lists which entity tokens appear in it.
 */
function buildFrameEntityIndex(frames, entityWords) {
  // Pre-norm entity words for comparison
  const normedWords = entityWords.map((w) => ({ original: w, normed: norm(w) }));
  const index = new Map(); // frame.order → Set<entity word>
  for (const f of frames) {
    const text = norm(f.text);
    const entities = new Set();
    for (const nw of normedWords) {
      if (text.includes(nw.normed)) entities.add(nw.original);
    }
    if (entities.size > 0) index.set(f.order, entities);
  }
  return index;
}

/**
 * Build co-occurrence signatures for all entities using a frame→entity
 * pre-index. O(F * E_per_frame²) instead of O(E² * F).
 */
function buildAllSignatures(frames, entityWords) {
  const index = buildFrameEntityIndex(frames, entityWords);

  // Initialize co-occurrence maps for all entities
  const signatures = new Map();
  for (const w of entityWords) {
    signatures.set(w, { word: w, cooccurs: new Map(), frames: [] });
  }

  // For each frame, update co-occurrence counts for all entity pairs in it
  for (const [order, entities] of index) {
    const entArr = [...entities];
    for (const e of entArr) {
      signatures.get(e).frames.push(order);
      for (const other of entArr) {
        if (e === other) continue;
        const m = signatures.get(e).cooccurs;
        m.set(other, (m.get(other) ?? 0) + 1);
      }
    }
  }

  return signatures;
}

/**
 * Compute Jaccard similarity between two co-occurrence signatures.
 * J(A,B) = |A ∩ B| / |A ∪ B| where A and B are the sets of entities
 * that co-occur with each token.
 *
 * @param {Map<string, number>} sigA
 * @param {Map<string, number>} sigB
 * @returns {number} Jaccard similarity (0-1)
 */
function jaccard(sigA, sigB) {
  const setA = new Set(sigA.keys());
  const setB = new Set(sigB.keys());
  let intersection = 0;
  for (const k of setA) if (setB.has(k)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Discover entity equivalence classes through co-occurrence clustering.
 *
 * @param {Array} entities - from discoverMotifs (or any list of { word, frames })
 * @param {Array} frames - signal frames from frameText
 * @param {object} options - { similarityThreshold, minCooccurrence }
 * @returns {{
 *   classes: Map<string, string[]>,   // canonical → aliases
 *   canonical: Map<string, string>,    // alias → canonical
 *   signatures: Map<string, object>    // word → signature
 * }}
 */
export function clusterEntityEquivalences(entities, frames, options = {}) {
  const { similarityThreshold = 0.3, minCooccurrence = 1 } = options;
  if (entities.length < 2) return { classes: new Map(), canonical: new Map(), signatures: new Map() };

  // Build entity words list
  const entityWords = entities.map((e) => e.word);

  // Build signatures using frame→entity pre-index (fast path)
  const allSignatures = buildAllSignatures(frames, entityWords);

  // Filter by minimum frame count
  const signatures = new Map();
  for (const [word, sig] of allSignatures) {
    if (sig.frames.length >= minCooccurrence) {
      signatures.set(word, sig);
    }
  }

  // Union-find for equivalence classes
  const parent = new Map();
  const find = (x) => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    return p;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Compute Jaccard similarity between all signature pairs
  const words = [...signatures.keys()];
  const considered = new Set();

  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const sim = jaccard(
        signatures.get(words[i]).cooccurs,
        signatures.get(words[j]).cooccurs
      );
      if (sim >= similarityThreshold) {
        union(words[i], words[j]);
        considered.add(`${words[i]}|${words[j]}`);
      }
    }
  }

  // Build equivalence classes
  const classes = new Map();  // canonical → [aliases]
  const canonical = new Map(); // alias → canonical

  for (const word of words) {
    const root = find(word);
    if (!classes.has(root)) classes.set(root, []);
    classes.get(root).push(word);
    canonical.set(word, root);
  }

  // Remove singletons (entities with no equivalence)
  for (const [root, aliases] of classes) {
    if (aliases.length === 1) {
      classes.delete(root);
    }
  }

  return { classes, canonical, signatures };
}

/**
 * Simplify entity graph by merging equivalent tokens.
 * @param {Array} entities - discovered entities
 * @param {Map<string, string>} canonical - alias → canonical mapping
 * @returns {Array} merged entities
 */
export function mergeEquivalentEntities(entities, canonical) {
  if (!canonical || canonical.size === 0) return entities;

  const merged = new Map(); // canonical → merged entity
  for (const e of entities) {
    const canon = canonical.get(e.word) ?? e.word;
    const existing = merged.get(canon) || {
      word: canon,
      frames: new Set(),
      salience: 0,
      aliases: [],
    };
    existing.frames = new Set([...existing.frames, ...e.frames]);
    existing.salience = Math.max(existing.salience, e.salience);
    if (e.word !== canon) existing.aliases.push(e.word);
    merged.set(canon, existing);
  }

  return [...merged.values()]
    .map((e) => ({ ...e, frames: [...e.frames].sort((a, b) => a - b) }))
    .sort((a, b) => b.salience - a.salience);
}

/**
 * Diacritical-insensitive comparison for entity identity bootstrapping.
 * This is ENGINE-level structure discovery, not PERCEIVER-level
 * normalization. The perceiver never touches the raw signal; the engine
 * uses this to discover that "Natásha" and "Natasha" are the same entity
 * despite their different character-level spellings.
 *
 * The primary signal is co-occurrence similarity (jaccard). This is the
 * fallback bootstrapping mechanism for the first match.
 */
const DIACRITICAL_MAP = {
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
  'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u',
  'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u',
  'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ü': 'u',
};

function stripDiacritics(text) {
  return String(text ?? "").split("").map((c) => DIACRITICAL_MAP[c] ?? c).join("");
}

export function prefixMatch(a, b, minPrefix = 4) {
  const na = stripDiacritics(norm(a)), nb = stripDiacritics(norm(b));
  if (na === nb) return true;
  if (na.length < minPrefix || nb.length < minPrefix) return false;
  const prefix = na.slice(0, minPrefix);
  return nb.startsWith(prefix) || na.startsWith(nb.slice(0, minPrefix));
}

/**
 * Diacritical-aware norm: normalizes for entity-kinds comparison
 * while keeping the signal path raw. Only used within entity-kinds.
 */
export function entityNorm(text) {
  return stripDiacritics(norm(text));
}
