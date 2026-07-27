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
} from "./text-organ.js";
import { classify } from "../../cube/index.js";

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
  } = options;

  // 1. Frame text into signal windows
  const frames = frameText(text);

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

  // Physics-based ratio filter: names appear in both capitalized and lowercase
  // forms; sentence-start words are almost exclusively capitalized.
  const lowerCounts = new Map();
  for (const f of frames) for (const word of f.dist.keys()) lowerCounts.set(word, (lowerCounts.get(word) ?? 0) + 1);

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
        const lower = lowerCounts.get(sn) ?? 0;
        const upper = surfaceMass.get(s) ?? 0;
        const ratio = lower > 0 ? upper / lower : 1;
        if (lower < 50 || ratio < 0.8) continue; // not a name
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

  // 7. Order by narrative position
  const ordered = orderChronologically([], events, new Map());

  // 8. Key moments from events
  const eventMoments = buildKeyMomentsFromEvents(events, targetFrames, {
    maxMoments: sceneCount,
  });

  let sceneMoments;
  if (eventMoments.length >= 3) {
    sceneMoments = eventMoments.map((m) => ({
      idx: m.idx, text: m.text, context: m.text, score: m.score, type: m.type,
    }));
  } else {
    const spine = significanceSpine(targetFrames, { budget: 600, k: sceneCount });
    sceneMoments = buildSceneMoments(targetFrames, spine, { contextWindow: 1 });
  }

  // 9. Build EOT packet
  const packet = buildEntityPacket(ordered, targetSurface, {
    tokenBudget,
    maxRelations: 0,
    connectionMap,
    focus,
    title: title ?? targetSurface,
    sceneMoments,
    graphFigures: figures,
  });

  updateConnectionMap(connectionMap, packet);
  return packet;
}
