// phase-roles.js — Entity role classification via embedding delta.
//
// For each sentence containing an entity:
//   1. Embed the sentence (vector representation)
//   2. Null out the entity (replace with void token), re-embed
//   3. Delta = embedding_with - embedding_without
//   4. Compare delta to each of the 27 phasepost profiles
//      (operator × terrain × stance archetype embeddings)
//   5. The highest-similarity phasepost IS the entity's role
//
// This gives SOFT classification — an entity can be 60% Entity:Tracing
// and 30% Lens:Composing. Far richer than hard regex patterns.
//
// The 27 phasepost profiles are precomputed once (offline) and stored
// as constants. The embedder is injected (from the proxy/web client).
// The delta computation and comparison are pure functions.

// ── 27 phasepost profiles ──────────────────────────────────────
// Each profile is the characteristic embedding vector for one of the
// 9 operators, 9 terrains, or 9 stances. These are precomputed by
// embedding canonical sentences and stored here as frozen vectors.
//
// This file stores the STRUCTURE only. The actual embedding vectors
// are small Float64Arrays generated once by phase-profile-tool.js
// and loaded at initialization. For now, the vectors are zeros —
// the first call to warm() generates them via the injected embedder.

import { OPERATOR_CODES } from "@eoreader/spec/operators";
import { TERRAINS, STANCES } from "@eoreader/spec/cube";

const PHASE_KEYS = [
  ...OPERATOR_CODES.map((o) => `operator:${o}`),
  ...Object.keys(TERRAINS).map((t) => `terrain:${t}`),
  ...Object.keys(STANCES).map((s) => `stance:${s}`),
]; // 27 phasepost keys

let dims = 0; // embedding dimension (set by warm())
let profiles = null; // Map<phaseKey, Float64Array>

/**
 * Warm the phase role classifier by generating phasepost embedding
 * profiles via the injected embedder. Must be called before classify().
 *
 * @param {object} embedder - { dims: number, embed: (text) => number[] }
 */
export async function warm(embedder) {
  if (!embedder || !embedder.embed) throw new Error("phase-roles: embedder required");
  dims = embedder.dims || 384; // default MiniLM dimension

  // Canonical sentences for each phasepost
  const canonicals = {
    // Operators
    "operator:NUL": "nothing happened, it was empty",
    "operator:SEG": "divide it into parts, segment the whole",
    "operator:DEF": "define what this means, set the boundary",
    "operator:SIG": "this indicates that, it signals something",
    "operator:CON": "connect this to that, relate them together",
    "operator:EVA": "evaluate how well this works, judge the result",
    "operator:INS": "insert a new element, add it to the set",
    "operator:SYN": "synthesize the parts into a unified whole",
    "operator:REC": "record what happened, log the observation",
    // Terrains
    "terrain:Void": "there was nothing there, an empty void",
    "terrain:Entity": "a person named Pierre, he was the main character",
    "terrain:Kind": "it was a type of bird, a species of tree",
    "terrain:Field": "the text contained information, the data was clear",
    "terrain:Link": "they were connected, bonded by friendship",
    "terrain:Network": "the system of roads, the empire's structure",
    "terrain:Atmosphere": "a feeling of dread, the mood was tense",
    "terrain:Lens": "from this perspective, viewed through that frame",
    "terrain:Paradigm": "the theoretical framework, a new philosophy",
    // Stances
    "stance:Clearing": "clear away the obstacles, remove what blocks",
    "stance:Dissecting": "analyze the components, break it down",
    "stance:Unraveling": "explain what this means, interpret the signs",
    "stance:Tending": "maintain the system, care for what exists",
    "stance:Binding": "connect the pieces, link them together",
    "stance:Tracing": "trace the path, describe what happened",
    "stance:Cultivating": "grow understanding, develop the idea",
    "stance:Making": "create something new, build the structure",
    "stance:Composing": "organize the elements, compose the whole",
  };

  profiles = new Map();
  const texts = PHASE_KEYS.map((k) => canonicals[k] || k);
  const vectors = await embedder.embed(texts);
  for (let i = 0; i < PHASE_KEYS.length; i++) {
    profiles.set(PHASE_KEYS[i], new Float64Array(vectors[i]));
  }
  return profiles;
}

/**
 * Classify an entity's role in its sentence using the embedding delta.
 *
 * @param {string} sentence - the full sentence containing the entity
 * @param {string} entity - the entity name (will be nulled in a copy)
 * @param {object} embedder - { embed: (text) => number[] }
 * @returns {Promise<{ operator: string, terrain: string, stance: string,
 *                      scores: object }>}
 */
export async function classifyEntityRole(sentence, entity, embedder) {
  if (!profiles) throw new Error("phase-roles: not warmed — call warm() first");
  if (!sentence || !entity) return { operator: "SIG", terrain: "Field", stance: "Tracing", scores: {} };

  // 1. Embed the full sentence
  const fullVec = await embedder.embed([sentence]);

  // 2. Null out the entity and re-embed
  const nulled = sentence.replace(new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[void]");
  const nulledVec = await embedder.embed([nulled]);

  // 3. Compute delta
  const delta = new Float64Array(dims);
  for (let i = 0; i < dims; i++) {
    delta[i] = fullVec[0][i] - nulledVec[0][i];
  }

  // 4. Compare delta to each phasepost profile (cosine similarity)
  const scores = {};
  for (const [key, profile] of profiles) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < dims; i++) {
      dot += delta[i] * profile[i];
      na += delta[i] * delta[i];
      nb += profile[i] * profile[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    scores[key] = denom > 0 ? dot / denom : 0;
  }

  // 5. Find best operator, terrain, stance
  const bestOp = bestOfCategory(scores, "operator");
  const bestTer = bestOfCategory(scores, "terrain");
  const bestSta = bestOfCategory(scores, "stance");

  return {
    operator: bestOp ?? "SIG",
    terrain: bestTer ?? "Field",
    stance: bestSta ?? "Tracing",
    scores,
  };
}

function bestOfCategory(scores, category) {
  let best = null, bestScore = -Infinity;
  for (const [key, score] of Object.entries(scores)) {
    if (key.startsWith(`${category}:`) && score > bestScore) {
      bestScore = score;
      best = key.slice(category.length + 1);
    }
  }
  return best;
}

/**
 * Check if the phase role classifier is ready.
 */
export function isWarm() {
  return profiles !== null && dims > 0;
}

export { PHASE_KEYS };
