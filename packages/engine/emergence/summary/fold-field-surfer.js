// fold-field-surfer.js — Entity-specific attention field with delta-driven holons.
//
// A holon is a NAMELESS position in fold space. It exists in the entity's
// attention field. Two ways to exist:
//   1. RAW SPAN — created from a text surface the perceiver found
//   2. READING-CREATED — created by the delta between predicted and actual
//
// The arrow of time: at sentence T, the entity's attention is distributed
// across the holon field as an ACTIVATION VECTOR. Each holon has a
// similarity-to-actual score. The entity's attention IS this distribution.
//
// A new holon is born when the delta between predicted (from past) and
// actual (at T) exceeds threshold, AND no existing holon in the field
// has its fold near the observed fold. The holon's fold is the ACTUAL
// fold — what the entity experienced.
//
// The activation of each holon is:
//   activation(H) = ampDist(actualFold, H.fold)
// Higher activation = the entity is "thinking about" H right now.
//
// Span selection: a sentence is significant when:
//   - A new holon was born (high surprise delta)
//   - An existing holon's activation spiked (entity suddenly attended to it)
//   - A holon climbed the ontological ladder (its terrain changed)

import { fold } from "../../quantum/index.js";

const TERRAIN_LADDER = [
  "Void", "Entity", "Kind", "Field", "Link",
  "Network", "Atmosphere", "Lens", "Paradigm",
];
const TERRAIN_RUNG = new Map(TERRAIN_LADDER.map((t, i) => [t, i]));

function dominantFace(amps) {
  let best = null, bestV = -1;
  for (const [k, v] of Object.entries(amps ?? {})) if (v > bestV) { bestV = v; best = k; }
  return best;
}

function terrainRung(ter) { return TERRAIN_RUNG.get(ter) ?? -1; }

function ampDist(a, b) {
  let dot = 0, na = 0, nb = 0;
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const va = a?.[k] ?? 0, vb = b?.[k] ?? 0;
    dot += va * vb; na += va * va; nb += vb * vb;
  }
  return 1 - (dot / (Math.sqrt(na * nb) || 1));
}

function faceOf(a) {
  return {
    operator: dominantFace(a?.operator) ?? "SIG",
    terrain: dominantFace(a?.terrain) ?? "Field",
    stance: dominantFace(a?.stance) ?? "Tracing",
  };
}

function rungOf(a) { return terrainRung(dominantFace(a?.terrain)); }

// ── Nameless Holon ───────────────────────────────────────────────────────────

let nextHolonId = 0;

class Holon {
  constructor(foldObj, birthOffset, sceneId) {
    this.id = nextHolonId++;
    this.birth = birthOffset;
    this.lastActivation = birthOffset;
    this.activationCount = 1;
    this.scene = sceneId;
    this.scenesSeen = new Set([sceneId]);

    this.fold = foldObj;
    this.signature = faceOf(foldObj);
    this.rung = rungOf(foldObj);
    this.trajectory = [{ offset: birthOffset, rung: this.rung, terrain: this.signature.terrain }];
  }

  // Update when reactivated
  reactivate(foldObj, offset, sceneId) {
    this.lastActivation = offset;
    this.activationCount++;
    this.scenesSeen.add(sceneId);
    this.fold = foldObj;
    const newSig = faceOf(foldObj);
    const newRung = rungOf(foldObj);
    if (newRung !== this.rung) {
      this.trajectory.push({ offset, rung: newRung, terrain: newSig.terrain, scene: sceneId });
      this.rung = newRung;
      this.signature = newSig;
    }
  }

  get totalClimb() {
    if (this.trajectory.length < 2) return 0;
    return this.trajectory[this.trajectory.length - 1].rung - this.trajectory[0].rung;
  }

  get mostRecentClimb() {
    if (this.trajectory.length < 2) return null;
    const a = this.trajectory[this.trajectory.length - 1];
    const b = this.trajectory[this.trajectory.length - 2];
    return a.rung !== b.rung ? { from: b.terrain, to: a.terrain, delta: a.rung - b.rung } : null;
  }
}

// ── Entity-specific attention field ──────────────────────────────────────────

export class AttentionField {
  constructor(entityId) {
    this.entityId = entityId;
    this.holons = new Map();
    this.history = [];
    this.currentScene = 0;
  }

  setScene(sceneId) { this.currentScene = sceneId; }

  // Predicted fold = centroid of all holons, weighted by activation count
  // and recency. A holon the entity has attended to many times recently
  // dominates the prediction.
  predictedFold(currentOffset) {
    if (this.holons.size === 0) return null;

    const op = {}, te = {}, st = {};
    let totalW = 0;

    for (const h of this.holons.values()) {
      const recency = Math.max(0, 1 - (currentOffset - h.lastActivation) / 300000);
      const w = h.activationCount * recency;
      if (w <= 0) continue;
      for (const [k, v] of Object.entries(h.fold.operator ?? {})) op[k] = (op[k] ?? 0) + v * w;
      for (const [k, v] of Object.entries(h.fold.terrain ?? {})) te[k] = (te[k] ?? 0) + v * w;
      for (const [k, v] of Object.entries(h.fold.stance ?? {})) st[k] = (st[k] ?? 0) + v * w;
      totalW += w;
    }
    if (totalW <= 0) return null;

    for (const face of [op, te, st]) {
      let ss = 0;
      for (const v of Object.values(face)) ss += v * v;
      if (ss > 0) { const n = Math.sqrt(ss); for (const k of Object.keys(face)) face[k] /= n; }
    }
    return { operator: op, terrain: te, stance: st };
  }

  /**
   * Compute the ACTIVATION VECTOR: for each holon, how similar is the
   * actual fold to that holon's fold? Returns Map<id, activationStrength>
   * where higher = more activated.
   */
  activationVector(actualFold) {
    const acts = new Map();
    for (const [id, h] of this.holons) {
      const d = ampDist(actualFold.operator, h.fold.operator) +
                ampDist(actualFold.terrain, h.fold.terrain) +
                ampDist(actualFold.stance, h.fold.stance);
      acts.set(id, 1 - (d / 3));
    }
    return acts;
  }

  /**
   * Process a sentence in the entity's presence.
   *
   * 1. Compute the predicted fold from past holons (arrow of time: past→future)
   * 2. Compute the delta = ampDist(actual, predicted)
   * 3. Compute activation vector = similarity of actual to each holon
   * 4. If delta > threshold AND no existing holon has activation > 0.7:
   *    → A NEW holon is born (the entity encountered something new)
   * 5. Otherwise: reinforce the most-activated holon
   *
   * Returns { delta, activationVector, newHolon, reinforcedHolon, climbed }
   */
  processSentence(actualFold, offset, threshold = 0.8) {
    const predicted = this.predictedFold(offset);
    let delta = 0;
    if (predicted) {
      delta = ampDist(actualFold.operator, predicted.operator) +
              ampDist(actualFold.terrain, predicted.terrain) +
              ampDist(actualFold.stance, predicted.stance);
    }

    // Activation vector: how much is the entity "thinking about" each holon?
    const activation = this.activationVector(actualFold);

    // Find the most activated holon (if any)
    let maxAct = 0, maxHolon = null;
    for (const [id, act] of activation) {
      if (act > maxAct) { maxAct = act; maxHolon = this.holons.get(id); }
    }

    let newHolon = null;
    let reinforced = null;
    let climbed = null;

    if (predicted && delta > threshold && (!maxHolon || maxAct < 0.7)) {
      // High delta AND no existing holon is strongly activated:
      // Something genuinely new — birth a holon
      const h = new Holon(actualFold, offset, this.currentScene);
      this.holons.set(h.id, h);
      newHolon = h;
      this.history.push({
        type: "birth", offset, id: h.id,
        sig: h.signature, rung: h.rung, delta: delta.toFixed(3),
      });
    } else if (maxHolon) {
      // Reinforce the most-activated holon
      const prevRung = maxHolon.rung;
      maxHolon.reactivate(actualFold, offset, this.currentScene);
      reinforced = maxHolon;
      if (maxHolon.rung !== prevRung) {
        climbed = maxHolon;
        this.history.push({
          type: "climb", offset, id: maxHolon.id,
          from: faceOf({ terrain: { [prevRung === 0 ? "Void" : TERRAIN_LADDER[prevRung] || "Void"]: 1 } }).terrain,
          to: maxHolon.signature.terrain,
          delta: maxHolon.rung - prevRung,
        });
      }
    }

    return { delta, activation, newHolon, reinforcedHolon: reinforced, climbedHolon: climbed };
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build an entity-specific attention field by reading the full text.
 * Each sentence is folded against accumulating textual priors. The delta
 * between the predicted fold (from the entity's past) and the actual fold
 * generates new holons or reinforces existing ones.
 *
 * Holons are NAMELESS — they have no surface string. They exist only as
 * positions in fold space, activated by the entity's attention.
 */
export function readEntityField(fullText, entityName, targetFrames, sceneBoundaries = null) {
  const text = String(fullText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Sentence splitting
  const sentences = [];
  const splitter = /(?<=[.!?])\s+(?=["'""''«»]?\p{Lu})/gu;
  let lastEnd = 0, match;
  while ((match = splitter.exec(text)) !== null) {
    const raw = text.slice(lastEnd, match.index + 1).trim();
    if (raw.length > 10) sentences.push({ idx: sentences.length, offset: lastEnd, text: raw });
    lastEnd = match.index + 1;
  }
  const tail = text.slice(lastEnd).trim();
  if (tail.length > 10) sentences.push({ idx: sentences.length, offset: lastEnd, text: tail });

  // Frame ranges for entity presence filtering
  const frameRanges = targetFrames.map((f) => ({
    min: f.offset - 50,
    max: f.offset + f.text.length + 50,
  }));

  // Entity-specific attention field
  const field = new AttentionField(entityName);

  // Scene boundary mapping: each sentence belongs to a scene (contiguous block
  // separated by topic shifts). Scene boundaries provide the temporal container
  // for holon persistence — a holon that survives across scenes is structurally
  // significant, not just a within-scene noise fluctuation.
  const sceneBreaks = (sceneBoundaries ?? []).map((b) => b.offset).sort((a, b) => a - b);
  function sceneForOffset(offset) {
    let s = 0;
    for (const br of sceneBreaks) { if (offset >= br) s++; else break; }
    return s;
  }
  if (sceneBreaks.length > 0) field.setScene(sceneForOffset(sentences[0]?.offset ?? 0));

  // Accumulating textual priors (the reader never comes blind)
  const textualPriors = { termFreq: new Map(), entities: new Set() };

  const significant = [];

  for (const s of sentences) {
    // Update the field's scene context
    if (sceneBreaks.length > 0) {
      const sc = sceneForOffset(s.offset);
      if (sc !== field.currentScene) field.setScene(sc);
    }
    const sf = fold(s.text, textualPriors);
    s.conditionalFold = sf;

    // Update textual priors
    const words = s.text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    for (const w of words) textualPriors.termFreq.set(w, (textualPriors.termFreq.get(w) ?? 0) + 1);

    // Entity-present?
    const isPresent = frameRanges.some((r) => s.offset >= r.min && s.offset < r.max);
    if (!isPresent) continue;

    // Process against the attention field (arrow of time: prediction uses
    // only holons created from PAST sentences, never from future)
    const result = field.processSentence(sf, s.offset);

    // Compute significance: birth + climb + delta + activation sparsity
    let score = 0;
    if (result.newHolon) {
      // Birth at a high ontological rung = more significant
      score += 25 + result.newHolon.rung * 3;
    }
    if (result.climbedHolon) {
      const c = result.climbedHolon.mostRecentClimb;
      if (c) score += Math.abs(c.delta) * 10;
    }
    score += result.delta * 8;

    // Activation sparsity: if one holon dominates activation, the entity
    // is FOCUSED. If activation is spread, the entity is DISTRACTED.
    // Focused attention on a single holon is more significant
    // (the entity is deeply engaged with one thing).
    const acts = [...(result.activation?.values() ?? [])];
    if (acts.length > 1) {
      const maxAct = Math.max(...acts);
      const meanAct = acts.reduce((s, a) => s + a, 0) / acts.length;
      const sparsity = meanAct > 0 ? maxAct / meanAct : 0;
      score += sparsity * 5;
    }

    if (score > 0) {
      significant.push({
        idx: s.idx, offset: s.offset, text: s.text, score,
        delta: result.delta,
        holonCount: field.holons.size,
        newHolon: result.newHolon?.id ?? null,
        climbedHolon: result.climbedHolon?.id ?? null,
        nActivated: acts.filter((a) => a > 0.5).length,
      });
    }
  }

  return { field, significantSentences: significant };
}

/**
 * Select top-K span moments from the significant sentences.
 */
export function selectTopFieldMoments(
  significantSentences, sceneMoments, sceneCount
) {
  if (!significantSentences.length) return;

  const near = (a, b) => a != null && b != null && Math.abs(a - b) < 2000;
  const slotsNeeded = sceneCount - sceneMoments.length;
  if (slotsNeeded <= 0) return;

  const candidates = significantSentences
    .filter((s) => s.score > 5)
    .filter((m) => !sceneMoments.some((s) => near(s.offset, m.offset)));

  if (!candidates.length) return;

  const lo = candidates[0].offset;
  const hi = candidates[candidates.length - 1].offset + 1;
  const span = hi - lo || 1;
  const slots = Math.min(slotsNeeded, candidates.length);
  if (slots <= 0) return;

  const strata = Array.from({ length: slots }, () => []);
  for (const m of candidates) {
    const s = Math.max(0, Math.min(slots - 1, Math.floor(((m.offset - lo) / span) * slots)));
    strata[s].push(m);
  }

  const picked = strata
    .map((bucket) => bucket.sort((a, b) => b.score - a.score)[0])
    .filter(Boolean);

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  for (const m of sorted) {
    if (picked.length >= slots) break;
    if (!picked.some((p) => near(p.offset, m.offset))) picked.push(m);
  }

  for (const m of picked.slice(0, slots)) {
    sceneMoments.push(m);
  }
  sceneMoments.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
}
