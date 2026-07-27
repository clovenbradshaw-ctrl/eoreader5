import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { applyCommand, createState, project, read, readTasks, replay, readingSnapshot } from "../index.js";
import { pencilTask, inkTask } from "../emergence/genesis/index.js";
import { deriveNull } from "../emergence/nulls/index.js";

const priorSnapshot = { schema_version: "PriorSnapshot@1", prior_id: "prior:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", operator_epoch: "eo-2026-07", ledger_head: "head:empty", basis_id: "basis:test", content_hash: "sha256:11111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const observation = { schema: "ObservationEnvelope@1", source_id: "source:1", source_media_type: "text/plain", decoder: { id: "test", version: "1" }, axes: [{ axis_id: "line", topology: "ordered" }], fields: [{ field_id: "f1", value_type: "text", block_id: "b1", axes: ["line"] }], anchors: { scheme: "test", surfaces: [{ referent_id: "ref:1", text: "alpha" }] }, source_content_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", blocks_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" };

function state() { return createState({ engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot }); }
function resign(event) { const { event_id, ...body } = event; return { ...body, event_id: `event:${canonicalHashSync(body)}` }; }

test("minimal observation ledger replays deterministically", () => {
  const once = applyCommand(state(), { type: "observation.admit", payload: observation });
  const twice = applyCommand(state(), { type: "observation.admit", payload: observation });
  assert.deepEqual(once.events, twice.events);
  assert.equal(once.semanticHead, twice.semanticHead);
  const replayed = replay(once.events, { engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot });
  assert.deepEqual(replayed.projectedState, once.projectedState);
  assert.equal(replayed.semanticHead, once.semanticHead);
});

test("ledger rejects duplicates, invalid operators, unordered dependencies, and broken provenance", () => {
  const once = applyCommand(state(), { type: "observation.admit", payload: observation });
  assert.throws(() => replay([once.events[0], once.events[0]], { engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot }), /duplicate/);
  assert.throws(() => replay([resign({ ...once.events[0], op: "BAD" })], { engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot }), /invalid operator/);
  assert.throws(() => replay([resign({ ...once.events[0], inputs: ["event:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"] })], { engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot }), /unordered dependency/);
  assert.throws(() => replay([resign({ ...once.events[0], provenance: { depends_on: ["event:sha256:3434343434343434343434343434343434343434343434343434343434343434"] } })], { engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot }), /broken provenance/);
  assert.throws(() => replay([{ ...once.events[0], payload: { ...once.events[0].payload, source_id: "tampered" } }], { engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot }), /event_id does not match/);
});

test("hypothesis commands reduce accepted, competing, held, and superseded states", () => {
  let next = applyCommand(state(), { type: "hypothesis.accept", payload: { hypothesis_id: "hyp:accepted", evidence: { event_ids: [] } } });
  next = applyCommand(next, { type: "hypothesis.compete", payload: { hypothesis_id: "hyp:competing", evidence: { event_ids: [] } } });
  next = applyCommand(next, { type: "hypothesis.hold", payload: { hypothesis_id: "hyp:held", evidence: { event_ids: [] } } });
  assert.equal(next.hypotheses.accepted[0].hypothesis_id, "hyp:accepted");
  assert.equal(next.hypotheses.competing[0].hypothesis_id, "hyp:competing");
  assert.equal(next.hypotheses.held[0].hypothesis_id, "hyp:held");
  next = applyCommand(next, { type: "hypothesis.supersede", payload: { superseded_ids: ["hyp:held"], replacement_id: "hyp:replacement" } });
  assert.equal(next.hypotheses.held.some((h) => h.hypothesis_id === "hyp:held"), false);
});

test("discovery budget exhaustion is held as an abstention with continuation", () => {
  const next = applyCommand(state(), { type: "discovery.advance", budget: { max_events: 1 } });
  assert.equal(next.events[0].event_type, "discovery.abstained");
  assert.equal(next.events[0].payload.reason, "held:budget_exhausted");
  assert.match(next.continuation, /^continuation:sha256:/);
});

test("read, project, and readingSnapshot return evidence-bearing public contracts", () => {
  const next = applyCommand(state(), { type: "observation.admit", payload: observation });
  assert.equal(read(next).schema, "HypothesisSet@1");
  const bundle = project(next, { frame: "frame:default", lens: "lens:neutral" });
  assert.equal(bundle.schema, "ProjectionBundle@1");
  assert.equal(bundle.spans.length, 1);
  assert.equal(bundle.relations.length, 1);
  assert.deepEqual(Object.keys(bundle).includes("markup"), false);
  const snapshot = readingSnapshot(next, { source_id: observation.source_id });
  assert.equal(snapshot.schema_version, "ReadingSnapshot@1");
  assert.equal(snapshot.units.length, 1);
  assert.equal(snapshot.units[0].operator_events.length, 1);
});

function passingValidation() {
  return deriveNull({
    nullSamples: [0.1, 0.2, 0.15, 0.12, 0.18],
    observedStatistic: 0.9,
    tailDirection: "greater",
    quantile: 0.9,
    protocol: { name: "test-validation" },
  });
}

test("task.pencil/task.ink commands record genesis's own EVA/REC operator, not a hardcoded one", () => {
  const pencil = pencilTask({ id: "task-add-search", score: 5, description: "add a search bar" }, { dependents: 0, baseQuantile: 0.9 });
  let next = applyCommand(state(), { type: "task.pencil", payload: pencil });
  assert.equal(next.events[0].event_type, "task.penciled");
  assert.equal(next.events[0].op, "EVA");
  assert.equal(next.tasks.pencil[0].candidate_id, "task-add-search");

  const inked = inkTask(pencil, passingValidation());
  assert.ok(inked.promoted);
  next = applyCommand(next, { type: "task.ink", payload: inked.task, inputs: [next.events[0].event_id] });
  assert.equal(next.events[1].event_type, "task.inked");
  assert.equal(next.events[1].op, "EVA", "a first commit with no prior ink behind it is EVA, matching hypothesis.accept");
  assert.equal(next.tasks.ink[0].candidate_id, "task-add-search");
  assert.equal(next.tasks.pencil.length, 0, "the candidate's CURRENT status is ink, not pencil");
});

test("a revision ink is recorded with REC, and the prior ink is preserved in history, not deleted", () => {
  const pencil = pencilTask({ id: "task-x", score: 5 }, { dependents: 0, baseQuantile: 0.9 });
  let next = applyCommand(state(), { type: "task.pencil", payload: pencil });
  const firstInk = inkTask(pencil, passingValidation());
  next = applyCommand(next, { type: "task.ink", payload: firstInk.task, inputs: [next.events[0].event_id] });

  const revisionPencil = pencilTask({ id: "task-x", score: 6 }, { dependents: 0, baseQuantile: 0.9, supersedes: firstInk.task.id });
  next = applyCommand(next, { type: "task.pencil", payload: revisionPencil, inputs: [next.events[1].event_id] });
  const secondInk = inkTask(revisionPencil, passingValidation());
  assert.equal(secondInk.task.emergence.op, "REC");
  next = applyCommand(next, { type: "task.ink", payload: secondInk.task, inputs: [next.events[2].event_id] });

  assert.equal(next.events[3].op, "REC", "the ledger reads the revision's operator from genesis, not a hardcoded EVA");
  assert.equal(next.tasks.ink.length, 1, "one CURRENT ink per candidate_id");
  assert.equal(next.tasks.ink[0].event_id, next.events[3].event_id, "the current view is the latest ink");

  const tasks = readTasks(next);
  assert.equal(tasks.schema, "TaskSet@1");
  const fullHistory = tasks.history["task-x"];
  assert.equal(fullHistory.length, 4, "pencil, ink, revision-pencil, revision-ink — every attempt preserved");
  assert.deepEqual(fullHistory.map((e) => e.event_type), ["task.penciled", "task.inked", "task.penciled", "task.inked"]);
});

test("a held task (failed validation) is visible in the ledger, not just returned to the caller", () => {
  const pencil = pencilTask({ id: "task-risky", score: 5 }, { dependents: 0, baseQuantile: 0.9 });
  let next = applyCommand(state(), { type: "task.pencil", payload: pencil });
  next = applyCommand(next, {
    type: "task.hold",
    payload: { ...pencil, reason: "validation-failed" },
    inputs: [next.events[0].event_id],
  });
  assert.equal(next.tasks.held[0].candidate_id, "task-risky");
  assert.equal(next.tasks.pencil.length, 0, "held supersedes pencil as the candidate's current status");
  const tasks = readTasks(next);
  assert.equal(tasks.history["task-risky"].length, 2);
});

test("priors cited on a task survive replay verbatim — provenance is not summarized away", () => {
  const priors = [{ prior_id: "coding-prior:react-forms", content_hash: "hash1", weight: 0.7 }];
  const pencil = pencilTask({ id: "task-y", score: 5 }, { dependents: 0, priorsCited: priors });
  const next = applyCommand(state(), { type: "task.pencil", payload: pencil });
  assert.deepEqual(next.tasks.pencil[0].priors_cited, priors);
  const replayed = replay(next.events, { engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot });
  assert.deepEqual(replayed.tasks.pencil[0].priors_cited, priors);
});

test("task command types are accepted by validateCommand alongside the existing vocabulary", () => {
  // Regression guard for packages/spec/validation/index.js's allowed set —
  // this would throw "unknown command type" if the addition were reverted.
  const pencil = pencilTask({ id: "task-z", score: 1 });
  assert.doesNotThrow(() => applyCommand(state(), { type: "task.pencil", payload: pencil }));
});

test("referent merge events are replayed explicitly", () => {
  let next = applyCommand(state(), { type: "observation.admit", payload: { ...observation, anchors: { ...observation.anchors, surfaces: [{ referent_id: "ref:1", text: "alpha" }, { referent_id: "ref:2", text: "alpha" }] } } });
  next = applyCommand(next, { type: "referent.merge", payload: { into_id: "ref:1", from_ids: ["ref:2"] }, inputs: [next.events[0].event_id] });
  assert.equal(next.projectedState.referents.length, 1);
});
