export function evaluate(state, candidateSurface) {
  return {
    candidate_id: candidateSurface?.candidate_id ?? "candidate:anonymous",
    evaluator_version: "emergence-evaluator@0",
    status: "held",
    reason: "substrate-only evaluator; discovery implementation pending P1",
    context: { semantic_head: state.semanticHead, engine_version: state.engineVersion },
  };
}
