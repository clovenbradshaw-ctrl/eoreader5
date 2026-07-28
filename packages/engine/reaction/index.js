// The reaction channel (HANDOFF Part 4).
//
// WHY THIS EXISTS
//
// Three independent attempts to compute a reader prior from text all failed
// the same way (HANDOFF section 1.6): an IDF prior built from a different
// corpus agreed with the intrinsic reading at r = 0.974; a REC-gated learning
// prior over 85 chapters matched a greedy prior within 1% on transfer; a
// compression-dictionary reader seeded on WORD-SCRAMBLED text agreed with a
// real reader at r = 0.887, MORE than a genuine second sample of the same
// author did (0.779). A prior computed from what texts contain can only ever
// be a statement about what texts contain.
//
// The complementary measurement from the same experiment: provenance is
// invariant. Top-3 neighbour agreement between readers seeded from Melville,
// Doyle, and word-salad sat at 0.49-0.54 against a 0.082 chance floor, flat
// across all three. So identity/provenance is reader-independent and
// computable from text; salience is reader-dependent and computable from no
// text at all. This channel is the only place the missing input can come
// from. Until it has data, every reader-prior experiment is guaranteed to
// return the text again.
//
// WHAT THIS IS NOT
//
// It is logging, not ML. Nothing here infers, weights, ranks by importance,
// or feeds a prior. `salienceRanking` below is a COUNT, and its header says
// so at length. The non-goal is explicit in the handoff: collect first.
//
// WHY IT IS NOT IN THE SEMANTIC LEDGER
//
// A reaction is an observation of a READER, not an engine inference. It has
// no operator (no member of the 9 describes "a human looked at this for 4
// seconds"), no prior_id, and no operator_epoch, so it is not a
// SemanticEvent@1 and appendEvents would rightly refuse it. Keeping it in a
// separate log also keeps the guarantee that matters: a reaction can never
// mint an observation, referent, hypothesis, or task. That is the same
// firewall reasoning as docs/corpus-role.md, applied one channel over.
//
// THE ENGINE HAS NO CLOCK
//
// `ts` and `seq` are supplied by the host and never generated here. Reading
// an ambient clock engine-side would put wall-clock into a content address
// and destroy byte-identical replay — the one invariant HANDOFF section 1.2
// measured as genuinely load-bearing (stubbing the cube classifier to a
// constant costs 0 tests; making it inconsistent costs 3, two of them
// determinism tests).

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { validateReactionEvent, REACTION_KINDS } from "@eoreader/spec";

// Fixed iteration order for per-kind tallies. Sorted once, here, so that the
// key order of every `by_kind` object is a constant of this module rather
// than a function of which kinds happened to occur first in a session.
// JSON.stringify preserves insertion order, and the acceptance test compares
// with JSON.stringify, so this is what makes the ranking byte-identical
// rather than merely deep-equal.
const KIND_ORDER = [...REACTION_KINDS].sort();

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

/**
 * mintReaction(fields) -> ReactionEvent@1
 *
 * Computes the content address over every other field and validates the
 * result. All of reader_id, session_id, ts, seq, kind, block_id, extent,
 * context and payload must be supplied by the caller; `extent` may be null
 * for a whole-block reaction but must be present.
 */
export function mintReaction(fields) {
  const body = {
    schema: "ReactionEvent@1",
    reader_id: fields.reader_id,
    session_id: fields.session_id,
    ts: fields.ts,
    seq: fields.seq,
    kind: fields.kind,
    block_id: fields.block_id,
    extent: fields.extent ?? null,
    context: {
      visible_block_ids: fields.context?.visible_block_ids ?? [],
      scale: fields.context?.scale,
      lens_id: fields.context?.lens_id,
    },
    payload: fields.payload ?? {},
  };
  return validateReactionEvent({ ...body, reaction_id: stableId("reaction", body) });
}

/**
 * createReactionLog({ reader_id, session_id }) -> ReactionLog
 *
 * One log per (reader, session). Both are fixed at creation and every
 * appended reaction must match: a log that mixed readers would be exactly
 * the reader-independent average that section 1.6 shows collapses back to
 * the text.
 */
export function createReactionLog({ reader_id, session_id }) {
  if (typeof reader_id !== "string" || !reader_id) throw new TypeError("ReactionLog: expected non-empty reader_id");
  if (typeof session_id !== "string" || !session_id) throw new TypeError("ReactionLog: expected non-empty session_id");
  return { schema: "ReactionLog@1", reader_id, session_id, reactions: [], head: "reactions:empty" };
}

/**
 * appendReactions(log, events) -> ReactionLog
 *
 * Append-only. Returns a new log; never mutates. Refuses, in order: a
 * malformed or mis-addressed event, an event from another reader or session,
 * a duplicate content address, and a seq that does not strictly increase.
 *
 * seq is required to strictly increase rather than merely differ because the
 * log's order IS the reading order, and a later interpretation of `reread`
 * or `abandon` depends on it. ts is deliberately NOT required to be monotone
 * — real client clocks jitter and correct backwards, and refusing those
 * events would silently drop real reader behaviour to protect a property
 * nothing needs.
 */
export function appendReactions(log, events) {
  const seen = new Set(log.reactions.map((reaction) => reaction.reaction_id));
  let lastSeq = log.reactions.length ? log.reactions[log.reactions.length - 1].seq : -1;
  const appended = [];
  for (const event of events) {
    validateReactionEvent(event);
    if (event.reader_id !== log.reader_id) throw new TypeError(`reaction log reader mismatch for ${event.reaction_id}`);
    if (event.session_id !== log.session_id) throw new TypeError(`reaction log session mismatch for ${event.reaction_id}`);
    if (seen.has(event.reaction_id)) throw new TypeError(`reaction log duplicate reaction: ${event.reaction_id}`);
    if (event.seq <= lastSeq) throw new TypeError(`reaction log non-monotone seq ${event.seq} after ${lastSeq} for ${event.reaction_id}`);
    seen.add(event.reaction_id);
    lastSeq = event.seq;
    appended.push(event);
  }
  const reactions = [...log.reactions, ...appended];
  return { ...log, reactions, head: reactions.length ? stableId("reactions", reactions.map((r) => r.reaction_id)) : "reactions:empty" };
}

/**
 * replayReactions(events, { reader_id, session_id }) -> ReactionLog
 *
 * Rebuild a log from its events. This is the acceptance path: replaying a
 * session's reaction log must reproduce the same salience ranking
 * byte-for-byte.
 */
export function replayReactions(events, { reader_id, session_id }) {
  return appendReactions(createReactionLog({ reader_id, session_id }), events);
}

/**
 * salienceRanking(log) -> { schema, head, reader_id, session_id, blocks }
 *
 * READ THIS BEFORE USING IT. This is a TALLY, not a salience model.
 *
 * It ranks blocks by how many reactions landed on them, ties broken by
 * block_id ascending. It has zero free parameters and applies zero weights,
 * and that is the entire point. The obvious "improvement" — weight dwell
 * positively and skip/abandon negatively — is exactly the inference the
 * handoff rules out until the channel has data ("Non-goal: inferring
 * anything from it yet. Collect first."). Any such weighting would be a
 * reader model asserted rather than measured, and this repo has three
 * separate measurements of what asserting a reader model gets you.
 *
 * So: `reactions` is engagement VOLUME, and volume is not salience. A block
 * with many `skip` and `abandon` reactions ranks high here, which is
 * correct for a tally and wrong for salience. `by_kind` is returned
 * alongside precisely so that nothing is hidden behind the single number,
 * and so the eventual weighted model (HANDOFF Part 6, blocked on this
 * channel having data) can be derived and checked against a null rather
 * than hardcoded.
 *
 * Determinism: the sort is total (count, then block_id), the by_kind key
 * order is the module-level KIND_ORDER constant, and the whole result is a
 * pure function of the log. Nothing here reads a clock or a random source.
 */
export function salienceRanking(log) {
  const byBlock = new Map();
  for (const reaction of log.reactions) {
    let entry = byBlock.get(reaction.block_id);
    if (!entry) {
      entry = { reactions: 0, kinds: new Map() };
      byBlock.set(reaction.block_id, entry);
    }
    entry.reactions += 1;
    entry.kinds.set(reaction.kind, (entry.kinds.get(reaction.kind) ?? 0) + 1);
  }
  const blocks = [...byBlock.entries()]
    .map(([block_id, entry]) => {
      const by_kind = {};
      for (const kind of KIND_ORDER) {
        if (entry.kinds.has(kind)) by_kind[kind] = entry.kinds.get(kind);
      }
      return { block_id, reactions: entry.reactions, by_kind };
    })
    .sort((a, b) => (b.reactions - a.reactions) || (a.block_id < b.block_id ? -1 : a.block_id > b.block_id ? 1 : 0));
  return {
    schema: "ReactionTally@1",
    head: log.head,
    reader_id: log.reader_id,
    session_id: log.session_id,
    blocks,
  };
}
