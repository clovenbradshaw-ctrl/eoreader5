export function evaluate(state, candidateSurface) {
  const support = candidateSurface?.support ?? candidateSurface?.sightings?.length ?? 0;
  const accepted = support > 1;
  return {
    candidate_id: candidateSurface?.candidate_id ?? "candidate:anonymous",
    evaluator_version: "emergence-evaluator@1",
    status: accepted ? "accepted" : "held",
    reason: accepted ? "recurrence beats single-observation null" : "insufficient evidence against single-observation null",
    evidence: candidateSurface?.sightings ?? [],
    context: { semantic_head: state.semanticHead, engine_version: state.engineVersion },
  };
}
