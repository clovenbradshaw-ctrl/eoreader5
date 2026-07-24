import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { validateReadingSnapshot } from "@eoreader/spec";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

export function project(state, { frame = "frame:default", lens = "lens:neutral", cursor, projection } = {}) {
  const spans = state.observations.flatMap((observation) => (observation.fields ?? []).map((field) => ({ span_id: id("span", { source: observation.source_id, field: field.field_id }), source_id: observation.source_id, field_id: field.field_id, axes: field.axes ?? [], block_id: field.block_id })));
  const referents = [...(state.referents?.values?.() ?? [])];
  return {
    schema: "ProjectionBundle@1",
    projection_id: id("projection", { head: state.semanticHead, frame, lens, cursor, projection }),
    semantic_head: state.semanticHead,
    context: { frame, lens, cursor, projection },
    spans,
    nesting: state.observations.flatMap((observation) => (observation.axes ?? []).map((axis) => ({ parent_id: observation.source_id, child_id: axis.axis_id, relation: "axis" }))),
    relations: referents.flatMap((referent) => referent.surfaces.map((surface) => ({ relation_id: id("relation", { referent: referent.id, surface }), type: "names", from: referent.id, to: surface }))),
    parameters: [state.hypotheses.accepted, state.hypotheses.competing, state.hypotheses.held].flat().map((h) => ({ parameter_id: h.hypothesis_id ?? h.event_id, status: h.status ?? "held", evidence: h.evidence ?? null })),
    evidence_links: state.events.map((event) => ({ event_id: event.event_id, inputs: event.inputs, provenance: event.provenance })),
    navigation_hints: [{ rel: "semantic-head", target: state.semanticHead }, ...referents.map((r) => ({ rel: "referent", target: r.id }))],
  };
}

export function readingSnapshot(state, { frame = "frame:default", lens = "lens:neutral", source_id } = {}) {
  const bundle = project(state, { frame, lens });
  const snapshot = {
    schema_version: "ReadingSnapshot@1",
    reading_id: id("reading", { head: state.semanticHead, frame, lens, prior: state.priorSnapshot.prior_id }),
    engine_version: state.engineVersion,
    operator_epoch: state.operatorEpoch,
    prior_id: state.priorSnapshot.prior_id,
    frame_id: frame,
    lens_id: lens,
    source_id,
    semantic_head: state.semanticHead,
    provenance_layer: provenanceLayer(state),
    units: bundle.spans.map((span) => {
      const operator_events = state.events
        .filter((event) => (event.payload?.envelope?.source_id ?? event.payload?.source_id) === span.source_id || (event.payload?.envelope?.fields ?? event.payload?.fields)?.some?.((field) => field.field_id === span.field_id) || event.inputs?.some((input) => state.events.some((candidate) => candidate.event_id === input && candidate.payload?.source_id === span.source_id)))
        .map((event) => event.event_id);
      return { unit_id: span.span_id, operator_events, provenance: { source_id: span.source_id, field_id: span.field_id }, held: state.hypotheses.held.length > 0, alternatives: state.hypotheses.competing };
    }),
  };
  return validateReadingSnapshot(snapshot);
}

function provenanceLayer(state) {
  return [...(state.individuationResults ?? [])]
    .map((entry) => entry?.result ?? entry)
    .filter((result) => result?.individuation_type === "apparatus")
    .map((result) => ({ referent_id: result.referent_id, reason: result.gate_result.reason }));
}
