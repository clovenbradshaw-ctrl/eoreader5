// Confirms the audit trail (spec 7.11, "recursive audit") actually
// reconstructs a real causal chain out of the replay reducer's state, that
// its output validates as AuditTrail@1, and that "what priors were
// activated" resolves to the one pinned PriorSnapshot every event in the
// chain actually carries (docs/priors-boundary.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { validateAuditTrail } from "@eoreader/spec";
import { applyCommand, createState } from "../replay/index.js";
import { readingSnapshot } from "../projection/index.js";
import { blockContentHash } from "../observation-index.js";
import { auditTrail, auditTrailForUnit, auditTrailForReferent, auditTrailForHypothesis } from "./index.js";

const priorSnapshot = {
  schema_version: "PriorSnapshot@1",
  prior_id: "prior:sha256:" + "0".repeat(64),
  operator_epoch: CURRENT_OPERATOR_EPOCH,
  ledger_head: "head:empty",
  basis_id: "basis:test",
  convention_set_id: "convention:test",
  policy_ids: ["policy:baseline"],
  algorithm_versions: { discovery: "1.0.0" },
  content_hash: "sha256:" + "1".repeat(64),
};

function freshState() {
  return createState({ engineVersion: "0.1.0", operatorEpoch: CURRENT_OPERATOR_EPOCH, priorSnapshot });
}

function textObservation(sourceId, referentId, surfaceText, values) {
  const block = {
    schema: "ObservationBlock@1",
    block_id: `block:${canonicalHashSync({ source: sourceId, values })}`,
    value_type: "string",
    shape: [values.length],
    axis_order: ["line"],
    values,
    loss: [{ kind: "none" }],
  };
  block.content_hash = blockContentHash(block);
  const blocks_hash = canonicalHashSync([{ block_id: block.block_id, content_hash: block.content_hash }]);
  const envelope = {
    schema: "ObservationEnvelope@1",
    source_id: sourceId,
    source_media_type: "text/plain",
    decoder: { id: "plain-text", version: "1" },
    axes: [{ axis_id: "line", topology: "ordered" }],
    fields: [{ field_id: "f1", value_type: "string", block_id: block.block_id, axes: ["line"] }],
    anchors: { scheme: "test", surfaces: [{ referent_id: referentId, text: surfaceText }] },
    source_content_hash: canonicalHashSync({ source: sourceId, values }),
    blocks_hash,
  };
  return { envelope, blocks: [block] };
}

function admit(state, ...args) {
  return applyCommand(state, { type: "observation.admit", payload: textObservation(...args) });
}

test("auditTrail reconstructs the causal closure behind a discovery decision and validates as AuditTrail@1", () => {
  let state = freshState();
  state = admit(state, "doc:kurtz", "ref:kurtz", "Kurtz", [
    "The steamer drifted past Kurtz slowly, and every account of Kurtz felt more like rumor than record.",
  ]);
  state = applyCommand(state, { type: "discovery.advance", budget: {} });

  const acceptedEvent = state.events.find((event) => event.event_type === "kind.accepted" && event.payload?.surface === "Kurtz");
  assert.ok(acceptedEvent, "discovery must accept the twice-recurring surface");

  const trail = auditTrail(state, { event_id: acceptedEvent.event_id });
  assert.deepEqual(validateAuditTrail(trail), trail);

  assert.equal(trail.target.type, "event");
  assert.equal(trail.target.id, acceptedEvent.event_id);
  assert.ok(trail.events.some((event) => event.event_type === "observation.admitted"), "the observation root must be in the closure");
  assert.ok(
    trail.decisions.some((decision) => decision.kind === "discovery.evaluate" && decision.status === "accepted"),
    "the acceptance decision must be normalized into decisions[]",
  );
  assert.equal(trail.observations.length, 1);
  assert.equal(trail.observations[0].source_id, "doc:kurtz");

  assert.equal(trail.prior.prior_id, priorSnapshot.prior_id);
  assert.equal(trail.prior.basis_id, priorSnapshot.basis_id);
  assert.deepEqual(trail.prior.policy_ids, priorSnapshot.policy_ids);
  assert.deepEqual(
    new Set(trail.prior.referenced_by_event_ids),
    new Set(trail.events.map((event) => event.event_id)),
    "every event in an engine-authored chain must carry the pinned prior binding",
  );

  // Pure function of state: identical input, identical (deterministic) output.
  assert.deepEqual(auditTrail(state, { event_id: acceptedEvent.event_id }), trail);
});

test("auditTrail throws on an unknown event_id rather than silently returning a partial trail", () => {
  const state = freshState();
  assert.throws(() => auditTrail(state, { event_id: "event:sha256:" + "9".repeat(64) }), /unknown event_id/);
});

test("auditTrailForUnit traces a reading unit back to its observation root", () => {
  let state = freshState();
  state = admit(state, "doc:unit", "ref:unit", "Marlow", ["A quiet sentence with nothing notable in it at all."]);
  const snapshot = readingSnapshot(state, { source_id: "doc:unit" });
  const unit = snapshot.units.find((candidate) => candidate.provenance.source_id === "doc:unit");
  assert.ok(unit, "the snapshot must carry a unit for the admitted source");

  const trail = auditTrailForUnit(state, snapshot, unit.unit_id);
  assert.deepEqual(validateAuditTrail(trail), trail);
  assert.deepEqual(trail.target, { type: "unit", id: unit.unit_id });
  assert.ok(trail.observations.some((observation) => observation.source_id === "doc:unit"));
});

test("auditTrailForHypothesis traces a held (single-occurrence) candidate, distinct from an accepted one", () => {
  let state = freshState();
  state = admit(state, "doc:kurtz", "ref:kurtz", "Kurtz", [
    "The steamer drifted past Kurtz slowly, and every account of Kurtz felt more like rumor than record.",
  ]);
  state = admit(state, "doc:ombala", "ref:ombala", "Ombala", [
    "The trading post near Ombala stood empty for another quiet season.",
  ]);
  state = applyCommand(state, { type: "discovery.advance", budget: {} });

  const held = state.hypotheses.held.find((hypothesis) => hypothesis.surface === "Ombala");
  assert.ok(held, "a single-occurrence surface must be held, not accepted");
  assert.equal(state.events.find((event) => event.event_type === "kind.accepted" && event.payload?.surface === "Ombala"), undefined);

  const trail = auditTrailForHypothesis(state, held.event_id);
  assert.deepEqual(validateAuditTrail(trail), trail);
  assert.equal(trail.target.type, "hypothesis");
  assert.ok(trail.decisions.some((decision) => decision.kind === "discovery.evaluate" && decision.status === "held"));
  assert.equal(trail.observations.length, 1, "the held trail must not pull in the unrelated Kurtz observation");
  assert.equal(trail.observations[0].source_id, "doc:ombala");
});

test("auditTrailForReferent absorbs the events of any referent merged into the target", () => {
  let state = freshState();
  state = admit(state, "doc:a", "ref:a", "Alpha", ["Alpha sits alone in the first paragraph."]);
  state = admit(state, "doc:b", "ref:b", "Beta", ["Beta sits nearby in the second paragraph."]);
  const admitA = state.events.find((event) => (event.payload.envelope ?? event.payload).source_id === "doc:a");
  const admitB = state.events.find((event) => (event.payload.envelope ?? event.payload).source_id === "doc:b");
  state = applyCommand(state, {
    type: "referent.merge",
    payload: { into_id: "ref:a", from_ids: ["ref:b"] },
    inputs: [admitA.event_id, admitB.event_id],
  });

  const trail = auditTrailForReferent(state, "ref:a");
  assert.deepEqual(validateAuditTrail(trail), trail);
  assert.deepEqual(trail.target, { type: "referent", id: "ref:a" });
  assert.ok(trail.observations.some((observation) => observation.source_id === "doc:a"));
  assert.ok(trail.observations.some((observation) => observation.source_id === "doc:b"), "the merged-away referent's own observation must still surface in the audit trail");
  assert.ok(trail.decisions.some((decision) => decision.kind === "referent-merged"));
});
