// The audit trail (spec section 7.11, "recursive audit"): given any surface
// the engine has produced -- a ReadingSnapshot unit, a referent, a
// hypothesis, or an arbitrary event set -- reconstruct exactly what the
// engine was doing to arrive at it: every SemanticEvent in its causal
// closure, the decisions those events recorded, the observation roots the
// chain bottoms out at, and the identity of the one pinned PriorSnapshot
// that was in effect throughout.
//
// This module is a pure query over already-computed state.events; it
// derives no new substrate and performs no I/O (docs/invariants.md, "Engine
// purity"). "Presenting prior provenance and audit trails to users" is
// app-owned (docs/priors-boundary.md); this is the engine-owned data that
// presentation is built from. See docs/audit-trail.md.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const stableId = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

/**
 * Reconstruct the causal derivation of a target.
 *
 * @param {object} state - engine state from createState/appendEvents.
 * @param {object} query
 * @param {string} [query.event_id] - a single seed event.
 * @param {string[]} [query.event_ids] - one or more seed events (their union
 *   closure is returned). Exactly one of event_id/event_ids is required.
 * @param {{type: string, id: string}} [query.target] - what this trail is
 *   *about*, for the AuditTrail@1 record. Convenience wrappers below supply
 *   this; callers of the raw seed form should too, or a generic
 *   "event"/"events" descriptor is derived from the seed ids.
 */
export function auditTrail(state, query = {}) {
  const seedIds = query.event_ids ?? (query.event_id ? [query.event_id] : null);
  if (!Array.isArray(seedIds) || seedIds.length === 0) {
    throw new TypeError("auditTrail: query must supply event_id or a non-empty event_ids array");
  }

  const byId = new Map(state.events.map((event) => [event.event_id, event]));
  for (const id of seedIds) {
    if (!byId.has(id)) throw new Error(`auditTrail: unknown event_id "${id}"`);
  }

  const closure = closureEventIds(byId, seedIds);
  const events = state.events.filter((event) => closure.has(event.event_id));

  const target = query.target ?? {
    type: seedIds.length === 1 ? "event" : "events",
    id: seedIds.length === 1 ? seedIds[0] : stableId("events", seedIds),
  };

  const body = {
    schema: "AuditTrail@1",
    target,
    engine_version: state.engineVersion,
    operator_epoch: state.operatorEpoch,
    semantic_head: state.semanticHead,
    prior: priorSummary(state, events),
    events,
    decisions: collectDecisions(events),
    observations: collectObservations(events),
  };
  const content_hash = canonicalHashSync(body);
  return { ...body, audit_id: `audit:${content_hash}`, content_hash };
}

/** Audit trail behind one ReadingSnapshot unit (packages/engine/projection). */
export function auditTrailForUnit(state, readingSnapshot, unitId) {
  const unit = readingSnapshot?.units?.find((candidate) => candidate.unit_id === unitId);
  if (!unit) throw new Error(`auditTrailForUnit: no unit "${unitId}" in the supplied ReadingSnapshot`);
  if (!unit.operator_events?.length) throw new Error(`auditTrailForUnit: unit "${unitId}" carries no operator_events to trace`);
  return auditTrail(state, { event_ids: unit.operator_events, target: { type: "unit", id: unitId } });
}

/**
 * Audit trail behind one referent, including any referents merged into it.
 * Merge absorption follows referent.merged edges only (spec 3.1: a merge
 * preserves all prior surfaces and observations of what it absorbs);
 * same_as proposals are candidate equivalences, not identity, so they
 * appear in the trail's events/decisions but do not by themselves widen
 * which admit events are pulled in.
 */
export function auditTrailForReferent(state, referentId) {
  const relevant = new Set([referentId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const event of state.events) {
      if (event.event_type !== "referent.merged") continue;
      const intoId = event.payload?.into_id;
      const fromIds = event.payload?.from_ids ?? [];
      if (!relevant.has(intoId)) continue;
      for (const id of fromIds) {
        if (!relevant.has(id)) {
          relevant.add(id);
          grew = true;
        }
      }
    }
  }

  const eventIds = state.events.filter((event) => referentTouchesEvent(event, relevant)).map((event) => event.event_id);
  if (eventIds.length === 0) throw new Error(`auditTrailForReferent: no events reference referent "${referentId}"`);
  return auditTrail(state, { event_ids: eventIds, target: { type: "referent", id: referentId } });
}

/** Audit trail behind one hypothesis (accepted, competing, or held). */
export function auditTrailForHypothesis(state, hypothesisId) {
  const pools = [...state.hypotheses.accepted, ...state.hypotheses.competing, ...state.hypotheses.held];
  const match = pools.find((hypothesis) => hypothesis.hypothesis_id === hypothesisId || hypothesis.event_id === hypothesisId);
  if (!match) throw new Error(`auditTrailForHypothesis: no hypothesis found for "${hypothesisId}"`);
  return auditTrail(state, { event_ids: [match.event_id], target: { type: "hypothesis", id: hypothesisId } });
}

function closureEventIds(byId, seedIds) {
  const seen = new Set();
  const queue = [...seedIds];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const event = byId.get(id);
    const deps = new Set([...(event.inputs ?? []), ...(event.provenance?.depends_on ?? [])]);
    for (const dep of deps) {
      if (typeof dep === "string" && dep.startsWith("event:") && byId.has(dep) && !seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

function referentTouchesEvent(event, ids) {
  if (event.event_type === "observation.admitted") {
    const envelope = event.payload?.envelope ?? event.payload;
    return (envelope?.anchors?.surfaces ?? []).some((surface) => ids.has(surface.referent_id));
  }
  if (event.event_type === "referent.merged") {
    return ids.has(event.payload?.into_id) || (event.payload?.from_ids ?? []).some((id) => ids.has(id));
  }
  if (event.event_type === "referent.split") {
    return ids.has(event.payload?.from_id) || (event.payload?.into_ids ?? []).some((id) => ids.has(id));
  }
  if (event.event_type === "referent.same_as") {
    return ids.has(event.payload?.referent_id) || ids.has(event.payload?.target_id);
  }
  return false;
}

function priorSummary(state, events) {
  const referenced_by_event_ids = events
    .filter((event) => event.context?.prior_snapshot === state.priorSnapshot.prior_id)
    .map((event) => event.event_id);
  const otherPriorIds = new Set(
    events.map((event) => event.context?.prior_snapshot).filter((id) => id && id !== state.priorSnapshot.prior_id),
  );
  if (otherPriorIds.size > 0) {
    throw new Error(
      `auditTrail: causal chain references prior snapshot(s) other than the pinned one (${[...otherPriorIds].join(", ")}) - the semantic-ledger prior-mismatch guard should make this impossible`,
    );
  }
  return {
    prior_id: state.priorSnapshot.prior_id,
    basis_id: state.priorSnapshot.basis_id,
    convention_set_id: state.priorSnapshot.convention_set_id ?? null,
    policy_ids: state.priorSnapshot.policy_ids ?? [],
    algorithm_versions: state.priorSnapshot.algorithm_versions ?? {},
    content_hash: state.priorSnapshot.content_hash,
    referenced_by_event_ids,
  };
}

function collectDecisions(events) {
  const decisions = [];
  for (const event of events) {
    const payload = event.payload ?? {};
    if (payload.gate_result) {
      decisions.push({
        event_id: event.event_id,
        kind: "individuation",
        status: payload.gate_result.status ?? null,
        reason: payload.gate_result.reason ?? null,
        detail: { individuation_type: payload.individuation_type ?? null, admitted: Boolean(payload.gate_result.admitted) },
      });
    } else if (payload.evaluator_version) {
      decisions.push({
        event_id: event.event_id,
        kind: "discovery.evaluate",
        status: payload.status ?? null,
        reason: payload.reason ?? null,
        detail: { evaluator_version: payload.evaluator_version, candidate_id: payload.candidate_id ?? null },
      });
    } else if (event.event_type === "discovery.abstained") {
      decisions.push({ event_id: event.event_id, kind: "discovery.abstain", status: "abstained", reason: payload.reason ?? null, detail: null });
    } else if (event.event_type?.startsWith("hypothesis.")) {
      decisions.push({
        event_id: event.event_id,
        kind: "hypothesis",
        status: payload.status ?? null,
        reason: payload.reason ?? null,
        detail: { hypothesis_id: payload.hypothesis_id ?? null },
      });
    } else if (event.event_type === "referent.merged" || event.event_type === "referent.split" || event.event_type === "referent.same_as") {
      decisions.push({ event_id: event.event_id, kind: event.event_type.replace(".", "-"), status: null, reason: null, detail: { ...payload } });
    }
  }
  return decisions;
}

function collectObservations(events) {
  return events
    .filter((event) => event.event_type === "observation.admitted")
    .map((event) => {
      const envelope = event.payload?.envelope ?? event.payload;
      return { event_id: event.event_id, source_id: envelope.source_id, source_content_hash: envelope.source_content_hash };
    });
}
