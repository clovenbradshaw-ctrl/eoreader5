// packages/def/index.js — Differential Embedding Functions for EOReader5.
//
// DEFs are the principled use of tiny NLP models in an EOReader organ:
// not as ground-truth semantic sources (BERT does not know what a clause
// "means"), but as differential sensors whose DELTAS carry signal.
//
//   embed(text)                  → position in embedding space
//   delta(text, concept)         → embed(text) - embed(text\{concept})
//   svoDelta(S, V, O)            → triad of role deltas
//   nearestCell(delta)           → which EO cell is this delta closest to?
//
// The engine imports vectors (data), never the model. The SEPARATION is
// architectural: @eoreader/def is NOT @eoreader/engine.
//
// ── Workflow ──
//
//   import { DEFEngine } from "@eoreader/def";
//   const def = await DEFEngine.create();
//   const d = await def.shadowDelta("Pierre danced with Natasha", "danced");
//   const cell = def.nearestCell(d);
//   console.log(cell.operator); // "BINDING" or "MAKING" etc.

export { Encoder, createEncoder, lazyEncoder, MODELS } from "./embedder.js";
export {
  shadowDelta, multiShadow, pairwiseDelta,
  deltaMagnitude, deltaCosine, STRATEGIES,
} from "./shadow.js";
export {
  extractSVO, verbDelta, roleDeltas,
} from "./svo.js";
export {
  loadCentroids, nearestCell, cellProximityProfile, axisScores,
  cellAddress, axisDistance,
  Q1_VALS, Q2_VALS, Q3_VALS,
} from "./cell.js";
export {
  transitionSignificance, buildTransitionMatrix, scoreSequence, findPeaks,
  rowEntropies, cellKey, splitToSentences, ALL_CELL_KEYS,
  transitionSurprisal, finalDistribution,
} from "./transition.js";

/**
 * DEFEngine — convenience facade bundling encoder + centroids.
 *
 * Usage:
 *   const def = await DEFEngine.create({ model: "Xenova/all-MiniLM-L6-v2" });
 *   const delta = await def.shadowDelta("Andrew married Lise", "married");
 *   const profile = def.cellProximityProfile(delta);
 */
export class DEFEngine {
  constructor(encoder, centroids) {
    this.encoder = encoder;
    this.centroids = centroids;
  }

  static async create(options = {}) {
    const { model, centroidPath } = options;
    const { createEncoder } = await import("./embedder.js");
    const encoder = await createEncoder(model);
    const centroids = centroidPath ? loadCentroids(centroidPath) : null;
    return new DEFEngine(encoder, centroids);
  }

  async encode(text) {
    return this.encoder.encode(text);
  }

  async shadowDelta(text, concept, opts = {}) {
    const { shadowDelta: fn } = await import("./shadow.js");
    return fn(text, concept, { ...opts, encoder: this.encoder });
  }

  async multiShadow(text, concepts, opts = {}) {
    const { multiShadow: fn } = await import("./shadow.js");
    return fn(text, concepts, { ...opts, encoder: this.encoder });
  }

  async pairwiseDelta(a, b) {
    const { pairwiseDelta: fn } = await import("./shadow.js");
    return fn(a, b, { encoder: this.encoder });
  }

  async roleDeltas(clause, subject, verb, object) {
    const { roleDeltas: fn } = await import("./svo.js");
    return fn(clause, subject, verb, object, { encoder: this.encoder });
  }

  nearestCell(vector) {
    return nearestCell(vector, this.centroids);
  }

  cellProximityProfile(vector) {
    return cellProximityProfile(vector, this.centroids);
  }

  axisScores(vector) {
    return axisScores(vector, this.centroids);
  }
}
