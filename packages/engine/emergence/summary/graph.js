// graph.js — Lightweight entity graph for entity-focused folds.
//
// Ported from eoreader4.2:src/core/project.js + perceiver/individuation.js.
// This is the minimum viable graph substrate: a union-find over entity
// mentions, edge weight from relation coupling, and per-node coupling
// scores. Without this, the fold has no way to distinguish a main
// character from a passing mention — everything is just a regex hit.

// ── Union-find (disjoint set) ─────────────────────────────────────────────────
// Fast path: two entity strings that are the same after normalization are
// the same node. Slower path: entities that co-occur in the same sentence
// (within a sliding window) are merged — this approximates coreference
// for pronouns / variant spellings without a full parse.

// No diacritical normalization — the entity-kinds pipeline handles
// equivalence discovery through co-occurrence. "Natásha" and "Natasha"
// unify when they co-occur with the same entities, not through
// character-level normalization.

function norm(name) {
  return String(name ?? "").toLowerCase().trim();
}

/**
 * Build a union-find entity graph from relations.
 *
 * @param {Array<{ subject: string, verb: string, object: string, idx: number }>} relations
 * @param {string} targetEntity - the entity the fold focuses on (excluded from figure registry)
 * @returns {{ entities: Map<string, { id: string, label: string, sightings: number }>,
 *             edges: Array<{ from: string, to: string, via: string, weight: number }>,
 *             representative: (id: string) => string }}
 */
export function buildGraph(relations, targetEntity = "") {
  const parent = new Map();
  const targetNorm = norm(targetEntity);

  function find(x) {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    return p;
  }

  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Entity registry: norm(id) → { id, label, sightings }
  const registry = new Map();
  function getOrCreate(id) {
    const n = norm(id);
    if (!n || n === targetNorm) return null; // skip the target entity itself
    let e = registry.get(n);
    if (!e) {
      e = { id, label: id, sightings: 0 };
      registry.set(n, e);
    }
    return e;
  }

  // Helper: check if a string looks like a named entity (capitalized proper noun,
  // not a sentence fragment). Filters out verb complements like "perfectly happy"
  // while keeping character names like "Prince Andrew" or "Countess Mary".
  function isEntityName(text) {
    if (!text || text.length > 40) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (!/^[A-Z]/.test(trimmed)) return false;
    if (/^(the|a|an|in|on|at|to|for|with|by|from|of|that|this|these|those)/i.test(trimmed)) return false;
    const words = trimmed.split(/\s+/);
    if (!words.some((w) => /^[A-Z]/.test(w))) return false;
    return true;
  }

  // Build edges from relations: subject → verb → object
  // Count sightings from the object side (how many times a figure appears
  // in relation objects across different sentences).
  const edgeMap = new Map(); // key → { from, to, via, weight, idx }
  for (const r of relations) {
    if (!isEntityName(r.object)) continue;
    const obj = getOrCreate(r.object);
    if (obj) {
      const key = `${targetNorm}|${r.verb}|${obj.id}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.weight += 1; // same entity across multiple sentences
      } else {
        edgeMap.set(key, {
          from: targetNorm,
          to: obj.id,
          via: r.verb,
          weight: 1,
          idx: r.idx,
        });
      }
      obj.sightings += 1; // count as a sighting of this figure
    }
  }

  // Merge entities by coreference. A shared token alone is NOT identity —
  // "Prince Andrew" and "Prince Vasili" share an honorific, not a referent.
  // Two names corefer only when one is contained in the other ("Natasha" ⊂
  // "Natasha Rostova", "Prince Andrew" ⊂ "Prince Andrew Bolkonski") or when
  // both END in the same token (surname match: "Andrew Bolkonski" /
  // "Prince Bolkonski"). Leading shared tokens never merge.
  const tokensOf = (id) => id.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const corefers = (a, b) => {
    const ta = tokensOf(a);
    const tb = tokensOf(b);
    if (!ta.length || !tb.length) return false;
    const setA = new Set(ta);
    const setB = new Set(tb);
    const subset = ta.every((t) => setB.has(t)) || tb.every((t) => setA.has(t));
    const surnameMatch = ta[ta.length - 1] === tb[tb.length - 1];
    return subset || surnameMatch;
  };
  const byToken = new Map();
  for (const [n, e] of registry) {
    if (!/^[A-Z]/.test(e.id)) continue;
    for (const t of tokensOf(e.id)) {
      const group = byToken.get(t) ?? [];
      if (!group.includes(e.id)) group.push(e.id);
      byToken.set(t, group);
    }
  }
  for (const [token, ids] of byToken) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (corefers(ids[i], ids[j])) union(ids[i], ids[j]);
      }
    }
  }

  // Collapse into merged entities
  const merged = new Map();
  for (const [n, e] of registry) {
    const root = find(e.id);
    const m = merged.get(root) || { id: root, label: e.label, sightings: 0, aliases: [] };
    if (m.label === root) m.label = e.label;
    m.sightings += e.sightings;
    if (e.id !== root) m.aliases.push(e.id);
    merged.set(root, m);
  }

  // Resolve edge endpoints through union-find
  const resolvedEdges = [];
  for (const e of edgeMap.values()) {
    const f = find(e.to);
    resolvedEdges.push({ ...e, from: targetNorm, to: f });
  }

  return {
    entities: merged,
    edges: resolvedEdges,
    representative: (id) => find(id),
  };
}

// ── Figure detection via co-occurrence ─────────────────────────────────────────
// The SVO-based figure extraction fails because our relation extraction captures
// verb complements ("perfectly happy", "going to her first grand ball"), not just
// entity names. Instead, detect figures by finding capitalized character names
// that co-occur with the target entity in the same sentence. This is simpler,
// more reliable, and modality-agnostic (works on any chunk stream with text).

// Common English words that start with capital letters but aren't character names.
const NOT_A_NAME = new Set([
  "The", "And", "But", "For", "With", "This", "That", "When", "Where",
  "While", "He", "She", "It", "They", "His", "Her", "Their", "Its",
  "In", "On", "At", "To", "From", "By", "As", "Or", "If", "So", "No",
  "Not", "Yet", "Now", "Then", "Also", "Just", "Only", "Even", "Still",
  "Already", "Always", "Never", "Often", "Sometimes", "Usually", "Here",
  "There", "Every", "Each", "Both", "Few", "Many", "Much", "Some", "Any",
  "All", "None", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
  "Eight", "Nine", "Ten", "Yes", "Oh", "Well", "What", "Which", "Who",
  "Whom", "Whose", "Why", "How", "Was", "Were", "Has", "Have", "Had",
  "Do", "Does", "Did", "Can", "Could", "Will", "Would", "Shall", "Should",
  "May", "Might", "Must", "Dear", "My", "Your", "His", "Her",
  "You", "Your", "Yours",
]);

function isCharacterName(text) {
  if (!text || text.length > 30 || text.length < 2) return false;
  const trimmed = text.trim();
  if (NOT_A_NAME.has(trimmed)) return false;
  // Must start with a capital letter
  if (!/^[A-Z]/.test(trimmed)) return false;
  // Must contain at least one vowel (eliminates acronyms, garbled text)
  if (!/[aeiouy]/i.test(trimmed)) return false;
  // Must not be a sentence-starting word followed by a verb
  if (/^(Was|Were|Had|Has|Have|Did|Could|Would|Should|May|Might) /.test(trimmed)) return false;
  return true;
}

/**
 * Discover character names by finding capitalized words that co-occur with
 * the target entity in the same sentence. Returns figures sorted by
 * co-occurrence frequency (descending).
 *
 * @param {Array<{ text: string, idx: number }>} entitySentences - sentences mentioning target
 * @param {string} targetEntity - the entity being analyzed
 * @returns {Array<{ label: string, count: number }>} figures sorted by frequency
 */
export function detectFigures(entitySentences, targetEntity) {
  const targetNorm = norm(targetEntity);
  // Build a set of target entity name tokens to filter out fragments
  const targetTokens = new Set(targetNorm.split(/\s+/).filter((t) => t.length > 2));

  const figureCounts = new Map();

  for (const s of entitySentences) {
    // Extract potential character names: sequences of 1-3 capitalized words
    // Match capitalized word sequences. Must handle accented characters
    // (Natásha, Rostóva). Common accented letters in Romanized Russian:
    // á, é, í, ó, ú, ä, ë, ö, ï, ü, â, ê, î, ô, û, à, è, ì, ò, ù.
    const matches = s.text.match(/\b([A-ZÁÉÍÓÚÄËÖÏÜÂÊÎÔÛÀÈÌÒÙ][a-záéíóúäëöïüâêîôûàèìòù'’]+(?:\s+[A-ZÁÉÍÓÚÄËÖÏÜÂÊÎÔÛÀÈÌÒÙ][a-záéíóúäëöïüâêîôûàèìòù'’]+){0,2})\b/g) ?? [];
    for (const match of matches) {
      const trimmed = match.trim();
      if (!isCharacterName(trimmed)) continue;

      const n = norm(trimmed);
      // Skip if the name is a substring of the target entity (e.g. "Nat" from "Natasha")
      if (targetNorm.includes(n) || n.includes(targetNorm)) continue;
      // Skip if the name is a substring/pseudonym of the target entity:
      // "Nat" from "Natasha", "Rost" from "Rostova" — but only for
      // names at least 3 chars (to avoid filtering very short real names).
      if (n.length >= 3) {
        if ([...targetTokens].some((t) => t.includes(n) && t !== n)) continue;
        if ([...targetTokens].some((t) => t.startsWith(n) && t !== n)) continue;
      }
      // Skip single-character "names"
      if (n.length < 2) continue;

      figureCounts.set(trimmed, (figureCounts.get(trimmed) ?? 0) + 1);
    }
  }

  // Remove the target entity itself (and any possessive variant) from figures
  figureCounts.delete(targetEntity);
  figureCounts.delete(`${targetEntity}’s`);
  // Also remove any figure whose normalized form matches the target entity
  const targetTokensAll = new Set(targetNorm.split(/\s+/));
  for (const [label] of figureCounts) {
    const n = norm(label);
    if (n === targetNorm || targetTokensAll.has(n)) {
      figureCounts.delete(label);
    }
  }

  return [...figureCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([label, count]) => ({ label, count }));
}

// ── Coupling by node (entity importance by graph connectivity) ─────────────────
// A main character couples to many others; a passing mention couples to few.
// This is the key metric for distinguishing Natasha from her maid.

/**
 * Measure per-node coupling: how connected is each entity in the graph?
 *
 * @param {{ entities: Map, edges: Array }} graph - from buildGraph
 * @returns {Map<string, { rhoIn: number, rhoOut: number, rho: number }>}
 */
export function couplingByNode(graph) {
  const out = new Map();
  const bump = (id, key, w) => {
    const e = out.get(id) || { rhoIn: 0, rhoOut: 0, rho: 0 };
    e[key] += w;
    e.rho += w;
    out.set(id, e);
  };
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    bump(edge.from, "rhoOut", edge.weight);
    bump(edge.to, "rhoIn", edge.weight);
  }
  return out;
}

/**
 * Rank entities by a combination of mass (sightings) and coupling (connectivity).
 * This is v5's lightweight version of v4.2's salienceOf formula.
 *
 * @param {Map<string, { id: string, label: string, sightings: number }>} entities - merged entities
 * @param {Map<string, { rho: number }>} coupling - from couplingByNode
 * @returns {Array<{ id: string, label: string, sightings: number, rho: number, salience: number }>}
 */
export function rankBySalience(entities, coupling) {
  return [...entities.values()]
    .map((e) => {
      const c = coupling.get(e.id);
      const rho = c?.rho ?? 0;
      // v4.2's bilinear salience: log(1+mass) + log(1+ρ)
      const salience = Math.log(1 + Math.max(0, e.sightings)) + Math.log(1 + Math.max(0, rho));
      return { ...e, rho, salience };
    })
    .sort((a, b) => b.salience - a.salience);
}

/**
 * Filter entity names to the "cast" — entities with salience above threshold.
 * Below-threshold entities are treated as noise (settings, passing mentions).
 *
 * @param {Array} ranked - from rankBySalience
 * @param {object} options - { minSightings }
 * @returns {Array} filtered, salience-ranked entities
 */
export function filterCast(ranked, options = {}) {
  const { minSightings = 2 } = options;
  return ranked.filter((e) => e.sightings >= minSightings);
}
