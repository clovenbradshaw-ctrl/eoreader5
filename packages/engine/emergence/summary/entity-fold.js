// entity-fold.js — Entity-focused fold orchestrator.
//
// This is the thin orchestrator that wires the organ (modality-specific
// extraction) to the kernel (universal fold logic). For text, it uses
// text-organ.js to extract signal-derived frames, boundaries, entities,
// and events, then passes them to kernel.js for key moment selection,
// temporal ordering, and EOT packet assembly.
//
// The signal approach (ported from the music extraction) measures the
// text's own statistics — KL divergence between frames, co-occurrence
// of words — and lets structure emerge. No regex, no hardcoded patterns.
// This mirrors how the music system discovers chords and patterns from
// raw PCM without any musical notation templates.
//
// The fold is cheap (CPU-only, no model calls).

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
  discoverEntities,
  matchTargetEntity,
  findEntityMentions,
  segmentSentences,
} from "./text-organ.js";
import {
  detectFigures,
} from "./graph.js";

/**
 * Entity-focused fold: raw text → EOT packet with temporal ordering.
 *
 * @param {string} text - raw text (e.g., a chapter of War and Peace)
 * @param {string} entityName - the entity to focus on (e.g., "Natasha Rostova")
 * @param {object} options - { tokenBudget, connectionMap, focus, title }
 * @returns {object} EOT packet with temporal relations
 */
export function entityFold(text, entityName, options = {}) {
  const {
    tokenBudget = 500,
    connectionMap = createConnectionMap(),
    focus = null,
    title = null,
    sceneCount = 12,
  } = options;

  // 1. Frame text into signal windows (like STFT frames)
  const frames = frameText(text);

  // 2. Discover entities from frame co-occurrence statistics
  const entities = discoverEntities(frames);

  // 3. Identify target entity
  const target = matchTargetEntity(entities, entityName);

  // 4. Find frames relevant to the entity
  const relevant = findEntityMentions(
    frames.map((f) => ({ text: f.text, idx: f.order })),
    entityName
  ).map((c) => {
    const f = frames[c.idx];
    return f ?? { text: c.text, dist: new Map(), order: c.idx, offset: 0 };
  });

  // 5. Detect boundaries (topic shifts) among entity-relevant frames
  const boundaries = detectBoundaries(relevant);

  // 6. Extract events from boundaries near the entity's frames
  const events = [];
  if (entityName) {
    const en = entityName.toLowerCase();
    for (const b of boundaries) {
      const f = frames.find((f) => f.offset >= b.offset);
      if (f && f.text.toLowerCase().includes(en)) {
        events.push({
          type: "shift",
          text: f.text,
          score: b.score,
          idx: f.order,
          participants: [entityName],
        });
      }
    }
  }
  // Fallback: if no entity-match events, use all top boundaries
  if (events.length < 3) {
    for (const b of boundaries.slice(0, sceneCount)) {
      const f = frames.find((f) => f.offset >= b.offset) || frames[frames.length - 1];
      events.push({
        type: "shift",
        text: f.text,
        score: b.score,
        idx: f.order,
        participants: [entityName],
      });
    }
  }

  // 7. Detect figures via co-occurrence
  const figureCounts = detectFigures(
    relevant.map((f) => ({ text: f.text, idx: f.order })),
    entityName
  );

  // 8. Order by narrative position (no temporal markers — signal has none)
  const ordered = orderChronologically([], events, new Map());

  // 9. Key moments from events
  const eventMoments = buildKeyMomentsFromEvents(events, relevant, {
    maxMoments: sceneCount,
  });

  let sceneMoments;
  if (eventMoments.length >= 3) {
    sceneMoments = eventMoments.map((m) => ({
      idx: m.idx,
      text: m.text,
      context: m.text,
      score: m.score,
      type: m.type,
    }));
  } else {
    const spine = significanceSpine(relevant, { budget: 600, k: sceneCount });
    const spineMoments = buildSceneMoments(relevant, spine, { contextWindow: 1 });
    sceneMoments = spineMoments;
  }

  // 10. Build EOT packet
  const packet = buildEntityPacket(ordered, entityName, {
    tokenBudget,
    maxRelations: 0,
    connectionMap,
    focus,
    title,
    sceneMoments,
    graphFigures: figureCounts.slice(0, 10),
  });

  // 11. Update connection map
  updateConnectionMap(connectionMap, packet);

  return packet;
}
