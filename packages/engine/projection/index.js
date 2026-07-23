export function project(state, { frame, lens, cursor, projection } = {}) {
  return {
    schema: "ProjectionBundle@1",
    projection_id: `projection:${state.semanticHead}`,
    semantic_head: state.semanticHead,
    context: { frame, lens, cursor, projection },
    spans: [],
    nesting: [],
    relations: [],
    parameters: [],
    evidence_links: state.events.map((event) => ({ event_id: event.event_id, inputs: event.inputs })),
    navigation_hints: [],
  };
}
