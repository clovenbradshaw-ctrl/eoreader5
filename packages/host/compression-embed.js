// compression-embed.js — Compression-based text embedding.
//
// The compression ratio of a text reveals its structure: predictable
// text compresses well, surprising text doesn't. For entity role
// classification, the compressed-size delta between "sentence with
// entity" and "sentence without entity" measures the entity's
// contribution to the sentence's structure.
//
// No LLM needed — just zlib (built into Node.js).
//
// WHY THIS IS A HOST MODULE. It lived in packages/engine/emergence, where
// `import { deflateSync } from "zlib"` violates the P0 purity gate
// (conformance/invariants/forbidden-dependencies.test.js): the engine may name
// no Node built-ins, because the rule is about what the module graph may
// reference, not what a given code path happens to call. A platform codec is
// an ambient capability, which is exactly what this package is for — the same
// reason ffmpeg lives in ./video rather than inside the video perceiver.
//
// It has no callers anywhere in the workspace today. If it is later wired into
// engine-side scoring it cannot be imported from there (engine must not depend
// on host); the shape that works is to keep the measurement pure in the engine
// and have the host inject a `compress(bytes) -> length` function, the same way
// `ts`/`seq` are host-supplied to the reaction channel.

import { deflateSync } from "zlib";

const ENC = new TextEncoder();

/**
 * Compute the compressed size of a text string.
 * Uses raw deflate (no headers) for consistent, fast measurement.
 */
function compressedSize(text) {
  const bytes = ENC.encode(text);
  const compressed = deflateSync(bytes, { level: 1, memLevel: 1 });
  return compressed.length;
}

/**
 * Embedding via compression signatures: measure compressed sizes
 * of the full sentence, the nulled sentence, and a set of reference
 * texts. The return is the delta vector (full - nulled) plus the
 * per-phasepost scores.
 */
export function compressEmbed(sentence, entity) {
  const full = sentence;
  const safe = entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nulled = sentence.replace(new RegExp(safe, "g"), "");

  const fullSize = compressedSize(full);
  const nulledSize = compressedSize(nulled);
  const delta = fullSize - nulledSize;

  return { fullSize, nulledSize, delta };
}

/**
 * Precomputed phasepost compression profiles.
 * Each profile is the compressed-size signature of a canonical
 * sentence exemplifying that operator/terrain/stance.
 */
const PHASEPOST_SENTENCES = {
  // Operators
  "operator:NUL": "nothing happened it was empty",
  "operator:SEG": "divide it into parts segment the whole",
  "operator:DEF": "define what this means set the boundary",
  "operator:SIG": "this indicates that it signals something",
  "operator:CON": "connect this to that relate them together",
  "operator:EVA": "evaluate how well this works judge the result",
  "operator:INS": "insert a new element add it to the set",
  "operator:SYN": "synthesize the parts into a unified whole",
  "operator:REC": "record what happened log the observation",
  // Terrains
  "terrain:Void": "there was nothing there an empty void",
  "terrain:Entity": "a person named pierre he was the main character",
  "terrain:Kind": "it was a type of bird a species of tree",
  "terrain:Field": "the text contained information the data was clear",
  "terrain:Link": "they were connected bonded by friendship",
  "terrain:Network": "the system of roads the empire structure",
  "terrain:Atmosphere": "a feeling of dread the mood was tense",
  "terrain:Lens": "from this perspective viewed through that frame",
  "terrain:Paradigm": "the theoretical framework a new philosophy",
  // Stances
  "stance:Clearing": "clear away the obstacles remove what blocks",
  "stance:Dissecting": "analyze the components break it down",
  "stance:Unraveling": "explain what this means interpret the signs",
  "stance:Tending": "maintain the system care for what exists",
  "stance:Binding": "connect the pieces link them together",
  "stance:Tracing": "trace the path describe what happened",
  "stance:Cultivating": "grow understanding develop the idea",
  "stance:Making": "create something new build the structure",
  "stance:Composing": "organize the elements compose the whole",
};

const PHASEPOST_KEYS = Object.keys(PHASEPOST_SENTENCES);

/**
 * Precompute compressed sizes for all 27 phasepost reference texts.
 * Returns Map<phaseKey, compressedSize>
 */
export function precomputePhasepostSizes() {
  const map = new Map();
  for (const [key, text] of Object.entries(PHASEPOST_SENTENCES)) {
    map.set(key, compressedSize(text));
  }
  return map;
}

/**
 * Classify an entity's role in its sentence using compression deltas.
 *
 * 1. Compress sentence WITH entity → size_full
 * 2. Compress sentence WITHOUT entity → size_nulled
 * 3. Delta = size_full - size_nulled (entity's structural contribution)
 * 4. For each phasepost, compute how much the entity's text contributes
 *    to that phase's compressed size
 * 5. The best-matching operator/terrain/stance IS the entity's role
 *
 * @param {string} sentence - the full sentence
 * @param {string} entity - the entity name to null out
 * @param {Map} phasepostSizes - precomputed from precomputePhasepostSizes()
 * @returns {{ operator, terrain, stance, scores, delta }}
 */
export function classifyByCompression(sentence, entity, phasepostSizes) {
  const safe = entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nulled = sentence.replace(new RegExp(safe, "g"), "");

  const fullSize = compressedSize(sentence);
  const nulledSize = compressedSize(nulled);
  const delta = fullSize - nulledSize;

  // For each phasepost, compute the similarity between the delta
  // and the phasepost's own "entity removal delta"
  const scores = {};
  for (const [key, refSize] of phasepostSizes) {
    const refText = PHASEPOST_SENTENCES[key];
    // Measure how much removing the key word from the phasepost
    // changes its compressed size — this is the phasepost's signature
    const refKey = key.split(":")[1]; // e.g., "Entity", "NUL"
    const refNulled = refText.replace(new RegExp(refKey, "gi"), "");
    const refFullSize = compressedSize(refText);
    const refNulledSize = compressedSize(refNulled);
    const refDelta = refFullSize - refNulledSize;

    // Score: how similar are the entity's delta and the phasepost's delta?
    // Both should be positive (entity removal reduces compressed size).
    // Simple product: high when both deltas are high and in the same direction.
    scores[key] = delta <= 0 || refDelta <= 0 ? 0 : delta * refDelta;
  }

  function best(category) {
    let best = null, bestScore = -1;
    for (const [key, score] of Object.entries(scores)) {
      if (key.startsWith(`${category}:`) && score > bestScore) {
        bestScore = score;
        best = key.slice(category.length + 1);
      }
    }
    return best ?? null;
  }

  // Normalize scores to 0-1 range for interpretability
  const maxScore = Math.max(...Object.values(scores), 1);
  const normalizedScores = {};
  for (const [key, score] of Object.entries(scores)) {
    normalizedScores[key] = score / maxScore;
  }

  return {
    operator: best("operator") ?? "SIG",
    terrain: best("terrain") ?? "Field",
    stance: best("stance") ?? "Tracing",
    scores: normalizedScores,
    delta,
    fullSize,
    nulledSize,
  };
}

export { PHASEPOST_KEYS };
