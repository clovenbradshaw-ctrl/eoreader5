import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

function normalizeQuery(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(value) {
  return normalizeQuery(value).split(" ").filter(Boolean);
}

function collectUnitText(unit) {
  return [unit.source_id, unit.field_id, unit.block_id, ...(unit.axes ?? []), ...(unit.surfaces ?? []), ...(unit.values ?? [])].filter(Boolean).join(" ");
}

function blockStoreValues(state, blockId) { return (state.blockStore?.get(blockId)?.values ?? []).filter((value) => typeof value === "string"); }
function blockStoreSelectors(state, blockId) { return state.blockStore?.get(blockId)?.selectors ?? []; }

function buildUnits(state) {
  const surfaceBySource = new Map();
  for (const observation of state.observations ?? []) {
    for (const surface of observation.anchors?.surfaces ?? []) {
      const bucket = surfaceBySource.get(observation.source_id) ?? [];
      if (surface.text) bucket.push(surface.text);
      surfaceBySource.set(observation.source_id, bucket);
    }
  }

  return (state.observations ?? []).flatMap((observation) => (observation.fields ?? []).map((field) => ({
    unit_id: id("query-unit", { head: state.semanticHead, source: observation.source_id, field: field.field_id }),
    source_id: observation.source_id,
    field_id: field.field_id,
    block_id: field.block_id,
    axes: field.axes ?? [],
    surfaces: surfaceBySource.get(observation.source_id) ?? [],
      values: blockStoreValues(state, field.block_id),
    selectors: blockStoreSelectors(state, field.block_id),
      evidence_event_ids: (state.events ?? [])
      .filter((event) => (event.payload?.envelope?.source_id ?? event.payload?.source_id) === observation.source_id || (event.payload?.envelope?.fields ?? event.payload?.fields)?.some?.((candidate) => candidate.field_id === field.field_id))
      .map((event) => event.event_id),
  })));
}

function scoreUnit(unit, terms) {
  const text = normalizeQuery(collectUnitText(unit));
  if (terms.length === 0) return 1;
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

export function search(state, request = {}) {
  const query = String(request.query ?? "");
  const terms = tokenize(query);
  const limit = Math.max(1, Math.min(100, Number(request.limit ?? 10)));
  const frame = request.frame ?? "frame:default";
  const lens = request.lens ?? "lens:neutral";
  const units = buildUnits(state);
  const matches = units
    .map((unit) => ({ unit, score: scoreUnit(unit, terms) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.unit_id.localeCompare(b.unit.unit_id))
    .slice(0, limit)
    .map(({ unit, score }) => ({
      passage_id: id("passage", { head: state.semanticHead, query: normalizeQuery(query), unit: unit.unit_id }),
      unit_id: unit.unit_id,
      source_id: unit.source_id,
      field_id: unit.field_id,
      block_id: unit.block_id,
      score,
      anchors: {
        exact_text: unit.values.length ? unit.values : unit.surfaces,
        selectors: unit.selectors,
        axes: unit.axes,
      },
      evidence_event_ids: unit.evidence_event_ids,
    }));

  return {
    schema_version: "QueryReading@1",
    query_reading_id: id("query-reading", { head: state.semanticHead, query: normalizeQuery(query), frame, lens, limit }),
    semantic_head: state.semanticHead,
    engine_version: state.engineVersion,
    operator_epoch: state.operatorEpoch,
    prior_id: state.priorSnapshot.prior_id,
    request: { query, frame, lens, limit },
    passages: matches,
    contrasts: state.hypotheses?.competing ?? [],
    gaps: matches.length === 0 ? [{ reason: terms.length === 0 ? "empty_query" : "no_evidence_matched", query }] : [],
  };
}
