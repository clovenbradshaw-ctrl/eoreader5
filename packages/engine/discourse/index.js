// discourse/index.js — DiscourseState with Born-rule motif activation and pronoun channelling.
//
// Motif activation is SIGNAL-DRIVEN (Born rule), not time-driven:
//   activation = cosineSimilarity(querySignal, motif.signal)
//   computed each turn from the query's char-n-gram signal vector.
//   A motif that matches the current query has high activation; one
//   that doesn't match naturally fades. No hardcoded τ constant.
//
//   Referents still use exponential decay (identity persistence is
//   different from motif salience). Pronouns channel activation to
//   the most active referent, keeping it alive without re-naming.
//
//   PRONOUN CHANNELLING — "she", "her", "he", "him", "they", "them"
//     in the query text activate the current most-active referent.
//     Same weight (0.5) as first-person surfaces in presence.js.
//
//   DECOHERENCE — a referent that hasn't been mentioned for τ turns
//     falls below threshold and is evicted. But pronouns can pull it
//     back above threshold — the "old friend" effect.

import { extractTextFieldVectors, cosineSimilarity } from "../perceiver/text/text-signal.js";
import { createReaderOrientation } from "../motivation/index.js";
import { detectResonanceEvents, resonanceSummary, computeResonanceScore, mintResonanceEvent } from "./resonance.js";

export { resonanceSummary, computeResonanceScore, mintResonanceEvent };

// ── Physics constants ─────────────────────────────────────────────────────────
// Match the form of quantum/index.js constants

const DISCOURSE_TAU = 5;         // turns to decay to 1/e (~37%)
const PRONOUN_SURFACES = new Set([
  "she", "her", "hers", "herself",
  "he", "him", "his", "himself",
  "they", "them", "their", "theirs", "themselves",
  "it", "its", "itself",
]);
const PRONOUN_WEIGHT = 0.5;      // match presence.js FIRST_PERSON_WEIGHT

const MAX_MOTIFS = 25;
const MAX_TOPICS = 5;
const PROMOTION_THRESHOLD = 0.6;
const EVICTION_THRESHOLD = 0.05;
const TOPIC_NOISE_FLOOR = EVICTION_THRESHOLD * 2;
// Recency horizon for capacity eviction, in turns. A few multiples of
// DISCOURSE_TAU: past this, a motif counts as fully stale for ranking.
const MOTIF_RECENCY_TURNS = DISCOURSE_TAU * 4;

// ── Motif ────────────────────────────────────────────────────────────────────

// `turn` is the discourse's LOGICAL clock, not a wall-clock timestamp. The
// engine has no clock — the same rule that makes `ts`/`seq` host-supplied on
// the reaction channel — and this module's physics were already turn-based
// everywhere else (DISCOURSE_TAU is in turns, decay() takes turns). Wall-clock
// was the wrong quantity on its own terms too: in a turn-based model a
// conversation left idle for five minutes should not decay differently from
// one answered immediately.
class Motif {
  constructor(id, fold, activation, source, turn = 0, signal = null) {
    this.id = id;
    this.fold = fold;
    this.activation = activation;
    this.source = source;
    this.signal = signal;
    this.firstSeen = turn;
    this.lastSeen = turn;
    this.reinforcements = 1;
    this.face = dominantFace(fold?.terrain ?? {});
    this.rung = terrainRung(this.face);
  }

  // Boosts activation, capped at 1.0
  boost(amount, turn) {
    this.activation = Math.min(1, this.activation + amount);
    if (turn !== undefined) this.lastSeen = turn;
    this.reinforcements++;
  }

  get isAlive() { return this.activation > EVICTION_THRESHOLD; }
}

// ── Discourse State ──────────────────────────────────────────────────────────

export class DiscourseState {
  constructor({ orientation } = {}) {
    this.motifs = new Map();
    this.referents = new Map();
    this.topicStack = [];
    this.commitments = [];
    this.turnIntent = null;
    this.turnCount = 0;

    // Location (corpus offset) — decays like motifs
    this.location = null;
    this.locationActivation = 0;

    this.birthTurn = 0;
    this.totalMotifsCreated = 0;

    // Reader motivation — how this reader's observed behaviour biases
    // every organ downstream. Defaults to neutral; can be overwritten
    // from a reaction log via readerOrientationFromLog().
    this.orientation = orientation ?? createReaderOrientation();

    // Ananda (joy): resonance events — append-only log of qualitative
    // state changes in the reader-discourse system. Each event captures
    // a moment where expectation met reality in a reader-meaningful way.
    this.resonanceEvents = [];
  }

  // ── Core update ────────────────────────────────────────────────────────────

  update(sentenceFold, delta, newHolons, intent, results, queryText, passageOffset = null) {
    this.turnCount++;
    this.turnIntent = intent;

    // 0. Save pre-update motif state for resonance detection
    for (const [, m] of this.motifs) {
      m._prevActivation = m.activation;
    }

    // 1. Born rule: compute query signal, then set each motif's activation
    //    to cosineSimilarity(querySignal, motif.signal). No time constant.
    //    A motif that matches the current query is active; one that doesn't
    //    naturally fades. Fallback: gentle exponential decay when no query.
    let querySignal = null;
    if (queryText) {
      const qSig = extractTextFieldVectors(queryText);
      querySignal = qSig.frames[0]?.field ?? null;
    }
    if (querySignal) {
      for (const m of this.motifs.values()) {
        if (m.signal) {
          m.activation = cosineSimilarity(querySignal, m.signal);
        }
        // Motifs without a signal vector retain their current activation
      }
    } else {
      for (const m of this.motifs.values()) {
        m.activation *= Math.exp(-1 / DISCOURSE_TAU);
      }
    }
    if (this.locationActivation > 0) {
      this.locationActivation *= Math.exp(-1 / DISCOURSE_TAU);
    }

    // 2. Pronoun channelling: if the query uses pronouns, boost the
    //    most active referent. "She" keeps Natasha alive even when
    //    the query doesn't name her.
    if (queryText) {
      const queryLower = queryText.toLowerCase();
      const words = queryLower.split(/\s+/);
      const hasPronoun = words.some((w) => PRONOUN_SURFACES.has(w));
      if (hasPronoun) {
        // Find the most active referent
        let bestRef = null, bestAct = 0;
        for (const [id, ref] of this.referents) {
          if (ref.activation > bestAct) { bestAct = ref.activation; bestRef = ref; }
        }
        if (bestRef) {
          bestRef.activation = Math.min(1, bestRef.activation + PRONOUN_WEIGHT);
          // Also boost the corresponding motif (deliberate override of Born rule)
          for (const m of this.motifs.values()) {
            if (m.source === "referent" && m.id === bestRef.id) {
              m.boost(PRONOUN_WEIGHT, this.turnCount);
            }
          }
        }
      }
    }

    // 3. Push new motifs from delta (surprise)
    if (delta > 0.3) {
      const deltaText = results?.[0]?.text ?? "";
      const deltaSignal = deltaText ? (extractTextFieldVectors(deltaText).frames[0]?.field ?? null) : null;
      this._pushMotif(new Motif(`motif:δ:${this.turnCount}`, sentenceFold, Math.min(1, delta), "delta", this.turnCount, deltaSignal));
    }

    // 4. Push motifs from new holons
    if (newHolons) {
      for (const h of Array.isArray(newHolons) ? newHolons : [newHolons]) {
        if (h?.fold) {
          let hSignal = null;
          if (h.text) {
            const hSig = extractTextFieldVectors(h.text);
            hSignal = hSig.frames[0]?.field ?? null;
          }
          this._pushMotif(new Motif(`motif:holon:${h.id ?? this.turnCount}`, h.fold, 0.8, "delta", this.turnCount, hSignal));
        }
      }
    }

    // 5. Update location
    if (results?.length > 0 && results[0].score > 0.1) {
      const best = results[0];
      if (this.location == null) {
        this.location = best.offset;
        this.locationActivation = best.score;
      } else {
        const weight = best.score * 0.3;
        this.location = Math.round(this.location * (1 - weight) + best.offset * weight);
        this.locationActivation = Math.min(1, this.locationActivation + best.score * 0.1);
      }
    }

    // 6. Evict dead motifs, promote to referents
    this._evictDead();
    this._promoteToReferents();

    // 7. Track saturation turns for each motif (feeds resonance detection)
    for (const [, m] of this.motifs) {
      if (m.activation > 0.85) {
        m._saturationTurns = (m._saturationTurns ?? 0) + 1;
      } else {
        m._saturationTurns = 0;
      }
    }

    // 8. Detect resonance events — qualitative joy state changes
    //    Clears _justFulfilled flags after detection.
    try {
      const newEvents = detectResonanceEvents(this, passageOffset);
      if (newEvents.length > 0) {
        this.resonanceEvents.push(...newEvents);
      }
    } finally {
      for (const c of this.commitments) {
        c._justFulfilled = false;
      }
    }
  }

  // ── Context for query conditioning ─────────────────────────────────────────

  getContext() {
    const active = [...this.motifs.values()].filter((m) => m.activation > 0.1);
    if (active.length === 0 && !this.location) return null;

    const op = {}, te = {}, st = {};
    let totalW = 0;

    for (const m of active) {
      const w = m.activation * m.activation;
      for (const [k, v] of Object.entries(m.fold?.operator ?? {})) op[k] = (op[k] ?? 0) + v * w;
      for (const [k, v] of Object.entries(m.fold?.terrain ?? {})) te[k] = (te[k] ?? 0) + v * w;
      for (const [k, v] of Object.entries(m.fold?.stance ?? {})) st[k] = (st[k] ?? 0) + v * w;
      totalW += w;
    }

    for (const face of [op, te, st]) {
      let ss = 0;
      for (const v of Object.values(face)) ss += v * v;
      if (ss > 0) { const n = Math.sqrt(ss); for (const k of Object.keys(face)) face[k] /= n; }
    }

    return {
      contextFold: Object.keys(op).length ? { operator: op, terrain: te, stance: st } : null,
      nActive: active.length,
      topMotifs: active.sort((a, b) => b.activation - a.activation).slice(0, 5).map((m) => ({
        id: m.id, activation: m.activation.toFixed(3), face: m.face, rung: m.rung,
      })),
      location: this.locationActivation > 0.2 ? this.location : null,
      locationRadius: 50000,
    };
  }

  // ── Topic management ───────────────────────────────────────────────────────

  // ── Born rule: a topic stays on the stack only while its signal beats noise.
  //    Each topic's motif activation is recomputed every turn (cosineSim against
  //    the query signal) — the same Born-rule physics as every other motif. A
  //    topic whose activation has fallen below the noise floor is the past not
  //    relevant against noise: it is pruned. When ALL past topics are noise, the
  //    stack stops — cleared so it can start fresh from the current turn.
  pushTopic(label, fold) {
    this._pruneNoise();
    if (this.topicStack.length >= MAX_TOPICS) this.topicStack.shift();
    const signal = extractTextFieldVectors(label).frames[0]?.field ?? null;
    const motif = new Motif(`topic:${label}`, fold, 1.0, "query", this.turnCount, signal);
    this.topicStack.push({ label, fold, opened: this.turnCount, motif });
    this._pushMotif(motif);
  }

  popTopic() {
    const t = this.topicStack.pop();
    if (t) { t.motif.activation = 0; this._evictDead(); }
    return t?.label ?? null;
  }

  // ── Commitments ────────────────────────────────────────────────────────────

  addCommitment(type, description, deadline) {
    this.commitments.push({ type, description, created: this.turnCount, deadline, status: "open" });
  }

  fulfillCommitment(description) {
    for (const c of this.commitments) {
      if (c.status === "open" && c.description.includes(description)) {
        c.status = "fulfilled";
        c._justFulfilled = true;
        return true;
      }
    }
    return false;
  }

  get openCommitments() { return this.commitments.filter((c) => c.status === "open"); }

  // ── Summary ────────────────────────────────────────────────────────────────

  summary() {
    return {
      turnCount: this.turnCount,
      turnIntent: this.turnIntent,
      motifsActive: [...this.motifs.values()].filter((m) => m.activation > 0.1).length,
      totalMotifs: this.motifs.size,
      referents: this.referents.size,
      topicStack: this.topicStack.map((t) => t.label),
      location: this.location,
      locationActivation: this.locationActivation.toFixed(3),
      topMotifs: [...this.motifs.values()]
        .sort((a, b) => b.activation - a.activation)
        .slice(0, 5)
        .map((m) => ({ id: m.id, act: m.activation.toFixed(3), face: m.face, rung: m.rung })),
      orientation: {
        drive: this.orientation.drive,
        tierDemand: this.orientation.tierDemand,
        evidence: this.orientation.evidence,
      },
    };
  }

  // ── Resonance (joy) profile ────────────────────────────────────────────────

  /**
   * getResonanceProfile() -> resonance summary
   *
   * The reader's joy profile from this discourse session: how many
   * resonance events, what type dominates, the peak joy moment.
   */
  getResonanceProfile() {
    return resonanceSummary(this);
  }

  /**
   * activeResonanceJoy() -> number
   *
   * The current joy level (weighted average of recent resonance events).
   * Decays like motif activation — recent joy fades.
   */
  activeResonanceJoy() {
    const events = this.resonanceEvents;
    if (!events.length) return 0;

    let totalWeight = 0;
    let weightedJoy = 0;
    for (const e of events) {
      const age = this.turnCount - e.turn;
      const weight = Math.exp(-age / DISCOURSE_TAU);
      weightedJoy += e.joy_score * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? weightedJoy / totalWeight : 0;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _pushMotif(motif) {
    // Merge if same face/rung exists
    for (const [, existing] of this.motifs) {
      if (existing.face === motif.face && existing.rung === motif.rung) {
        existing.boost(motif.activation, this.turnCount);
        return;
      }
    }
    // Evict weakest if at capacity
    if (this.motifs.size >= MAX_MOTIFS) {
      let worst = null, worstScore = Infinity;
      for (const [id, m] of this.motifs) {
        // Recency in TURNS over the same horizon the decay uses, clamped so a
        // long-idle motif scores 0 rather than going negative and out-ranking
        // an active one. This was a wall-clock elapsed-milliseconds term over a
        // 60-second window, in a module whose every other constant is turns.
        const age = Math.min(1, (this.turnCount - m.lastSeen) / MOTIF_RECENCY_TURNS);
        const score = m.activation * (1 - age);
        if (score < worstScore) { worstScore = score; worst = id; }
      }
      if (worst) this.motifs.delete(worst);
    }
    this.motifs.set(motif.id, motif);
    this.totalMotifsCreated++;
  }

  _evictDead() {
    for (const [id, m] of this.motifs) {
      if (!m.isAlive) this.motifs.delete(id);
    }
  }

  // Born-rule gate: prune every topic whose signal (motif activation) has
  // fallen below the noise floor — the past is not relevant against noise.
  // When ALL topics are noise, the whole stack is cleared (the stack stops).
  _pruneNoise() {
    const before = this.topicStack.length;
    this.topicStack = this.topicStack.filter((t) => t.motif?.activation > TOPIC_NOISE_FLOOR);
    // If silent pruning removed every topic, the past was all noise — the
    // stack stops, giving the current turn a clean slate. The motifs below
    // noise are killed so _evictDead will collect them on the next pass.
    if (before > 0 && this.topicStack.length === 0) {
      for (const [, m] of this.motifs) {
        if (m.source === "query" && m.activation <= TOPIC_NOISE_FLOOR) m.activation = 0;
      }
    }
  }

  _promoteToReferents() {
    for (const [id, m] of this.motifs) {
      if (m.activation > PROMOTION_THRESHOLD && !this.referents.has(id)) {
        this.referents.set(id, {
          surfaces: [m.id], fold: m.fold, activation: m.activation, promoted: this.turnCount,
        });
      }
    }
    // Decay existing referent activations
    for (const ref of this.referents.values()) {
      ref.activation *= Math.exp(-1 / DISCOURSE_TAU);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dominantFace(amps) {
  if (!amps) return "Void";
  let best = null, bestV = -1;
  for (const [k, v] of Object.entries(amps)) if (v > bestV) { bestV = v; best = k; }
  return best ?? "Void";
}

function terrainRung(ter) {
  const ladder = ["Void","Entity","Kind","Field","Link","Network","Atmosphere","Lens","Paradigm"];
  const i = ladder.indexOf(ter ?? "");
  return i >= 0 ? i : -1;
}
