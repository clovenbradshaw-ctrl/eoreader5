// encounter/index.js — the encounter channel: testimony between two
// individuated creatures, not a reader's reaction to a text and not an
// engine inference over one.
//
// WHY THIS EXISTS
//
// The existing event vocabulary has exactly two shapes: a SemanticEvent@1
// (an engine inference over a text, carrying an operator and a prior_id)
// and a ReactionEvent@1 (a human reader's raw, unprocessed observation of
// the engine's output, firewalled from the ledger). Neither covers "one
// individuated creature forms testimony about meeting another individuated
// creature" — that is not inference over a text (there may be no text at
// all: two nameless leitmotifs can meet, not just two named characters)
// and it is not a reader watching an engine artifact. It is peer
// testimony, and peer testimony needs its own channel for the same reason
// a reaction does: an inference-shaped hole invites something to be
// smuggled through it as inference that is not.
//
// WHAT THIS IS NOT
//
// It is logging, not relationship inference. mintEncounter records that a
// meeting happened and what kind it was DECLARED to be; nothing here
// computes affinity, trust, or a relationship strength from the payload,
// and nothing here derives kind or affect (valence/arousal) from content —
// see cube/index.js's dead-ends for what happens when a classifier is
// allowed to gate instead of a declaration. encounterTally below is a
// COUNT, on the same "collect first" discipline as reaction/index.js's
// salienceRanking, for an even sharper reason here: turning encounter
// counts into a relationship model without a null is the reader-prior-
// from-text mistake at creature scale — three independent measured
// failures (HANDOFF 1.6) already show what asserting a model instead of
// deriving one against a null gets you.
//
// WHY IT IS NOT IN THE SEMANTIC LEDGER
//
// An encounter is testimony OF a creature ABOUT a peer, not an engine
// inference: it has no operator, no prior_id, no operator_epoch, so it is
// not a SemanticEvent@1 and appendEvents rightly refuses it (see
// conformance/invariants/encounter-channel-firewall.test.js). Kept in its
// own log for the same guarantee the reaction channel keeps: an encounter
// can never mint an observation, referent, hypothesis, or task about the
// peer it describes. Testimony is evidence a peer's own individuation gate
// may later weigh — it is never automatically true of the peer. In
// particular, a `teach` encounter is NOT a write into the taught
// creature's priors: it is a proposal sitting in a log, exactly as real as
// any other testimony and no more, until something runs it back through
// the ordinary admission machinery.
//
// A CREATURE DOES NOT ENCOUNTER ITSELF, AND NOT BY NAME
//
// self_id and peer_id are referent ids, not name strings, and they must
// differ (validateEncounterEvent enforces this) — same-string identity is
// never assumed here either (docs/nameless-referent.md).
//
// WORLDS ARE A COMMONS, NOT A MERGE
//
// world_id groups encounters the way session_id groups reactions: many
// creatures can write into the same world, but createEncounterLog holds
// exactly one creature's own testimony (one log per self_id). Nothing here
// pools two creatures' logs into one; a "hive" built on top of this
// channel is stigmergic (independent walled creatures reading and writing
// a shared commons) rather than telepathic (one merged state) — see
// docs/nameless-referent.md's same-string-does-not-auto-merge rule, which
// this is the same principle applied to whole creatures instead of names.
//
// THE ENGINE HAS NO CLOCK
//
// ts and seq are host-supplied, never generated here — same discipline as
// reaction/index.js, for the same reason: byte-identical replay.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { validateEncounterEvent, ENCOUNTER_KINDS } from "@eoreader/spec";

// Fixed iteration order for per-kind tallies, for the same reason
// reaction/index.js sorts KIND_ORDER once at module scope: by_kind's key
// order must be a constant of this module, not a function of which kinds
// happened to occur first in a session.
const KIND_ORDER = [...ENCOUNTER_KINDS].sort();

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

/**
 * mintEncounter(fields) -> EncounterEvent@1
 *
 * Computes the content address over every other field and validates the
 * result. self_id, peer_id, world_id, ts, seq, kind, context.medium and
 * payload must all be supplied by the caller.
 */
export function mintEncounter(fields) {
  const body = {
    schema: "EncounterEvent@1",
    self_id: fields.self_id,
    peer_id: fields.peer_id,
    world_id: fields.world_id,
    ts: fields.ts,
    seq: fields.seq,
    kind: fields.kind,
    context: {
      medium: fields.context?.medium,
    },
    payload: fields.payload ?? {},
  };
  return validateEncounterEvent({ ...body, encounter_id: stableId("encounter", body) });
}

/**
 * createEncounterLog({ self_id, world_id }) -> EncounterLog
 *
 * One log per (self, world): a creature's own record of everyone it has
 * met there. A log that mixed selves would be exactly the pooled, unwalled
 * state a group of these creatures must not default to — each keeps its
 * own testimony, and nothing merges two creatures' logs automatically.
 */
export function createEncounterLog({ self_id, world_id }) {
  if (typeof self_id !== "string" || !self_id) throw new TypeError("EncounterLog: expected non-empty self_id");
  if (typeof world_id !== "string" || !world_id) throw new TypeError("EncounterLog: expected non-empty world_id");
  return { schema: "EncounterLog@1", self_id, world_id, encounters: [], head: "encounters:empty" };
}

/**
 * appendEncounters(log, events) -> EncounterLog
 *
 * Append-only. Returns a new log; never mutates. Refuses, in order: a
 * malformed or mis-addressed event, an event from another self or world,
 * a duplicate content address, and a seq that does not strictly increase.
 */
export function appendEncounters(log, events) {
  const seen = new Set(log.encounters.map((encounter) => encounter.encounter_id));
  let lastSeq = log.encounters.length ? log.encounters[log.encounters.length - 1].seq : -1;
  const appended = [];
  for (const event of events) {
    validateEncounterEvent(event);
    if (event.self_id !== log.self_id) throw new TypeError(`encounter log self mismatch for ${event.encounter_id}`);
    if (event.world_id !== log.world_id) throw new TypeError(`encounter log world mismatch for ${event.encounter_id}`);
    if (seen.has(event.encounter_id)) throw new TypeError(`encounter log duplicate encounter: ${event.encounter_id}`);
    if (event.seq <= lastSeq) throw new TypeError(`encounter log non-monotone seq ${event.seq} after ${lastSeq} for ${event.encounter_id}`);
    seen.add(event.encounter_id);
    lastSeq = event.seq;
    appended.push(event);
  }
  const encounters = [...log.encounters, ...appended];
  return { ...log, encounters, head: encounters.length ? stableId("encounters", encounters.map((e) => e.encounter_id)) : "encounters:empty" };
}

/**
 * replayEncounters(events, { self_id, world_id }) -> EncounterLog
 *
 * Rebuild a log from its events. Replaying a creature's encounter log must
 * reproduce the same tally byte-for-byte.
 */
export function replayEncounters(events, { self_id, world_id }) {
  return appendEncounters(createEncounterLog({ self_id, world_id }), events);
}

/**
 * encounterTally(log) -> { schema, head, self_id, world_id, peers }
 *
 * READ THIS BEFORE USING IT. This is a TALLY, not a relationship model.
 *
 * It ranks peers by how many encounters this creature logged with them,
 * ties broken by peer_id ascending, with a by_kind breakdown alongside so
 * nothing is hidden behind one number. It has zero free parameters and
 * assigns zero weight to `withdraw` vs `play` vs `teach` — weighting kinds
 * against each other (a `play`-heavy peer scoring as more "trusted" than a
 * `withdraw`-heavy one) is exactly the inference this channel defers, for
 * the same reason reaction/index.js's salienceRanking defers it: this repo
 * has three separate measurements of what asserting an unearned model gets
 * you (HANDOFF 1.6), and a further one of what an unconditional null gets
 * you — an affinity score is meaningless without a null for what encounter
 * counts between UNRELATED creatures look like by chance, and this module
 * does not have one. Collect first.
 */
export function encounterTally(log) {
  const byPeer = new Map();
  for (const encounter of log.encounters) {
    let entry = byPeer.get(encounter.peer_id);
    if (!entry) {
      entry = { encounters: 0, kinds: new Map() };
      byPeer.set(encounter.peer_id, entry);
    }
    entry.encounters += 1;
    entry.kinds.set(encounter.kind, (entry.kinds.get(encounter.kind) ?? 0) + 1);
  }
  const peers = [...byPeer.entries()]
    .map(([peer_id, entry]) => {
      const by_kind = {};
      for (const kind of KIND_ORDER) {
        if (entry.kinds.has(kind)) by_kind[kind] = entry.kinds.get(kind);
      }
      return { peer_id, encounters: entry.encounters, by_kind };
    })
    .sort((a, b) => (b.encounters - a.encounters) || (a.peer_id < b.peer_id ? -1 : a.peer_id > b.peer_id ? 1 : 0));
  return {
    schema: "EncounterTally@1",
    head: log.head,
    self_id: log.self_id,
    world_id: log.world_id,
    peers,
  };
}
