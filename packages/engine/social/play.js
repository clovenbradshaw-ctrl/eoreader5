// social/play.js — Inter-engine play: engines surfing each other's discoveries.
//
// Play is the social form of surplus REC (spontaneousSurface in the store).
// One engine's spontaneous connection — a Hebbian edge it noticed without
// being asked — becomes a CUE for another engine. The second engine doesn't
// adopt the first's conclusion; it investigates the passage independently
// and reports what IT found there.
//
// This is not teaching (exporting priors). This is lighter — more like
// "hey, I found something interesting here, you might want to look."
// The receiving engine treats it as a discourse cue (pushTopic) and
// produces a mini-fold at that passage. The result is a PLAY EXCHANGE:
// engine A's surplus → engine B's investigation → divergence or convergence.
//
// Key property: play is LOW-STAKES by design. A play exchange that produces
// divergence is NOT an error — it's delightful. "I found a pattern here."
// "I looked, and I see something different." That DIFFERENCE is the joy
// of play. Two players should NOT always agree — if they did, play would
// be redundant, which kills the joy.
//
// The PlaySession tracks rounds of exchange between two engines. Each
// round: A proposes a passage → B investigates → B reports back. The
// session records what B found vs what A expected, and the divergence
// IS the outcome, not a failure.

import { surface as surfaceMemory } from "../emergence/store/index.js";
import { foldCosineSimilarity } from "./index.js";

/**
 * PlaySession — a round-based exchange between two engines.
 *
 * Engine A ("the proposer") has a store of Hebbian connections.
 * Engine B ("the investigator") examines passages A found interesting.
 * The result is a log of (proposal, investigation, outcome) tuples.
 */
export class PlaySession {
  constructor(engineAId, engineBId) {
    this.engineAId = engineAId;
    this.engineBId = engineBId;
    this.rounds = [];
    this.convergenceCount = 0;
    this.divergenceCount = 0;
  }

  /**
   * playRound(storeA, framesB, engineBOrientation, options) -> PlayRound
   *
   * A single round of play:
   *   1. Engine A's store produces a spontaneous connection
   *   2. The passage at that connection is extracted from the text
   *   3. Engine B investigates: surface(storeA, passageText) from B's perspective
   *   4. Compare: does B's recollection match A's connection?
   *
   * @param {Store} storeA — Engine A's associative memory store
   * @param {Array<{ offset, order, text }>} framesB — Engine B's text frames
   * @param {object} engineBOrientation — Engine B's reader orientation
   * @param {object} options — { maxRounds }
   * @returns {PlayRound}
   */
  playRound(storeA, framesB, engineBOrientation, options = {}) {
    const { maxRounds = 5 } = options;
    if (this.rounds.length >= maxRounds) return null;

    // 1. Engine A's strongest spontaneous connection
    const surplus = surfaceMemory(storeA, "", {
      completion: 0, // direct only — surplus has no cue
      topEdges: 10,
    });

    if (!surplus.length) return null;

    // Pick a connection we haven't explored yet
    const explored = new Set(this.rounds.map((r) => r.proposal.order));
    const proposal = surplus.find((s) => !explored.has(s.order));
    if (!proposal) return null;

    // 2. Find the passage in Engine B's frames
    const frameB = framesB.find((f) => f.order === proposal.order);
    if (!frameB) {
      return this._recordRound(proposal, null, null, "no_frame");
    }

    // 3. Engine B investigates: what does B's own store recall from this passage?
    //    (Using B's frames, but the CUE is A's proposed passage)
    const bRecall = surfaceMemory({ ...storeA, frames: framesB }, frameB.text, {
      selfOrder: frameB.order,
      cueOrder: frameB.order,
      completion: 0.5,
    });

    // 4. Compare: does B see the same thing A saw?
    const aActivation = proposal.activation;
    const bTop = bRecall.length > 0 ? bRecall[0] : null;
    const bActivation = bTop?.activation ?? 0;

    // Convergence: B's strongest recall is within 50% of A's
    const similarity = aActivation > 0 ? Math.min(1, bActivation / aActivation) : 0;
    const converged = similarity >= 0.5;

    const round = this._recordRound(proposal, frameB, bTop, converged ? "converged" : "diverged");
    round.similarityScore = +similarity.toFixed(4);
    round.bTopActivation = +bActivation.toFixed(4);
    round.aActivation = +aActivation.toFixed(4);
    return round;
  }

  _recordRound(proposal, frameB, bTop, outcome) {
    const round = Object.freeze({
      round: this.rounds.length + 1,
      proposal: {
        order: proposal.order,
        activation: proposal.activation,
      },
      frameText: frameB?.text?.slice(0, 200) ?? null,
      outcome,
      bTop: bTop ? { order: bTop.order, activation: bTop.activation } : null,
    });

    this.rounds.push(round);
    if (outcome === "converged") this.convergenceCount++;
    else if (outcome === "diverged") this.divergenceCount++;

    return round;
  }

  /**
   * summary() -> PlaySessionSummary
   */
  summary() {
    const total = this.rounds.length;
    return Object.freeze({
      engineA: this.engineAId,
      engineB: this.engineBId,
      rounds: total,
      converged: this.convergenceCount,
      diverged: this.divergenceCount,
      convergenceRate: total > 0 ? +(this.convergenceCount / total).toFixed(4) : 0,
      // Play is HEALTHY when there's a mix — all convergence means
      // the engines are redundant; all divergence means they can't
      // communicate. The sweet spot is 40-60% convergence.
      health: total >= 3
        ? (this.convergenceCount / total >= 0.4 && this.convergenceCount / total <= 0.6
            ? "healthy_mix" : this.convergenceCount / total > 0.6 ? "too_similar" : "too_different")
        : "insufficient_rounds",
    });
  }
}

/**
 * playExchange(storeA, framesB, engineAId, engineBId, options) -> PlaySession
 *
 * Run a full play exchange — multiple rounds — between two engines.
 * Each round: A proposes → B investigates → compare.
 *
 * @param {Store} storeA — Engine A's store
 * @param {Array} framesB — Engine B's frames
 * @param {string} engineAId
 * @param {string} engineBId
 * @param {object} options — { maxRounds, orientationB }
 * @returns {PlaySession}
 */
export function playExchange(storeA, framesB, engineAId, engineBId, options = {}) {
  const { maxRounds = 5, orientationB = null } = options;
  const session = new PlaySession(engineAId, engineBId);

  for (let i = 0; i < maxRounds; i++) {
    const round = session.playRound(storeA, framesB, orientationB, { maxRounds });
    if (!round) break;
  }

  return session;
}
