// multi-altitude-fold.js — One pass, five altitudes, monotone by construction.
//
// The engine's fundamental test: given a text and an entity, produce a
// coherent multi-level summary where every level is faithful and levels
// nest monotonically. Altitudes are cumulative by design — L0 spans are
// a subset of L1, L1 ⊆ L2, etc. — so monotonicity is structural, not
// aspirational.
//
// Altitudes:
//   L0: line-level — top 3 scenes, single-sentence each
//   L1: short summary — top 6 scenes
//   L2: medium summary — top 12 scenes
//   L3: detailed scene list — top 24 scenes
//   L4: dossier — all available scenes for the entity
//
// Discourse conditioning: when a DiscourseState is provided, scene scores
// are biased by location proximity (scenes near the discourse's current
// reading position rank higher) and motif activation (scenes whose text
// overlaps active motifs rank higher). The bias is proportional — a scene
// at the discourse location gets a 20% score boost; a scene whose text
// matches an active motif gets a 10% boost per match. This is the same
// exponential-decay physics as the discourse module itself.
//
// Every span carries { offset, length, text, score } — all grounded,
// all traceable, all verifiable: `offset`/`length` are corrected (via
// locateRawSpan, see text-organ.js) to the TRUE raw source span once
// resolved, `raw` is the literal source substring, `verified`/`drift`
// report whether resolution succeeded and how far the pre-fold
// approximation was off. Unresolved ⇒ `verified: false, raw: null`, a
// typed gap — never a guessed slice.

import { frameText, detectBoundaries, extractEvents, extractSurfaces, snapToSentences, locateRawSpan, TURNING_EVENT_TYPES } from "./text-organ.js";
import { classify, advisoryClassifyTerrain } from "../../cube/index.js";
import { extractRelations as extractTextRelations } from "../../perceiver/text/extraction.js";
import { admitReferent, presenceByFrame } from "../../perceiver/text/presence.js";
import { buildStore, surface as surfaceMemory, spontaneousSurface } from "../store/index.js";
import { buildKeyMomentsFromEvents, orderChronologically } from "./kernel.js";
import { significanceSpine, buildSceneMoments } from "./spine.js";
import { resonanceSpine, buildResonanceCandidates } from "./resonance-spine.js";
import { isSavoredSurprise, ConvergenceWitness } from "../../discourse/resonance.js";
import { readEntityField, selectTopFieldMoments } from "./fold-field-surfer.js";
import { createConnectionMap, updateConnectionMap } from "./index.js";

const DIACRITICAL_MAP = {
  'á':'a','é':'e','í':'i','ó':'o','ú':'u',
  'à':'a','è':'e','ì':'i','ò':'o','ù':'u',
  'â':'a','ê':'e','î':'i','ô':'o','û':'u',
  'ä':'a','ë':'e','ï':'i','ö':'o','ü':'u',
};
const diaNorm = (t) => String(t ?? "").toLowerCase().trim()
  .split("").map(c => DIACRITICAL_MAP[c] ?? c).join("");

function matchSurface(name, surfaces) {
  const n = diaNorm(name);
  const tokens = n.split(/\s+/).filter((t) => t.length > 2);
  let best = null, bestScore = -1;
  for (const s of surfaces) {
    const sn = diaNorm(s);
    const sWords = s.split(/\s+/);
    if (sWords.length === 1 && sWords[0].length <= 3) continue;
    const score = tokens.filter((t) => sn.includes(t)).length;
    if (score === 0) continue;
    const lengthPenalty = s.length / 100;
    const adjusted = score - lengthPenalty;
    if (adjusted > bestScore) { bestScore = adjusted; best = s; }
  }
  return best;
}

// Default altitude config: cumulative scene counts.
const ALTITUDE_SCENE_COUNTS = { 0: 3, 1: 6, 2: 12, 3: 24, 4: Infinity };

/**
 * multiAltitudeFold(text, entityName, options) → PacketStack
 *
 * One-pass construction of a five-altitude entity summary packet.
 * Altitudes are monotone by construction: each level's span set is a
 * prefix of the next level's, guaranteeing L0 ⊆ L1 ⊆ L2 ⊆ L3 ⊆ L4.
 *
 * Returns:
 *   altitudes: { 0: Packet, 1: Packet, 2: Packet, 3: Packet, 4: Packet }
 *   claimCount: total distinct spans
 *   entity: entity name
 *   entityCoherent: true if the entity is found in the text
 *   gaps: any admission/attribution gaps
 */
export function multiAltitudeFold(text, entityName = null, options = {}) {
  const {
    altitudes = ALTITUDE_SCENE_COUNTS,
    connectionMap = createConnectionMap(),
    focus = null,
    title = null,
    referent = null,
    aliases = null,
    narratorSpans = null,
    withEchoes = true,
    discourse = null,  // DiscourseState — biases scene ranking by location + motif
    convergenceWitness = null,  // ConvergenceWitness — tracks lens-pair convergence
    withResonance = true,  // enable resonance candidates and anandaWitness
  } = options;

  const normText = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 1. Frame text
  const allFrames = frameText(normText);
  const frames = allFrames;

  // 2. Extract surfaces + match entity name
  const allSurfaces = [...new Set(extractSurfaces(normText))];
  const targetSurface = matchSurface(entityName, allSurfaces) ?? entityName ?? "unknown";

  // 3. Referent-centric presence
  const prior = referent ?? {
    id: entityName ?? targetSurface,
    name: /^\p{Lu}/u.test(String(targetSurface).trim()) ? targetSurface : null,
    surfaces: (aliases ?? []).map((a) => ({ surface: a })),
    narratorSpans: (narratorSpans ?? []).map((sp) => ({ from: sp.from, to: sp.to })),
  };
  if (referent && !prior.name && /^\p{Lu}/u.test(String(targetSurface).trim())) {
    prior.name = targetSurface;
  }
  const admission = admitReferent(frames, prior, {
    nameSurfaces: allSurfaces,
    fullText: normText,
  });
  const presence = presenceByFrame(frames, admission.surfaces);
  const targetFrames = frames.filter((f) => (presence.get(f.order) ?? 0) > 0);
  const entityPositions = new Set(targetFrames.map((f) => f.order));

  // 4. Build per-chunk surface map for figure detection
  const perChunk = new Map();
  for (const f of frames) perChunk.set(f.order, extractSurfaces(f.text));

  // Physics-based capitalization filter
  const lowerFormCounts = new Map();
  for (const f of frames) {
    for (const tok of f.text.split(/\s+/)) {
      const m = tok.match(/^\p{Ll}[\p{L}'']*/u);
      if (m) {
        const k = m[0].toLowerCase();
        lowerFormCounts.set(k, (lowerFormCounts.get(k) ?? 0) + 1);
      }
    }
  }

  const surfaceMass = new Map();
  for (const [order, surfaces] of perChunk) for (const s of surfaces) surfaceMass.set(s, (surfaceMass.get(s) ?? 0) + 1);

  const targetNameTokenSet = new Set(diaNorm(targetSurface).split(/\s+/).filter((t) => t.length > 2));
  const figureStats = new Map();
  for (const f of targetFrames) {
    const chunkSurfaces = perChunk.get(f.order) ?? [];
    for (const s of chunkSurfaces) {
      const sn = diaNorm(s);
      if (targetNameTokenSet.has(sn)) continue;
      if (s.includes("\n")) continue;
      if (advisoryClassifyTerrain(s) === "Entity") continue;
      const words = s.split(/\s+/);
      if (words.length === 1) {
        const lower = lowerFormCounts.get(sn) ?? 0;
        const upper = surfaceMass.get(s) ?? 0;
        if (upper > 0 && lower > 0) {
          const ratio = upper / lower;
          if (ratio < 0.8 || ratio > 2.0) continue;
        }
        if (upper === 0) continue;
      }
      figureStats.set(s, (figureStats.get(s) ?? 0) + 1);
    }
  }

  const figures = [...figureStats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, count]) => ({ label, count }));

  // 5. Detect boundaries
  const boundaries = detectBoundaries(frames, { zThreshold: 1.8 });

  // 6. Extract events near the entity — get more than the max altitude needs
  const maxNeeded = Math.max(...Object.values(altitudes).filter((n) => n < Infinity));
  const events = extractEvents(frames, boundaries, [], targetSurface, {
    maxEvents: Math.max(maxNeeded, 48),
    proximityWindow: 10,
    entityPositions,
  });

  // 7. Build candidate moments from BOTH event structure AND significance spine.
  // Events provide structural turning points (narrative pivots per type).
  // The spine provides lexical-surprise peaks (per-frame significance).
  // Together they generate enough candidates for altitude differentiation.
  const maxNeededClean = Math.max(maxNeeded, 48);

  // Structural candidates: one per event type (turning points)
  const eventMoments = buildKeyMomentsFromEvents(events, targetFrames, {
    maxMoments: maxNeededClean,
    turningTypes: TURNING_EVENT_TYPES,
  });
  const structCandidates = eventMoments.map((m, i) => ({
    idx: m.idx, offset: m.offset ?? null, source: "event",
    text: m.text, context: m.text, score: (m.score ?? 0) + 100, type: m.type,
  }));

  // Lexical candidates: significance spine across ALL frames
  const spine = significanceSpine(targetFrames, {
    budget: 1200, k: Math.max(maxNeededClean, 48),
  });
  const lexCandidates = buildSceneMoments(targetFrames, spine, { contextWindow: 1 })
    .map((m) => ({
      idx: m.idx, offset: m.offset ?? null, source: "spine",
      text: snapToSentences(m.text), context: snapToSentences(m.context ?? m.text),
      score: m.score, type: m.type ?? null,
    }));

  // Merge: deduplicate by offset (within 50 chars), keep higher-scoring
  const seen = new Set();
  const merged = [];
  for (const m of [...structCandidates, ...lexCandidates].sort((a, b) => b.score - a.score)) {
    const key = m.offset != null ? Math.round(m.offset / 50) : m.idx;
    if (!seen.has(key)) { seen.add(key); merged.push(m); }
  }

  // Top up from field reader
  if (merged.length < maxNeededClean && targetFrames.length) {
    const { significantSentences } = readEntityField(normText, targetSurface, targetFrames, boundaries);
    if (significantSentences.length >= 2) {
      const added = new Set(merged.map((m) => m.offset));
      for (const s of significantSentences) {
        if (added.has(s.offset)) continue;
        added.add(s.offset);
        merged.push({
          idx: merged.length, offset: s.offset, source: "field",
          text: snapToSentences(s.text), context: snapToSentences(s.text),
          score: (s.score ?? 50) / 2, type: s.type ?? null,
        });
        if (merged.length >= maxNeededClean) break;
      }
    }
  }

  let allMoments = merged;

  // 7b. Resonance candidates: joy-informed significance (optional, low weight).
  // These enter the pool so they CAN be selected if truly significant, but at
  // ~50 weight vs events at 100+ — they don't dominate. The real joy
  // contribution is the anandaWitness post-pass below, which annotates
  // WITHOUT reordering.
  if (withResonance && discourse && discourse.motifs && discourse.motifs.size > 0) {
    const rspine = resonanceSpine(targetFrames, discourse, {
      budget: 1200, k: Math.min(maxNeededClean, 24),
    });
    const resonanceCandidates = buildResonanceCandidates(targetFrames, rspine, discourse, { contextWindow: 1 });
    for (const rc of resonanceCandidates) {
      const key = rc.offset != null ? Math.round(rc.offset / 50) : rc.idx;
      if (!seen.has(key)) {
        seen.add(key);
        allMoments.push({
          idx: rc.idx, offset: rc.offset, source: "resonance",
          text: snapToSentences(rc.text), context: snapToSentences(rc.context ?? rc.text),
          score: rc.score, // already scaled to ~0-100 in buildResonanceCandidates
          type: rc.resonanceType ?? null,
          resonanceType: rc.resonanceType,
          resonanceJoy: rc.resonanceJoy,
        });
      }
    }
  }

  // 8. Score-sort ALL moments — this is the global significance ranking
  let ranked = allMoments
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // 8b. Discourse bias: if a DiscourseState is provided, boost scenes near
  // its reading location and matching its active motifs. The bias is
  // proportional and deterministic — same physics as the discourse module.
  if (discourse && discourse.location != null && allMoments.length > 2) {
    const LOCATION_BIAS = 0.2;   // 20% boost for being at the discourse location
    const MOTIF_BIAS = 0.1;      // 10% boost per overlapping motif word

    // Collect active motif word stems from discourse
    const motifWords = new Set();
    if (discourse.motifs && discourse.motifs.size > 0) {
      for (const [id, m] of discourse.motifs) {
        if (m.activation > 0.1 && (m.source === "query" || m.source === "delta")) {
          const words = (id ?? "").toLowerCase().split(/[^a-z]+/);
          for (const w of words) if (w.length > 3) motifWords.add(w);
        }
      }
    }

    const loc = discourse.location;
    const locRadius = discourse.locationRadius ?? 50000;

    ranked = ranked.map((m) => {
      let boost = 0;

      // Location proximity: scenes within the discourse radius get a boost
      // proportional to proximity (1.0 at exact location, 0 at radius edge)
      if (m.offset != null) {
        const dist = Math.abs(m.offset - loc);
        if (dist < locRadius) {
          boost += LOCATION_BIAS * (1 - dist / locRadius);
        }
      }

      // Motif overlap: if the scene text shares words with active motifs
      if (motifWords.size > 0 && m.text) {
        const mWords = new Set(m.text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3));
        let overlap = 0;
        for (const w of motifWords) if (mWords.has(w)) overlap++;
        boost += MOTIF_BIAS * overlap;
      }

      return boost > 0 ? { ...m, score: m.score + boost } : m;
    });

    // Re-sort with discourse bias
    ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  // 8c. Raw-span provenance: resolve each moment's TRUE offset/length against
  // the source once (reused across every altitude level below — they're all
  // cumulative prefixes of this same `ranked` array). frameText's window-trim
  // and snapToSentences' whitespace collapse both decouple the approximate
  // `offset` from where `text` actually starts, so once resolved, `offset`/
  // `length` are corrected to the verified raw span (not left at the stale
  // approximation) — `drift` records how far off the approximation was.
  // Unresolvable moments keep their approximate offset/length untouched and
  // are reported as an unverified gap, never silently corrected wrong.
  ranked = ranked.map((m) => {
    if (m.offset == null || !m.text) return m;
    const resolved = locateRawSpan(normText, m.offset, m.text);
    if (!resolved.verified) return { ...m, raw: null, verified: false, drift: null };
    return { ...m, offset: resolved.offset, length: resolved.length, raw: resolved.raw, verified: true, drift: resolved.drift };
  });

  // 9. Build altitude layers — cumulative prefixes for monotonicity
  const altitudeLabels = Object.keys(altitudes).map(Number).sort((a, b) => a - b);
  const altPackets = {};

  for (const level of altitudeLabels) {
    const count = altitudes[level];
    const selected = count === Infinity ? ranked.slice() : ranked.slice(0, count);

    const spans = selected.map((m, i) => ({
      idx: i,
      offset: m.offset ?? null,
      length: m.length ?? (m.text?.length ?? 0),
      text: m.text,
      raw: m.raw ?? null,
      verified: m.verified ?? false,
      drift: m.drift ?? null,
      score: m.score ?? 0,
      entityPresent: m.offset != null && entityPositions.size > 0
        ? frames.some((f) => f.offset <= m.offset && m.offset < f.offset + (f.text?.length ?? 0) && entityPositions.has(f.order))
        : null,
    }));

    const keyMoments = selected
      .slice()
      .sort((a, b) => a.idx - b.idx)
      .map((m) => ({
        idx: m.idx,
        offset: m.offset ?? null,
        length: m.length ?? (m.text?.length ?? 0),
        type: m.type ?? null,
        text: m.text,
        context: m.context,
        raw: m.raw ?? null,
        verified: m.verified ?? false,
        drift: m.drift ?? null,
        score: m.score ?? 0,
      }));

    const groups = {
      turns: selected.map((m) => m.text),
    };

    const gaps = [...(admission.gaps ?? [])];
    if (!targetFrames.length) {
      gaps.push({ reason: "entity_not_found", entity: entityName ?? targetSurface });
    }

    altPackets[level] = Object.freeze({
      altitude: level,
      sceneCount: selected.length,
      entity: entityName ?? targetSurface,
      title: title ?? targetSurface,
      spans,
      keyMoments,
      groups,
      figures,
      gaps,
    });
  }

  // 10. Echoes — associative memory across the full text, attached to L4
  if (withEchoes && frames.length > 2) {
    const memory = buildStore(frames);
    const byOrder = new Map(frames.map((f) => [f.order, f]));
    const frameFor = (off) => {
      let best = null;
      for (const f of frames) { if (f.offset <= off) best = f; else break; }
      return best;
    };
    const MIN_DISTANCE = 5;

    const allSpans = altPackets[Math.max(...altitudeLabels)]?.spans ?? [];
    for (const s of allSpans) {
      if (s.offset == null) continue;
      const f = frameFor(s.offset);
      if (!f) continue;
      const recalled = surfaceMemory(memory, f.text, { selfOrder: f.order, cueOrder: f.order })
        .filter((r) => r.order < f.order - MIN_DISTANCE && byOrder.has(r.order));
      if (!recalled.length) continue;
      const top = recalled[0].activation;
      s.echoes = recalled
        .filter((r) => r.activation >= 0.5 * top)
        .slice(0, 2)
        .map((r) => ({
          offset: byOrder.get(r.order).offset,
          activation: +r.activation.toFixed(3),
        }));
    }
  }

  // 11. Ananda (joy) witness — post-pass over ALL selected spans.
  // Joy annotates, never gates. Each span gets an `ananda` field that records
  // what the reader-discourse system experienced at this passage, AFTER
  // selection. This is the architecture the essay demands: Ananda cannot be
  // maximized; it can only be made possible and then witnessed.
  //
  // Four witness dimensions:
  //   - savored_surprise: high spine score + active motif alignment (delightful twist)
  //   - resonance_events: discourse resonance events at nearby offsets
  //   - convergences: independent lens convergences (if convergenceWitness provided)
  //   - spontaneous_connections: surplus store connections (play)
  if (withResonance && frames.length > 2) {
    const anandaMemory = buildStore(frames);
    const anandaByOrder = new Map(frames.map((f) => [f.order, f]));
    const anandaFrameFor = (off) => {
      let best = null;
      for (const f of frames) { if (f.offset <= off) best = f; else break; }
      return best;
    };

    // Surplus connections: the store's strongest patterns, surfaced for free
    const surplusConns = withResonance ? spontaneousSurface(anandaMemory, { count: 20, minStrength: 0.4 }) : [];
    const surplusByOrder = new Map();
    for (const sc of surplusConns) {
      const entries = surplusByOrder.get(sc.order) ?? [];
      entries.push(sc);
      surplusByOrder.set(sc.order, entries);
    }

    for (const level of altitudeLabels) {
      const pkt = altPackets[level];
      const spans = pkt.spans;

      for (const span of spans) {
        const ananda = {};

        // Savored surprise: high lexical surprise that aligns with active motifs
        if (discourse && discourse.motifs && discourse.motifs.size > 0 && span.text && span.score > 0) {
          // Look up spine score if available
          const pos = ranked.findIndex((r) => r.offset === span.offset);
          const spineScore = pos >= 0 ? (ranked[pos].score ?? 0) : span.score;
          const savored = isSavoredSurprise(spineScore, span.text, discourse.motifs);
          if (savored.savored) {
            ananda.savored_surprise = { reason: savored.reason };
          }
        }

        // Resonance events: discourse events near this passage
        if (discourse && discourse.resonanceEvents && discourse.resonanceEvents.length > 0) {
          const nearby = discourse.resonanceEvents.filter((e) => {
            if (e.passage_offset == null || span.offset == null) return false;
            return Math.abs(e.passage_offset - span.offset) < 1000;
          });
          if (nearby.length > 0) {
            ananda.joy_events = nearby.slice(0, 3).map((e) => ({
              type: e.type,
              joy_score: e.joy_score,
              motif_id: e.motif_id,
            }));
          }
        }

        // Convergence witness: independent lenses agreeing at this passage
        if (convergenceWitness && convergenceWitness.events.length > 0) {
          const converged = convergenceWitness.events.filter((e) => {
            if (e.passage_offset == null || span.offset == null) return false;
            return Math.abs(e.passage_offset - span.offset) < 1000;
          });
          if (converged.length > 0) {
            ananda.convergences = converged.map((e) => ({
              lenses: e.lenses,
              similarity: e.similarity,
            }));
          }
        }

        // Spontaneous connections: surplus store play at this passage
        const f = anandaFrameFor(span.offset);
        if (f) {
          const conns = surplusByOrder.get(f.order);
          if (conns && conns.length > 0) {
            ananda.spontaneous_connections = conns.slice(0, 3).map((c) => ({
              linked_by: c.linkedBy,
              strength: c.strength,
            }));
          }
        }

        // Only set ananda if there's something to witness
        if (Object.keys(ananda).length > 0) {
          span.ananda = Object.freeze(ananda);
        }
      }
    }
  }

  updateConnectionMap(connectionMap, { relations: [], properties: [] });

  const claimCount = altPackets[Math.max(...altitudeLabels)]?.spans?.length ?? 0;

  return Object.freeze({
    altitudes: altPackets,
    claimCount,
    entity: entityName ?? targetSurface,
    entityCoherent: targetFrames.length > 0,
    gaps: admission.gaps ?? [],
  });
}
