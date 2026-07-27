// kernel.js — Universal fold logic for entity-focused EOT packets.
//
// This module contains the modality-agnostic fold machinery. It works on
// any ordered chunk stream with typed events and temporal markers, regardless
// of whether those chunks came from text, image, audio, or any other modality.
//
// The organ (text-organ.js, image-organ.js, etc.) does the modality-specific
// extraction and feeds into this kernel. The kernel consumes the organ's
// output uniformly and assembles the EOT packet.
//
// Universal interface:
//   chunks: [{ text, idx, metadata? }]
//   relations: [{ subject, verb, object, polarity, idx, text }]
//   events: [{ type, text, participants, idx }]
//   temporalMarkers: Map<idx, { type, value, raw }>

import { classify } from "../../cube/index.js";
import { forwardScore } from "../surprise/index.js";
import {
  createConnectionMap,
  updateConnectionMap,
} from "./index.js";

// ── Event type classification ──────────────────────────────────────────────────
// The event types that mark a narrative turning point — a change in the
// entity's relational/emotional state, as opposed to routine action.

export const TURNING_EVENT_TYPES = [
  "shift", // signal-based boundary
  "love", "engagement", "breakup", "elopement", "thwarting", "death",
  "marriage", "nursing", "evacuation", "rescue", "dance", "folk-dance",
  "ball", "command", "wound", "war",
];

// ── Key moment selection ───────────────────────────────────────────────────────
// Build key moments from turning events (structural signal) rather than
// pure lexical forward-surprise. A pivotal scene (elopement, marriage,
// death) is significant because of what TYPE of event it is, not because
// its words are statistically rare — forward-surprise alone picks up
// unusual dialogue fragments, not narrative turns.
//
// One representative event is kept per type (the one with highest local
// forward-surprise among same-type candidates, so a type with many
// mentions still surfaces its most distinctive instance), ordered by
// narrative position so the result reads as a forward tour of the arc.

/**
 * Build key moments from turning events.
 * @param {Array} events - from organ's extractEvents
 * @param {Array<{ text, idx }>} relevantChunks - entity-mention stream, in order
 * @param {object} options - { maxMoments, window }
 * @returns {Array<{ idx, type, text, score }>}
 */
export function buildKeyMomentsFromEvents(events, relevantChunks, options = {}) {
  const { maxMoments = 8, window = 60 } = options;

  const turning = events.filter((e) => TURNING_EVENT_TYPES.includes(e.type));
  if (!turning.length) return [];

  // Position each event within the relevant-chunk stream (by idx match)
  // so we can build a local history window for scoring.
  const posByIdx = new Map(relevantChunks.map((s, pos) => [s.idx, pos]));

  const scored = turning.map((e) => {
    const pos = posByIdx.get(e.idx) ?? 0;
    const from = Math.max(0, pos - window);
    const history = relevantChunks.slice(from, pos);
    const score = forwardScore({ text: e.text }, history);
    return { ...e, pos, score };
  });

  // If fewer than 4 distinct event types, keep the top N by score
  // (one per type when plentiful, all top-scorers when sparse).
  // This prevents a text with only "war" and "death" events from
  // producing only 2 key moments.
  const types = new Set(scored.map((e) => e.type));

  let selected;
  if (types.size >= 4) {
    // Plentiful types — one per type
    const bestByType = new Map();
    for (const e of scored) {
      const existing = bestByType.get(e.type);
      if (!existing || e.score > existing.score) bestByType.set(e.type, e);
    }
    selected = [...bestByType.values()];
  } else {
    // Sparse types — keep all, sorted by score
    selected = scored.slice();
  }

  return selected
    .sort((a, b) => b.score - a.score)
    .slice(0, maxMoments)
    .sort((a, b) => a.idx - b.idx)
    .map((e) => ({ idx: e.idx, type: e.type, text: e.text, score: e.score }));
}

// ── Chronological ordering ─────────────────────────────────────────────────────
// Order relations and events by time using temporal markers.
//
// Ordering rules:
//   1. Absolute dates → numerical order
//   2. Sequential markers → explicit order (first=1, then=2, eventually=N)
//   3. Relative markers → narrative position order
//   4. No marker → preserve original chunk order

const SEQUENTIAL_ORDER = {
  "first": 1,
  "at first": 1,
  "then": 2,
  "next": 3,
  "subsequently": 4,
  "eventually": 5,
  "finally": 6,
  "in the end": 7,
  "at the start": 0,
  "in the beginning": 0,
  "previously": -1,
  "formerly": -1,
  "earlier": -1,
  "later": 3,
  "afterward": 4,
  "afterwards": 4,
  "meanwhile": 2,
  "simultaneously": 2,
  "concurrently": 2,
  "ultimately": 6,
};

/**
 * Order relations and events chronologically.
 * @param {Array} relations
 * @param {Array} events
 * @param {Map<number, { type, value, raw }>} temporalMarkers
 * @returns {{ relations: Array, events: Array, order: number[] }}
 */
export function orderChronologically(relations, events, temporalMarkers) {
  // Combine all items with their temporal position
  const items = [
    ...relations.map((r) => ({ ...r, itemType: "relation" })),
    ...events.map((e) => ({ ...e, itemType: "event" })),
  ];

  // Assign temporal position to each item
  const positioned = items.map((item) => {
    const marker = temporalMarkers.get(item.idx);
    let position = item.idx; // default: preserve original order

    if (marker) {
      if (marker.type === "absolute") {
        // Absolute date: use the year as position
        position = parseInt(marker.value, 10) || item.idx;
      } else if (marker.type === "sequential") {
        // Sequential: use the predefined order
        position = (SEQUENTIAL_ORDER[marker.value] ?? 2) * 1000 + item.idx;
      } else if (marker.type === "relative") {
        // Relative: use narrative position (offset by a small amount)
        position = item.idx + 0.5;
      }
    }

    return { ...item, position };
  });

  // Sort by position
  positioned.sort((a, b) => a.position - b.position);

  // Split back into relations and events
  const orderedRelations = positioned
    .filter((i) => i.itemType === "relation")
    .map(({ position, itemType, ...rest }) => rest);

  const orderedEvents = positioned
    .filter((i) => i.itemType === "event")
    .map(({ position, itemType, ...rest }) => rest);

  // The order array: indices in chronological order
  const order = positioned.map((i) => i.idx);

  return {
    relations: orderedRelations,
    events: orderedEvents,
    order,
  };
}

// ── EOT packet assembly ────────────────────────────────────────────────────────
// Build the EOT packet from ordered relations, events, and figures.

/**
 * Build an entity-focused EOT packet with temporal ordering.
 *
 * @param {{ relations, events, order }} ordered - from orderChronologically
 * @param {string} entityName
 * @param {object} options - { tokenBudget, maxRelations, connectionMap, focus, title, sceneMoments }
 * @returns {object} EOT packet
 */
export function buildEntityPacket(ordered, entityName, options = {}) {
  const {
    tokenBudget = 500,
    maxRelations = 20,
    connectionMap,
    focus,
    title = null,
    sceneMoments = [],
    graphFigures = [],
  } = options;

  const { relations, events, order } = ordered;

  // Build spans from scene moments (significance spine peaks) when available —
  // these are the sentences of highest forward surprise, i.e. the document's
  // turning points, not just the first N events encountered.
  const spans = sceneMoments.length
    ? sceneMoments.map((m, i) => ({
        idx: i,
        text: m.text,
        coord: classify(m.text),
        score: m.score,
      }))
    : events.slice(0, 8).map((e, i) => ({
        idx: i,
        text: e.text,
        coord: classify(e.text),
        score: 0,
      }));

  // Key moments: scene moments with surrounding context, ordered by narrative
  // position (not by score) so they read as a forward tour of the entity's arc.
  const keyMoments = sceneMoments
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((m) => ({
      idx: m.idx,
      type: m.type ?? null,
      text: m.text,
      context: m.context,
      score: m.score,
    }));

  // Build groups: settled = relations, heldOpen = none (biography is all settled),
  // turns = events that change the narrative state
  const turningEvents = events.filter((e) => TURNING_EVENT_TYPES.includes(e.type));

  const groups = {
    settled: relations.map((r) => `${r.subject} ${r.verb} ${r.object}`),
    heldOpen: [],
    turns: turningEvents.map((e) => e.text),
  };

  // Build properties from "is" relations
  const properties = relations
    .filter((r) => r.verb === "is")
    .map((r) => ({
      label: r.subject,
      value: r.object,
      score: 0,
    }));

  // Build temporal relations (with time field)
  const temporalRelations = relations
    .filter((r) => r.verb !== "is")
    .map((r) => {
      // Find the temporal position for this relation
      const pos = order.indexOf(r.idx);
      return {
        subject: r.subject,
        verb: r.verb,
        object: r.object,
        polarity: r.polarity,
        score: 0,
        time: {
          position: pos >= 0 ? pos : r.idx,
        },
      };
    });

  // Extract figures from relations — prefer graph-derived figures (which use
  // the entity graph's coupling-aware ranking) over the old proper-noun regex
  // heuristic. graphFigures comes from the orchestrator which has access to
  // the full graph substrate; when absent, fall back to filtering by proper
  // noun heuristic.
  const figures = graphFigures.length
    ? graphFigures
    : (() => {
        const STOP_WORDS = new Set([
          "the", "and", "but", "for", "with", "this", "that", "when", "where", "while",
          "he", "she", "it", "they", "his", "her", "their", "its", "in", "on", "at",
          "to", "from", "by", "as", "or", "if", "so", "no", "not", "yet", "now", "then",
          "also", "just", "only", "even", "still", "already", "always", "never", "often",
          "sometimes", "usually", "here", "there", "every", "each", "both", "few", "many",
          "much", "some", "any", "all", "none", "one", "two", "three", "four", "five",
          "six", "seven", "eight", "nine", "ten",
        ]);
        function isProperNoun(name) {
          if (!name || name.length > 30) return false;
          const trimmed = name.trim();
          if (!trimmed) return false;
          if (!/^[A-Z]/.test(trimmed)) return false;
          if (STOP_WORDS.has(trimmed.toLowerCase())) return false;
          const words = trimmed.split(/\s+/);
          if (words.some((w) => /^[a-z]/.test(w))) return false;
          return true;
        }
        const counts = new Map();
        for (const r of relations) {
          for (const name of [r.subject, r.object]) {
            if (name && name.toLowerCase() !== entityName.toLowerCase() && isProperNoun(name)) {
              counts.set(name, (counts.get(name) ?? 0) + 1);
            }
          }
        }
        return [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) => ({ label, count }));
      })();

  // Build connection entries with accumulated strength
  const connections = [];
  if (connectionMap) {
    for (const [key, entry] of connectionMap) {
      if (entry.count > 1) {
        const parts = key.split("|");
        if (parts.length >= 3) {
          connections.push({
            subject: parts[0],
            verb: parts[1],
            object: parts.slice(2).join("|"),
            strength: entry.strength,
            count: entry.count,
          });
        }
      }
    }
  }

  return Object.freeze({
    scope: "entity",
    title,
    entity: entityName,
    spans,
    groups,
    properties,
    relations: temporalRelations,
    keyMoments,
    figures,
    surprise: { forward: 0, felt: 0, noveltyReserve: 0 },
    connections,
    order,
  });
}
