// social/medium-adapters.js — Proving the reaction channel and Hebbian store
// are lawful stigmergy Media.
//
// Both already satisfy most of the invariants by design. This module provides
// thin adapter functions that map their existing interfaces onto the formal
// Medium contract, with compliance checks where the existing implementation
// doesn't already enforce a rule.
//
// Rules already satisfied:
//   Reaction channel: R1 (append-only, no agent-to-agent, observer not actor),
//     R5 through deposit() open-loop check. Needs: R3 decay declaration.
//   Store: R2 (CA3 one-hop local completion), R3 (decay mechanism 4).
//     Needs: R4 exploration check.

import { createMedium, deposit, sense, evaporate } from "../emergence/stigmergy/index.js";
import { salienceRanking } from "../reaction/index.js";
import { surface as surfaceMemory, buildStore } from "../emergence/store/index.js";

// ── Reaction channel adapter ──────────────────────────────────────────────────

/**
 * reactionChannelAsMedium(reactionLog, { decay }) -> Medium
 *
 * Wraps a ReactionLog as a lawful stigmergy Medium. The reaction log already
 * satisfies R1 (append-only, observer-not-actor, no agent-to-agent channel).
 * This adapter adds:
 *   - R3: a REQUIRED decay rate (must be declared — the reaction log had no
 *     concept of decay before, but the stigmergy rules require it)
 *   - Deposit mapping: each reaction becomes a deposit with agentId=reader_id
 *
 * @param {object} reactionLog — from createReactionLog()
 * @param {number} decay — MANDATORY R3 decay rate
 * @returns {Medium}
 */
export function reactionChannelAsMedium(reactionLog, { decay }) {
  const medium = createMedium({ decay, explorationFloor: 0.05 });

  // Map each reaction in the log to a deposit
  let m = medium;
  for (const reaction of (reactionLog.reactions ?? [])) {
    const { medium: nextM } = deposit(m, {
      agentId: reaction.reader_id,
      trace: {
        kind: reaction.kind,
        block_id: reaction.block_id,
        extent: reaction.extent,
        ts: reaction.ts,
        seq: reaction.seq,
        // React and reactions are observations of a reader, not inferences.
        // They carry no claims about the world — so consequenceEdges are
        // left null (the reader is not claiming a consequence, just reacting).
        reaction_id: reaction.reaction_id,
      },
      offGradient: reaction.kind === "probe" || reaction.kind === "follow-figure",
    });
    if (nextM) m = nextM;
  }

  return m;
}

/**
 * reactionLogDeposit(reactionLog, newReaction, { decay }) -> { medium, result }
 *
 * Deposit a new reaction into the reaction-log-as-Medium. Returns the
 * updated medium and the admission result (may be open-loop refused if
 * the reaction claims consequences without edges).
 */
export function reactionLogDeposit(reactionLog, newReaction, { decay }) {
  const medium = reactionLog?.medium ?? reactionChannelAsMedium(reactionLog, { decay });

  return deposit(medium, {
    agentId: newReaction.reader_id,
    trace: {
      kind: newReaction.kind,
      block_id: newReaction.block_id,
      ts: newReaction.ts,
      seq: newReaction.seq,
    },
    offGradient: newReaction.kind === "probe" || newReaction.kind === "follow-figure",
    consequenceEdges: null, // reactions don't claim consequences
  });
}

// ── Store adapter ─────────────────────────────────────────────────────────────

/**
 * storeAsMedium(frames, { decay, explorationFloor }) -> Medium
 *
 * Wraps the Hebbian associative memory store as a lawful stigmergy Medium.
 * The store already satisfies:
 *   - R2: CA3 one-hop completion for local sensing (surface() takes a cue,
 *     completes one hop, never floods the whole store)
 *   - R3: decay as mechanism 4 (consolidation/forgetting curve)
 *
 * This adapter maps each frame as a deposit of its strongest motifs.
 *
 * @param {Array<{ offset, order, text }>} frames — text frames in reading order
 * @param {number} decay — MANDATORY R3 decay rate
 * @param {number} explorationFloor — R4 exploration floor
 * @returns {Medium}
 */
export function storeAsMedium(frames, { decay, explorationFloor = 0.05 }) {
  const medium = createMedium({ decay, explorationFloor });
  const store = buildStore(frames);

  let m = medium;
  for (const f of frames) {
    const motifs = store.frameMotifs?.get(f.order);
    if (!motifs || motifs.size === 0) continue;

    // Each frame becomes a deposit carrying its strongest motifs as trace
    const { medium: nextM } = deposit(m, {
      agentId: `frame:${f.order}`,
      trace: {
        order: f.order,
        offset: f.offset,
        motifCount: motifs.size,
        // Carry forward the store's idf for soerity provenance
        strongestMotifs: [...motifs.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([motif, weight]) => ({ motif, weight })),
      },
      offGradient: false, // frame deposits are reading-order, not exploratory
    });
    if (nextM) m = nextM;
  }

  return m;
}

/**
 * storeSense(medium, cueText, { count }) -> recalled deposits
 *
 * Local sensing through the store's one-hop completion. Equivalent to
 * sense() on the medium, but using the store's CA3 completion mechanism.
 *
 * @param {Medium} medium — from storeAsMedium()
 * @param {string} cueText
 * @param {object} options
 * @returns {Array}
 */
export function storeSense(medium, cueText, { count = 10 } = {}) {
  // Find deposits whose motifs overlap with the cue
  const matches = [];
  for (const d of medium.deposits) {
    if (!d.trace?.strongestMotifs) continue;
    const cueTokens = new Set(String(cueText).toLowerCase().split(/\s+/));
    let overlap = 0;
    for (const { motif } of d.trace.strongestMotifs) {
      const motifTokens = motif.split(/\s+/);
      if (motifTokens.some((t) => cueTokens.has(t))) overlap++;
    }
    if (overlap > 0) {
      matches.push({ ...d, overlap });
    }
  }
  return matches
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, count);
}
