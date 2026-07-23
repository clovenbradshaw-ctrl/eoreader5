import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { semanticEventId, validateCommand, validatePriorSnapshot, validateSemanticEvent, validateSemanticEventId } from "@eoreader/spec";
import { isCurrentOperator } from "@eoreader/spec/operators";
import { projectReferents } from "../referents/index.js";
import { coherence } from "../ledger/cube.js";
import { spectrumOf } from "../resolution/resolution-spectrum.js";

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

export function createState({ engineVersion, operatorEpoch, priorSnapshot }) {
  validatePriorSnapshot(priorSnapshot);
  if (operatorEpoch !== priorSnapshot.operator_epoch) throw new TypeError(`engine operator epoch ${operatorEpoch} does not match prior epoch ${priorSnapshot.operator_epoch}`);
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
    effectResults: [],
    projectedState: { observations: [], referents: [], hypotheses: [], frames: [], resolution: null, effects: [] },
  };
}

export function appendEvents(state, events) {
  const seen = new Set(state.events.map((event) => event.event_id));
  const known = new Set(seen);
  for (const event of events) {
    validateSemanticEvent(event);
    validateSemanticEventId(event);
    if (event.operator_epoch !== state.operatorEpoch) throw new TypeError(`semantic ledger event epoch ${event.operator_epoch} does not match engine epoch ${state.operatorEpoch}`);
    if (event.operator_epoch !== state.priorSnapshot.operator_epoch) throw new TypeError(`semantic ledger event epoch ${event.operator_epoch} does not match prior epoch ${state.priorSnapshot.operator_epoch}`);
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
  if (command.type === "hypothesis.accept") return appendEvents(state, [baseEvent(state, "kind.accepted", "DEF", { ...command.payload, status: "accepted" }, inputs)]);
  if (command.type === "hypothesis.compete") return appendEvents(state, [baseEvent(state, "hypothesis.competing", "EVA", { ...command.payload, status: "candidate" }, inputs)]);
  if (command.type === "hypothesis.supersede") return appendEvents(state, [baseEvent(state, "hypothesis.superseded", "REC", { ...command.payload, status: "superseded" }, inputs)]);
  if (command.type === "hypothesis.retract") return appendEvents(state, [baseEvent(state, "hypothesis.superseded", "REC", { ...command.payload, status: "retracted" }, inputs)]);
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
  return { ...body, event_id: semanticEventId(body) };
}

function reduceEvents(state) {
  const observations = [];
  const held = [], accepted = [], competing = [], abstentions = [], effectResults = [];
  const superseded = new Set(), retracted = new Set();
  const referentEvents = [];
  const frames = new Map(state.frames);
  let resolution = { verdict: "unresolved", evidence_event_ids: [] };
  for (const event of state.events) {
    const cube = coherence({ op: event.op, grain: event.payload?.grain, stance: event.payload?.stance, terrain: event.payload?.terrain ?? event.payload?.site });
    if (event.event_type === "observation.admitted") {
      observations.push({ ...event.payload, event_id: event.event_id });
      for (const surface of event.payload?.anchors?.surfaces ?? []) referentEvents.push({ type: "admit", referent_id: surface.referent_id, surface: surface.text, provenance: { event_id: event.event_id } });
    }
    if (event.event_type === "effect.result.admitted") effectResults.push({ ...event.payload, event_id: event.event_id });
    if (event.payload?.referent_event) referentEvents.push({ ...event.payload.referent_event, provenance: { event_id: event.event_id } });
    if (event.event_type === "hypothesis.held") held.push({ ...event.payload, event_id: event.event_id, cube });
    if (event.event_type === "hypothesis.competing") competing.push({ ...event.payload, event_id: event.event_id, cube });
    if (event.event_type === "kind.accepted" || event.event_type === "parameter.accepted") accepted.push({ ...event.payload, event_id: event.event_id, cube });
    if (event.event_type === "hypothesis.superseded") {
      for (const target of event.payload?.supersedes ?? event.inputs) superseded.add(target);
      if (event.payload?.status === "retracted") for (const target of event.payload?.retracts ?? event.inputs) retracted.add(target);
    }
    if (event.event_type === "discovery.abstained") abstentions.push({ ...event.payload, event_id: event.event_id });
    if (event.payload?.frame) frames.set(event.payload.frame.frame_id, { ...event.payload.frame, authority: event.authority, provenance: event.provenance });
    if (event.payload?.authority) frames.set(`authority:${event.authority.actor_id}`, { authority: event.authority, payload: event.payload.authority });
    if (event.payload?.resolution) {
      const spectrum = spectrumOf(event.payload.resolution.type);
      resolution = { ...event.payload.resolution, spectrum, evidence_event_ids: event.inputs, authority: event.authority };
    }
  }
  const semanticHead = state.events.length ? stableId("head", state.events.map((event) => event.event_id)) : "head:empty";
  const referents = projectReferents(referentEvents);
  const live = (items) => items.filter((item) => !superseded.has(item.event_id) && !retracted.has(item.event_id) && !superseded.has(item.hypothesis_id) && !retracted.has(item.hypothesis_id));
  const hypotheses = { accepted: live(accepted), competing: live(competing), held: live(held), abstentions };
  return { ...state, semanticHead, observations, referents, hypotheses, frames, resolution, effectResults, projectedState: { observations, referents: [...referents.values()], hypotheses: [...hypotheses.accepted, ...hypotheses.competing, ...hypotheses.held], frames: [...frames.values()], resolution, effects: effectResults } };
}

export function replay(events, options) { return appendEvents(createState({ engineVersion: options.engineVersion ?? "unknown", operatorEpoch: options.operatorEpoch ?? "unknown", priorSnapshot: options.priorSnapshot }), events); }

export function read(state) { return { schema: "HypothesisSet@1", hypothesis_set_id: stableId("hypotheses", state.events.map((e) => e.event_id)), semantic_head: state.semanticHead, context: { engine_version: state.engineVersion, operator_epoch: state.operatorEpoch }, ...state.hypotheses }; }
