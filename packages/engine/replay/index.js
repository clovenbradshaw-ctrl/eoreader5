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
    // Task genesis (emergence/genesis): pencil = provisional, ink = settled,
    // held = validation failed on this attempt. Every event stays in the
    // ledger forever regardless of status — this bucket only tracks each
    // candidate_id's CURRENT status; taskHistory (below) keeps every
    // attempt, so nothing pencilled or held is ever actually lost, only
    // superseded by a later event under the same candidate_id.
    tasks: { pencil: [], ink: [], held: [] },
    taskHistory: new Map(),
    frames: new Map([["frame:default", { frame_id: "frame:default", label: "Default frame" }]]),
    resolution: { verdict: "unresolved", evidence_event_ids: [] },
    projectedState: { observations: [], referents: [], hypotheses: [], tasks: [], frames: [], resolution: null },
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
  // Corpus-role firewall (docs/corpus-role.md): a command may mark itself
  // role:'corpus' -- the chokepoint, mirroring eoreader4.2's
  // createLog({role:'corpus'})/per-event role -- and every event it
  // produces is sealed with that mark, never trusted from anywhere else.
  const role = command.role === "corpus" ? "corpus" : undefined;
  if (command.type === "observation.admit") {
    const payload = command.payload?.envelope ? command.payload : { envelope: command.payload, blocks: command.blocks ?? [] };
    verifyObservationBundle(payload.envelope, payload.blocks ?? []);
    return appendEvents(state, [baseEvent(state, "observation.admitted", "NUL", payload, inputs, role)]);
  }
  if (command.type === "effect.result.admit") return appendEvents(state, [baseEvent(state, "effect.result.admitted", "INS", command.payload, inputs, role)]);
  if (command.type === "hypothesis.accept") return appendEvents(state, [baseEvent(state, "hypothesis.accepted", "EVA", { ...command.payload, status: "accepted" }, inputs, role)]);
  if (command.type === "hypothesis.compete") return appendEvents(state, [baseEvent(state, "hypothesis.competing", "EVA", { ...command.payload, status: "competing" }, inputs, role)]);
  if (command.type === "hypothesis.hold") return appendEvents(state, [baseEvent(state, "hypothesis.held", "EVA", { ...command.payload, status: "held" }, inputs, role)]);
  if (command.type === "hypothesis.supersede") return appendEvents(state, [baseEvent(state, "hypothesis.superseded", "REC", { ...command.payload, status: "superseded" }, inputs, role)]);
  if (command.type === "referent.merge") return appendEvents(state, [baseEvent(state, "referent.merged", "REC", command.payload, inputs, role)]);
  if (command.type === "referent.split") return appendEvents(state, [baseEvent(state, "referent.split", "REC", command.payload, inputs, role)]);
  if (command.type === "referent.same_as") return appendEvents(state, [baseEvent(state, "referent.same_as", "REC", command.payload, inputs, role)]);
  // Task genesis: payload is a TaskCandidate@1 object from
  // emergence/genesis (pencilTask/inkTask's .task). The ledger does not
  // re-derive genesis's decisions — same discipline as hypothesis.accept
  // not re-deriving whether a hypothesis should be accepted — it only
  // records what genesis already decided, permanently. task.ink's operator
  // is read from the candidate's own emergence.op (EVA for a first commit,
  // REC for a revision that supersedes a prior ink) rather than hardcoded,
  // so the ledger reflects the same EVA/REC distinction genesis computed.
  if (command.type === "task.pencil") return appendEvents(state, [baseEvent(state, "task.penciled", "EVA", command.payload, inputs, role)]);
  if (command.type === "task.ink") return appendEvents(state, [baseEvent(state, "task.inked", command.payload?.emergence?.op === "REC" ? "REC" : "EVA", command.payload, inputs, role)]);
  if (command.type === "task.hold") return appendEvents(state, [baseEvent(state, "task.held", "EVA", command.payload, inputs, role)]);
  if (command.type === "discovery.advance" || command.type === "discovery.resume") {
    const budget = command.budget ?? {};
    const nObs = state.observations.length;
    const candidates = discoverCandidates(state, { maxCandidates: budget.max_candidates ?? Math.max(10, Math.round(nObs * 2)) });
    const maxEvents = Math.max(1, budget.max_events ?? candidates.length * 2 + 1);
    const events = [];
    let knownInputs = inputs;
    for (const candidate of candidates) {
      if (events.length + 2 > maxEvents) break;
      const proposed = baseEvent(state, "observable.proposed", "SIG", { candidate, status: "candidate" }, knownInputs, role);
      const decision = evaluate(state, candidate);
      const evaluated = baseEvent(state, decision.status === "accepted" ? "kind.accepted" : "hypothesis.held", decision.status === "accepted" ? "DEF" : "EVA", { ...candidate, ...decision }, [proposed.event_id], role);
      events.push(proposed, evaluated);
      knownInputs = [evaluated.event_id];
    }
    if (events.length === 0) events.push(baseEvent(state, "discovery.abstained", "EVA", { reason: (budget.max_events ?? 0) <= 1 ? "held:budget_exhausted" : "no_observation_values" }, inputs, role));
    const next = appendEvents(state, events);
    return { ...next, continuation: stableId("continuation", { head: next.semanticHead, emitted: events.length, remaining_candidates: Math.max(0, candidates.length - Math.floor(events.length / 2)) }) };
  }
}

function baseEvent(state, eventType, op, payload, inputs, role) {
  const body = {
    schema_version: "SemanticEvent@1", operator_epoch: state.operatorEpoch, event_type: eventType, op, inputs,
    provenance: { depends_on: inputs, transformations: [{ id: eventType, engine_version: state.engineVersion }] },
    authority: { actor_id: "engine", grant: { engine_version: state.engineVersion, prior_id: state.priorSnapshot.prior_id } },
    context: { engine_version: state.engineVersion, prior_snapshot: state.priorSnapshot.prior_id }, payload,
    ...(role ? { role } : {}),
  };
  return { ...body, event_id: stableId("event", body) };
}

function reduceEvents(state) {
  const observations = [];
  const blockStore = new Map();
  const byId = new Map();
  const abstentions = [];
  const referentEvents = [];
  const tasksById = new Map();
  const taskHistory = new Map();
  const frames = new Map(state.frames);
  let resolution = { verdict: "unresolved", evidence_event_ids: [] };
  for (const event of state.events) {
    // Corpus-role firewall (docs/corpus-role.md; ported from eoreader4.2
    // tests/corpus-role.test.js, src/core/project.js "THE FIREWALL (F4)").
    // A role:'corpus' event is reference-corpus content admitted for
    // prior/lens calibration, never a document being read. It stays in
    // state.events (the append-only ledger never refuses to store one,
    // matching 4.2's F6), so it still appears in project()'s evidence_links,
    // but it is skipped here unconditionally so it can never mint an
    // observation/referent/relation/merge/hypothesis/frame/resolution that
    // a citing surface (search, projection, query) can see.
    if (event.role === "corpus") continue;
    if (event.event_type === "observation.admitted") {
      const envelope = event.payload.envelope ?? event.payload;
      observations.push(envelope);
      for (const block of event.payload.blocks ?? []) blockStore.set(block.block_id, block);
      for (const surface of envelope?.anchors?.surfaces ?? []) referentEvents.push({ type: "DEF.admit", referent_id: surface.referent_id, surface: surface.text, provenance: { event_id: event.event_id } });
    }
    if (event.event_type === "referent.merged") referentEvents.push({ type: "SYN.merge", ...event.payload, provenance: { event_id: event.event_id, ...(event.payload?.provenance ?? {}) } });
    if (event.event_type === "referent.split") referentEvents.push({ type: "SEG.split", ...event.payload, provenance: { event_id: event.event_id, ...(event.payload?.provenance ?? {}) } });
    if (event.event_type === "referent.same_as") referentEvents.push({ type: "CON.identity", ...event.payload, provenance: { event_id: event.event_id, ...(event.payload?.provenance ?? {}) } });
    if (["hypothesis.accepted", "hypothesis.competing", "hypothesis.held"].includes(event.event_type)) byId.set(event.payload.hypothesis_id ?? event.event_id, { ...event.payload, event_id: event.event_id });
    if (event.event_type === "hypothesis.superseded") {
      const ids = [event.payload.hypothesis_id, event.payload.supersedes, ...(event.payload.superseded_ids ?? [])].filter(Boolean);
      for (const id of ids) byId.delete(id);
      byId.set(event.payload.replacement_id ?? event.event_id, { ...event.payload, event_id: event.event_id, status: "superseded" });
    }
    if (event.event_type === "discovery.abstained") abstentions.push({ ...event.payload, event_id: event.event_id });
    // Task genesis lifecycle. Grouped by candidate_id (the underlying
    // candidate's stable identity, stable across pencil -> ink -> a
    // revision's fresh pencil -> ink) so `tasksById` always reflects the
    // CURRENT status, while taskHistory keeps every event under that
    // candidate_id in order — nothing a pencil or a held attempt recorded
    // is ever dropped, only superseded by a later status for the same
    // candidate_id.
    if (["task.penciled", "task.inked", "task.held"].includes(event.event_type)) {
      const candidateId = event.payload?.candidate_id;
      if (candidateId) {
        const entry = { ...event.payload, event_id: event.event_id, event_type: event.event_type };
        tasksById.set(candidateId, entry);
        const history = taskHistory.get(candidateId) ?? [];
        taskHistory.set(candidateId, [...history, entry]);
      }
    }
    if (event.payload?.frame) frames.set(event.payload.frame.frame_id, event.payload.frame);
    if (event.payload?.resolution) resolution = { ...event.payload.resolution, evidence_event_ids: event.inputs };
  }
  const accepted = [], competing = [], held = [];
  for (const hypothesis of byId.values()) {
    if (hypothesis.status === "accepted") accepted.push(hypothesis);
    else if (hypothesis.status === "competing") competing.push(hypothesis);
    else held.push(hypothesis);
  }
  const taskPencil = [], taskInk = [], taskHeld = [];
  for (const task of tasksById.values()) {
    if (task.event_type === "task.inked") taskInk.push(task);
    else if (task.event_type === "task.held") taskHeld.push(task);
    else taskPencil.push(task);
  }
  const semanticHead = state.events.length ? stableId("head", state.events.map((event) => event.event_id)) : "head:empty";
  const referents = projectReferents(referentEvents);
  const observationIndex = materializeObservationIndex(observations, blockStore);
  return { ...state, semanticHead, observations, blockStore, observationIndex, referents, hypotheses: { accepted, competing, held, abstentions }, tasks: { pencil: taskPencil, ink: taskInk, held: taskHeld }, taskHistory, frames, resolution, projectedState: { observations, referents: [...referents.values()], hypotheses: [...accepted, ...competing, ...held], tasks: [...taskPencil, ...taskInk, ...taskHeld], frames: [...frames.values()], resolution } };
}

export function replay(events, options) { return appendEvents(createState({ engineVersion: options.engineVersion ?? "unknown", operatorEpoch: options.operatorEpoch ?? "unknown", priorSnapshot: options.priorSnapshot }), events); }

export function read(state) { return { schema: "HypothesisSet@1", hypothesis_set_id: stableId("hypotheses", state.events.map((e) => e.event_id)), semantic_head: state.semanticHead, context: { engine_version: state.engineVersion, operator_epoch: state.operatorEpoch }, ...state.hypotheses }; }

// TaskSet@1: the current status of every task ever proposed through
// task.pencil/task.ink/task.hold, grouped by candidate_id. `history`
// exposes EVERY event under each candidate_id in order, not just the
// current one — the ledger-level guarantee that pencils and held attempts
// are preserved, not merely "not literally deleted from an array
// somewhere". Same read-only, evidence-bearing contract as read().
export function readTasks(state) {
  return {
    schema: "TaskSet@1",
    task_set_id: stableId("tasks", state.events.map((e) => e.event_id)),
    semantic_head: state.semanticHead,
    context: { engine_version: state.engineVersion, operator_epoch: state.operatorEpoch },
    ...state.tasks,
    history: Object.fromEntries(state.taskHistory),
  };
}
