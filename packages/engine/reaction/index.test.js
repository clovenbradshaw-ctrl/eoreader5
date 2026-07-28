import { test } from "node:test";
import assert from "node:assert/strict";
import { mintReaction, createReactionLog, appendReactions, replayReactions, salienceRanking } from "./index.js";

const READER = "reader:alice";
const SESSION = "session:1";

function reaction(overrides = {}) {
  return mintReaction({
    reader_id: READER,
    session_id: SESSION,
    ts: 1_700_000_000_000,
    seq: 0,
    kind: "dwell",
    block_id: "block:a",
    extent: null,
    context: { visible_block_ids: ["block:a", "block:b"], scale: "paragraph", lens_id: "lens:default" },
    payload: {},
    ...overrides,
  });
}

function log(...reactions) {
  return appendReactions(createReactionLog({ reader_id: READER, session_id: SESSION }), reactions);
}

test("mints a content address over every field but the address itself", () => {
  const a = reaction();
  assert.match(a.reaction_id, /^reaction:sha256:[0-9a-f]{64}$/);
  assert.equal(a.schema, "ReactionEvent@1");
  // Same content, same address.
  assert.equal(reaction().reaction_id, a.reaction_id);
  // Any change to any field changes the address.
  for (const change of [{ kind: "skip" }, { block_id: "block:z" }, { ts: 1 }, { seq: 9 }, { payload: { dwell_ms: 10 } }, { extent: { span_start: 0, span_end: 4 } }]) {
    assert.notEqual(reaction(change).reaction_id, a.reaction_id, `changing ${Object.keys(change)[0]} must change the address`);
  }
});

test("rejects a tampered reaction: the address no longer matches the content", () => {
  const a = reaction();
  assert.throws(() => appendReactions(createReactionLog({ reader_id: READER, session_id: SESSION }), [{ ...a, block_id: "block:tampered" }]), /does not match canonical reaction content/);
});

test("rejects an unknown kind", () => {
  assert.throws(() => reaction({ kind: "vibed" }), /invalid kind vibed/);
});

test("rejects a non-integer or negative ts and seq — the host supplies both", () => {
  assert.throws(() => reaction({ ts: 1.5 }), /ts must be a non-negative integer/);
  assert.throws(() => reaction({ ts: -1 }), /ts must be a non-negative integer/);
  assert.throws(() => reaction({ seq: null }), /seq must be a non-negative integer/);
});

test("rejects an inverted extent", () => {
  assert.throws(() => reaction({ extent: { span_start: 10, span_end: 4 } }), /extent\.span_end must be >= extent\.span_start/);
  // A zero-width extent is legal: a caret position is a real span-select.
  assert.ok(reaction({ extent: { span_start: 4, span_end: 4 } }));
});

test("the log is append-only and never mutates its input", () => {
  const empty = createReactionLog({ reader_id: READER, session_id: SESSION });
  const one = appendReactions(empty, [reaction()]);
  assert.equal(empty.reactions.length, 0, "appending must not mutate the prior log");
  assert.equal(one.reactions.length, 1);
  assert.equal(empty.head, "reactions:empty");
  assert.match(one.head, /^reactions:sha256:[0-9a-f]{64}$/);
});

test("the head is a function of the reaction sequence, so any divergence shows", () => {
  const a = log(reaction({ seq: 0 }), reaction({ seq: 1, block_id: "block:b" }));
  const b = log(reaction({ seq: 0 }), reaction({ seq: 1, block_id: "block:c" }));
  assert.notEqual(a.head, b.head);
  assert.equal(log(reaction({ seq: 0 }), reaction({ seq: 1, block_id: "block:b" })).head, a.head);
});

test("refuses duplicates, foreign readers, foreign sessions, and non-monotone seq", () => {
  const a = reaction({ seq: 0 });
  assert.throws(() => log(a, a), /duplicate reaction/);
  assert.throws(() => log(reaction({ reader_id: "reader:bob" })), /reader mismatch/);
  assert.throws(() => log(reaction({ session_id: "session:2" })), /session mismatch/);
  assert.throws(() => log(reaction({ seq: 5 }), reaction({ seq: 5, block_id: "block:b" })), /non-monotone seq/);
  assert.throws(() => log(reaction({ seq: 5 }), reaction({ seq: 4, block_id: "block:b" })), /non-monotone seq/);
});

test("a backwards ts is accepted — client clocks jitter and the reader still reacted", () => {
  const settled = log(reaction({ seq: 0, ts: 1_700_000_000_100 }), reaction({ seq: 1, ts: 1_700_000_000_000, block_id: "block:b" }));
  assert.equal(settled.reactions.length, 2);
});

test("seq is not redundant with ts: two reactions in the same millisecond stay distinct", () => {
  // Without seq in the content address these two would collapse to one
  // address and the second would be refused as a duplicate.
  const settled = log(reaction({ seq: 0, ts: 1_700_000_000_000 }), reaction({ seq: 1, ts: 1_700_000_000_000 }));
  assert.equal(settled.reactions.length, 2);
  assert.notEqual(settled.reactions[0].reaction_id, settled.reactions[1].reaction_id);
});

// --- The acceptance criterion (HANDOFF Part 4) ------------------------------

test("ACCEPTANCE: replaying a session's reaction log reproduces the same salience ranking byte-for-byte", () => {
  const events = [
    reaction({ seq: 0, block_id: "block:a", kind: "dwell", payload: { dwell_ms: 4200 } }),
    reaction({ seq: 1, block_id: "block:b", kind: "skip" }),
    reaction({ seq: 2, block_id: "block:a", kind: "reread" }),
    reaction({ seq: 3, block_id: "block:c", kind: "query", payload: { text: "who is speaking here" } }),
    reaction({ seq: 4, block_id: "block:a", kind: "span-select", extent: { span_start: 12, span_end: 40 } }),
    reaction({ seq: 5, block_id: "block:b", kind: "abandon" }),
  ];
  const live = appendReactions(createReactionLog({ reader_id: READER, session_id: SESSION }), events);
  const replayed = replayReactions(events, { reader_id: READER, session_id: SESSION });

  assert.equal(replayed.head, live.head);
  assert.equal(
    JSON.stringify(salienceRanking(replayed)),
    JSON.stringify(salienceRanking(live)),
    "the reaction channel must replay byte-identically",
  );
});

test("ACCEPTANCE: the ranking is byte-identical across independent runs, not merely deep-equal", () => {
  const build = () => salienceRanking(log(
    reaction({ seq: 0, block_id: "block:b", kind: "skip" }),
    reaction({ seq: 1, block_id: "block:a", kind: "dwell" }),
    reaction({ seq: 2, block_id: "block:a", kind: "scrub" }),
  ));
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});

test("by_kind key order does not depend on the order kinds were observed", () => {
  // Same multiset of reactions on one block, encountered in two orders. If
  // by_kind were built in observation order these would differ under
  // JSON.stringify while still passing a deepEqual.
  const forward = salienceRanking(log(
    reaction({ seq: 0, kind: "dwell" }),
    reaction({ seq: 1, kind: "abandon" }),
    reaction({ seq: 2, kind: "scrub" }),
  ));
  const backward = salienceRanking(log(
    reaction({ seq: 0, kind: "scrub" }),
    reaction({ seq: 1, kind: "abandon" }),
    reaction({ seq: 2, kind: "dwell" }),
  ));
  assert.equal(JSON.stringify(forward.blocks[0].by_kind), JSON.stringify(backward.blocks[0].by_kind));
});

test("ties break on block_id, so the ranking does not depend on insertion order", () => {
  const forward = salienceRanking(log(reaction({ seq: 0, block_id: "block:z" }), reaction({ seq: 1, block_id: "block:a" })));
  const backward = salienceRanking(log(reaction({ seq: 0, block_id: "block:a" }), reaction({ seq: 1, block_id: "block:z" })));
  assert.deepEqual(forward.blocks.map((b) => b.block_id), ["block:a", "block:z"]);
  assert.equal(JSON.stringify(forward.blocks), JSON.stringify(backward.blocks));
});

test("the tally counts and does not weight — disengagement is not scored negative", () => {
  // Guards the documented non-goal. block:b has more reactions than block:a
  // and they are all disengagement; a tally must still rank it first. If
  // someone later adds weights, this test is the thing that should stop
  // them until the weights are derived from data and checked against a null.
  const ranking = salienceRanking(log(
    reaction({ seq: 0, block_id: "block:a", kind: "dwell" }),
    reaction({ seq: 1, block_id: "block:b", kind: "skip" }),
    reaction({ seq: 2, block_id: "block:b", kind: "abandon" }),
  ));
  assert.deepEqual(ranking.blocks.map((b) => b.block_id), ["block:b", "block:a"]);
  assert.deepEqual(ranking.blocks[0].by_kind, { abandon: 1, skip: 1 });
});

test("an empty log ranks to nothing rather than throwing", () => {
  const ranking = salienceRanking(createReactionLog({ reader_id: READER, session_id: SESSION }));
  assert.deepEqual(ranking.blocks, []);
  assert.equal(ranking.head, "reactions:empty");
});

test("context is required: a dwell on the only visible block is not a dwell on one of twelve", () => {
  assert.throws(() => reaction({ context: { visible_block_ids: ["block:a"], scale: "paragraph", lens_id: "" } }), /expected non-empty context.lens_id/);
  assert.throws(() => reaction({ context: { visible_block_ids: ["block:a"], lens_id: "lens:default" } }), /expected non-empty context.scale/);
});
