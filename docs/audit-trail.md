# The audit trail (spec 7.11, "recursive audit")

Status: implemented, P1 slice
Implements: spec section 7.11, "recursive audit" — cited but not previously
built (`packages/engine/referents/individuation.js` already promised
"callers keep both the pre- and post-name-bind individuation results for
the audit trail (spec 7.11)"; `docs/priors-boundary.md` already assigns
eoreaderapp the job of "present[ing] prior provenance and audit trails to
users" without anything yet supplying the data).
Code: `packages/engine/audit/index.js`.
Schema: `packages/spec/schemas/audit-trail.schema.json` (`AuditTrail@1`).

## 1. What this answers

For any surface the engine has produced — a `ReadingSnapshot` unit, a
referent, a hypothesis, or an arbitrary set of events — "what was the
engine doing to get that, and what priors were activated" reduces to two
already-real but previously unassembled things:

1. the causal closure of `SemanticEvent`s that surface actually depends on
   (`inputs` / `provenance.depends_on`, spec 3.2), walked back to its
   `observation.admitted` roots;
2. the identity of the one pinned `PriorSnapshot` bound into every event in
   that closure (`event.context.prior_snapshot` /
   `event.authority.grant.prior_id`).

`auditTrail(state, query)` in `packages/engine/audit/index.js` is a pure
query over `state.events` — no new substrate, no I/O
(`docs/invariants.md`, "Engine purity"). It never mutates state and never
derives anything the ledger did not already record; it only reconstructs
and reformats.

## 2. Why "priors activated" is a single identity, not a menu

`docs/priors-boundary.md` is explicit: eoreader5 "treat[s] the prior as an
immutable value supplied by the caller" — it does not select, activate, or
mix parts of a `PriorSnapshot` at read time; eoPriors does all policy,
projector, and compressor *activation* upstream, before publishing one
immutable artifact. Consistently with that boundary, and with the
`semantic-ledger` prior-mismatch guard in `packages/engine/replay/index.js`
(`appendEvents` throws if an event's `authority.grant.prior_id` disagrees
with the state's pinned prior), an audit trail's `prior` section reports
exactly one `PriorSnapshot` identity — `prior_id`, `basis_id`,
`convention_set_id`, `policy_ids`, `algorithm_versions`, `content_hash` —
plus `referenced_by_event_ids`: which events in *this* trail actually
carried that binding. `auditTrail` treats disagreement as a hard failure
(`priorSummary` throws) rather than silently picking one, per spec 4.4
("fail closed when an inference lacks provenance").

This is the honest current scope: `evaluate()`
(`packages/engine/emergence/evaluate/index.js`) and `discoverCandidates()`
(`packages/engine/emergence/search/index.js`) do not yet branch on any
sub-field of the pinned prior (`basis_id`, `policy_ids`, ...) — they only
consume `state.semanticHead`/`state.engineVersion`. Once a decision path
starts actually reading prior sub-fields to make a choice, that reference
belongs in this same audit trail, folded into `prior` or `decisions`
alongside the choice it informed — the schema does not need to change for
that, only the data assembled into it.

## 3. Shape

`AuditTrail@1` (`packages/spec/schemas/audit-trail.schema.json`):

- `target` — `{type, id}`, one of `event` / `events` / `unit` / `referent`
  / `hypothesis`.
- `prior` — the pinned `PriorSnapshot` identity plus
  `referenced_by_event_ids` (section 2).
- `events` — the full causal closure, in ledger append order, each a
  complete `SemanticEvent@1` (reuses `semantic-event.schema.json` — an
  audit trail excerpt is not a lossy summary of the ledger, it is the
  ledger).
- `decisions` — a normalized view over `events`: individuation gate
  results (`gate_result`), discovery/evaluate outcomes
  (`evaluator_version`), abstentions, hypothesis status changes, and
  referent lifecycle events, each tagged with `{event_id, kind, status,
  reason, detail}` so a consumer does not need to know every event
  payload shape to answer "what did it decide, and why."
- `observations` — the `observation.admitted` roots the closure bottoms
  out at (the Given, never derived from the Meant — spec 3.3).
- `audit_id` / `content_hash` — content-addressed like every other
  artifact in this repo (`packages/spec/canonical-json`); the same query
  against the same state always returns byte-identical output.

## 4. Entry points

`auditTrail(state, { event_id | event_ids, target? })` is the core
primitive. Three thin resolvers cover the surfaces the engine already
produces:

- `auditTrailForUnit(state, readingSnapshot, unitId)` — seeds from the
  unit's own `operator_events` (`packages/engine/projection/index.js`).
- `auditTrailForReferent(state, referentId)` — seeds from every
  `observation.admitted` surface admit and `referent.merged/split/same_as`
  event that names the referent, absorbing any referent merged into it
  (spec 3.1: a merge preserves all prior surfaces and observations of what
  it absorbs). `same_as` proposals appear in the trail but do not widen
  absorption — they are candidate equivalences, not identity.
- `auditTrailForHypothesis(state, hypothesisId)` — seeds from the one
  event that produced the current hypothesis record in
  `state.hypotheses.{accepted,competing,held}`.

## 5. A real gap this surfaced, and the fix

Building this against the actual discovery pipeline
(`packages/engine/replay/index.js`'s `discovery.advance` handler) found
that discovered candidates carried no real provenance back to the
`observation.admitted` events their sightings came from — `inputs` only
chained each candidate to whichever candidate was evaluated immediately
before it in the same batch, which is scheduling order, not a causal
dependency. An audit trail rooted at a `kind.accepted`/`hypothesis.held`
event could not reach the observation it was actually mined from, and
would falsely implicate whichever unrelated candidate happened to be
evaluated first in the batch. `discovery.advance`/`discovery.resume` now
index `observation.admitted` events by `source_id` and set each
candidate's `inputs` to the command's own inputs plus the specific
observation events backing its `sightings`, dropping the incidental
inter-candidate chain. See `packages/engine/audit/index.test.js` for the
regression coverage (a held single-occurrence candidate's trail contains
only its own observation, not an unrelated accepted candidate's).

## 6. What this does not do (yet)

- It does not present anything to a user — `docs/priors-boundary.md`
  assigns "present prior provenance and audit trails to users" to
  eoreaderapp. This module is the engine-owned data that presentation
  would be built from, not the presentation itself.
- It does not (yet) fold individuation-gate `NullProtocol@1` records
  (`mass_null`, `coupling_null`, `boundary_stability`) into `decisions`
  from a live pipeline run, because the individuation gate itself is "not
  yet wired into `packages/engine/runner.js`'s event pipeline"
  (`docs/individuation-gate.md` §6). Once it is, `individuateReferent`'s
  `gate_result` already flows through `collectDecisions` automatically —
  no schema change needed, only a wired caller.
- `auditTrailForReferent`'s merge absorption is one hop of `referent.merged`
  edges resolved transitively; it does not attempt to resolve `same_as`
  candidate-equivalence chains into identity, because the engine itself
  does not (spec 3.1: only an explicit merge event unifies identity).
