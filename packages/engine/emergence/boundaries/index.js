// Boundary stability (spec section 13.3): the individuation test. Mass
// concentration alone is a clustering heuristic that will happily
// individuate boilerplate; a figure is a place where the cut keeps landing.
//
//   for k perturbations of the segmentation (SEG):
//       recompute the referent's boundary
//       record displacement
//   boundaryStability = 1 - (mean displacement / null displacement)
//   promote if boundaryStability exceeds deriveNull(displacement | random boundaries)
//
// This module only scores displacement it is handed; generating the k
// re-segmentation perturbations and the random-boundary null samples is the
// caller's job (source-order re-segmentation is a modality concern, and
// engine purity forbids ambient randomness - see createSeededRng in
// ../nulls/index.js for a deterministic way to do it).

import { deriveNull } from "../nulls/index.js";

/**
 * Symmetric-difference distance between two boundaries, each expressed as
 * an iterable of comparable members (e.g. observation ids or byte spans
 * collapsed to a coordinate). 0 = identical boundary, 1 = disjoint.
 */
export function jaccardDistance(boundaryA, boundaryB) {
  const setA = new Set(boundaryA);
  const setB = new Set(boundaryB);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const member of setA) if (setB.has(member)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : 1 - intersection / union;
}

function mean(values) {
  if (values.length === 0) throw new TypeError("mean: values must be non-empty");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Score a referent's boundary stability under re-segmentation.
 *
 * @param {object} args
 * @param {number[]} args.observedDisplacements - displacement of the
 *   referent's boundary under k real re-segmentation perturbations (SEG).
 * @param {number[]} args.nullDisplacements - displacement of random
 *   boundaries of comparable shape/size under the same perturbations; this
 *   is the null model ("random boundaries") the spec requires.
 * @param {number} [args.quantile=0.95] - the null quantile the observed mean
 *   displacement must stay under to pass.
 * @param {object} [args.protocol] - description of the segmentation
 *   perturbation used, echoed into the result's nullResult.nullProtocol.
 */
export function computeBoundaryStabilityGate({
  observedDisplacements,
  nullDisplacements,
  quantile = 0.95,
  protocol,
}) {
  if (!Array.isArray(observedDisplacements) || observedDisplacements.length === 0) {
    throw new TypeError("computeBoundaryStabilityGate: observedDisplacements must be a non-empty array");
  }
  const meanObservedDisplacement = mean(observedDisplacements);

  const nullResult = deriveNull({
    nullSamples: nullDisplacements,
    observedStatistic: meanObservedDisplacement,
    tailDirection: "less",
    quantile,
    protocol: protocol ?? { name: "random-boundary-displacement" },
  });

  // Informational gauge only (spec 29.5: numeric readouts belong on the
  // audit surface, not the reader) - not itself compared against a
  // constant; passed/failed comes from nullResult, a Born-null threshold.
  const boundaryStability =
    nullResult.threshold > 0
      ? 1 - meanObservedDisplacement / nullResult.threshold
      : meanObservedDisplacement === 0
        ? 1
        : 0;

  return Object.freeze({
    mean_observed_displacement: meanObservedDisplacement,
    boundary_stability: boundaryStability,
    passed: nullResult.passed,
    null_result: nullResult,
  });
}
