// Mereotopology: parthood, connection, and boundary as one named vocabulary
// (docs/mereotopology.md). This is step 1 of that doc's build order: extract
// the set-overlap primitive that boundaries/index.js's jaccardDistance
// already computes inline, so later steps (classifyRegionRelation,
// fusionSupplementationGate) share one implementation instead of a third.
//
// A region is a set of observation ids (or byte-spans collapsed to a
// comparable coordinate) - exactly what jaccardDistance already consumes.

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
