import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { validateCommand, validatePriorSnapshot, validateSemanticEvent } from "@eoreader/spec";
import { isCurrentOperator } from "@eoreader/spec/operators";
import { projectReferents } from "../referents/index.js";
import { materializeObservationIndex, verifyObservationBundle } from "../observation-index.js";
import { discoverCandidates } from "../emergence/search/index.js";
import { evaluate } from "../emergence/evaluate/index.js";

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

export function createState({ engineVersion, operatorEpoch, priorSnapshot }) {
  validatePriorSnapshot(priorSnapshot);
  if (operatorEpoch !== priorSnapshot.operator_epoch) throw new TypeError("engine operator epoch must match prior snapshot epoch");
  return {
    engineVersion,
    operatorEpoch,
    priorSnapshot,
    events: [],
    semanticHead: "head:empty",
    observations: [],
    blockStore: new Map(),
    observationIndex: { fields: new Map(), axes: new Map(), values: [] },
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
    if (event.operator_epoch !== state.operatorEpoch) throw new TypeError(`semantic ledger epoch mismatch for ${event.event_id}`);
    if (event.authority?.grant?.prior_id && event.authority.grant.prior_id !== state.priorSnapshot.prior_id) throw new TypeError(`semantic ledger prior mismatch for ${event.event_id}`);
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
  if (command.type === "observation.admit") {
    const payload = command.payload?.envelope ? command.payload : { envelope: command.payload, blocks: command.blocks ?? [] };
    verifyObservationBundle(payload.envelope, payload.blocks ?? []);
    return appendEvents(state, [baseEvent(state, "observation.admitted", "NUL", payload, inputs)]);
  }
  if (command.type === "effect.result.admit") return appendEvents(state, [baseEvent(state, "effect.result.admitted", "INS", command.payload, inputs)]);
  if (command.type === "hypothesis.accept") return appendEvents(state, [baseEvent(state, "hypothesis.accepted", "EVA", { ...command.payload, status: "accepted" }, inputs)]);
  if (command.type === "hypothesis.compete") return appendEvents(state, [baseEvent(state, "hypothesis.competing", "EVA", { ...command.payload, status: "competing" }, inputs)]);
  if (command.type === "hypothesis.hold") return appendEvents(state, [baseEvent(state, "hypothesis.held", "EVA", { ...command.payload, status: "held" }, inputs)]);
  if (command.type === "hypothesis.supersede") return appendEvents(state, [baseEvent(state, "hypothesis.superseded", "REC", { ...command.payload, status: "superseded" }, inputs)]);
  if (command.type === "referent.merge") return appendEvents(state, [baseEvent(state, "referent.merged", "REC", command.payload, inputs)]);
  if (command.type === "referent.split") return appendEvents(state, [baseEvent(state, "referent.split", "REC", command.payload, inputs)]);
  if (command.type === "referent.same_as") return appendEvents(state, [baseEvent(state, "referent.same_as", "REC", command.payload, inputs)]);
  if (command.type === "discovery.advance" || command.type === "discovery.resume") {
    const budget = command.budget ?? {};
    const candidates = discoverCandidates(state, { maxCandidates: budget.max_candidates ?? 100 });
    const maxEvents = Math.max(1, budget.max_events ?? candidates.length * 2 + 1);
    const events = [];
    let knownInputs = inputs;
    for (const candidate of candidates) {
      if (events.length + 2 > maxEvents) break;
      const proposed = baseEvent(state, "observable.proposed", "SIG", { candidate, status: "candidate" }, knownInputs);
      const decision = evaluate(state, candidate);
      const evaluated = baseEvent(state, decision.status === "accepted" ? "kind.accepted" : "hypothesis.held", decision.status === "accepted" ? "DEF" : "EVA", { ...candidate, ...decision }, [proposed.event_id]);
      events.push(proposed, evaluated);
      knownInputs = [evaluated.event_id];
    }
    if (events.length === 0) events.push(baseEvent(state, "discovery.abstained", "EVA", { reason: (budget.max_events ?? 0) <= 1 ? "held:budget_exhausted" : "no_observation_values" }, inputs));
    const next = appendEvents(state, events);
    return { ...next, continuation: stableId("continuation", { head: next.semanticHead, emitted: events.length, remaining_candidates: Math.max(0, candidates.length - Math.floor(events.length / 2)) }) };
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
  const blockStore = new Map();
  const byId = new Map();
  const abstentions = [];
  const referentEvents = [];
  const frames = new Map(state.frames);
  let resolution = { verdict: "unresolved", evidence_event_ids: [] };
  for (const event of state.events) {
    if (event.event_type === "observation.admitted") {
      const envelope = event.payload.envelope ?? event.payload;
      observations.push(envelope);
      for (const block of event.payload.blocks ?? []) blockStore.set(block.block_id, block);
      for (const surface of envelope?.anchors?.surfaces ?? []) referentEvents.push({ type: "admit", referent_id: surface.referent_id, surface: surface.text, provenance: { event_id: event.event_id } });
    }
    if (event.event_type === "referent.merged") referentEvents.push({ type: "merge", ...event.payload, provenance: { event_id: event.event_id, ...(event.payload?.provenance ?? {}) } });
    if (event.event_type === "referent.split") referentEvents.push({ type: "split", ...event.payload, provenance: { event_id: event.event_id, ...(event.payload?.provenance ?? {}) } });
    if (event.event_type === "referent.same_as") referentEvents.push({ type: "same_as", ...event.payload, provenance: { event_id: event.event_id, ...(event.payload?.provenance ?? {}) } });
    if (["hypothesis.accepted", "hypothesis.competing", "hypothesis.held"].includes(event.event_type)) byId.set(event.payload.hypothesis_id ?? event.event_id, { ...event.payload, event_id: event.event_id });
    if (event.event_type === "hypothesis.superseded") {
      const ids = [event.payload.hypothesis_id, event.payload.supersedes, ...(event.payload.superseded_ids ?? [])].filter(Boolean);
      for (const id of ids) byId.delete(id);
      byId.set(event.payload.replacement_id ?? event.event_id, { ...event.payload, event_id: event.event_id, status: "superseded" });
    }
    if (event.event_type === "discovery.abstained") abstentions.push({ ...event.payload, event_id: event.event_id });
    if (event.payload?.frame) frames.set(event.payload.frame.frame_id, event.payload.frame);
    if (event.payload?.resolution) resolution = { ...event.payload.resolution, evidence_event_ids: event.inputs };
  }
  const accepted = [], competing = [], held = [];
  for (const hypothesis of byId.values()) {
    if (hypothesis.status === "accepted") accepted.push(hypothesis);
    else if (hypothesis.status === "competing") competing.push(hypothesis);
    else held.push(hypothesis);
  }
  const semanticHead = state.events.length ? stableId("head", state.events.map((event) => event.event_id)) : "head:empty";
  const referents = projectReferents(referentEvents);
  const observationIndex = materializeObservationIndex(observations, blockStore);
  return { ...state, semanticHead, observations, blockStore, observationIndex, referents, hypotheses: { accepted, competing, held, abstentions }, frames, resolution, projectedState: { observations, referents: [...referents.values()], hypotheses: [...accepted, ...competing, ...held], frames: [...frames.values()], resolution } };
}

export function replay(events, options) { return appendEvents(createState({ engineVersion: options.engineVersion ?? "unknown", operatorEpoch: options.operatorEpoch ?? "unknown", priorSnapshot: options.priorSnapshot }), events); }

export function read(state) { return { schema: "HypothesisSet@1", hypothesis_set_id: stableId("hypotheses", state.events.map((e) => e.event_id)), semantic_head: state.semanticHead, context: { engine_version: state.engineVersion, operator_epoch: state.operatorEpoch }, ...state.hypotheses }; }
