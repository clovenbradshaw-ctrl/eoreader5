// Portable summary engine: fold → summary packet.
//
// Pure functions, no model calls. Takes a fold (reading units + history)
// and projection parameters, returns a structured summary packet.
//
// The packet is the universal projection of the fold — any consumer
// (question answering, entity exploration, topic exploration) works
// with packets, not raw folds.
//
// History feedback: each packet's connections feed back into future
// folds via the ConnectionMap, strengthening connections that appear
// repeatedly (neuronal network metaphor). A connection that appears
// in 3 packets is stronger than one that appears in 1. The fold
// biases toward strengthened connections — what the system has learned
// to expect.

import {
  forwardScore,
  wordFrequencies,
  feltSurprise,
} from "../surprise/index.js";
import {
  classify,
  scoreCoordinate,
  focusBias,
} from "../../cube/index.js";

// ── ConnectionMap ──────────────────────────────────────────────────────────────
// Tracks which relations/properties appeared across packets, and how often.
// Each connection is keyed by "subject|verb|object" (for relations) or
// "label|value" (for properties). The strength accumulates across packets:
// strength = 1 - (1 / (1 + count)), so 1 appearance = 0.5, 2 = 0.67,
// 3 = 0.75, approaching 1.0 asymptotically.

/**
 * Create a new empty ConnectionMap.
 * @returns {Map<string, { count: number, strength: number, lastSeen: number }>}
 */
export function createConnectionMap() {
  return new Map();
}

/**
 * Update a ConnectionMap with connections from a packet.
 * @param {Map} map - the connection map (mutated in place)
 * @param {object} packet - the packet whose connections to add
 * @param {number} timestamp - current timestamp for lastSeen
 * @returns {Map} the same map, updated
 */
export function updateConnectionMap(map, packet, timestamp = Date.now()) {
  if (!map || !packet) return map;

  const upsert = (key) => {
    const existing = map.get(key);
    const count = (existing?.count ?? 0) + 1;
    map.set(key, {
      count,
      strength: 1 - 1 / (1 + count),
      lastSeen: timestamp,
    });
  };

  for (const r of packet.relations || []) {
    upsert(`${r.subject}|${r.verb}|${r.object}`);
  }
  for (const p of packet.properties || []) {
    upsert(`${p.label}|${p.value}`);
  }

  return map;
}

/**
 * Get the strength of a connection from the map.
 * @param {Map} map
 * @param {string} key - "subject|verb|object" or "label|value"
 * @returns {number} strength 0-1 (0 if not in map)
 */
export function connectionStrength(map, key) {
  return map?.get(key)?.strength ?? 0;
}

// ── Token estimation ──────────────────────────────────────────────────────────
// Same heuristic as fold/index.js: words + punctuation.

function estimateTokens(text) {
  return String(text ?? "").split(/\s+/).filter(Boolean).length;
}

// ── Content selection ──────────────────────────────────────────────────────────
// Filter reading units by holonic level and entity/kind cast.
//
// Level types:
//   full     — all units
//   place    — units whose coord matches a position (within a radius)
//   entity   — units whose text mentions the entity (case-insensitive)
//   topic    — units whose text matches topic keywords
//   range    — units within [from, to] index range

/**
 * Select content from a fold based on projection parameters.
 *
 * @param {object} fold - { units: [{ text, coord?, meta? }], query? }
 * @param {object} projection - { level, cast? }
 * @returns {Array} filtered units
 */
export function selectContent(fold, projection) {
  const units = fold?.units ?? [];
  const level = projection?.level ?? { type: "full" };
  const cast = projection?.cast ?? {};

  let selected = [...units];

  // Filter by holonic level
  if (level.type === "place" && level.position) {
    // Select units whose coordinate is near the position
    selected = selected.filter((u) => {
      const coord = u.coord ?? classify(u.text);
      // Approximate: same terrain = "near" (no spatial coords in v5)
      return coord.terrain === classify("").terrain || true; // placeholder — real impl needs spatial coords
    });
  } else if (level.type === "entity" && level.id) {
    // Select units that mention the entity
    const idLower = level.id.toLowerCase();
    selected = selected.filter((u) =>
      (u.text ?? "").toLowerCase().includes(idLower) ||
      (u.meta?.entities ?? []).some((e) => String(e).toLowerCase().includes(idLower))
    );
  } else if (level.type === "topic" && level.keywords?.length) {
    // Select units that match topic keywords
    const kwSet = new Set(level.keywords.map((k) => k.toLowerCase()));
    selected = selected.filter((u) => {
      const text = (u.text ?? "").toLowerCase();
      return [...kwSet].some((kw) => text.includes(kw));
    });
  } else if (level.type === "range") {
    // Select units within index range
    const from = level.from ?? 0;
    const to = level.to ?? units.length;
    selected = units.slice(from, to);
  }
  // 'full' — no filtering

  // Filter by entity cast
  if (cast.entities?.length) {
    const entitySet = new Set(cast.entities.map((e) => e.toLowerCase()));
    selected = selected.filter((u) => {
      const text = (u.text ?? "").toLowerCase();
      return [...entitySet].some((e) => text.includes(e)) ||
        (u.meta?.entities ?? []).some((ee) => entitySet.has(String(ee).toLowerCase()));
    });
  }

  // Filter by kind cast
  if (cast.kinds?.length) {
    const kindSet = new Set(cast.kinds.map((k) => k.toLowerCase()));
    selected = selected.filter((u) => {
      const text = (u.text ?? "").toLowerCase();
      return [...kindSet].some((k) => text.includes(k)) ||
        (u.meta?.kinds ?? []).some((kk) => kindSet.has(String(kk).toLowerCase()));
    });
  }

  return selected;
}

// ── Content ranking ────────────────────────────────────────────────────────────
// Score each unit by:
//   1. Surprise (forwardScore against unit history)
//   2. Relevance (coordinate match with focus)
//   3. Connection strength (from ConnectionMap)
//   4. Text relevance (keyword match with query)
//
// The surprise component ensures the most novel units rank highest.
// The connection strength component ensures what the system has learned
// to expect (strengthened connections) gets优先 — but surprise still wins
// when something genuinely new appears.

/**
 * Rank content by surprise + relevance + connection strength.
 *
 * @param {Array} selected - filtered units from selectContent
 * @param {object} options - { focus, history, query, connectionMap }
 * @returns {Array} units sorted by score descending, with foldScore attached
 */
export function rankContent(selected, options = {}) {
  const { focus, history = [], query, connectionMap } = options;

  const queryWords = (query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const queryPhrase = queryWords.join(" ");

  const scored = selected.map((unit) => {
    let score = 0;
    const coord = unit.coord ?? classify(unit.text);

    // 1. Surprise (forward score against history)
    if (history.length > 0) {
      const novelty = forwardScore(unit, history);
      score += Math.min(10, novelty);
    }

    // 2. Relevance (coordinate match with focus)
    if (focus) {
      score += focusBias({ coord }, focus);
      score += scoreCoordinate(coord, focus);
    }

    // 3. Text relevance (keyword match with query)
    const text = (unit.text ?? "").toLowerCase();
    for (const w of queryWords) {
      if (text.includes(w)) score += 3;
    }
    if (queryPhrase && text.includes(queryPhrase)) score += 20;

    // 4. Connection strength (from ConnectionMap)
    // Check if this unit's text contains any strengthened connections
    if (connectionMap && connectionMap.size > 0) {
      for (const [key, entry] of connectionMap) {
        const parts = key.split("|");
        if (parts.length >= 2) {
          const subject = parts[0].toLowerCase();
          const object = parts[parts.length - 1].toLowerCase();
          if (text.includes(subject) && text.includes(object)) {
            score += entry.strength * 5; // max +5 for a fully strengthened connection
          }
        }
      }
    }

    return { ...unit, foldScore: score, coord };
  });

  // Sort by score descending
  scored.sort((a, b) => b.foldScore - a.foldScore);

  return scored;
}

// ── Content grouping ───────────────────────────────────────────────────────────
// Simple heuristic grouping without the v4.2 substrate:
//   settled    — units with strong coordinate match to focus
//   heldOpen   — units with weak match (the "void band")
//   turns      — units that transition between topics
//
// Without the perceiver's substrate, this is an approximation.
// The caller can override with their own grouping.

/**
 * Group ranked content into settled/heldOpen/turns.
 *
 * @param {Array} ranked - scored units from rankContent
 * @param {object} options - { focus, settledThreshold? }
 * @returns {{ settled: string[], heldOpen: string[], turns: string[] }}
 */
export function groupContent(ranked, options = {}) {
  const { focus, settledThreshold = 5 } = options;

  const settled = [];
  const heldOpen = [];
  const turns = [];

  for (const unit of ranked) {
    const text = unit.text ?? "";
    if (!text.trim()) continue;

    if (focus) {
      const coord = unit.coord ?? classify(text);
      const match = scoreCoordinate(coord, focus);
      if (match >= settledThreshold) {
        settled.push(text);
      } else if (match > 0) {
        heldOpen.push(text);
      } else {
        turns.push(text);
      }
    } else {
      // No focus — everything is settled
      settled.push(text);
    }
  }

  return { settled, heldOpen, turns };
}

// ── Packet building ────────────────────────────────────────────────────────────
// Assemble the SUMMARY PACKET from ranked units, groups, and surprise profile.
//
// The packet shape follows the v4.2 convention:
//   spans      — verbatim sentences (top-ranked)
//   groups     — settled/heldOpen/turns
//   properties — extracted key-value pairs (placeholder without perceiver)
//   relations  — extracted subject-verb-object (placeholder without perceiver)
//   figures    — extracted entities (placeholder without perceiver)
//   surprise   — { forward, felt, noveltyReserve }
//   connections — relations/properties with their accumulated strength

/**
 * Build a summary packet from ranked content.
 *
 * @param {Array} ranked - scored units from rankContent
 * @param {{ settled, heldOpen, turns }} groups - from groupContent
 * @param {object} foldSurprise - { forward, felt, noveltyReserve } from the fold
 * @param {object} options - { maxSpans?, connectionMap?, scope?, title? }
 * @returns {object} Summary packet
 */
export function buildPacket(ranked, groups, foldSurprise, options = {}) {
  const maxSpans = options.maxSpans ?? 8;
  const connectionMap = options.connectionMap;
  const scope = options.scope ?? "full";
  const title = options.title ?? null;

  // Top-ranked units become spans
  const spans = ranked
    .slice(0, maxSpans)
    .map((u, i) => ({
      idx: i,
      text: u.text ?? "",
      coord: u.coord,
      score: u.foldScore,
    }))
    .filter((s) => s.text.trim());

  // Extract simple properties from text (placeholder — real impl uses perceiver)
  const properties = extractProperties(ranked);

  // Extract simple relations from text (placeholder — real impl uses perceiver)
  const relations = extractRelations(ranked);

  // Extract figures from text (placeholder — real impl uses perceiver)
  const figures = extractFigures(ranked);

  // Build connection entries with accumulated strength
  const connections = [];
  if (connectionMap) {
    for (const [key, entry] of connectionMap) {
      if (entry.count > 1) {
        // Only include connections that have appeared in multiple packets
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

  // Compute surprise profile from the fold's surprise
  const surprise = {
    forward: foldSurprise?.forward ?? 0,
    felt: foldSurprise?.felt ?? 0,
    noveltyReserve: foldSurprise?.noveltyReserve ?? 0,
  };

  return Object.freeze({
    scope,
    title,
    spans,
    groups,
    properties,
    relations,
    figures,
    surprise,
    connections,
  });
}

// ── Simple extraction helpers ──────────────────────────────────────────────────
// These are placeholders that provide basic extraction without the v4.2 perceiver.
// They'll be replaced when the perceiver is ported to v5.

function extractProperties(ranked) {
  const props = [];
  const seen = new Set();

  for (const unit of ranked) {
    const text = unit.text ?? "";
    // Simple pattern: "X is Y" or "X was Y" or "X has Y"
    const matches = text.match(/\b(\w+(?:\s+\w+)?)\s+(?:is|was|has|are|were|had)\s+(.+?)(?:\.|,|;|$)/gi);
    if (matches) {
      for (const m of matches) {
        const parts = m.match(/^(.+?)\s+(?:is|was|has|are|were|had)\s+(.+?)$/i);
        if (parts) {
          const label = parts[1].trim();
          const value = parts[2].trim().replace(/[.,;]$/, "");
          const key = `${label}|${value}`.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            props.push({ label, value, score: unit.foldScore ?? 0 });
          }
        }
      }
    }
  }

  return props.slice(0, 6);
}

function extractRelations(ranked) {
  const rels = [];
  const seen = new Set();

  for (const unit of ranked) {
    const text = unit.text ?? "";
    // Simple pattern: "X verb Y" (very basic)
    const matches = text.match(/\b(\w+(?:\s+\w+)?)\s+(married|fought|led|wrote|built|destroyed|founded|ruled|served|worked|lived|died|born|moved|traveled|wrote|said|told|asked|gave|took|made|found|held|stood|sat|ran|walked|spoke|thought|knew|saw|heard|felt|wanted|needed|loved|hated|feared|hoped|believed|claimed|stated|argued|showed|proved|revealed|demonstrated|indicated|suggested|implied|meant|intended|planned|tried|attempted|managed|failed|succeeded|won|lost|beat|defeated|conquered|controlled|dominated|influenced|shaped|changed|transformed|developed|grew|improved|declined|fell|rose|increased|decreased|remained|stayed|became|turned|seemed|appeared|looked|sounded|felt|tasted|smelled)\s+(.+?)(?:\.|,|;|$)/gi);
    if (matches) {
      for (const m of matches) {
        const parts = m.match(/^(.+?)\s+(married|fought|led|wrote|built|destroyed|founded|ruled|served|worked|lived|died|born|moved|traveled|wrote|said|told|asked|gave|took|made|found|held|stood|sat|ran|walked|spoke|thought|knew|saw|heard|felt|wanted|needed|loved|hated|feared|hoped|believed|claimed|stated|argued|showed|proved|revealed|demonstrated|indicated|suggested|implied|meant|intended|planned|tried|attempted|managed|failed|succeeded|won|lost|beat|defeated|conquered|controlled|dominated|influenced|shaped|changed|transformed|developed|grew|improved|declined|fell|rose|increased|decreased|remained|stayed|became|turned|seemed|appeared|looked|sounded|felt|tasted|smelled)\s+(.+?)$/i);
        if (parts) {
          const subject = parts[1].trim();
          const verb = parts[2].trim();
          const object = parts[3].trim().replace(/[.,;]$/, "");
          const key = `${subject}|${verb}|${object}`.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            rels.push({ subject, verb, object, polarity: "+", score: unit.foldScore ?? 0 });
          }
        }
      }
    }
  }

  return rels.slice(0, 6);
}

function extractFigures(ranked) {
  const figures = [];
  const seen = new Set();

  for (const unit of ranked) {
    const text = unit.text ?? "";
    // Simple pattern: capitalized words that aren't at sentence start
    const matches = text.match(/(?<=[.!?]\s|^)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g);
    if (matches) {
      for (const m of matches) {
        const name = m.trim();
        // Skip common false positives
        if (/^(The|And|But|For|With|This|That|When|Where|While|He|She|It|They|His|Her|Their|Its|In|On|At|To|From|By|As|Or|If|So|No|Not|Yet|Now|Then|Also|Just|Only|Even|Still|Already|Always|Never|Often|Sometimes|Usually|Here|There|Every|Each|Both|Few|Many|Much|Some|Any|All|None|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)$/.test(name)) continue;
        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          figures.push({ label: name, count: 1 });
        }
      }
    }
  }

  // Deduplicate and sort by count
  const figureMap = new Map();
  for (const f of figures) {
    const existing = figureMap.get(f.label);
    if (existing) {
      existing.count += 1;
    } else {
      figureMap.set(f.label, { ...f });
    }
  }

  return [...figureMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

// ── Surprise profile ───────────────────────────────────────────────────────────
// Compute the surprise profile for a set of ranked units.
// This tells the packet "what's surprising about this summary?"

/**
 * Compute surprise profile for ranked content.
 *
 * @param {Array} ranked - scored units from rankContent
 * @param {Array} history - previous units for forward score
 * @param {object} focus - current focus coordinate
 * @returns {{ forward: number, felt: number, noveltyReserve: number }}
 */
export function computeSurpriseProfile(ranked, history, focus) {
  if (!ranked.length) {
    return { forward: 0, felt: 0, noveltyReserve: 0 };
  }

  // Forward score: cumulative new information
  let totalForward = 0;
  const cumulativeHistory = [...history];
  for (const unit of ranked) {
    const fs = forwardScore(unit, cumulativeHistory);
    totalForward += fs;
    cumulativeHistory.push(unit);
  }

  // Felt surprise: coordinate-weighted surprise
  let totalFelt = 0;
  for (const unit of ranked) {
    const coord = unit.coord ?? classify(unit.text);
    const rawSurprise = forwardScore(unit, history);
    totalFelt += feltSurprise(rawSurprise, coord, focus);
  }

  // Novelty reserve: how much novelty remains (are there more surprises?)
  const avgForward = totalForward / ranked.length;
  const noveltyReserve = Math.min(1, avgForward / 5); // normalized

  return {
    forward: totalForward,
    felt: totalFelt / ranked.length,
    noveltyReserve,
  };
}

// ── Top-level API ──────────────────────────────────────────────────────────────

/**
 * Project a fold into a summary packet.
 *
 * @param {object} fold - { units: [{ text, coord?, meta? }], query?, history?, connectionMap? }
 * @param {object} projection - { level, cast?, detailTier?, focus? }
 * @returns {object} Summary packet
 */
export function projectSummary(fold, projection = {}) {
  const {
    level = { type: "full" },
    cast = {},
    detailTier = "standard",
    focus = null,
  } = projection;

  // 1. Select content based on holonic level + cast
  const selected = selectContent(fold, { level, cast });

  if (!selected.length) {
    return buildPacket([], { settled: [], heldOpen: [], turns: [] }, { forward: 0, felt: 0, noveltyReserve: 0 }, {
      scope: level.type,
      title: fold?.title ?? null,
    });
  }

  // 2. Rank by surprise + relevance + connection strength
  const ranked = rankContent(selected, {
    focus,
    history: fold?.history ?? [],
    query: fold?.query,
    connectionMap: fold?.connectionMap,
  });

  // 3. Group by frame (simple heuristic)
  const groups = groupContent(ranked, { focus });

  // 4. Compute surprise profile
  const surprise = computeSurpriseProfile(ranked, fold?.history ?? [], focus);

  // 5. Build packet with connection strengths
  const packet = buildPacket(ranked, groups, surprise, {
    scope: level.type,
    title: fold?.title ?? null,
    connectionMap: fold?.connectionMap,
    maxSpans: detailTier === "brief" ? 2 : detailTier === "paragraph" ? 8 : 4,
  });

  return packet;
}
