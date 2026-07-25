import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";

const WORD = /\b[\p{Lu}][\p{L}'-]{2,}\b/gu;
const STOP = new Set(["The","And","But","For","With","This","That","When","Where","While","Letter","Chapter"]);

export function evaluate(state, candidateSurface) {
  const support = candidateSurface?.support ?? candidateSurface?.sightings?.length ?? 0;

  const counts = [];
  for (const value of state?.observationIndex?.values ?? []) {
    if (typeof value.value !== "string") continue;
    for (const [surface] of value.value.matchAll(WORD)) {
      if (STOP.has(surface)) continue;
      counts.push(surface.toLowerCase());
    }
  }

  const n = counts.length;
  const permutations = Math.max(40, Math.max(1, n) * 2);
  const rng = createSeededRng(candidateSurface?.candidate_id ?? "evaluate:recurrence-null");
  const nullSamples = [];
  for (let i = 0; i < permutations; i += 1) {
    const indices = Array.from({ length: n }, (_, j) => j);
    seededShuffle(indices, rng);
    let maxRun = 1;
    let run = 1;
    for (let j = 1; j < indices.length; j += 1) {
      run = counts[indices[j]] === counts[indices[j - 1]] ? run + 1 : 1;
      if (run > maxRun) maxRun = run;
    }
    nullSamples.push(maxRun);
  }

  const nullResult = deriveNull({
    nullSamples,
    observedStatistic: support,
    tailDirection: "greater",
    quantile: 1 - 1 / Math.max(10, n),
    protocol: {
      name: "recurrence-label-shuffle",
      iterations: permutations,
      statistic: "max-recurrence-run",
      scope: "surface-form recurrence under random label assignment",
    },
  });

  const accepted = nullResult.passed;

  return {
    candidate_id: candidateSurface?.candidate_id ?? "candidate:anonymous",
    evaluator_version: "emergence-evaluator@1",
    status: accepted ? "accepted" : "held",
    reason: accepted ? "recurrence beats single-observation null" : "insufficient evidence against single-observation null",
    evidence: candidateSurface?.sightings ?? [],
    context: { semantic_head: state.semanticHead, engine_version: state.engineVersion },
  };
}
