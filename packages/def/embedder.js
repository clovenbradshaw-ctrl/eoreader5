// embedder.js — Tiny encoder wrapper for Differential Embedding Functions.
//
// Wraps @huggingface/transformers (ONNX-based, no Python) to provide a
// stateless encode() that the DEF package uses as its sensor. The model is
// all-MiniLM-L6-v2 (384-dim, 22MB, runs locally) — chosen because it is
// small enough to load in under a second and produces stable embeddings that
// the lexical analysis 2.0 corpus was also built from (paraphrase-multilingual-
// MiniLM-L12-v2 is the multilingual sibling; this is the English-tuned base).
//
// The ENCODER is never a source of ground-truth semantic facts. It is a
// differential sensor: encode(text) returns a position in embedding space;
// only DELTAS between positions carry meaning (shadow embedding). The encoder
// itself is a black box we do not interpret.
//
// No global singleton — call createEncoder() to get a pipeline, or use the
// convenience lazyEncoder singleton if you just need one.

import { pipeline, env } from "@huggingface/transformers";

// Model registry: model id -> { dim, description }
export const MODELS = {
  "Xenova/all-MiniLM-L6-v2":   { dim: 384,  description: "English-tuned MiniLM (22MB, fast)" },
  "Xenova/all-MiniLM-L12-v2":  { dim: 384,  description: "Larger MiniLM (12 layers, slower but richer)" },
  "Xenova/multilingual-e5-small": { dim: 384, description: "Multilingual E5-small, paired with LA2 corpus" },
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2": { dim: 384, description: "Multilingual MiniLM used in LA2 corpus" },
};

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

// ── Encoder instance ────────────────────────────────────────────────────────

export class Encoder {
  #pipe;
  #dim;

  constructor(pipe, dim) {
    this.#pipe = pipe;
    this.#dim = dim;
  }

  get dim() { return this.#dim; }

  async encode(texts) {
    const single = typeof texts === "string";
    const inputs = single ? [texts] : texts;
    if (!inputs.length) return [];

    const out = await this.#pipe(inputs, { pooling: "mean", normalize: true });
    const vectors = out.tolist();

    return single ? vectors[0] : vectors;
  }

  // Pool multiple text chunks into one vector by mean-pooling their embeddings.
  // Used to embed a whole clause for clause-level analysis.
  async encodePool(texts) {
    if (!Array.isArray(texts) || !texts.length) return null;
    if (texts.length === 1) return this.encode(texts[0]);
    const vecs = await this.encode(texts);
    const d = vecs[0].length;
    const pooled = new Float64Array(d);
    for (const v of vecs) for (let i = 0; i < d; i++) pooled[i] += v[i] / vecs.length;
    return Array.from(pooled);
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let _lazyEncoder = null;

export async function createEncoder(modelId = DEFAULT_MODEL) {
  const info = MODELS[modelId];
  if (!info) throw new Error(`Unknown model: ${modelId}. Valid: ${Object.keys(MODELS).join(", ")}`);

  env.localModelCache = new URL("./cache/", import.meta.url).pathname;

  const pipe = await pipeline("feature-extraction", modelId, {
    quantized: true,
    progress_callback: null,
  });

  return new Encoder(pipe, info.dim);
}

export async function lazyEncoder(modelId = DEFAULT_MODEL) {
  if (!_lazyEncoder) _lazyEncoder = await createEncoder(modelId);
  return _lazyEncoder;
}

export function resetLazyEncoder() {
  _lazyEncoder = null;
}
