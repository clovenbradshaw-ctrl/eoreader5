/**
 * Self-narrative: the collective's story of itself.
 *
 * The narrative is NOT the self. The self IS the self-record — the
 * append-only log of coordination events with provenance. The narrative
 * is a FOLD of that record: a compressed, readable story the collective
 * can tell about what it has been through.
 *
 * This is the same mechanism as the entity-fold (emergence/summary) applied
 * to the self-record instead of the corpus. Same fold physics, same
 * provenance discipline, same altitude layering (L0 line → L4 dossier).
 * The only difference is the source: self-events instead of text spans.
 *
 * ── At every altitude ──────────────────────────────────────────────
 *
 * L0 (line)    — one sentence: the collective's current situation
 * L1 (brief)   — one paragraph: key milestones + current delta
 * L2 (normal)  — several paragraphs: event history, convergence trend,
 *                motivation field, recent refusals
 * L3 (detailed) — full timeline: every significant coordination event
 * L4 (dossier) — the complete self-record, unfiltered
 */

import {
  foldSelfRecord, computeDelta, convergenceTrend, computeMotivationField,
  truthGate,
} from "./index.js";
import { fold, project } from "../quantum/index.js";

// ── Altitude folding ────────────────────────────────────────────────
//
// Same mechanism as emergence/summary: cumulative prefixes of a ranked
// event pool, guaranteeing monotonicity by construction. Lower altitudes
// are subsets of higher altitudes.

const LEVELS = [
  { name: "line",    maxEvents: 1 },
  { name: "brief",   maxEvents: 3 },
  { name: "normal",  maxEvents: 8 },
  { name: "detailed", maxEvents: 20 },
  { name: "dossier", maxEvents: Infinity },
];

/**
 * Rank self-events by significance for narrative inclusion.
 *
 * Events that represent state CHANGES (transitions, gate refusals,
 * genesis milestones) rank higher than steady-state events
 * (convergence confirmations, capacity repeats).
 */
function rankEvents(events) {
  const kindWeight = {
    gate: 1.0,
    genesis: 0.9,
    transition: 0.8,
    divergence: 0.7,
    capacity: 0.4,
    convergence: 0.3,
    delta: 0.2,
  };

  return [...events]
    .map((e) => ({
      event: e,
      weight: (kindWeight[e.kind] || 0.1) * (1 + (e.turn || 0) * 0.01),
    }))
    .sort((a, b) => b.weight - a.weight)
    .map((e) => e.event);
}

/**
 * Fold the self-record into a narrative at the given altitude.
 *
 * @param {object} record — SelfRecord from createSelfRecord/appendSelfEvents
 * @param {object} opts
 * @param {string} [opts.level="normal"] — altitude name
 * @param {object} [opts.currentSelfFold] — current self-fold (avoids recomputing)
 * @param {object} [opts.currentWorldFold] — current world-fold for delta
 * @param {number[]} [opts.deltaHistory] — recent deltas
 * @returns {object} narrative packet
 */
export function foldNarrative(record, {
  level = "normal",
  currentSelfFold = null,
  currentWorldFold = null,
  deltaHistory = [],
} = {}) {
  const levelDef = LEVELS.find((l) => l.name === level) || LEVELS[2]; // default "normal"

  const ranked = rankEvents(record.events);
  const selected = ranked.slice(0, Math.min(levelDef.maxEvents, ranked.length));

  const selfFold = currentSelfFold || foldSelfRecord(record);

  // ── Scene-level summaries ────────────────────────────────────────
  const scenes = selected.map((event) => narrativeLine(event));

  // ── Header: the collective's current frame ───────────────────────
  const delta = currentWorldFold
    ? computeDelta(selfFold, currentWorldFold)
    : null;
  const trend = convergenceTrend(deltaHistory);
  const motivation = computeMotivationField(selfFold, currentWorldFold, delta || 0, deltaHistory);

  const header = {
    totalEvents: record.events.length,
    selectedEvents: selected.length,
    level,
    delta: delta !== null ? delta : "unavailable",
    trend: trend.trend,
    urgency: motivation.urgency,
    motivation: motivation.direction,
  };

  // ── Compose lines ────────────────────────────────────────────────
  const lines = [];
  lines.push(`## Self-narrative (${level})`);
  lines.push("");
  lines.push(`Turn ${record.events.length ? record.events[record.events.length - 1].turn : 0}. ` +
    `Delta: ${delta !== null ? delta.toFixed(3) : "?"}. ` +
    `Trend: ${trend.trend}.`);
  lines.push("");

  for (const scene of scenes) {
    lines.push(`- [turn ${scene.turn}] ${scene.line}`);
  }

  if (scenes.length === 0) {
    lines.push("(no self-events recorded yet — the collective is newborn)");
  }

  // ── Footer ────────────────────────────────────────────────────────
  if (levelDef.maxEvents < record.events.length) {
    lines.push("");
    lines.push(`(${record.events.length - selected.length} more events at higher altitudes)`);
  }

  lines.push("");
  lines.push(`Record head: \`${record.head}\``);

  return Object.freeze({
    text: lines.join("\n"),
    header: Object.freeze(header),
    scenes: Object.freeze(scenes),
    level,
    recordHead: record.head,
  });
}

/**
 * Render a single self-event as a prose line.
 * Each line is a claim about the collective — and the claim binds to
 * the event's id (step 7 of the article: every claim must have a source).
 */
function narrativeLine(event) {
  const turn = event.turn;
  const organ = event.source_organ;
  const d = event.delta !== null ? ` (Δ${event.delta.toFixed(2)})` : "";

  switch (event.kind) {
    case "transition": {
      const to = event.payload?.to || event.layer || "?";
      const from = event.payload?.from || "?";
      return {
        turn,
        kind: "transition",
        line: `${organ} shifted from ${from} → ${to}${d}`,
        source: event.id,
      };
    }
    case "gate": {
      const reason = event.payload?.reason || event.description || "unknown";
      return {
        turn,
        kind: "gate",
        line: `${organ} refused to speak — ${reason}${d}`,
        source: event.id,
      };
    }
    case "genesis": {
      const lifecycle = event.payload?.lifecycle || "?";
      const desc = event.payload?.description || event.description || "";
      return {
        turn,
        kind: "genesis",
        line: `${organ} ${lifecycle === "ink" ? "committed" : lifecycle === "pencil" ? "proposed" : lifecycle === "held" ? "held" : lifecycle}: ${desc.slice(0, 80)}${d}`,
        source: event.id,
      };
    }
    case "delta": {
      return {
        turn,
        kind: "delta",
        line: `delta spike to ${event.delta?.toFixed(3) || "?"} — ${event.description || "unexpected observation"}`,
        source: event.id,
      };
    }
    case "capacity": {
      const cap = event.payload?.capacity || "?";
      return {
        turn,
        kind: "capacity",
        line: `${organ} built capacity: ${cap}${d}`,
        source: event.id,
      };
    }
    case "convergence": {
      return {
        turn,
        kind: "convergence",
        line: `model converging — ${event.description || "delta trending down"}`,
        source: event.id,
      };
    }
    case "divergence": {
      return {
        turn,
        kind: "divergence",
        line: `model diverging — ${event.description || "new territory"}`,
        source: event.id,
      };
    }
    default: {
      return {
        turn,
        kind: event.kind,
        line: `${event.kind}: ${event.description || "(no description)"}`,
        source: event.id,
      };
    }
  }
}

/**
 * Ask the narrative: what should I do next?
 * This is the narrative's advisory read of the motivation field — what the
 * architecture naturally steers toward. Not a command; an observation.
 *
 * @param {object} narrative — from foldNarrative
 * @returns {object} { action, reason, cell }
 */
export function readNarrative(narrative) {
  const h = narrative.header;
  if (!h) return Object.freeze({ action: "observe", reason: "no narrative available", cell: null });

  if (h.trend === "diverging" && h.urgency > 0.5) {
    return Object.freeze({
      action: "seek",
      reason: `model diverging (urgency ${h.urgency.toFixed(2)}) — need new observations to converge`,
      cell: h.motivation || "unknown territory",
    });
  }
  if (h.trend === "converging" && h.urgency < 0.3) {
    return Object.freeze({
      action: "deepen",
      reason: `model converging (urgency ${h.urgency.toFixed(2)}) — deepen current understanding`,
      cell: h.motivation || "current territory",
    });
  }
  if (h.delta !== "unavailable" && h.delta > 0.5) {
    return Object.freeze({
      action: "probe",
      reason: `high delta (${typeof h.delta === "number" ? h.delta.toFixed(3) : h.delta}) — probe under-represented cells`,
      cell: h.motivation || "unknown territory",
    });
  }
  return Object.freeze({
    action: "explore",
    reason: `delta ${typeof h.delta === "number" ? h.delta.toFixed(3) : h.delta} — explore or deepen`,
    cell: h.motivation || "current territory",
  });
}
