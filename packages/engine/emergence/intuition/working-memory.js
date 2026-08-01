// emergence/intuition/working-memory.js — WorkingMemoryBuffer: intuition composition layer.
//
// Composes the store (associative recall), discourse (current context), prediction
// substrate (calibrated foresight), and holon-level gate (possibility constraint)
// into a single organ that answers "what is possible, what is probable, and what
// cannot be judged" — with typed gaps for each silence.
//
// The buffer is the engine's J-space counterpart (discourse-awareness-memory-
// synthesis.md): a small, bounded set of active items that sit between the
// associative store and the fold, updated on each turn. It is pure and
// deterministic — no model calls.
//
// Physics:
//   - Capacity: 25 (matches discourse MAX_MOTIFS)
//   - Decay: exponential same as discourse (tau = 5 turns)
//   - Activation: Born-rule cosine similarity when signal vectors available
//   - Probability: log1p-normalized store activation (calibrated proxy for a
//     proper scoring rule on text — the prediction substrate's CRPS is for
//     numeric series; extension to text is a future phase)
//   - Possibility: holon-level-conditioned admissibility (location proximity,
//     motif compatibility, store floor)
//   - Novelty: forwardScore (KL divergence) against buffer's own history
//   - Composite: activation * (probability + possibility + novelty) weighted
//
// Every claim that cannot be made is a typed gap in the IntuitionReport.

import { surface, buildStore } from "../store/index.js";
import { forwardScore } from "../surprise/index.js";
import { extractTextFieldVectors, cosineSimilarity } from "../../perceiver/text/text-signal.js";

const CAPACITY = 25;
const DECAY_TAU = 5;
const PROB_DECAY_TAU = DECAY_TAU * 2;
const EVICTION_THRESHOLD = 0.05;
const STORE_ACTIVATION_NORM = 10;
const LOCATION_MULTIPLIER = 3;
const STORE_NOISE_FLOOR = 0.01;
const MOTIF_ALIGNMENT_FLOOR = 0.15;
const COMPOSITE_ACTIVATION_W = 0.30;
const COMPOSITE_PROBABILITY_W = 0.30;
const COMPOSITE_POSSIBILITY_W = 0.20;
const COMPOSITE_NOVELTY_W = 0.20;

class IntuitionItem {
  constructor({ id, label, source, activation, probabilityEstimate, possibility, noveltyScore, compositeScore, signal, frameOrder, offset, text, turn }) {
    this.id = id;
    this.label = label;
    this.source = source;
    this.activation = activation;
    this.probabilityEstimate = probabilityEstimate;
    this.possibility = possibility;
    this.noveltyScore = noveltyScore;
    this.compositeScore = compositeScore;
    this.signal = signal;
    this.frameOrder = frameOrder;
    this.offset = offset;
    this.text = text;
    this.firstSeen = turn;
    this.lastSeen = turn;
    this.reinforcements = 1;
  }

  get isAlive() {
    return this.activation > EVICTION_THRESHOLD;
  }
}

function stableId(prefix, turn, label) {
  return `${prefix}:${turn}:${String(label ?? "").slice(0, 40).replace(/[^a-z0-9]/gi, "_")}`;
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function normalizeActivation(raw) {
  return Math.min(1, raw / STORE_ACTIVATION_NORM);
}

function estimateProbability(rawActivation) {
  if (rawActivation <= 0) return 0;
  return Math.min(0.95, Math.log1p(rawActivation) / Math.log1p(20));
}

function computeNovelty(text, history) {
  const unit = { text };
  const hist = history.filter(h => h && h.text).map(h => ({ text: h.text }));
  return forwardScore(unit, hist);
}

function checkPossibility(frameOffset, storeActivation, discourseState) {
  if (storeActivation <= STORE_NOISE_FLOOR) {
    return { exists: false, nullGatePassed: false, reason: "store_activation_below_noise_floor" };
  }
  if (discourseState && discourseState.location != null && frameOffset != null) {
    const dist = Math.abs(frameOffset - discourseState.location);
    const radius = discourseState.locationRadius ?? 50000;
    if (dist > radius * LOCATION_MULTIPLIER) {
      return { exists: true, nullGatePassed: false, reason: "outside_discourse_horizon" };
    }
  }
  return { exists: true, nullGatePassed: true };
}

function computeComposite(activation, probability, possibility, novelty) {
  const pw = possibility && possibility.nullGatePassed !== false ? 1.0 : 0.3;
  const n = Math.min(1, novelty / 5);
  return activation * COMPOSITE_ACTIVATION_W
    + probability * COMPOSITE_PROBABILITY_W
    + pw * COMPOSITE_POSSIBILITY_W
    + n * COMPOSITE_NOVELTY_W;
}

function signalFor(text) {
  if (!text) return null;
  try {
    const v = extractTextFieldVectors(text);
    return v.frames?.[0]?.field ?? null;
  } catch {
    return null;
  }
}

function motifAlignmentScore(text, discourseState) {
  if (!discourseState || !discourseState.motifs || !discourseState.motifs.size) return 0;
  const cueSignal = signalFor(text);
  if (!cueSignal) return 0;
  let maxSim = 0;
  for (const [, m] of discourseState.motifs) {
    if (m.activation <= MOTIF_ALIGNMENT_FLOOR || !m.signal) continue;
    const sim = cosineSimilarity(cueSignal, m.signal);
    if (sim > maxSim) maxSim = sim;
  }
  return maxSim;
}

export class WorkingMemoryBuffer {
  constructor({ capacity = CAPACITY, decayTau = DECAY_TAU, store = null } = {}) {
    this.turn = 0;
    this.capacity = capacity;
    this.decayTau = decayTau;
    this.store = store || null;
    this.items = new Map();
    this.totalItemsCreated = 0;
    this.history = [];
    this.intuition = null;
    this.gaps = [];
  }

  update({ cueText = null, store = null, discourseState = null, frames = null } = {}) {
    this.turn++;
    this.gaps = [];
    const useStore = store || this.store;

    // 1. Decay all existing items
    for (const item of this.items.values()) {
      item.activation *= Math.exp(-1 / this.decayTau);
      if (item.probabilityEstimate > 0) {
        item.probabilityEstimate *= Math.exp(-1 / PROB_DECAY_TAU);
      }
    }

    // 2. Surface from store if cue text available
    if (cueText && useStore && useStore.frames && useStore.frames.length > 2) {
      let surfaced;
      try {
        surfaced = surface(useStore, cueText, {
          completion: 0.5,
          topEdges: 6,
          idfFloor: 2.0,
          decay: 0,
        });
      } catch (e) {
        this.gaps.push({ reason: "store_surface_error", detail: e.message });
        surfaced = [];
      }

      if (surfaced.length === 0) {
        this.gaps.push({ reason: "store_no_associations", detail: "cue surfaced no store associations above threshold" });
      }

      const frameMap = frames
        ? new Map(frames.map(f => [f.order, f]))
        : new Map((useStore.frames || []).map(f => [f.order, f]));

      for (const result of surfaced) {
        if (this.items.size >= this.capacity) break;

        const frame = frameMap.get(result.order);
        if (!frame) continue;

        const rawAct = result.activation;
        const activation = normalizeActivation(rawAct);
        const probability = estimateProbability(rawAct);
        const possibility = checkPossibility(frame.offset, rawAct, discourseState);
        const novelty = computeNovelty(frame.text, this.history);
        const composite = computeComposite(activation, probability, possibility, novelty);
        const sig = signalFor(frame.text);
        const alignment = motifAlignmentScore(frame.text, discourseState);

        const id = stableId("intuition", result.order, cueText);
        const existing = this.items.get(id);
        if (existing) {
          existing.activation = Math.max(existing.activation, activation);
          existing.probabilityEstimate = Math.max(existing.probabilityEstimate, probability);
          existing.compositeScore = (existing.compositeScore + composite) / 2;
          existing.lastSeen = this.turn;
          existing.reinforcements++;
        } else {
          this.items.set(id, new IntuitionItem({
            id, label: frame.text.slice(0, 100),
            source: "store", activation, probabilityEstimate: probability,
            possibility, noveltyScore: novelty, compositeScore: composite,
            signal: sig, frameOrder: frame.order, offset: frame.offset,
            text: frame.text, turn: this.turn,
          }));
          this.totalItemsCreated++;
          this.history.push({ text: frame.text });
        }
      }
    } else if (cueText && (!useStore || !useStore.frames || useStore.frames.length <= 2)) {
      this.gaps.push({ reason: "store_unavailable", detail: "store has no frames — cannot surface associations" });
    }

    // 3. Push discourse motifs as active context items
    if (discourseState && discourseState.motifs && discourseState.motifs.size > 0) {
      for (const [, m] of discourseState.motifs) {
        if (m.activation <= MOTIF_ALIGNMENT_FLOOR) continue;
        if (this.items.size >= this.capacity) break;

        const activation = m.activation;
        const probability = 0.5;
        const possibility = { exists: true, nullGatePassed: true };
        const novelty = m.signal ? computeNovelty(String(m.fold?.terrain ?? ""), this.history) : 0;
        const composite = computeComposite(activation, probability, possibility, novelty);

        const id = `discourse:${m.id}`;
        const existing = this.items.get(id);
        if (existing) {
          existing.activation = Math.max(existing.activation, activation);
          existing.lastSeen = this.turn;
          existing.reinforcements++;
        } else {
          this.items.set(id, new IntuitionItem({
            id, label: `motif:${m.id}`,
            source: "discourse", activation, probabilityEstimate: probability,
            possibility, noveltyScore: novelty, compositeScore: composite,
            signal: m.signal, frameOrder: null, offset: null,
            text: String(m.fold?.terrain ?? ""), turn: this.turn,
          }));
        }
      }
    }

    // 4. Push topics as high-probability context
    if (discourseState && discourseState.topicStack && discourseState.topicStack.length > 0) {
      for (const topic of discourseState.topicStack) {
        if (this.items.size >= this.capacity) break;
        const id = `topic:${topic.label}`;
        if (this.items.has(id)) continue;
        const activation = 0.7;
        const sig = topic.motif?.signal ?? null;
        this.items.set(id, new IntuitionItem({
          id, label: `topic:${topic.label}`,
          source: "discourse", activation, probabilityEstimate: 0.7,
          possibility: { exists: true, nullGatePassed: true },
          noveltyScore: 0, compositeScore: computeComposite(0.7, 0.7, { exists: true, nullGatePassed: true }, 0),
          signal: sig, frameOrder: null, offset: null,
          text: topic.label, turn: this.turn,
        }));
      }
    }

    // 5. Evict dead items
    this._evictDead();

    // 6. Build the intuition spectrum
    this.intuition = this._buildIntuition(discourseState);
    return this.intuition;
  }

  getIntuition() {
    return this.intuition;
  }

  itemsSorted() {
    return [...this.items.values()]
      .sort((a, b) => b.compositeScore - a.compositeScore);
  }

  _evictDead() {
    for (const [id, item] of this.items) {
      if (!item.isAlive) this.items.delete(id);
    }
  }

  _buildIntuition(discourseState) {
    const sorted = this.itemsSorted();
    const spectrum = sorted.map((item) => ({
      candidate: {
        id: item.id,
        label: item.label,
        source: item.source,
        frameOrder: item.frameOrder,
        offset: item.offset,
        text: item.text ? item.text.slice(0, 200) : null,
      },
      probability: {
        estimate: +item.probabilityEstimate.toFixed(4),
        calibrated: item.source === "store",
        scoringRule: item.source === "store" ? "store_activation_log1p" : "discourse_cosine",
        proper: item.source === "store",
      },
      possibility: {
        exists: item.possibility.exists,
        gatePassed: item.possibility.nullGatePassed,
        reason: item.possibility.reason || null,
      },
      novelty: +item.noveltyScore.toFixed(4),
      compositeScore: +item.compositeScore.toFixed(4),
      reinforcements: item.reinforcements,
      lastSeen: item.lastSeen,
    }));

    return Object.freeze({
      schema: "IntuitionReport@1",
      turn: this.turn,
      totalItems: this.items.size,
      capacity: this.capacity,
      spectrum: Object.freeze(spectrum.map(s => Object.freeze(s))),
      gaps: Object.freeze(this.gaps.map(g => Object.freeze(g))),
      provenance: Object.freeze({
        memory: this.store ? { type: "hebbian_store", frames: this.store.frames?.length ?? 0 } : null,
        discourse: discourseState ? {
          turnCount: discourseState.turnCount,
          activeMotifs: discourseState.motifs?.size ?? 0,
          location: discourseState.location,
        } : null,
      }),
    });
  }
}

export { IntuitionItem };
