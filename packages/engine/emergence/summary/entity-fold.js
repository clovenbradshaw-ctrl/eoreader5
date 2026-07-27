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
  TURNING_EVENT_TYPES,
} from "./text-organ.js";
import { classify } from "../../cube/index.js";
import { extractRelations as extractTextRelations } from "../../perceiver/text/extraction.js";

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

  // 3. Find frames containing the target entity (by any name token)
  const targetNameTokens = norm(targetSurface).split(/\s+/).filter((t) => t.length > 2);
  const targetFrames = frames.filter((f) => {
    const text = norm(f.text);
    return targetNameTokens.some((t) => text.includes(t));
  });

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
      const words = s.split(/\s+/);
      if (words.length === 1) {
        if (s.length < 3) continue; // below 3 chars the cap/lower physics has no resolution ("Oh")
        const lower = lowerFormCounts.get(sn) ?? 0;
        const upper = surfaceMass.get(s) ?? 0;
        const capRatio = upper / (upper + lower || 1);
        if (capRatio < 0.9) continue; // seen in lowercase → a word, not a name
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

  // 6. Extract typed events near the entity
  const events = extractEvents(frames, boundaries, [], targetSurface, {
    maxEvents: sceneCount,
    proximityWindow: 10, // wider window to catch more boundaries near entity
  });

  // 7. Optional relation extraction — the PERCEIVER's organ output, wired
  // in only on request (`withRelations`). The fold itself stays signal-only;
  // relations are kept when a clause names the target entity, and their
  // polarity is read from the clause, never asserted.
  let relations = [];
  if (options.withRelations) {
    // Compare in the same normalization space: rn below is diacritic-
    // stripped, so the name tokens must be stripped too.
    const targetTokens = [...targetNameTokenSet].map(diaNorm);
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
      idx: m.idx, text: m.text, context: m.text, score: m.score, type: m.type,
    }));
  } else {
    const spine = significanceSpine(targetFrames, { budget: 600, k: sceneCount });
    sceneMoments = buildSceneMoments(targetFrames, spine, { contextWindow: 1 })
      .map((m) => ({ ...m, text: snapToSentences(m.text), context: snapToSentences(m.context ?? m.text) }));
  }

  // 9. Build EOT packet. Absence is reported, never papered over: an entity
  // with no matching frames yields an explicit gap.
  const gaps = [];
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
  });

  updateConnectionMap(connectionMap, packet);
  return packet;
}
