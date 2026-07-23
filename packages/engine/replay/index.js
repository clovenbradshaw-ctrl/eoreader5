import { canonicalJsonStringify } from "@eoreader/spec/canonical-json";

function stableId(prefix, value) {
  let hash = 2166136261;
  const text = canonicalJsonStringify(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${prefix}:${hash.toString(16).padStart(8, "0")}`;
}

export function createState({ engineVersion, operatorEpoch, priorSnapshot }) {
  return {
    engineVersion,
    operatorEpoch,
    priorSnapshot,
    events: [],
    semanticHead: "head:empty",
    observations: [],
    hypotheses: { accepted: [], competing: [], held: [], abstentions: [] },
  };
}

export function appendEvents(state, events) {
  const nextEvents = [...state.events, ...events];
  return { ...state, events: nextEvents, semanticHead: stableId("head", nextEvents) };
}

export function applyCommand(state, command) {
  if (command.type === "observation.admit") {
    const event = baseEvent(state, "observation.admitted", "NUL", command.payload ?? {}, []);
    return appendEvents({ ...state, observations: [...state.observations, command.payload] }, [event]);
  }
  if (command.type === "effect.result.admit") {
    return appendEvents(state, [baseEvent(state, "effect.result.admitted", "INS", command.payload ?? {}, command.inputs ?? [])]);
  }
  if (command.type === "hypothesis.hold") {
    return appendEvents(state, [baseEvent(state, "hypothesis.held", "EVA", { ...command.payload, status: "held" }, command.inputs ?? [])]);
  }
  if (command.type === "hypothesis.supersede") {
    return appendEvents(state, [baseEvent(state, "hypothesis.superseded", "REC", { ...command.payload, status: "superseded" }, command.inputs ?? [])]);
  }
  if (command.type === "discovery.advance" || command.type === "discovery.resume") {
    const remaining = Math.max(0, (command.budget?.max_events ?? 1) - 1);
    const event = baseEvent(state, "discovery.abstained", "EVA", { reason: remaining === 0 ? "held:budget_exhausted" : "no_candidate_cleared_null" }, command.inputs ?? []);
    const next = appendEvents(state, [event]);
    return { ...next, continuation: stableId("continuation", { head: next.semanticHead, remaining }) };
  }
  throw new TypeError(`unknown command type: ${command.type}`);
}

function baseEvent(state, eventType, op, payload, inputs) {
  const body = {
    schema_version: "SemanticEvent@1",
    operator_epoch: state.operatorEpoch,
    event_type: eventType,
    op,
    inputs,
    provenance: { depends_on: inputs, transformations: [] },
    authority: { actor_id: "engine", grant: { engine_version: state.engineVersion } },
    context: { engine_version: state.engineVersion, prior_snapshot: state.priorSnapshot?.prior_id ?? state.priorSnapshot?.schema ?? "unknown" },
    payload,
  };
  return { ...body, event_id: stableId("event", body) };
}

export function replay(events, options) {
  return appendEvents(createState({ engineVersion: options.engineVersion ?? "unknown", operatorEpoch: options.operatorEpoch ?? "unknown", priorSnapshot: options.priorSnapshot }), events);
}

export function read(state) {
  return {
    schema: "HypothesisSet@1",
    hypothesis_set_id: stableId("hypotheses", state.events),
    semantic_head: state.semanticHead,
    context: { engine_version: state.engineVersion, operator_epoch: state.operatorEpoch },
    ...state.hypotheses,
  };
}
