// shadow.js — Shadow embedding: differential measurement via concept removal.
//
// The core DEF technique: encode(full) and encode(full minus concept) are both
// positions in embedding space. Their delta isolates the concept's contribution
// as a signed vector — not a ground-truth "meaning" of the concept, but its
// empirical effect on the encoder's representation of THIS passage.
//
// This is the same logic as fMRI subtraction paradigms or Shapley values:
// the contribution of X is measured by how the representation changes when X
// is removed, holding everything else constant.
//
// ── Masking strategies ──
//
//   "mask"     — replace the concept with [MASK] token (ideal for BERT-family
//                models: the model fills in from context, so the delta captures
//                what the concept adds beyond what context would predict)
//   "delete"   — remove the concept entirely (good for entities, keeps the
//                surrounding structure intact — "Pierre danced with [MASK]"
//                vs "Pierre danced with")
//   "null"     — replace with a semantically null token like "the" or "it"
//                (experimental — tests whether the delta is specific to the
//                concept vs just any swap)

import { lazyEncoder } from "./embedder.js";

const MASK_TOKEN = "[MASK]";

// ── Mask helpers ────────────────────────────────────────────────────────────

function maskInText(text, concept) {
  const idx = text.toLowerCase().indexOf(concept.toLowerCase());
  if (idx === -1) return { masked: text, removed: false };
  return {
    masked: text.slice(0, idx) + MASK_TOKEN + text.slice(idx + concept.length),
    removed: true,
  };
}

function deleteFromText(text, concept) {
  const idx = text.toLowerCase().indexOf(concept.toLowerCase());
  if (idx === -1) return { masked: text, removed: false };
  const before = text.slice(0, idx).trimEnd();
  const after = text.slice(idx + concept.length).trimStart();
  return { masked: before + " " + after, removed: true };
}

function replaceInText(text, concept, replacement = "it") {
  const idx = text.toLowerCase().indexOf(concept.toLowerCase());
  if (idx === -1) return { masked: text, removed: false };
  return {
    masked: text.slice(0, idx) + replacement + text.slice(idx + concept.length),
    removed: true,
  };
}

// ── Core shadow-embedding functions ─────────────────────────────────────────

export const STRATEGIES = {
  mask: maskInText,
  delete: deleteFromText,
  null: replaceInText,
};

/**
 * shadowDelta(fullText, concept, { strategy, encoder }) -> delta vector
 *
 * Returns embed(full) - embed(full\{concept}) — the signed vector contribution
 * of `concept` to the passage's representation.
 *
 * A large-magnitude delta means the concept significantly alters the encoder's
 * representation. A near-zero delta means the concept is redundant given
 * context (or absent from the text). The sign and direction of the delta
 * encode HOW the concept transforms the representation — two concepts with
 * similar deltas affect the passage in similar ways.
 */
export async function shadowDelta(fullText, concept, options = {}) {
  const { strategy = "mask", encoder } = options;
  if (!concept || !concept.trim()) return null;

  const maskFn = STRATEGIES[strategy];
  if (!maskFn) throw new Error(`Unknown strategy: ${strategy}. Valid: ${Object.keys(STRATEGIES).join(", ")}`);

  const { masked, removed } = maskFn(fullText, concept);
  if (!removed) return null; // concept not found in text

  const enc = encoder || await lazyEncoder();
  const fullVec = await enc.encode(fullText);
  const maskedVec = await enc.encode(masked);

  return fullVec.map((v, i) => v - maskedVec[i]);
}

/**
 * multiShadow(fullText, concepts, options) -> { concept: delta, ... }
 *
 * Batch shadow-embedding for multiple concepts in one passage. Each concept
 * is masked independently and its delta computed from the SAME fullText
 * embedding (computed once).
 */
export async function multiShadow(fullText, concepts, options = {}) {
  const { strategy = "mask", encoder } = options;
  if (!concepts || !concepts.length) return {};

  const enc = encoder || await lazyEncoder();
  const fullVec = await enc.encode(fullText);
  const maskFn = STRATEGIES[strategy];

  const result = {};
  for (const concept of concepts) {
    if (!concept || !concept.trim()) continue;
    const { masked, removed } = maskFn(fullText, concept);
    if (!removed) { result[concept] = null; continue; }
    const maskedVec = await enc.encode(masked);
    result[concept] = fullVec.map((v, i) => v - maskedVec[i]);
  }
  return result;
}

/**
 * pairwiseDelta(a, b, { encoder }) -> delta vector
 *
 * Returns embed(a) - embed(b). A direct differential between two arbitrary
 * texts. Used for clause-pair comparison and for scoring against the LA2
 * corpus (comparing clause embeddings to cell centroids).
 */
export async function pairwiseDelta(a, b, options = {}) {
  const enc = options.encoder || await lazyEncoder();
  const [vecA, vecB] = await Promise.all([enc.encode(a), enc.encode(b)]);
  return vecA.map((v, i) => v - vecB[i]);
}

/**
 * Signed vector utility: magnitude of a delta.
 * Large magnitude = concept had a large effect on the representation.
 */
export function deltaMagnitude(delta) {
  if (!delta) return 0;
  let sum = 0;
  for (const v of delta) sum += v * v;
  return Math.sqrt(sum);
}

/**
 * Cosine similarity between two deltas.
 * high = the two concepts affect the passage in similar ways.
 */
export function deltaCosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const norm = Math.sqrt(na) * Math.sqrt(nb);
  return norm === 0 ? 0 : dot / norm;
}
