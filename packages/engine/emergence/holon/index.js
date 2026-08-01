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
import {
  existenceDependencyTest,
  possibilityConstraintTest,
  classifyHolonLevelRelation,
} from "../holon-level/index.js";

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
 * supplementationTest({ parts, partFeatures, assemblyPool, nullMode }) -> gateResult
 *
 * Leave-one-out test: for each part pi, compute the distance between the
 * holon centroid WITH pi and the holon centroid WITHOUT pi.
 *
 * Two null modes (arrow of time: the real grouping should matter more than
 * random assignment or random substitution):
 *
 *   "replace" (default): For each part, replace it with a random vector from
 *     the pool. If the average replacement distance exceeds the average
 *     leave-one-out distance, the parts genuinely contribute — their specific
 *     identity matters more than random insertion. An assembly where
 *     replacement ~= removal has interchangeable parts.
 *
 *   "draw": Draw random same-size assemblies from the pool. Used when the
 *     pool represents alternative part candidates rather than a diverse
 *     background.
 *
 * @param {string[]} parts — part identifiers (e.g. referent names)
 * @param {Map<string, Map<string, number>>} partFeatures — partId → feature vector
 * @param {Map<string, number>[][][]} assemblyPool — pool of feature vectors for null
 * @param {"replace"|"draw"} nullMode — how to build the null distribution
 * @returns {{ passed: boolean, null_result: object, mean_leave_out: number }}
 */
export function supplementationTest({ parts, partFeatures, assemblyPool = null, nullMode = "replace" } = {}) {
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

  const nullSamples = [];
  const rng = createSeededRng(`supplementation-null-${parts.length}-${nullMode}-${JSON.stringify(parts)}`);
  const totalPool = assemblyPool ?? vectors;
  const iters = Math.max(50, parts.length * 10);

  if (nullMode === "replace" && totalPool.length > parts.length) {
    // Replacement null: replace each real part with a random pool vector.
    // If replacement distance > removal (leave-one-out) distance, the parts
    // are genuinely contributing — a random substitution disrupts more than
    // simply removing. If replacement ~= removal, parts are interchangeable.
    const partIndices = vectors.map((_, j) => j);

    for (let iter = 0; iter < iters; iter++) {
      // Pick which part to replace
      const replaceIdx = partIndices[Math.floor(rng() * partIndices.length)];
      // Pick a random pool vector that's not one of the real part vectors
      let poolIdx;
      let poolVec;
      do {
        poolIdx = Math.floor(rng() * totalPool.length);
        poolVec = totalPool[poolIdx];
      } while (vectors.some((v) => v === poolVec));

      // Replace the part and recompute centroid distance from original
      const replaced = vectors.map((v, j) => j === replaceIdx ? poolVec : v);
      const replacedCentroid = centroid(replaced);
      nullSamples.push(cosineDistance(fullCentroid, replacedCentroid));
    }

    const nullResult = deriveNull({
      nullSamples,
      observedStatistic: meanLeaveOut,
      tailDirection: "less",
      quantile: 0.95,
      protocol: { name: "supplementation-replacement-null", parts: parts.length, iterations: iters },
    });

    // Pass when meanLeaveOut is BELOW the null replacement distances —
    // i.e., removing a real part disturbs the holon LESS than replacing it
    // with random. If removal disturbs AS MUCH as replacement, parts are
    // interchangeable (assembly).
    return {
      passed: nullResult.passed,
      null_result: nullResult,
      mean_leave_out: +meanLeaveOut.toFixed(4),
      replacement_mean: +(nullSamples.reduce((a, b) => a + b, 0) / nullSamples.length).toFixed(4),
      samples: looDistances.length,
      null_mode: "replace",
    };
  }

  // Fallback: draw mode — random assemblies from pool
  for (let iter = 0; iter < iters; iter++) {
    const shuffled = seededShuffle(totalPool, rng);
    const assembly = shuffled.slice(0, parts.length);
    if (assembly.length < 2) continue;

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
    null_mode: "draw",
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

// ── Holon-level confirmation ───────────────────────────────────────────────────
//
// composeHolon used to assume SYN composition always produces a ladder rung.
// It doesn't get to assume that (docs/holon-level.md) — confirm it instead,
// per part, using data composeHolon already has:
//
//   existence-dependency — does the HOLON depend on part P? Leave-one-out
//     centroid distance when P is excluded (the same statistic
//     supplementationTest already computes internally, just kept per-part
//     here) against the leave-one-out distances of the OTHER parts as the
//     null population — the exact, enumerable null at this scale, no
//     sampling needed (the same idiom supplementationTest's own "draw" mode
//     uses: real siblings from the same pool, not invented noise).
//   possibility-constraint — does the HOLON constrain part P? Reuses the
//     "pull" statistic independently derived in eoPriors'
//     src/vendor/eoreader/core/spectral.js for exactly this relation:
//     pull = cos^2(part, whole), "the fraction of the part's energy the
//     whole sets." Compared against the pull observed for sibling parts.
//
// With very few parts, or a highly symmetric holon, many/most parts will
// legitimately confirm as "peer" even though the holon as a WHOLE passed
// supplementation and downward-closure — that certifies a genuine holon
// exists; this certifies WHICH parts show a discoverable individual
// asymmetry against their siblings, a different and honestly narrower
// question. Never assume "above" just because composition succeeded.
function confirmLevelRelations({ parts, partFeatures, holonVec }) {
  if (!partFeatures || parts.length < 2) return [];

  const vectors = parts.map((p) => partFeatures.get(p));
  const leaveOneOut = parts.map((_, i) => {
    const without = vectors.filter((_, j) => j !== i);
    return cosineDistance(holonVec, centroid(without));
  });
  const pulls = parts.map((p) => {
    const similarity = 1 - cosineDistance(holonVec, partFeatures.get(p));
    return similarity * similarity;
  });

  return parts.map((part, i) => {
    const nullDegradations = leaveOneOut.filter((_, j) => j !== i);
    const nullNarrowings = pulls.filter((_, j) => j !== i);

    const existence = existenceDependencyTest({
      observedDegradation: leaveOneOut[i],
      nullDegradations,
      protocol: { name: "compose-holon-leave-one-out-degradation", part },
    });
    const constraint = possibilityConstraintTest({
      observedNarrowing: pulls[i],
      nullNarrowings,
      protocol: { name: "compose-holon-part-pull", part },
    });
    const classification = classifyHolonLevelRelation({
      existence,
      constraint,
      subject_id: "holon",
      candidate_id: part,
    });
    return Object.freeze({ part, ...classification });
  });
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

  const levelRelations = confirmLevelRelations({ parts, partFeatures, holonVec });

  return Object.freeze({
    admitted: true,
    holon: Object.freeze({
      schema: "Holon@1",
      parts: Object.freeze([...parts]),
      featureVector: Object.freeze(new Map(holonVec)),
      level_relations: Object.freeze(levelRelations),
    }),
    supplementation: supp,
    downward_closure: down,
    status: "holon",
    reason: null,
  });
}
