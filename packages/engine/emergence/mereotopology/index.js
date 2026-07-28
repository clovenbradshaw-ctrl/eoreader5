// Mereotopology: parthood, connection, and boundary as one named vocabulary
// (docs/mereotopology.md). regionOverlap is step 1 of that doc's build
// order: extract the set-overlap primitive that boundaries/index.js's
// jaccardDistance already computes inline. fusionSupplementationGate is
// step 4: the SYN/fusion composition test - mereology's supplementation
// principle (a genuine sum's members each change what the whole predicts;
// a similarity-only cluster's members don't) as a deriveNull-gated pass.
//
// A region is a set of observation ids (or byte-spans collapsed to a
// comparable coordinate) - exactly what jaccardDistance already consumes.

import { deriveNull } from "../nulls/index.js";

/**
 * Overlap between two regions, each an iterable of comparable members.
 *
 * @param {Iterable} regionA
 * @param {Iterable} regionB
 * @returns {{ overlapCount: number, jaccard: number }} overlapCount is
 *   |A ∩ B|; jaccard is |A ∩ B| / |A ∪ B| (1 = identical, 0 = disjoint).
 *   Two empty regions are defined as fully overlapping (jaccard 1) - the
 *   same "nothing to compare" convention jaccardDistance already used
 *   (distance 0 for two empty boundaries).
 */
export function regionOverlap(regionA, regionB) {
  const setA = new Set(regionA);
  const setB = new Set(regionB);
  if (setA.size === 0 && setB.size === 0) return { overlapCount: 0, jaccard: 1 };
  let overlapCount = 0;
  for (const member of setA) if (setB.has(member)) overlapCount += 1;
  const union = setA.size + setB.size - overlapCount;
  return { overlapCount, jaccard: union === 0 ? 1 : overlapCount / union };
}

/**
 * Mereology's supplementation gate: a cluster is a genuine fused whole only
 * if its members each measurably change what the whole predicts, not just
 * a similarity blob (docs/mereotopology.md §2). Pure gate - it does not
 * compute the per-member contribution itself; the caller runs the
 * leave-one-out competency measurement appropriate to its own domain (e.g.
 * entity-kinds/index.js's held-out attribute-prediction accuracy) and hands
 * the resulting scores here, the same division of labor
 * computeBoundaryStabilityGate already uses for displacement.
 *
 * @param {object} args
 * @param {string[]} args.members - member ids, parallel to heldOutScores.
 * @param {number[]} args.heldOutScores - per-member contribution: how much
 *   removing that member changes the group's held-out predictive
 *   competency for the rest. Higher = more essential.
 * @param {number[]} args.nullHeldOutScores - the same aggregate statistic
 *   (mean contribution), computed under an explicit perturbation of the
 *   actual data (e.g. same-size random clusters drawn from the population) -
 *   the null "what contribution would a same-sized random group show by
 *   chance" distribution.
 * @param {number} [args.quantile] - Born-null quantile.
 * @param {object} [args.protocol] - echoed into the result's null_result.
 */
export function fusionSupplementationGate({ members, heldOutScores, nullHeldOutScores, quantile, protocol }) {
  if (!Array.isArray(members) || members.length === 0) {
    throw new TypeError("fusionSupplementationGate: members must be a non-empty array");
  }
  if (!Array.isArray(heldOutScores) || heldOutScores.length !== members.length) {
    throw new TypeError("fusionSupplementationGate: heldOutScores must be an array parallel to members");
  }

  const meanContribution = heldOutScores.reduce((sum, value) => sum + value, 0) / heldOutScores.length;

  const nullResult = deriveNull({
    nullSamples: nullHeldOutScores,
    observedStatistic: meanContribution,
    tailDirection: "greater",
    quantile,
    protocol: protocol ?? { name: "random-cluster-member-contribution" },
  });

  const perMemberContribution = members.map((member, i) => Object.freeze({
    member,
    contribution: heldOutScores[i],
  }));

  // A degenerate null (e.g. a heterogeneous population where most random
  // same-size groups show zero contribution by construction) can put a
  // point mass exactly at deriveNull's interpolated quantile threshold; the
  // ">=" boundary then reports passed:true even though p_value:1 - every
  // null sample was at least as extreme as observed, the least significant
  // result possible. p_value:1 can never be genuine evidence under a
  // "greater" tail regardless of where the threshold interpolation lands,
  // so this guard only ever turns a boundary-tie false positive into a
  // fail; it never overrides a real one.
  const passed = nullResult.passed && nullResult.p_value < 1;

  return Object.freeze({
    mean_contribution: meanContribution,
    passed,
    null_result: nullResult,
    per_member_contribution: Object.freeze(perMemberContribution),
  });
}
