import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { validateCommand, validatePriorSnapshot, validateSemanticEvent } from "@eoreader/spec";
import { isCurrentOperator } from "@eoreader/spec/operators";
import { projectReferents } from "../referents/index.js";

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

export function createState({ engineVersion, operatorEpoch, priorSnapshot }) {
  validatePriorSnapshot(priorSnapshot);
  return {
    engineVersion,
    operatorEpoch,
    priorSnapshot,
    events: [],
    semanticHead: "head:empty",
    observations: [],
    referents: new Map(),
    hypotheses: { accepted: [], competing: [], held: [], abstentions: [] },
    frames: new Map([["frame:default", { frame_id: "frame:default", label: "Default frame" }]]),
    resolution: { verdict: "unresolved", evidence_event_ids: [] },
    projectedState: { observations: [], referents: [], hypotheses: [], frames: [], resolution: null },
  };
}

export function appendEvents(state, events) {
  const seen = new Set(state.events.map((event) => event.event_id));
  const known = new Set(seen);
  for (const event of events) {
    validateSemanticEvent(event);
    if (seen.has(event.event_id)) throw new TypeError(`semantic ledger duplicate event: ${event.event_id}`);
    if (!isCurrentOperator(event.op)) throw new TypeError(`semantic ledger invalid operator: ${event.op}`);
    for (const input of event.inputs) {
      if (!known.has(input)) throw new TypeError(`semantic ledger unordered dependency ${input} for ${event.event_id}`);
    }
    for (const dep of event.provenance.depends_on) {
      if (!event.inputs.includes(dep) && !known.has(dep) && dep.startsWith("event:")) {
        throw new TypeError(`semantic ledger broken provenance ${dep} for ${event.event_id}`);
      }
    }
    seen.add(event.event_id); known.add(event.event_id);
  }
  return reduceEvents({ ...state, events: [...state.events, ...events] });
}

export function applyCommand(state, command) {
  validateCommand(command);
  const inputs = command.inputs ?? [];
  if (command.type === "observation.admit") return appendEvents(state, [baseEvent(state, "observation.admitted", "NUL", command.payload, inputs)]);
  if (command.type === "effect.result.admit") return appendEvents(state, [baseEvent(state, "effect.result.admitted", "INS", command.payload, inputs)]);
  if (command.type === "hypothesis.hold") return appendEvents(state, [baseEvent(state, "hypothesis.held", "EVA", { ...command.payload, status: "held" }, inputs)]);
  if (command.type === "hypothesis.supersede") return appendEvents(state, [baseEvent(state, "hypothesis.superseded", "REC", { ...command.payload, status: "superseded" }, inputs)]);
  if (command.type === "discovery.advance" || command.type === "discovery.resume") {
    const remaining = Math.max(0, (command.budget?.max_events ?? 1) - 1);
    const next = appendEvents(state, [baseEvent(state, "discovery.abstained", "EVA", { reason: remaining === 0 ? "held:budget_exhausted" : "no_candidate_cleared_null" }, inputs)]);
    return { ...next, continuation: stableId("continuation", { head: next.semanticHead, remaining }) };
  }
}

function baseEvent(state, eventType, op, payload, inputs) {
  const body = {
    schema_version: "SemanticEvent@1", operator_epoch: state.operatorEpoch, event_type: eventType, op, inputs,
    provenance: { depends_on: inputs, transformations: [{ id: eventType, engine_version: state.engineVersion }] },
    authority: { actor_id: "engine", grant: { engine_version: state.engineVersion, prior_id: state.priorSnapshot.prior_id } },
    context: { engine_version: state.engineVersion, prior_snapshot: state.priorSnapshot.prior_id }, payload,
  };
  return { ...body, event_id: stableId("event", body) };
}

function reduceEvents(state) {
  const observations = [];
  const held = [], accepted = [], competing = [], abstentions = [];
  const referentEvents = [];
  const frames = new Map(state.frames);
  let resolution = { verdict: "unresolved", evidence_event_ids: [] };
  for (const event of state.events) {
    if (event.event_type === "observation.admitted") {
      observations.push(event.payload);
      for (const surface of event.payload?.anchors?.surfaces ?? []) referentEvents.push({ type: "admit", referent_id: surface.referent_id, surface: surface.text, provenance: { event_id: event.event_id } });
    }
    if (event.event_type === "hypothesis.held") held.push({ ...event.payload, event_id: event.event_id });
    if (event.event_type === "hypothesis.superseded") held.push({ ...event.payload, event_id: event.event_id });
    if (event.event_type === "discovery.abstained") abstentions.push({ ...event.payload, event_id: event.event_id });
    if (event.payload?.frame) frames.set(event.payload.frame.frame_id, event.payload.frame);
    if (event.payload?.resolution) resolution = { ...event.payload.resolution, evidence_event_ids: event.inputs };
  }
  const semanticHead = state.events.length ? stableId("head", state.events.map((event) => event.event_id)) : "head:empty";
  const referents = projectReferents(referentEvents);
  return { ...state, semanticHead, observations, referents, hypotheses: { accepted, competing, held, abstentions }, frames, resolution, projectedState: { observations, referents: [...referents.values()], hypotheses: [...accepted, ...competing, ...held], frames: [...frames.values()], resolution } };
}

export function replay(events, options) { return appendEvents(createState({ engineVersion: options.engineVersion ?? "unknown", operatorEpoch: options.operatorEpoch ?? "unknown", priorSnapshot: options.priorSnapshot }), events); }

export function read(state) { return { schema: "HypothesisSet@1", hypothesis_set_id: stableId("hypotheses", state.events.map((e) => e.event_id)), semantic_head: state.semanticHead, context: { engine_version: state.engineVersion, operator_epoch: state.operatorEpoch }, ...state.hypotheses }; }
