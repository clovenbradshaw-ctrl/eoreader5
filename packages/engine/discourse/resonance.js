// discourse/resonance.js — Ananda (joy) organ: resonance tracking.
//
// Joy is the CONDITIONAL dimension that makes salience reader-dependent.
// The dead-ends section established: identity is computable from text and
// salience is not — every reader-prior derived from text collapses back
// toward the text's vocabulary. Joy is why the reaction channel exists
// (salience needs the reader), but until now it had no organ to live in.
//
// Resonance is the distance between expectation (discourse state) and
// reality (the text passage encountered), weighted by the reader's
// motivational orientation. A truth-seeker finds joy in gaps and
// breakthroughs; a completion-seeker finds joy in saturation and
// fulfillment; a novelty-seeker finds joy in subversion and surprise.
// Same text, different reader, different joy profile.
//
// This organ tracks resonance EVENTS — qualitative state changes in the
// reader-discourse system — and scores passages by their resonance with
// the current discourse state. It feeds into the significance pipeline
// as a non-lexical observable, addressing the altitude test's gap #1:
// "lexical-surprise peaks aren't narrative turning points."

import { extractTextFieldVectors, cosineSimilarity } from "../perceiver/text/text-signal.js";

// The five types of resonance event. Each captures a different kind of
// reader joy — the moment the reader-discourse system experiences a
// qualitative state change, not just a large number.
const RESONANCE_TYPES = Object.freeze([
  "breakthrough",  // dormant motif suddenly activates (discovery)
  "saturation",    // motif reaches sustained high activation (closure)
  "subversion",    // expectation contradicted pleasurably (twist)
  "fulfillment",   // open commitment resolved (satisfaction)
  "surprise_delight", // high delta that confirms rather than violates
]);

export { RESONANCE_TYPES };

// Thresholds — derived from discourse/index.js physics constants
const BREAKTHROUGH_FROM = 0.15;  // must come from below this to count as breakthrough
const BREAKTHROUGH_TO = 0.55;    // must reach above this
const SATURATION_THRESHOLD = 0.85; // count as saturation above this
const SATURATION_SUSTAINED = 3;    // turns above threshold before emitting
const SUBVERSION_DISTANCE = 0.6;   // cosine distance between expected and actual folds
const DELIGHT_HIGH_DELTA = 0.5;    // high delta that confirms (cosineSimilarity > 0.7)

// ── ResonanceEvent ────────────────────────────────────────────────────────────

function stableId(prefix, turn, type, motifId) {
  return `${prefix}:${turn}:${type}:${motifId}`;
}

/**
 * mintResonanceEvent(fields) -> ResonanceEvent
 *
 * Creates a content-addressed resonance event. Immutable once minted.
 * The `joy_score` is the reader-dependent weight: how much THIS reader's
 * orientation amplifies this type of resonance.
 */
export function mintResonanceEvent(fields) {
  return Object.freeze({
    schema: "ResonanceEvent@1",
    id: stableId("resonance", fields.turn, fields.type, fields.motif_id),
    type: fields.type,
    motif_id: fields.motif_id,
    activation: fields.activation,
    previous_activation: fields.previous_activation ?? 0,
    delta: fields.delta ?? 0,
    turn: fields.turn,
    passage_offset: fields.passage_offset ?? null,
    joy_score: fields.joy_score ?? 0,
    // Which orientation drive dominated the joy scoring
    joy_source: fields.joy_source ?? null,
  });
}

// ── Resonance detection ───────────────────────────────────────────────────────

/**
 * computeResonanceScore(passageText, passageFold, motif, orientation) -> { joy_score, type, reason }
 *
 * How much joy does THIS reader get from THIS passage given THIS motif?
 * The joy_score is conditional: it depends on BOTH the passage-motive fit
 * AND the reader's orientation. An unconditional joy measure would be
 * just another units change (see dead-ends: unconditional nulls).
 *
 * @param {string} passageText
 * @param {object} passageFold — cube fold for the passage
 * @param {object} motif — DiscourseState motif with signal, activation, fold
 * @param {object} orientation — ReaderOrientation from motivation organ
 * @returns {{ joy_score: number, type: string, reason: string }}
 */
export function computeResonanceScore(passageText, passageFold, motif, orientation) {
  const d = orientation?.drive ?? { seek_truth: 0.5, seek_completion: 0.5, seek_novelty: 0.5 };

  let score = 0;
  let type = "none";
  let reason = "";

  // Signal similarity — the basic alignment between passage and motif
  let signalSim = 0;
  if (motif.signal && passageText) {
    const pSig = extractTextFieldVectors(passageText);
    const pField = pSig.frames[0]?.field ?? null;
    if (pField) {
      signalSim = cosineSimilarity(pField, motif.signal);
    }
  }

  const act = motif.activation ?? 0;

  // ── Breakthrough: truth-seeker joy ──
  // A dormant motif that the text suddenly activates is a discovery.
  const prevAct = motif._prevActivation ?? 0;
  const breakthroughDelta = act - prevAct;
  if (prevAct < BREAKTHROUGH_FROM && act > BREAKTHROUGH_TO) {
    const breakthroughJoy = breakthroughDelta * d.seek_truth;
    if (breakthroughJoy > score) {
      score = breakthroughJoy;
      type = "breakthrough";
      reason = `dormant→active (+${breakthroughDelta.toFixed(2)}), truth=${d.seek_truth.toFixed(2)}`;
    }
  }

  // ── Saturation: completion-seeker joy ──
  // A motif reaching high activation and sustained there is closure.
  if (act > SATURATION_THRESHOLD && motif._saturationTurns >= SATURATION_SUSTAINED - 1) {
    const saturationJoy = act * d.seek_completion * (motif._saturationTurns / SATURATION_SUSTAINED);
    if (saturationJoy > score) {
      score = saturationJoy;
      type = "saturation";
      reason = `sustained high activation (${act.toFixed(2)}×${motif._saturationTurns}t), completion=${d.seek_completion.toFixed(2)}`;
    }
  }

  // ── Subversion: novelty-seeker joy ──
  // A passage that differs from the motif's expected fold is a twist.
  if (motif.fold && passageFold && signalSim < SUBVERSION_DISTANCE) {
    const subversionJoy = (SUBVERSION_DISTANCE - signalSim) * d.seek_novelty;
    if (subversionJoy > score) {
      score = subversionJoy;
      type = "subversion";
      reason = `expected/actual distance=${(SUBVERSION_DISTANCE - signalSim).toFixed(2)}, novelty=${d.seek_novelty.toFixed(2)}`;
    }
  }

  // ── Surprise delight: high delta that confirms ──
  // Big surprise (high delta) but when it confirms rather than violates.
  if (breakthroughDelta > DELIGHT_HIGH_DELTA && signalSim > 0.7) {
    const delightJoy = breakthroughDelta * (d.seek_completion * 0.5 + d.seek_novelty * 0.3);
    if (delightJoy > score) {
      score = delightJoy;
      type = "surprise_delight";
      reason = `high delta (${breakthroughDelta.toFixed(2)}) that confirms (sim=${signalSim.toFixed(2)})`;
    }
  }

  // ── Fulfillment: truth + completion ──
  // Resolution of an open commitment. Scored by both truth and completion.
  if (motif._fulfillment) {
    const fulfillmentJoy = (d.seek_truth * 0.6 + d.seek_completion * 0.6);
    if (fulfillmentJoy > score) {
      score = fulfillmentJoy;
      type = "fulfillment";
      reason = `commitment resolved, truth=${d.seek_truth.toFixed(2)} completion=${d.seek_completion.toFixed(2)}`;
    }
  }

  return {
    joy_score: Math.min(1, Math.max(0, score)),
    type,
    reason,
    signal_similarity: signalSim,
  };
}

/**
 * detectResonanceEvents(discourseState, passageOffset) -> ResonanceEvent[]
 *
 * After a discourse update, scan all motifs for resonance state changes.
 * Returns immutable ResonanceEvents for any detected qualitative shifts.
 *
 * @param {DiscourseState} ds
 * @param {number|null} passageOffset
 * @returns {Array<ResonanceEvent>}
 */
export function detectResonanceEvents(ds, passageOffset = null) {
  const events = [];
  const orientation = ds.orientation;

  for (const [id, motif] of ds.motifs) {
    const act = motif.activation;
    const prevAct = motif._prevActivation ?? 0;

    // Breakthrough: dormant → active
    if (prevAct < BREAKTHROUGH_FROM && act > BREAKTHROUGH_TO) {
      const joyScore = (act - prevAct) * (orientation.drive?.seek_truth ?? 0.5);
      events.push(mintResonanceEvent({
        type: "breakthrough",
        motif_id: id,
        activation: act,
        previous_activation: prevAct,
        delta: act - prevAct,
        turn: ds.turnCount,
        passage_offset: passageOffset,
        joy_score: Math.min(1, joyScore),
        joy_source: "seek_truth",
      }));
    }

    // Saturation: sustained high activation
    const satTurns = motif._saturationTurns ?? 0;
    if (act > SATURATION_THRESHOLD) {
      if (satTurns === SATURATION_SUSTAINED - 1) {
        const joyScore = act * (orientation.drive?.seek_completion ?? 0.5);
        events.push(mintResonanceEvent({
          type: "saturation",
          motif_id: id,
          activation: act,
          previous_activation: act,
          delta: 0,
          turn: ds.turnCount,
          passage_offset: passageOffset,
          joy_score: Math.min(1, joyScore),
          joy_source: "seek_completion",
        }));
      }
    }
  }

  // Fulfillment: check commitment satisfaction
  for (const c of ds.commitments) {
    if (c._justFulfilled) {
      const joyScore = ((orientation.drive?.seek_truth ?? 0.5) * 0.6 +
                        (orientation.drive?.seek_completion ?? 0.5) * 0.6);
      events.push(mintResonanceEvent({
        type: "fulfillment",
        motif_id: `commitment:${c.description}`,
        activation: 1,
        previous_activation: 0,
        delta: 1,
        turn: ds.turnCount,
        passage_offset: passageOffset,
        joy_score: Math.min(1, joyScore),
        joy_source: "seek_truth+seek_completion",
      }));
    }
  }

  return events;
}

/**
 * resonanceSummary(ds) -> { burstCount, peakJoy, dominantType, topResonances }
 *
 * Summarize the resonance history of a discourse session.
 */
export function resonanceSummary(ds) {
  const events = ds.resonanceEvents ?? [];
  if (!events.length) {
    return { burstCount: 0, peakJoy: 0, dominantType: null, topResonances: [] };
  }

  const byType = {};
  let peakJoy = 0;
  for (const e of events) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    if (e.joy_score > peakJoy) peakJoy = e.joy_score;
  }

  let dominantType = null;
  let maxCount = 0;
  for (const [type, count] of Object.entries(byType)) {
    if (count > maxCount) { maxCount = count; dominantType = type; }
  }

  const topResonances = [...events]
    .sort((a, b) => b.joy_score - a.joy_score)
    .slice(0, 5)
    .map((e) => ({
      type: e.type,
      joy_score: e.joy_score,
      turn: e.turn,
      motif_id: e.motif_id,
    }));

  return {
    burstCount: events.length,
    peakJoy,
    dominantType,
    topResonances,
  };
}

// ── Convergence witness ───────────────────────────────────────────────────────
//
// Ananda as "a new affirmation of Sacchidananda in its apparent opposite":
// two genuinely walled-off lenses, computed in real exclusion from each other,
// converging — unbidden, uncomputed-toward — on the same passage. Not consensus
// you engineered; convergence you were surprised by.
//
// This organ witnesses convergence AFTER the fact — it never drives lenses
// toward agreement, because optimizing for convergence would corrupt the
// independence that makes it meaningful. It can only be witnessed.

/**
 * ConvergenceWitness records an event where two independent lens folds
 * converged on a passage. Stored as a flat array, not a module-level state
 * — the engine has no clock and no ambient memory outside its organs.
 */
export class ConvergenceWitness {
  constructor() {
    this.events = [];
  }

  /**
   * witness(foldA, foldB, passageOffset, lensIdA, lensIdB, ts = null) -> ConvergenceEvent | null
   *
   * Two folds are "converging" when their cosine similarity exceeds the
   * convergence threshold AND both folds have sufficient amplitude (above
   * the noise floor — a flat zero fold trivially "agrees" with everything).
   *
   * `ts` is host-supplied (ingest time, wall clock, etc.) and never generated
   * here — the engine has no clock. Same pattern as the reaction channel.
   *
   * @param {object} foldA — cube fold { operator, terrain, stance } from lens A
   * @param {object} foldB — cube fold from lens B
   * @param {number|null} passageOffset
   * @param {string} lensIdA
   * @param {string} lensIdB
   * @param {number|null} ts — host-supplied timestamp
   * @returns {object|null} convergence event or null if no convergence
   */
  witness(foldA, foldB, passageOffset, lensIdA, lensIdB, ts = null) {
    if (!foldA || !foldB) return null;

    const sim = foldCosineSimilarity(foldA, foldB);
    const ampA = foldAmplitude(foldA);
    const ampB = foldAmplitude(foldB);

    // Both folds must be above the noise floor to count as "real convergence"
    if (ampA < 0.1 || ampB < 0.1) return null;

    // Convergence threshold: 0.6 is a deliberate crossover — high enough that
    // accidental agreement from the cube's nine buckets won't trigger it, low
    // enough that genuinely independent perspectives finding the same cell do.
    const CONVERGENCE_THRESHOLD = 0.6;
    if (sim < CONVERGENCE_THRESHOLD) return null;

    const event = Object.freeze({
      schema: "ConvergenceEvent@1",
      type: "convergence",
      lenses: [lensIdA, lensIdB],
      similarity: +sim.toFixed(4),
      fold_amplitude_a: +ampA.toFixed(4),
      fold_amplitude_b: +ampB.toFixed(4),
      passage_offset: passageOffset,
      ...(ts != null ? { ts } : {}),
    });

    this.events.push(event);
    return event;
  }

  /**
   * summary() -> { totalConvergences, peakSimilarity, lensPairs }
   */
  summary() {
    const events = this.events;
    if (!events.length) {
      return { totalConvergences: 0, peakSimilarity: 0, lensPairs: [] };
    }

    let peakSim = 0;
    const pairs = new Map();
    for (const e of events) {
      if (e.similarity > peakSim) peakSim = e.similarity;
      const key = [...e.lenses].sort().join(" ↔ ");
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }

    const lensPairs = [...pairs.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pair, count]) => ({ pair, count }));

    return {
      totalConvergences: events.length,
      peakSimilarity: peakSim,
      lensPairs,
    };
  }
}

// ── Savored surprise (strange surprise kept open) ─────────────────────────────
//
// The essay: "There may be a class of surprise your engine should learn to
// savor rather than immediately fold flat — the surprise that does not indict
// the prior but enriches it."
//
// A savored surprise has high forward KL (the spine's standard measure) but
// ALSO has high signal similarity with an ACTIVE motif — it's not a
// prediction failure, it's a DELIGHTFUL twist. The system recognizes it as
// meaningful even though it didn't predict it, and flags it for keeping open
// rather than folding into the prior immediately.

/**
 * isSavoredSurprise(surpriseScore, passageText, activeMotifs, options) -> { savored: boolean, reason: string | null }
 *
 * A passage with high lexical surprise may still be "savored" (enjoyed and
 * kept strange) rather than corrected if:
 *   1. Its signal aligns with an active motif (it's meaningful to the reader)
 *   2. The surprise is high enough to be "delightful" (above savored threshold)
 *   3. It's NOT flagged as an error (subversion distance is low — it confirms
 *      rather than violates)
 *
 * @param {number} surpriseScore — forward KL score from the spine
 * @param {string} passageText
 * @param {Map} activeMotifs — map of active discourse motifs with signal vectors
 * @param {object} options — { savoredThreshold }
 * @returns {{ savored: boolean, reason: string | null }}
 */
export function isSavoredSurprise(surpriseScore, passageText, activeMotifs, options = {}) {
  const { savoredThreshold = 0.4 } = options;

  if (surpriseScore < savoredThreshold) return { savored: false, reason: null };
  if (!passageText || !activeMotifs || !activeMotifs.size) return { savored: false, reason: null };

  const pSig = extractTextFieldVectors(passageText);
  const pField = pSig.frames[0]?.field ?? null;
  if (!pField) return { savored: false, reason: null };

  let bestSim = 0;
  let bestMotifId = null;
  let bestMotifAct = 0;

  for (const [id, motif] of activeMotifs) {
    if (!motif.signal || motif.activation < 0.1) continue;
    const sim = cosineSimilarity(pField, motif.signal);
    if (sim > bestSim) {
      bestSim = sim;
      bestMotifId = id;
      bestMotifAct = motif.activation;
    }
  }

  // Savored: high surprise but aligns with an active motif — delightful twist
  if (bestSim > 0.5) {
    return {
      savored: true,
      reason: `high surprise (${surpriseScore.toFixed(2)}) aligns with active motif "${bestMotifId}" (sim=${bestSim.toFixed(2)}, act=${bestMotifAct.toFixed(2)}) — strange but meaningful, kept open`,
    };
  }

  return { savored: false, reason: null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function foldAmplitude(fold) {
  if (!fold) return 0;
  let sum = 0;
  for (const face of ["operator", "terrain", "stance"]) {
    const amps = fold[face] ?? {};
    for (const v of Object.values(amps)) sum += v * v;
  }
  return Math.sqrt(sum);
}
