// entity-fold.js — Entity fold orchestrator.
//
// Wires the perceiver (capitalized surface extraction) to the engine
// (signal boundaries, events, figures). The perceiver finds surfaces,
// the engine finds structure. No regex, no string normalization,
// no entity-kinds clustering (that's a separate pipeline).

import {
  createConnectionMap,
  updateConnectionMap,
} from "./index.js";
import { significanceSpine, buildSceneMoments } from "./spine.js";
import {
  buildKeyMomentsFromEvents,
  orderChronologically,
  buildEntityPacket,
} from "./kernel.js";
import {
  frameText,
  detectBoundaries,
  extractEvents,
  extractSurfaces,
  snapToSentences,
  locateRawSpan,
  TURNING_EVENT_TYPES,
} from "./text-organ.js";
import { classify, advisoryClassifyTerrain } from "../../cube/index.js";
import { extractRelations as extractTextRelations } from "../../perceiver/text/extraction.js";
import { admitReferent, presenceByFrame } from "../../perceiver/text/presence.js";
import { buildStore, surface as surfaceMemory } from "../store/index.js";
import { readEntityField, selectTopFieldMoments } from "./fold-field-surfer.js";

// Diacritical mapping for engine-level entity name matching.
// NOT signal-path normalization — this is the engine discovering
// that "Natásha" and "Natasha" refer to the same entity.
const DIACRITICAL_MAP = {
  'á':'a','é':'e','í':'i','ó':'o','ú':'u',
  'à':'a','è':'e','ì':'i','ò':'o','ù':'u',
  'â':'a','ê':'e','î':'i','ô':'o','û':'u',
  'ä':'a','ë':'e','ï':'i','ö':'o','ü':'u',
};
function diaNorm(text) {
  return String(text ?? "").toLowerCase().trim()
    .split("").map(c => DIACRITICAL_MAP[c] ?? c).join("");
}

function norm(text) {
  return String(text ?? "").toLowerCase().trim();
}

function matchSurface(name, surfaces) {
  const n = diaNorm(name);
  const tokens = n.split(/\s+/).filter((t) => t.length > 2);
  let best = null, bestScore = -1;
  for (const s of surfaces) {
    const sn = diaNorm(s);
    // Skip single short words (sentence-start probable)
    const sWords = s.split(/\s+/);
    if (sWords.length === 1 && sWords[0].length <= 3) continue;
    // Count how many name tokens appear in this surface
    const score = tokens.filter((t) => sn.includes(t)).length;
    if (score === 0) continue; // no shared token = no match; an unnamed
    // entity (emanon) must fall through to its own seed, not win by tiebreak
    // Prefer surfaces with more matching tokens; break ties by shortness
    const lengthPenalty = s.length / 100;
    const adjusted = score - lengthPenalty;
    if (adjusted > bestScore) { bestScore = adjusted; best = s; }
  }
  return best;
}

export function entityFold(text, entityName = null, options = {}) {
  const {
    tokenBudget = 500,
    connectionMap = createConnectionMap(),
    focus = null,
    title = null,
    sceneCount = 12,
    place = null,
    referent = null,       // per-text coref prior entry (eoPriors coref artifact)
    aliases = null,        // legacy escape hatch: flat descriptor aliases
    narratorSpans = null,  // legacy escape hatch: numeric first-person spans
  } = options;

  // 1. Frame text into signal windows
  const allFrames = frameText(text);

  // Optional place scoping: a place, for a linear document, is a position
  // on the document's own axis. `place.position` is a frame order (>= 1)
  // or a 0..1 fraction of the document; `place.radius` is the neighborhood
  // half-width in frames (default sqrt of the frame count — the engine's
  // usual scale idiom). The fold then reads the entity AT that place.
  let frames = allFrames;
  let placeWindow = null;
  if (place && place.position != null) {
    const n = allFrames.length;
    const center = place.position > 0 && place.position < 1
      ? Math.round(place.position * (n - 1))
      : Math.round(place.position);
    const radius = place.radius ?? Math.max(1, Math.round(Math.sqrt(n)));
    placeWindow = { center, radius, from: Math.max(0, center - radius), to: Math.min(n - 1, center + radius) };
    frames = allFrames.filter((f) => f.order >= placeWindow.from && f.order <= placeWindow.to);
  }

  // 2. Extract surfaces (capitalized spans) from the perceiver
  const allSurfaces = [...new Set(extractSurfaces(text))];
  const targetSurface = matchSurface(entityName, allSurfaces) ?? entityName ?? "unknown";

  // 3. Referent-centric presence (perceiver/text/presence.js). The unit of
  // identity is the REFERENT: surfaces are scoped evidence pointing at it,
  // admitted as lifecycle events and projected through the referents organ.
  // Name variants come from the structural coreference rule (TIER.RESOLVED);
  // descriptor surfaces and narrator spans come from a per-text coref prior
  // (witness-channel knowledge — injected, never derived).
  const normText = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const prior = referent ?? {
    id: entityName ?? targetSurface,
    name: /^\p{Lu}/u.test(String(targetSurface).trim()) ? targetSurface : null,
    surfaces: (aliases ?? []).map((a) => ({ surface: a })),
    narratorSpans: (narratorSpans ?? []).map((sp) => ({ from: sp.from, to: sp.to })),
  };
  if (referent && !prior.name && /^\p{Lu}/u.test(String(targetSurface).trim())) {
    // A prior may omit `name` for a holon; the matched surface supplies it.
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

  // Physics-based capitalization filter: a NAME essentially never appears
  // with a lowercase initial in the source, while a sentence/dialogue opener
  // ("Well", "Why") constantly does. The counts must be case-sensitive over
  // the raw text — frame distributions are already lowercased, so counting
  // those would count every occurrence and dissolve the signal.
  const lowerFormCounts = new Map();
  for (const f of frames) {
    for (const tok of f.text.split(/\s+/)) {
      const m = tok.match(/^\p{Ll}[\p{L}'’]*/u);
      if (m) {
        const k = m[0].toLowerCase();
        lowerFormCounts.set(k, (lowerFormCounts.get(k) ?? 0) + 1);
      }
    }
  }

  const surfaceMass = new Map();
  for (const [order, surfaces] of perChunk) for (const s of surfaces) surfaceMass.set(s, (surfaceMass.get(s) ?? 0) + 1);

  const targetNameTokenSet = new Set(norm(targetSurface).split(/\s+/).filter((t) => t.length > 2));
  const figureStats = new Map();
  for (const f of targetFrames) {
    const chunkSurfaces = perChunk.get(f.order) ?? [];
    for (const s of chunkSurfaces) {
      const sn = norm(s);
      if (targetNameTokenSet.has(sn)) continue;
      if (s.includes("\n")) continue;
      // Stage 1: surface-level Entity terrain = pronoun → filter
      if (advisoryClassifyTerrain(s) === "Entity") continue;
      const words = s.split(/\s+/);
      // Stage 2: cap/lower ratio for single-word surfaces.
      // - lower=0, upper>0: proper name (always capitalized) → keep
      // - lower>0, upper>0: has both forms → apply ratio filter
      // Names: ratio ~1.0-1.5. Common words: < 0.8. Dialogue-only: > 2.0.
      if (words.length === 1) {
        const lower = lowerFormCounts.get(sn) ?? 0;
        const upper = surfaceMass.get(s) ?? 0;
        if (upper > 0 && lower > 0) {
          const ratio = upper / lower;
          if (ratio < 0.8 || ratio > 2.0) continue;
        }
        // lower=0 means the word is never lowercased → it's a proper name
        if (upper === 0) continue; // not a perceiver surface (shouldnt happen)
      }
      figureStats.set(s, (figureStats.get(s) ?? 0) + 1);
    }
  }

  const figures = [...figureStats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, count]) => ({ label, count }));

  // 5. Detect boundaries (topic shifts) — lower threshold for more events
  const boundaries = detectBoundaries(frames, { zThreshold: 1.8 });

  // 6. Extract typed events near the entity — presence-derived positions,
  // so injected aliases and narrator spans count as "near".
  const events = extractEvents(frames, boundaries, [], targetSurface, {
    maxEvents: sceneCount,
    proximityWindow: 10, // wider window to catch more boundaries near entity
    entityPositions,
  });

  // 7. Optional relation extraction — the PERCEIVER's organ output, wired
  // in only on request (`withRelations`). The fold itself stays signal-only;
  // relations are kept when a clause names the target entity, and their
  // polarity is read from the clause, never asserted.
  let relations = [];
  if (options.withRelations) {
    // Compare in the same normalization space: rn below is diacritic-
    // stripped, so the name tokens must be stripped too. Alias head tokens
    // are included so "the monster seized..." clauses attach to the referent.
    const aliasTokens = (prior.surfaces ?? []).flatMap((s) =>
      diaNorm(s.surface ?? s).split(/\s+/).filter((t) => t.length > 3),
    );
    const targetTokens = [...new Set([...[...targetNameTokenSet].map(diaNorm), ...aliasTokens])];
    relations = extractTextRelations(
      targetFrames.map((f) => ({ text: snapToSentences(f.text), foldScore: 0, order: f.order })),
      { limit: Infinity },
    )
      .filter((r) => {
        const rn = diaNorm(`${r.subject} ${r.object}`);
        return targetTokens.some((t) => rn.includes(t));
      })
      .slice(0, 24)
      .map((r, i) => ({ ...r, idx: i }));
  }

  // 8. Order by narrative position
  const ordered = orderChronologically(relations, events, new Map());

  // 8. Key moments from events — the organ declares which of ITS event
  // types mark turning points; the kernel stays vocabulary-free.
  const eventMoments = buildKeyMomentsFromEvents(events, targetFrames, {
    maxMoments: sceneCount,
    turningTypes: TURNING_EVENT_TYPES,
  });

  let sceneMoments;
  if (eventMoments.length >= 3) {
    sceneMoments = eventMoments.map((m) => ({
      idx: m.idx, offset: m.offset ?? null,
      text: m.text, context: m.text, score: m.score, type: m.type,
    }));
  } else {
    const spine = significanceSpine(targetFrames, { budget: 600, k: sceneCount });
    sceneMoments = buildSceneMoments(targetFrames, spine, { contextWindow: 1 })
      .map((m) => ({ ...m, text: snapToSentences(m.text), context: snapToSentences(m.context ?? m.text) }));
  }

  // Top up: entity-specific, prior-driven holon field.
  // The entity's OWN holon field is seeded with the entity as a raw-span
  // holon. Each entity-present sentence is folded against accumulated
  // textual priors (the "human never reads a sentence blind" principle)
  // and processed against the entity's holon field. The delta between
  // the predicted fold (gravitational centroid of existing holons) and
  // the actual fold generates NEW reading-created holons or reinforces
  // existing ones.
  //
  // A sentence is significant when:
  //   - It created a NEW reading-created holon (delta exceeded threshold)
  //   - An existing holon CLIMBED the ontological ladder
  //   - The delta was very high (major prediction error ≈ major surprise)
  //
  // MEASURED 2026-07-29: on W&P and Frankenstein the field surfer returns
  // ZERO significant sentences (Natasha 702 target frames → 0, creature 231
  // → 0), so this top-up was a silent no-op and the fold emitted only the
  // 4 event-dedup moments. Recall on the span golden fell 5/21 → 1/21. The
  // field is kept (it is the only organ here that reads prediction error
  // rather than lexis) but it no longer gets to leave the budget unspent:
  // when it surfaces nothing, fall back to the stratified significance
  // spine below, which is the selector the 5/21 was measured with.
  if (sceneMoments.length < sceneCount && targetFrames.length) {
    const { significantSentences } = readEntityField(
      normText, targetSurface, targetFrames, boundaries
    );
    if (significantSentences.length >= 2) {
      selectTopFieldMoments(significantSentences, sceneMoments, sceneCount);
    }
  }

  // Fallback top-up: one-per-type event dedup can leave far fewer moments
  // than asked for (4 types → 4 moments regardless of sceneCount), and the
  // holon field above can surface nothing at all. Fill the remainder from
  // the significance spine — STRATIFIED across the entity's presence extent.
  // Forward surprise is measured against an accumulating history, so early
  // text scores high by construction; taking globally-ranked peaks confines
  // every moment to the opening chapters (measured: 12/12 spans in the first
  // 27.5% of W&P). One winner per stratum spends the budget across the whole
  // arc instead.
  //
  // Frame forward-surprise x referent presence, stratified, is the best
  // MEASURED selector on the span golden (5/21). Variants measured and
  // rejected — do not silently retry them:
  //   presence-only ............................ 4/21
  //   cold-start mask (minHistory) ............. 4/21 (kills exposition
  //     scenes — a theme's first statement is canonical, not noise)
  //   sentence-stream reduction ................ 3/21 (per-sentence bags
  //     are too small to carry a KL)
  // The residual gap to the golden is a MISSING OBSERVABLE (what the entity
  // does/feels — relations, dialogue, affect), not a rearrangement of this.
  if (sceneMoments.length < sceneCount && targetFrames.length) {
    const spine = significanceSpine(targetFrames, { budget: targetFrames.length, k: sceneCount * 3 });
    const near = (a, b) => a != null && b != null && Math.abs(a - b) < 2000;
    const candidates = [...spine.scoreByPos.entries()]
      .map(([pos, score]) => {
        const f = targetFrames[pos];
        return {
          idx: f.order,
          offset: f.offset,
          text: f.text,
          context: f.text,
          score: (score || 1e-6) * Math.log1p(presence.get(f.order) ?? 0),
        };
      })
      .filter((m) => m.offset != null && !sceneMoments.some((s) => near(s.offset, m.offset)));

    const lo = targetFrames[0].offset;
    const hi = targetFrames[targetFrames.length - 1].offset + 1;
    const slots = sceneCount - sceneMoments.length;
    const strata = Array.from({ length: slots }, () => []);
    for (const m of candidates) {
      const s = Math.min(slots - 1, Math.floor(((m.offset - lo) / (hi - lo)) * slots));
      strata[s].push(m);
    }
    const picked = strata
      .map((bucket) => bucket.sort((a, b) => b.score - a.score)[0])
      .filter(Boolean);
    // Strata the entity never peaks in stay empty; backfill by global score.
    for (const m of candidates.sort((a, b) => b.score - a.score)) {
      if (picked.length >= slots) break;
      if (!picked.includes(m) && !picked.some((p) => near(p.offset, m.offset))) picked.push(m);
    }
    for (const m of picked.slice(0, slots)) {
      sceneMoments.push({
        ...m,
        text: snapToSentences(m.text),
        context: snapToSentences(m.context ?? m.text),
      });
    }
    sceneMoments.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  }

  // 9. Build EOT packet. Absence is reported, never papered over: an entity
  // with no matching frames yields an explicit gap.
  const gaps = [...(admission.gaps ?? [])];
  if (!targetFrames.length) {
    gaps.push({
      reason: placeWindow ? "entity_not_found_at_place" : "entity_not_found",
      entity: entityName ?? targetSurface,
      ...(placeWindow ? { place: placeWindow } : {}),
    });
  }
  const packet = buildEntityPacket(ordered, targetSurface, {
    tokenBudget,
    maxRelations: 0,
    connectionMap,
    focus,
    title: title ?? targetSurface,
    sceneMoments,
    graphFigures: figures,
    turningTypes: TURNING_EVENT_TYPES,
    gaps,
    scope: placeWindow ? "entity@place" : "entity",
    place: placeWindow,
    resolveRawSpan: (offset, spanText) => locateRawSpan(normText, offset, spanText),
  });

  // 10. Echoes — associative memory (emergence/store). For each selected span,
  // surface the prior passages its frame recalls: verbatim/keyword motif
  // recurrence plus one Hebbian completion hop (engine tier only — synonymy
  // and thematic resonance are model-tier and correctly stay absent; see
  // golden/memory-golden.json). An echo is offset-anchored, so "this passage
  // recalls that one" is a grounded, checkable edge in the packet, not prose.
  if (options.withEchoes !== false && frames.length > 2) {
    const memory = buildStore(frames);
    const byOrder = new Map(frames.map((f) => [f.order, f]));
    const frameFor = (off) => {
      let best = null;
      for (const f of frames) { if (f.offset <= off) best = f; else break; }
      return best;
    };
    const MIN_DISTANCE = 5; // frames — an adjacent "echo" is just continuation
    for (const s of packet.spans) {
      if (s.offset == null) continue;
      const f = frameFor(s.offset);
      if (!f) continue;
      const recalled = surfaceMemory(memory, f.text, { selfOrder: f.order, cueOrder: f.order })
        .filter((r) => r.order < f.order - MIN_DISTANCE && byOrder.has(r.order));
      if (!recalled.length) continue;
      const top = recalled[0].activation;
      const echoes = recalled
        .filter((r) => r.activation >= 0.5 * top)
        .slice(0, 2)
        .map((r) => ({
          offset: byOrder.get(r.order).offset,
          activation: +r.activation.toFixed(3),
        }));
      if (echoes.length) s.echoes = echoes;
    }
  }

  updateConnectionMap(connectionMap, packet);
  return packet;
}
