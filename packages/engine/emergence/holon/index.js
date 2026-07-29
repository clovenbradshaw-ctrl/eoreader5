// emergence/holon/index.js — Earned composition: the supplementation and
// downward-closure gates.
//
// SYN composition of parts into a higher holon is GATED, not asserted.
// Two gates:
//
//   SUPPLEMENTATION — a holon is genuine only if removing any part changes
//     what the holon predicts more than removing a random member of a
//     random same-size assembly would (deriveNull, same discipline as
//     boundaries.js and kinds/index.js).
//
//   DOWNWARD-CLOSURE — the safety-critical gate. A holon is admitted as a
//     whole of its parts only if (a) it preserves each part's specific
//     character (no absorption-with-no-remainder — the predator case) and
//     (b) any trace the holon deposits into the medium is one its parts can
//     sense and answer (no captured commons — the seat that coordinates
//     without accountability).

import { deriveNull, createSeededRng, seededShuffle } from "../nulls/index.js";
import { sense } from "../stigmergy/index.js";

// ── Feature extraction ────────────────────────────────────────────────────────

const WORD_RE = /[a-zà-ÿ'’-]+/gi;

function tokens(text) {
  return String(text ?? "").toLowerCase().match(WORD_RE) ?? [];
}

function featureVector(text) {
  const ws = tokens(text);
  const vec = new Map();
  for (const w of ws) {
    if (w.length < 3) continue;
    vec.set(w, (vec.get(w) ?? 0) + 1);
  }
  return vec;
}

function cosineDistance(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  const allKeys = new Set([...vecA.keys(), ...vecB.keys()]);
  for (const k of allKeys) {
    const a = vecA.get(k) ?? 0;
    const b = vecB.get(k) ?? 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function centroid(vectors) {
  const c = new Map();
  for (const vec of vectors) {
    for (const [k, v] of vec) {
      c.set(k, (c.get(k) ?? 0) + v);
    }
  }
  const n = vectors.length;
  for (const [k, v] of c) c.set(k, v / n);
  return c;
}

// ── Supplementation gate ──────────────────────────────────────────────────────

/**
 * supplementationTest({ parts, partFeatures, assemblyPool }) -> gateResult
 *
 * Leave-one-out test: for each part pi, compute the distance between the
 * holon centroid WITH pi and the holon centroid WITHOUT pi. Build a null
 * distribution from random same-size assemblies where a random member is
 * removed. If the mean leave-one-out distance exceeds the null threshold,
 * the holon passes supplementation — its parts are genuinely contributing,
 * not interchangeable.
 *
 * @param {string[]} parts — part identifiers (e.g. referent names)
 * @param {Map<string, Map<string, number>>} partFeatures — partId → feature vector
 * @param {Map<string, number>[][][]} assemblyPool — pool of random assemblies
 *   (each is an array of feature vectors). If not provided, built by shuffling.
 * @returns {{ passed: boolean, null_result: object, mean_leave_out: number }}
 */
export function supplementationTest({ parts, partFeatures, assemblyPool = null } = {}) {
  if (!parts || parts.length < 2) {
    return { passed: false, null_result: null, mean_leave_out: 0, reason: "insufficient_parts" };
  }

  // Get feature vectors for each part
  const vectors = parts.map((p) => partFeatures?.get(p) ?? featureVector(p));
  if (vectors.some((v) => v.size === 0)) {
    return { passed: false, null_result: null, mean_leave_out: 0, reason: "empty_feature_vectors" };
  }

  // Compute leave-one-out distances
  const looDistances = [];
  const fullCentroid = centroid(vectors);
  for (let i = 0; i < parts.length; i++) {
    const without = vectors.filter((_, j) => j !== i);
    const withoutCentroid = centroid(without);
    const d = cosineDistance(fullCentroid, withoutCentroid);
    looDistances.push(d);
  }
  const meanLeaveOut = looDistances.reduce((a, b) => a + b, 0) / looDistances.length;

  // Build null distribution from random assemblies
  const nullSamples = [];
  const rng = createSeededRng(`supplementation-null-${parts.length}-${JSON.stringify(parts)}`);
  const totalPool = assemblyPool ?? vectors;
  const iters = Math.max(50, parts.length * 10);

  for (let iter = 0; iter < iters; iter++) {
    // Shuffle all vectors and take a random same-size assembly
    const shuffled = seededShuffle(totalPool, rng);
    const assembly = shuffled.slice(0, parts.length);
    if (assembly.length < 2) continue;

    // Randomly remove one member
    const removeIdx = Math.floor(rng() * assembly.length);
    const without = assembly.filter((_, j) => j !== removeIdx);
    const fullC = centroid(assembly);
    const withoutC = centroid(without);
    nullSamples.push(cosineDistance(fullC, withoutC));
  }

  const nullResult = deriveNull({
    nullSamples,
    observedStatistic: meanLeaveOut,
    tailDirection: "greater",
    quantile: 0.95,
    protocol: { name: "supplementation-leave-one-out", parts: parts.length, iterations: iters },
  });

  return {
    passed: nullResult.passed,
    null_result: nullResult,
    mean_leave_out: +meanLeaveOut.toFixed(4),
    samples: looDistances.length,
  };
}

// ── Downward-closure gate ─────────────────────────────────────────────────────

/**
 * downwardClosureTest({ parts, partFeatures, holonFeature, medium, holonTrace, partIds }) -> gateResult
 *
 * The safety-critical gate. Two checks:
 *
 * (a) Specific character preservation: each part's feature vector must be
 *     distinguishable from the holon's centroid. If a part is so similar to
 *     the holon that it has no distinguishing character, the holon has
 *     ABSORBED the part — the predator/borg case. Refused.
 *
 * (b) Trace sensibility: the holon's trace must be findable by at least one
 *     of its parts via sense() in the medium. If no part can sense (or has
 *     access to) the holon's trace, the holon is coordinating without
 *     accountability — the capture case. Refused.
 *
 * @param {string[]} partIds
 * @param {Map<string, Map>} partFeatures
 * @param {Map} holonFeature — the holon's own feature vector
 * @param {object} medium — stigmergy Medium (for checking trace sensibility)
 * @param {object} holonTrace — the trace the holon deposited
 * @returns {{ admitted: boolean, predicate_a: boolean, predicate_b: boolean, reason: string | null }}
 */
export function downwardClosureTest({ parts: partIds, partFeatures, holonFeature, medium = null, holonTrace = null } = {}) {
  if (!partIds || partIds.length < 2) {
    return { admitted: false, predicate_a: false, predicate_b: false, reason: "insufficient_parts" };
  }

  const failures = [];

  // (a) Specific character preservation
  let allPartsDistinct = true;
  const holonVec = holonFeature ?? (partFeatures
    ? centroid(partIds.map((id) => partFeatures.get(id)).filter(Boolean))
    : new Map());

  for (const id of partIds) {
    const pVec = partFeatures?.get(id);
    if (!pVec) continue;
    const dist = cosineDistance(holonVec, pVec);
    // If a part is nearly identical to the holon centroid (distance < 0.1),
    // it has been absorbed — no specific character remains.
    if (dist < 0.1 && pVec.size > 0) {
      allPartsDistinct = false;
      break;
    }
  }

  // (b) Trace sensibility
  let partsCanSenseHolonTrace = true;
  if (medium && holonTrace) {
    // Check: can any part sense the holon's trace in the medium?
    // Each part tries to sense its local neighborhood.
    let anyPartSenses = false;
    for (const id of partIds) {
      try {
        const sensed = sense(medium, { from: 0, count: medium.deposits.length > 0 ? Math.min(10, Math.floor(medium.deposits.length / 2)) : 0 });
        if (sensed.some((d) => d.trace && d.trace.holonId === holonTrace.holonId)) {
          anyPartSenses = true;
          break;
        }
      } catch {
        // sense() may throw for various reasons — part can't reach the medium
      }
    }
    partsCanSenseHolonTrace = anyPartSenses;
  }

  if (!allPartsDistinct) {
    failures.push("predator: holon absorbed a part's specific character (case a)");
  }
  if (!partsCanSenseHolonTrace && medium && holonTrace) {
    failures.push("capture: holon trace is not sensible by its parts (case b)");
  }

  const admitted = allPartsDistinct && (medium ? partsCanSenseHolonTrace : true);

  return {
    admitted,
    predicate_a: allPartsDistinct,
    predicate_b: medium ? partsCanSenseHolonTrace : true,
    reason: admitted ? null : failures.join("; "),
  };
}

// ── Full holon composition ────────────────────────────────────────────────────

/**
 * composeHolon({ parts, partFeatures, medium, holonTrace, assemblyPool }) -> result
 *
 * Full SYN composition: run supplementation first, then downward-closure.
 * If either gate fails, the holon is returned as an unpromoted assembly with
 * the failure reason on the audit surface.
 *
 * @returns {{ admitted: boolean, holon: object | null, supplementation: object, downward_closure: object }}
 */
export function composeHolon({ parts, partFeatures, medium = null, holonTrace = null, assemblyPool = null } = {}) {
  const supp = supplementationTest({ parts, partFeatures, assemblyPool });

  if (!supp.passed) {
    return Object.freeze({
      admitted: false,
      holon: null,
      supplementation: supp,
      downward_closure: null,
      status: "assembly", // unpromoted
      reason: `supplementation failed: mean leave-out ${supp.mean_leave_out} did not clear null threshold ${supp.null_result?.threshold}`,
    });
  }

  const holonVec = partFeatures ? centroid(parts.map((p) => partFeatures.get(p)).filter(Boolean)) : new Map();
  const down = downwardClosureTest({ parts, partFeatures, holonFeature: holonVec, medium, holonTrace });

  if (!down.admitted) {
    return Object.freeze({
      admitted: false,
      holon: null,
      supplementation: supp,
      downward_closure: down,
      status: "assembly",
      reason: `downward-closure failed: ${down.reason}`,
    });
  }

  return Object.freeze({
    admitted: true,
    holon: Object.freeze({
      schema: "Holon@1",
      parts: Object.freeze([...parts]),
      featureVector: Object.freeze(new Map(holonVec)),
    }),
    supplementation: supp,
    downward_closure: down,
    status: "holon",
    reason: null,
  });
}
