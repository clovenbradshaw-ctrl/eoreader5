// Coreference Phase A: OperatorCandidate -> individuation gate (spec "EO
// Terrain Promotion and Predictive Prior Induction v0.2" section 13, read
// against "EO Emergent Mathematics for Predictive Competency" section 11.2 /
// 22.4). See docs/individuation-gate.md for the gate this feeds and
// packages/engine/emergence/operators/index.js for OperatorCandidate@1.
//
// A promoted operator is ambient material with a provisional handle - a
// content-addressed id, not yet an entity assertion - exactly the position
// docs/individuation-gate.md describes for a ReferentHypothesis. This module
// is the thin, mechanical map from one to the other: it does not compute any
// new observable, it only reads the Born-null evidence an operator already
// carries and hands it to the same gate narrative referents go through.
//
// Field mapping, and why:
//   - mass      = transfer_gain. The held-out evidence that the operator's
//                 competency is a real, generalizing presence (invariant
//                 7.6), not an in-sample artifact - the closest analogue to
//                 "sighting mass" this rung has.
//   - coupling  = reference_gain. The in-sample gain the operator's own
//                 promotion_null was derived against (bornNullGate in
//                 emergence/operators/index.js measures exactly this
//                 statistic) - how tightly the composed structure binds to
//                 the series it was mined from.
//   - massNullSamples / couplingNullSamples = promotion_null.null_samples.
//                 An operator carries exactly one Born-null distribution
//                 (the shuffled-series reference-gain null); reusing it for
//                 both typings is an explicit, documented approximation, not
//                 a fabricated threshold (spec 12.8 still forbids a
//                 hand-set constant). couplingNullSamples is the exact
//                 match (same statistic, same protocol); massNullSamples is
//                 approximate because it types a held-out statistic against
//                 an in-sample null. A dedicated held-out null is follow-up
//                 work, not invented here.
//   - named     = emergence.reenters_as === "INS". A promoted operator's
//                 content-addressed id is the stable handle it is referred
//                 to by from this point on (section 22.4) - the same role a
//                 name-bind plays for a narrative referent (spec 13.5).
//   - boundary  = omitted. No re-segmentation evidence exists for an
//                 operator yet, so the gate result is "pending", never
//                 silently admitted (spec 4.4) - fabricating a boundary null
//                 here would be worse than leaving it unevaluated.

import { individuateReferent } from "./individuation.js";

/**
 * Map an OperatorCandidate@1 onto individuateReferent's argument shape.
 * Pure and non-mutating; does not call the gate itself so callers can
 * inspect or override fields (e.g. supply real boundary evidence once a
 * re-segmentation protocol for operators exists) before gating.
 *
 * @param {object} candidate - an OperatorCandidate@1 record from
 *   packages/engine/emergence/operators/index.js (`induceOperators`).
 * @returns {object} args suitable for individuateReferent / classifyIndividuationType.
 */
export function operatorCandidateToReferentArgs(candidate) {
  if (!candidate || candidate.schema !== "OperatorCandidate@1") {
    throw new TypeError('operatorCandidateToReferentArgs: candidate must be an "OperatorCandidate@1" record');
  }
  if (!candidate.promotion_null || !Array.isArray(candidate.promotion_null.null_samples)) {
    throw new TypeError("operatorCandidateToReferentArgs: candidate.promotion_null.null_samples is required");
  }

  const nullSamples = candidate.promotion_null.null_samples;

  return {
    referentId: candidate.id,
    mass: candidate.transfer_gain,
    coupling: candidate.reference_gain,
    named: candidate.emergence?.reenters_as === "INS",
    massNullSamples: nullSamples,
    couplingNullSamples: nullSamples,
    quantile: candidate.promotion_null.quantile,
  };
}

/**
 * Run an OperatorCandidate@1 through the individuation gate. A convenience
 * wrapper over operatorCandidateToReferentArgs + individuateReferent; extra
 * lets a caller supply what the candidate itself cannot (e.g. `boundary`
 * once a re-segmentation protocol for operators exists, or an override
 * `quantile`).
 *
 * @param {object} candidate - an OperatorCandidate@1 record.
 * @param {object} [extra] - additional/overriding individuateReferent args.
 */
export function individuateOperatorCandidate(candidate, extra = {}) {
  return individuateReferent({ ...operatorCandidateToReferentArgs(candidate), ...extra });
}
