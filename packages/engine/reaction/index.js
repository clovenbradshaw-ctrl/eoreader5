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

export { REACTION_KINDS };

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
 * readerOrientationFromLog(log) -> ReaderOrientation
 *
 * Derive the reader's motivational orientation from their reaction history.
 * Re-exported from motivation/index.js for convenience — the reaction channel
 * is the data source, and the motivation organ is the interpreter.
 */
export { readerOrientationFromLog } from "../motivation/index.js";

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

/**
 * reactionResonanceBursts(log) -> BurstAnalysis
 *
 * Detects temporal clusters (bursts) of reader engagement in the reaction log.
 * Beyond the simple tally (salienceRanking above), this finds WHERE the reader
 * showed concentrated attention — rapid sequences of dwell, re-read, probe,
 * and follow-figure reactions on nearby blocks.
 *
 * A burst is a run of 3+ reactions where:
 *   - Every reaction is an engagement kind (dwell, reread, probe, follow-figure,
 *     verify, decollapse — not skip, scrub, or abandon)
 *   - Adjacent reactions are within a proximity window (nearby block_ids or
 *     within a small seq range)
 *   - The total density (reactions per distance) exceeds the background rate
 *
 * This is mechanical pattern detection over the tally, not a salience model.
 * It surfaces WHERE the reader felt joy/flow without asserting WHY — the
 * interpretation ("aha moment", "resonance", "deep reading") is for a
 * downstream organ, not the reaction channel itself.
 *
 * @param {ReactionLog} log
 * @param {object} options — { minBurstLength, proximityWindow }
 * @returns {{ bursts: Array<Burst>, burstCount: number, engagementDensity: number }}
 */
export function reactionResonanceBursts(log, options = {}) {
  const { minBurstLength = 3, proximityWindow = 5 } = options;

  const ENGAGEMENT_KINDS = new Set([
    "dwell", "reread", "probe", "follow-figure", "verify", "decollapse",
    "demand_witness", "face_gap",
  ]);

  if (!log.reactions.length) {
    return { bursts: [], burstCount: 0, engagementDensity: 0 };
  }

  // Collect engagement reactions with their block positions
  const engaged = [];
  const blockIds = [];
  for (const r of log.reactions) {
    blockIds.push(r.block_id);
    if (ENGAGEMENT_KINDS.has(r.kind)) {
      engaged.push(r);
    }
  }

  // Map block_ids to linear positions for proximity measurement
  const blockOrder = [...new Set(blockIds)].sort();
  const blockPos = new Map(blockOrder.map((b, i) => [b, i]));

  // Find temporal clusters of engagement
  const bursts = [];
  let currentBurst = [];

  for (let i = 0; i < engaged.length; i++) {
    const curr = engaged[i];

    if (currentBurst.length === 0) {
      currentBurst.push(curr);
      continue;
    }

    const prev = currentBurst[currentBurst.length - 1];
    const currPos = blockPos.get(curr.block_id) ?? 0;
    const prevPos = blockPos.get(prev.block_id) ?? 0;
    const dist = Math.abs(currPos - prevPos);

    if (dist <= proximityWindow) {
      currentBurst.push(curr);
    } else {
      if (currentBurst.length >= minBurstLength) {
        bursts.push(summarizeBurst(currentBurst, blockPos));
      }
      currentBurst = [curr];
    }
  }
  if (currentBurst.length >= minBurstLength) {
    bursts.push(summarizeBurst(currentBurst, blockPos));
  }

  // Overall engagement density: engaged reactions / total distance covered
  let totalDist = 0;
  if (blockOrder.length > 1) {
    totalDist = blockPos.get(blockOrder[blockOrder.length - 1]) - blockPos.get(blockOrder[0]);
  }
  const engagementDensity = totalDist > 0 ? engaged.length / Math.max(1, totalDist) : 0;

  return {
    bursts: bursts.sort((a, b) => b.intensity - a.intensity),
    burstCount: bursts.length,
    engagementDensity: +engagementDensity.toFixed(4),
  };
}

function summarizeBurst(reactions, blockPos) {
  const blocks = reactions.map((r) => r.block_id);
  const kinds = {};
  for (const r of reactions) {
    kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  }

  const positions = blocks.map((b) => blockPos.get(b) ?? 0);
  const span = positions.length > 1 ? positions[positions.length - 1] - positions[0] : 0;
  const density = span > 0 ? reactions.length / span : reactions.length;
  const dominantKind = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    length: reactions.length,
    blocks: [...new Set(blocks)],
    kinds,
    span,
    density: +density.toFixed(4),
    dominantKind,
    seqRange: [reactions[0].seq, reactions[reactions.length - 1].seq],
  };
}

// ── Stigmergy adapter ────────────────────────────────────────────────────────
//
// The reaction log as a lawful Medium (R1-R5). R1 already holds (reactions
// never mint inferences; reader_id is opaque). This adapter adds the missing
// pieces: mandatory decay, local sensing by seq window, lock-in detection, and
// the R5 open-loop check for reactions that claim known consequences.
//
// This is additive: no existing function changes. The adapter wraps existing
// reaction-log operations through the stigmergy interface, proving the log is
// a lawful medium without rewriting it.

import {
  createMedium,
  lockInRisk as stigLockInRisk,
  unsensedConsequences,
} from "../emergence/stigmergy/index.js";

/**
 * reactionLogAsMedium(log, options) -> Medium
 *
 * Wraps a ReactionLog as a stigmergy Medium. The reaction log's reader_id
 * becomes the medium's sole agent; each reaction is a trace deposit. seq
 * ordering provides the temporal structure. R1–R5 are enforced through the
 * adapter's deposit/sense/evaporate wrappers.
 *
 * @param {ReactionLog} log — from createReactionLog
 * @param {object} options
 * @param {number} options.decay — R3 mandatory decay for evaporation
 * @param {number} options.explorationFloor — R4 lock-in floor
 * @returns {object} a Medium-compatible wrapper around the reaction log
 */
export function reactionLogAsMedium(log, { decay = 0.1, explorationFloor = 0.05 } = {}) {
  const base = createMedium({ decay, explorationFloor });

  // Populate with existing reactions as pre-existing deposits
  let m = base;
  let offGradientCount = 0;
  const deposits = [];
  for (const r of log.reactions) {
    const d = {
      id: r.reaction_id,
      agentId: log.reader_id,
      trace: {
        kind: r.kind,
        block_id: r.block_id,
        extent: r.extent,
        seq: r.seq,
        context: r.context,
        payload: r.payload,
      },
      offGradient: false,
      turn: r.seq,
    };
    deposits.push(Object.freeze(d));
  }

  return Object.freeze({
    schema: "ReactionMedium@1",
    id: base.id,
    decay: base.decay,
    explorationFloor: base.explorationFloor,
    deposits: Object.freeze(deposits),
    depositCount: deposits.length,
    offGradientCount,
    _log: log, // retained for adapter-specific access
  });
}

/**
 * depositReaction(medium, reactionEvent) -> { medium, result }
 *
 * Appends a reaction as a trace deposit. Enforces R5: if the reaction's
 * payload carries known consequence edges, they must be present.
 *
 * @param {object} medium — from reactionLogAsMedium
 * @param {ReactionEvent@1} reaction — a validated reaction event
 * @returns {{ medium, result }} — new medium or refusal with status
 */
export function depositReaction(medium, reaction) {
  if (!reaction || !reaction.reaction_id) {
    throw new TypeError("reaction-adapter: deposit requires a valid reaction event");
  }

  // R5: check payload for consequence edges
  const consequenceEdges = reaction.payload?.consequenceEdges ?? null;
  if (consequenceEdges !== null && (!Array.isArray(consequenceEdges) || consequenceEdges.length === 0)) {
    return {
      medium,
      result: Object.freeze({
        admitted: false,
        status: "open-loop",
        reason: "reaction payload has known consequences but no consequence-edges provided (R5)",
      }),
    };
  }

  const d = Object.freeze({
    id: reaction.reaction_id,
    agentId: medium._log.reader_id,
    trace: {
      kind: reaction.kind,
      block_id: reaction.block_id,
      extent: reaction.extent,
      seq: reaction.seq,
      context: reaction.context,
      payload: reaction.payload,
      consequenceRefs: consequenceEdges ?? [],
    },
    offGradient: !!reaction.payload?.offGradient,
    turn: medium.depositCount,
  });

  const offGradientCount = medium.offGradientCount + (d.offGradient ? 1 : 0);

  return {
    medium: Object.freeze({
      ...medium,
      deposits: Object.freeze([...medium.deposits, d]),
      depositCount: medium.depositCount + 1,
      offGradientCount,
    }),
    result: Object.freeze({
      admitted: true,
      status: "admitted",
      deposit_id: d.id,
    }),
  };
}

/**
 * senseReactions(medium, neighborhood) -> Deposit[]
 *
 * Local sensing by seq window. R2: rejects whole-medium reads.
 *
 * @param {object} medium
 * @param {{ from?: number, count?: number, byBlock?: string }} neighborhood
 * @returns {Array<object>}
 */
export function senseReactions(medium, neighborhood = {}) {
  const { from = 0, count = 20, byBlock } = neighborhood;

  if (byBlock) {
    // Sense only deposits for a specific block (local by block identity)
    const blockDeposits = medium.deposits.filter((d) => d.trace.block_id === byBlock);
    return blockDeposits.slice(Math.max(0, from), from + count);
  }

  if (count >= medium.deposits.length && medium.deposits.length > 0 && from === 0) {
    throw new TypeError("reaction-adapter: senseReactions() called with whole-medium neighborhood (R2: local sensing only)");
  }

  const start = Math.max(0, Math.min(from, medium.deposits.length));
  const end = Math.min(start + count, medium.deposits.length);
  return medium.deposits.slice(start, end);
}

/**
 * evaporateReactions(medium, dt) -> Medium
 *
 * Evaporate old deposits by seq age. Reactions with seq below the decay
 * floor (relative to the most recent seq) are dropped.
 *
 * @param {object} medium
 * @param {number} dt — evaporation steps
 */
export function evaporateReactions(medium, dt = 1) {
  if (dt <= 0 || medium.deposits.length === 0) return medium;

  const maxSeq = medium.deposits[medium.deposits.length - 1].trace.seq;
  const seqWindow = Math.max(1, Math.floor(medium.deposits.length * (1 - medium.decay * dt)));
  const minSeq = maxSeq - seqWindow;

  const surviving = medium.deposits.filter((d) => d.trace.seq >= minSeq);
  if (surviving.length === 0) {
    surviving.push(medium.deposits[medium.deposits.length - 1]);
  }
  if (surviving.length === medium.deposits.length) return medium;

  const offGradientCount = surviving.filter((d) => d.offGradient).length;
  return Object.freeze({
    ...medium,
    deposits: Object.freeze(surviving),
    offGradientCount,
  });
}

/**
 * lockInRiskReactions(medium) -> { flagged, offGradientFraction, null_result }
 *
 * R4: is deposit mass concentrated on a single block (all reactions on one
 * block, no exploration)? Flags lock-in through the stigmergy module's test.
 *
 * @param {object} medium
 * @returns {{ flagged: boolean, offGradientFraction: number, null_result: object }}
 */
export function lockInRiskReactions(medium) {
  // Build a synthetic stigmergy-compatible medium for the test
  const synth = {
    schema: "StigmergyMedium@1",
    decay: medium.decay,
    explorationFloor: medium.explorationFloor,
    deposits: medium.deposits,
    depositCount: medium.depositCount,
    offGradientCount: medium.offGradientCount,
  };
  return stigLockInRisk(synth);
}

/**
 * unsensedConsequencesReactions(medium, known) -> object[]
 *
 * R5 audit surface over reaction deposits — which known consequence
 * referents have no reaction trace?
 */
export function unsensedConsequencesReactions(medium, known) {
  return unsensedConsequences(medium, known);
}
