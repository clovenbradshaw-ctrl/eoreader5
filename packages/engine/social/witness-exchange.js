// social/witness-exchange.js — Inter-engine witness protocol.
//
// The engine's internal witnesses (ConvergenceWitness in discourse/resonance.js)
// track agreement between TWO LENSES within ONE engine. This module extends
// that to track agreement between TWO ENGINES examining the same passage.
//
// Each engine is a CGI collective — a federation of specialized organs with
// its own self-record, discourse state, reaction log, and motivational
// orientation. The witness exchange is how they compare notes.
//
// The protocol is:
//   1. Engine A produces a WitnessArtifact — the external face of its
//      internal state at a passage.
//   2. Engine B receives the artifact and compares it against ITS OWN
//      internal state at the same passage.
//   3. The comparison produces either CONVERGENCE (both engines saw the
//      same thing) or DIVERGENCE (they saw different things — which is
//      DATA, not error).
//   4. Engine B mints a SelfEvent recording the result.
//
// Key invariants:
//   - No engine communicates directly with another engine. The host
//     orchestrates all exchanges. (Same discipline as the reaction
//     channel's no-I/O rule.)
//   - Convergence is witnessed, never optimized. Two engines that
//     converge organically is meaningful; two engines optimized to
//     converge is theater.
//   - Disagreement is a typed gap, never a vote. "Engine A saw more
//     entities present than Engine B" is a gap to investigate, not a
//     majority-rule override.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { mintSelfEvent } from "../self/index.js";

// foldCosineSimilarity is shared with discourse/resonance.js — both modules
// define it independently to avoid circular imports. Keep in sync.
function foldCosineSimilarity(foldA, foldB) {
  if (!foldA || !foldB) return 0;
  let dot = 0, normA = 0, normB = 0;
  const faces = ["operator", "terrain", "stance"];
  for (const face of faces) {
    const aa = foldA[face] ?? {};
    const bb = foldB[face] ?? {};
    const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
    for (const k of keys) {
      const a = aa[k] ?? 0;
      const b = bb[k] ?? 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
  }
  return normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

// ── WitnessArtifact — the external face of an engine's state ─────────────────

/**
 * mintWitnessArtifact(fields) -> WitnessArtifact
 *
 * A content-addressed snapshot of what one engine saw at one passage.
 * Designed to be exchanged between engines by a host orchestrator.
 * The content_address enables deterministic replay of the exchange.
 *
 * @param {string} engine_id — stable identifier for this engine
 * @param {string} self_head — the engine's self-record head at artifact time
 * @param {number} passage_offset — character offset into the source text
 * @param {number} passage_length — span length
 * @param {object} fold — cube fold { operator, terrain, stance }
 * @param {object} presence — { entity_id: weight } per-entity presence
 * @param {Array} resonance_events — resonance events at this passage
 * @param {Array} spontaneous_connections — surplus store connections
 * @param {number|null} ts — host-supplied timestamp (engine has no clock)
 * @returns {WitnessArtifact}
 */
export function mintWitnessArtifact({
  engine_id, self_head, passage_offset, passage_length,
  fold = null, presence = null, resonance_events = null,
  spontaneous_connections = null, ts = null,
}) {
  const body = {
    schema: "WitnessArtifact@1",
    engine_id,
    self_head,
    passage_offset,
    passage_length,
    fold: fold ? {
      operator: fold.operator ?? {},
      terrain: fold.terrain ?? {},
      stance: fold.stance ?? {},
    } : null,
    presence: presence ?? {},
    resonance_events: resonance_events?.slice(0, 5) ?? [],
    spontaneous_connections: spontaneous_connections?.slice(0, 5) ?? [],
    ...(ts != null ? { ts } : {}),
  };

  return Object.freeze({
    ...body,
    content_address: stableHash("witness", body),
  });
}

// ── CrossEngineWitness ───────────────────────────────────────────────────────

// Threshold: what cosine similarity between two engine folds counts as
// "agreement." Higher than the intra-engine ConvergenceWitness threshold
// (0.6) because inter-engine agreement is rarer and should be held to a
// stricter standard — two engines agreeing is more meaningful than two
// lenses within the same engine agreeing.
const CROSS_ENGINE_CONVERGENCE_THRESHOLD = 0.7;

/**
 * CrossEngineWitness — tracks inter-engine agreement patterns.
 *
 * One instance per engine per passage (or per session). Accumulates
 * convergence/divergence events as other engines' witness artifacts
 * are compared against the local engine's state.
 *
 * Like ConvergenceWitness, this is a pure witness organ: it records
 * what happened without influencing it. Convergence events can be
 * read downstream (ananda witness, consensus analysis) but never
 * fed back as an optimization target.
 */
export class CrossEngineWitness {
  constructor(localEngineId) {
    this.localEngineId = localEngineId;
    this.peersSeen = new Set();
    this.events = [];
  }

  /**
   * witness(localArtifact, peerArtifact, turn, sourceOrgan) -> event | null
   *
   * Compare a peer engine's witness artifact against our own at the
   * same passage. Only witnesses if both artifacts have valid folds
   * at the same offset (within a tolerance window).
   *
   * @param {WitnessArtifact} localArtifact — our engine's witness at this passage
   * @param {WitnessArtifact} peerArtifact — the other engine's witness
   * @param {number} turn — discourse turn (logical clock)
   * @param {string} sourceOrgan — which organ initiated the comparison
   * @returns {object|null} convergence/divergence result or null if no comparison possible
   */
  witness(localArtifact, peerArtifact, turn = 0, sourceOrgan = "social") {
    if (!localArtifact?.fold || !peerArtifact?.fold) return null;
    if (this.peersSeen.has(peerArtifact.engine_id)) return null;

    // Must be examining the same passage (within tolerance)
    const PASSAGE_TOLERANCE = 200; // characters
    const localOff = localArtifact.passage_offset;
    const peerOff = peerArtifact.passage_offset;
    if (localOff == null || peerOff == null) return null;
    if (Math.abs(localOff - peerOff) > PASSAGE_TOLERANCE) return null;

    this.peersSeen.add(peerArtifact.engine_id);

    const sim = foldCosineSimilarity(localArtifact.fold, peerArtifact.fold);

    // Presence overlap: Jaccard of detected entities
    let presenceOverlap = 0;
    const localEntities = Object.keys(localArtifact.presence ?? {});
    const peerEntities = Object.keys(peerArtifact.presence ?? {});
    if (localEntities.length > 0 || peerEntities.length > 0) {
      const intersection = localEntities.filter((e) => peerEntities.includes(e)).length;
      const union = new Set([...localEntities, ...peerEntities]).size;
      presenceOverlap = union > 0 ? intersection / union : 0;
    }

    // Resonance overlap: do both engines experience joy at this passage?
    const localResonance = (localArtifact.resonance_events?.length ?? 0) > 0;
    const peerResonance = (peerArtifact.resonance_events?.length ?? 0) > 0;
    const resonanceMatch = localResonance === peerResonance ? 1 : (localResonance && peerResonance ? 1 : 0);

    const isConverging = sim >= CROSS_ENGINE_CONVERGENCE_THRESHOLD;

    const event = Object.freeze({
      schema: "CrossEngineWitnessEvent@1",
      local_engine: this.localEngineId,
      peer_engine: peerArtifact.engine_id,
      convergence: isConverging,
      fold_similarity: +sim.toFixed(4),
      presence_overlap: +presenceOverlap.toFixed(4),
      resonance_match: !!resonanceMatch,
      passage_offset: localOff,
      turn,
      self_event: null, // filled below if we mint one
    });

    // Mint a SelfEvent for the local engine's self-record
    const selfEvent = isConverging
      ? mintSelfEvent({
          kind: "convergence",
          sourceOrgan,
          turn,
          delta: 1 - sim,
          payload: {
            peer_engine: peerArtifact.engine_id,
            fold_similarity: +sim.toFixed(4),
            presence_overlap: +presenceOverlap.toFixed(4),
          },
          description: `converged with peer engine ${peerArtifact.engine_id} at passage ${localOff} (similarity ${sim.toFixed(3)})`,
          dependsOn: [],
        })
      : mintSelfEvent({
          kind: "divergence",
          sourceOrgan,
          turn,
          delta: sim, // high delta = disagreement
          payload: {
            peer_engine: peerArtifact.engine_id,
            fold_similarity: +sim.toFixed(4),
            presence_overlap: +presenceOverlap.toFixed(4),
            divergence_detail: describeDivergence(localArtifact, peerArtifact, sim, presenceOverlap),
          },
          description: `diverged from peer engine ${peerArtifact.engine_id} at passage ${localOff} (similarity ${sim.toFixed(3)}, presence ${presenceOverlap.toFixed(2)})`,
          dependsOn: [],
        });

    const eventWithSelf = Object.freeze({ ...event, self_event: selfEvent });
    this.events.push(eventWithSelf);
    return eventWithSelf;
  }

  /**
   * summary() -> { peerCount, convergenceRate, agreements, disagreements, topPeers }
   *
   * How well does this engine agree with others? Not a correctness measure —
   * a pattern measure. High agreement might mean the engine is accurate OR
   * that it's in an echo chamber. High disagreement might mean it's
   * uniquely insightful OR that it's wrong. The summary is data; the
   * interpretation is for a higher organ.
   */
  summary() {
    const events = this.events;
    if (!events.length) {
      return { peerCount: 0, convergenceRate: 0, agreements: 0, disagreements: 0, topPeers: [] };
    }

    const agreements = events.filter((e) => e.convergence).length;
    const disagreements = events.length - agreements;
    const convergenceRate = +(agreements / events.length).toFixed(4);

    // Which peers do we agree with most?
    const byPeer = new Map();
    for (const e of events) {
      let entry = byPeer.get(e.peer_engine);
      if (!entry) {
        entry = { agreements: 0, disagreements: 0, totalSim: 0 };
        byPeer.set(e.peer_engine, entry);
      }
      if (e.convergence) entry.agreements++;
      else entry.disagreements++;
      entry.totalSim += e.fold_similarity;
    }

    const topPeers = [...byPeer.entries()]
      .map(([peer, stats]) => ({
        peer,
        agreements: stats.agreements,
        disagreements: stats.disagreements,
        avgSimilarity: +(stats.totalSim / (stats.agreements + stats.disagreements)).toFixed(4),
      }))
      .sort((a, b) => b.agreements - a.agreements);

    return {
      peerCount: byPeer.size,
      convergenceRate,
      agreements,
      disagreements,
      topPeers: topPeers.slice(0, 5),
    };
  }

  /**
   * getPeerEvents(peerEngineId) -> events with that peer
   */
  getPeerEvents(peerEngineId) {
    return this.events.filter((e) => e.peer_engine === peerEngineId);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stableHash(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

function describeDivergence(local, peer, sim, presenceOverlap) {
  const reasons = [];
  if (sim < 0.3) reasons.push("very different fold interpretations");
  else if (sim < 0.7) reasons.push("partial fold overlap");
  if (presenceOverlap < 0.3) reasons.push("different entity detections");
  else if (presenceOverlap < 0.7) reasons.push("partial entity agreement");
  return reasons.length > 0 ? reasons.join("; ") : "mild divergence";
}
