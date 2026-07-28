import { test } from "node:test";
import assert from "node:assert/strict";
import { mintEncounter, createEncounterLog, appendEncounters, replayEncounters, encounterTally } from "./index.js";

const SELF = "referent:emanon-a";
const WORLD = "world:1";

function encounter(overrides = {}) {
  return mintEncounter({
    self_id: SELF,
    peer_id: "referent:emanon-b",
    world_id: WORLD,
    ts: 1_700_000_000_000,
    seq: 0,
    kind: "observe",
    context: { medium: "text" },
    payload: {},
    ...overrides,
  });
}

function log(...encounters) {
  return appendEncounters(createEncounterLog({ self_id: SELF, world_id: WORLD }), encounters);
}

test("mints a content address over every field but the address itself", () => {
  const a = encounter();
  assert.match(a.encounter_id, /^encounter:sha256:[0-9a-f]{64}$/);
  assert.equal(a.schema, "EncounterEvent@1");
  // Same content, same address.
  assert.equal(encounter().encounter_id, a.encounter_id);
  // Any change to any field changes the address.
  for (const change of [{ kind: "play" }, { peer_id: "referent:emanon-c" }, { ts: 1 }, { seq: 9 }, { payload: { valence: 0.4 } }, { context: { medium: "audio" } }]) {
    assert.notEqual(encounter(change).encounter_id, a.encounter_id, `changing ${Object.keys(change)[0]} must change the address`);
  }
});

test("a creature does not encounter itself", () => {
  assert.throws(() => encounter({ peer_id: SELF }), /self_id and peer_id must differ/);
});

test("rejects an unknown kind — kind is a closed, declared vocabulary", () => {
  assert.throws(() => encounter({ kind: "merge" }), /invalid kind merge/);
  assert.throws(() => encounter({ kind: "fear" }), /invalid kind fear/);
});

test("rejects a non-integer or negative ts and seq — the host supplies both", () => {
  assert.throws(() => encounter({ ts: 1.5 }), /ts must be a non-negative integer/);
  assert.throws(() => encounter({ ts: -1 }), /ts must be a non-negative integer/);
  assert.throws(() => encounter({ seq: null }), /seq must be a non-negative integer/);
});

test("the log is append-only, never mutates its input, and stays walled to one self/world", () => {
  const empty = createEncounterLog({ self_id: SELF, world_id: WORLD });
  const one = appendEncounters(empty, [encounter()]);
  assert.equal(empty.encounters.length, 0, "appending must not mutate the prior log");
  assert.equal(one.encounters.length, 1);
  assert.equal(empty.head, "encounters:empty");
  assert.match(one.head, /^encounters:sha256:[0-9a-f]{64}$/);
  assert.throws(
    () => appendEncounters(one, [encounter({ self_id: "referent:someone-else", seq: 1 })]),
    /self mismatch/,
  );
  assert.throws(
    () => appendEncounters(one, [encounter({ world_id: "world:2", seq: 1 })]),
    /world mismatch/,
  );
});

test("refuses duplicates and non-monotone seq", () => {
  const a = encounter({ seq: 0 });
  assert.throws(() => log(a, a), /duplicate encounter/);
  assert.throws(() => log(encounter({ seq: 5 }), encounter({ seq: 5, kind: "play" })), /non-monotone seq/);
  assert.throws(() => log(encounter({ seq: 5 }), encounter({ seq: 4, kind: "play" })), /non-monotone seq/);
});

test("ACCEPTANCE: replaying a creature's encounter log reproduces the same tally byte-for-byte", () => {
  const events = [
    encounter({ seq: 0, peer_id: "referent:emanon-b", kind: "observe" }),
    encounter({ seq: 1, peer_id: "referent:emanon-b", kind: "play" }),
    encounter({ seq: 2, peer_id: "referent:emanon-c", kind: "teach" }),
    encounter({ seq: 3, peer_id: "referent:emanon-b", kind: "withdraw" }),
  ];
  const live = appendEncounters(createEncounterLog({ self_id: SELF, world_id: WORLD }), events);
  const replayed = replayEncounters(events, { self_id: SELF, world_id: WORLD });

  assert.equal(replayed.head, live.head);
  assert.equal(
    JSON.stringify(encounterTally(replayed)),
    JSON.stringify(encounterTally(live)),
    "the encounter channel must replay byte-identically",
  );
});

test("the tally counts and does not weight — withdraw does not score negative", () => {
  // referent:emanon-c has fewer encounters than referent:emanon-b but they
  // are all `withdraw`; a tally must still rank purely on count.
  const ranking = encounterTally(log(
    encounter({ seq: 0, peer_id: "referent:emanon-b", kind: "play" }),
    encounter({ seq: 1, peer_id: "referent:emanon-c", kind: "withdraw" }),
    encounter({ seq: 2, peer_id: "referent:emanon-c", kind: "withdraw" }),
  ));
  assert.deepEqual(ranking.peers.map((p) => p.peer_id), ["referent:emanon-c", "referent:emanon-b"]);
  assert.deepEqual(ranking.peers[0].by_kind, { withdraw: 2 });
});

test("by_kind key order does not depend on the order kinds were observed", () => {
  const forward = encounterTally(log(
    encounter({ seq: 0, kind: "observe" }),
    encounter({ seq: 1, kind: "teach" }),
    encounter({ seq: 2, kind: "play" }),
  ));
  const backward = encounterTally(log(
    encounter({ seq: 0, kind: "play" }),
    encounter({ seq: 1, kind: "teach" }),
    encounter({ seq: 2, kind: "observe" }),
  ));
  assert.equal(JSON.stringify(forward.peers[0].by_kind), JSON.stringify(backward.peers[0].by_kind));
});

test("an empty log tallies to nothing rather than throwing", () => {
  const ranking = encounterTally(createEncounterLog({ self_id: SELF, world_id: WORLD }));
  assert.deepEqual(ranking.peers, []);
  assert.equal(ranking.head, "encounters:empty");
});

test("context.medium is required — creatures may be specialized to different perceiver modalities", () => {
  assert.throws(() => encounter({ context: { medium: "" } }), /expected non-empty context\.medium/);
  assert.throws(() => encounter({ context: {} }), /expected non-empty context\.medium/);
});
