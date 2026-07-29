// emergence/terrain/discovery.js — modality-blind terrain discovery.
//
// Every reading (text, audio, video, structured, binary) gets terrain
// analysis attached automatically. The analysis method is chosen by medium
// but the output format is uniform: a TerrainReport@1 with coverage across
// all 9 terrains, regardless of input type.
//
// Text:        cube classifier (regex-based terrain/stance/operator amplitudes)
// Structured:  structured entity extraction + state detection pipeline
// Audio:       chapter detection on spectral series + field-spec analysis
// Video:       chapter detection on physics series + flow analysis
// Binary:      byte-class distribution analysis
//
// This module is pure: no model calls, no I/O, no randomness.

import { advisoryClassifyTerrain, advisoryClassifyStance, advisoryClassifyOperator } from "../../cube/index.js";
import { extractAllEntities } from "../structured/index.js";
import { detectChapters } from "../chapters/index.js";

// ── Inline amplitude computation (same math as cube/index.js) ─────
// Avoids circular dependency since cube imports from spec package.

const WEAK = 0.15;
const hits = (t, re) => (t.match(re) ?? []).length;
function evidence(t, { strong, weak }) {
  return Math.log1p(hits(t, strong)) + WEAK * Math.log1p(hits(t, weak));
}
function amplitudesFor(text, table, key) {
  const t = String(text ?? "");
  const scored = table.map((row) => ({ label: row[key], score: evidence(t, row) }));
  const total = scored.reduce((s, r) => s + r.score, 0);
  return scored.map((r) => ({ ...r, amplitude: total > 0 ? r.score / total : 0 }));
}

// ── Terrain report schema ─────────────────────────────────────────

/**
 * @typedef TerrainReport
 * @property {string} schema - "TerrainReport@1"
 * @property {string} medium - the reading's medium
 * @property {string[]} covered - which of the 9 terrains were detected
 * @property {string[]} uncovered - which were not
 * @property {object} byTerrain - { Void, Entity, Kind, Field, Link, Network, Atmosphere, Lens, Paradigm }
 * @property {object} evidence - medium-specific evidence backing each terrain
 * @property {string} perceiver - which analysis method produced this report
 */

const ALL_TERRAINS = ["Void", "Entity", "Kind", "Field", "Link", "Network", "Atmosphere", "Lens", "Paradigm"];

function emptyCoverage() {
  const c = {};
  for (const t of ALL_TERRAINS) c[t] = false;
  return c;
}

// ── Text terrain analysis (cube classifier) ───────────────────────

function textTerrainReport(reading) {
  const text = reading.text ?? "";
  const coverage = emptyCoverage();

  // Terrain term definitions (mirrors cube/index.js for purity)
  const TERRAIN_TERMS = [
    { terrain: "Void",       strong: /\b(void|absence|emptiness|nothingness|oblivion|silence|vacant|barren)\b/gi, weak: /\b(nothing|empty|missing|none|null|no\s+one)\b/gi },
    { terrain: "Entity",     strong: /\b(who|person|people|name|identity|character|figure|individual|actor|agent|my\s+name|I\s+am)\b/gi, weak: /\b(he|she|they|him|her|his|their|them)\b/gi },
    { terrain: "Kind",       strong: /\b(type|kind|category|class|definition|species|genre|sort|variety)\b/gi, weak: /\b(is\s+a|are\s+a|was\s+a)\b/gi },
    { terrain: "Field",      strong: /\b(data|information|content|passage|quote|narrative|document|corpus|record)\b/gi, weak: /\b(text|context|chapter|book|story)\b/gi },
    { terrain: "Link",       strong: /\b(relation|connection|link|dependency|bond|ally|enemy|reports?\s+to|works?\s+for|relates)\b/gi, weak: /\b(between|friend|with)\b/gi },
    { terrain: "Network",    strong: /\b(system|network|empire|republic|government|army|legion|senate|organization|institution|regiment|society)\b/gi, weak: /\b(structure|state)\b/gi },
    { terrain: "Atmosphere", strong: /\b(feeling|feelings|mood|emotion|passion|fear|anger|love|loved|hate|desire|sentiment|atmosphere|joy|joyful|grief|sorrow|tenderness|shame|despair|rapture|terror|pity|weep|wept|weeping|tears|sobbed|sobbing|trembled|trembling|blushed)\b/gi, weak: /\b(tone|happy|sad|glad|afraid)\b/gi },
    { terrain: "Lens",       strong: /\b(perspective|standpoint|angle|lens|interpretation|analysis|stance|posture|point\s+of\s+view|in\s+his\s+eyes|in\s+her\s+eyes|as\s+if\s+seeing)\b/gi, weak: /\b(view|focus|frame|reading|seemed\s+to\s+him|seemed\s+to\s+her)\b/gi },
    { terrain: "Paradigm",   strong: /\b(theory|framework|paradigm|worldview|philosophy|doctrine|canon|providence|destiny|the\s+meaning\s+of\s+life|God's\s+will|first\s+principles)\b/gi, weak: /\b(model|principle|axiom|fate|truth|faith|law\s+of)\b/gi },
  ];

  const terrainAmps = amplitudesFor(text, TERRAIN_TERMS, "terrain");
  for (const ta of terrainAmps) {
    if (ta.amplitude > 0.05) coverage[ta.label] = true;
  }
  // Field is always present (everything is content)
  coverage.Field = true;

  const covered = ALL_TERRAINS.filter((t) => coverage[t]);
  const uncovered = ALL_TERRAINS.filter((t) => !coverage[t]);

  return {
    schema: "TerrainReport@1",
    medium: "text",
    covered,
    uncovered,
    byTerrain: coverage,
    evidence: {
      terrainAmplitudes: terrainAmps.filter((a) => a.amplitude > 0),
      classifier: "cube-regex",
      dominantTerrain: advisoryClassifyTerrain(text),
      dominantStance: advisoryClassifyStance(text),
      dominantOperator: advisoryClassifyOperator(text),
    },
    perceiver: "text-cube-classifier",
  };
}

// ── Structured terrain analysis ───────────────────────────────────

function structuredTerrainReport(reading) {
  const result = extractAllEntities(reading, { minRunLength: 5 });

  if (result.terrainCoverage) {
    return {
      schema: "TerrainReport@1",
      medium: "structured",
      covered: result.terrainCoverage.covered,
      uncovered: result.terrainCoverage.uncovered,
      byTerrain: result.terrainCoverage.byTerrain,
      evidence: {
        states: result.states?.length ?? 0,
        events: result.events?.length ?? 0,
        categories: result.categorical?.length ?? 0,
        associations: result.associations?.length ?? 0,
        voids: result.voids?.length ?? 0,
        paradigms: result.paradigms?.length ?? 0,
        atmospheres: result.atmospheres?.length ?? 0,
        lenses: result.lenses?.length ?? 0,
        holonicLevels: result.tree?.levels ?? {},
      },
      perceiver: "structured-entity-extraction",
    };
  }

  // Fallback
  return {
    schema: "TerrainReport@1",
    medium: "structured",
    covered: [],
    uncovered: ALL_TERRAINS,
    byTerrain: emptyCoverage(),
    evidence: {},
    perceiver: "structured-fallback",
  };
}

// ── Audio/video terrain analysis (chapter detection) ──────────────

function seriesTerrainReport(reading, medium) {
  const coverage = emptyCoverage();
  const units = reading.units ?? [];

  // Field: the unit series exists
  coverage.Field = units.length > 1;

  if (units.length > 1) {
    const primaryField = units.map((u) => {
      const f = u.field ?? [];
      return f.length > 0 ? f[0] : 0;
    });

    // Chapter detection finds boundaries — Entity requires real structure
    try {
      const chapters = detectChapters(primaryField, {
        positions: units.map((u) => u.pos ?? 0),
        extent: reading.axis?.extent ?? units.length,
      });

      if (!chapters.abstained && chapters.boundaries?.length > 0) {
        coverage.Entity = true;
        if (chapters.boundaries.length >= 3) coverage.Network = true;
      }
      // Abstention with many units = Void (no detectable structure despite data)
      if (chapters.abstained) coverage.Void = true;
    } catch { /* insufficient data */ }
  }

  // Lens: always present for binary (the byte-class is a lens on raw data)
  if (medium === "binary" && units.length > 0) {
    coverage.Lens = true;
  }

  const covered = ALL_TERRAINS.filter((t) => coverage[t]);
  const uncovered = ALL_TERRAINS.filter((t) => !coverage[t]);

  return {
    schema: "TerrainReport@1",
    medium,
    covered,
    uncovered,
    byTerrain: coverage,
    evidence: {
      unitCount: units.length,
      fieldSpec: reading.field_spec?.channels?.map((c) => c.name) ?? [],
      extent: reading.axis?.extent,
    },
    perceiver: `series-chapter-detection`,
  };
}

// ── Main dispatch ─────────────────────────────────────────────────

/**
 * buildTerrainReport(reading) -> TerrainReport@1
 *
 * Single entry point for terrain analysis. Dispatches to the right
 * analysis based on reading.medium. Returns a uniform TerrainReport
 * regardless of input type.
 *
 * @param {object} reading — a Reading@1 from any perceiver
 * @returns {object} TerrainReport@1
 */
export function buildTerrainReport(reading) {
  const medium = reading.medium ?? "binary";

  switch (medium) {
    case "structured":
      return structuredTerrainReport(reading);
    case "text":
      return textTerrainReport(reading);
    case "audio":
    case "video":
      return seriesTerrainReport(reading, medium);
    case "binary":
    default:
      return seriesTerrainReport(reading, "binary");
  }
}

/**
 * BornGate(reading) -> { signalDetected, reason, evidence }
 *
 * The mechanical Born gate: is there real structure in this data, or just
 * noise? When DEF-derived methods abstain across all modalities, the only
 * terrain present is Void — absence of structure. The engine honestly
 * reports Void rather than fabricating signal from noise.
 *
 * signalDetected: false means the data IS Void. Not NUL (that's an operator),
 * not "empty" — Void is the terrain of genuine absence.
 */
export function bornGate(reading) {
  const report = reading.terrain_report ?? buildTerrainReport(reading);
  const covered = report.covered ?? [];
  const medium = reading.medium ?? "binary";

  // Field-only or empty coverage = no structure. Everything is "content"
  // (Field) but nothing else is detectable. The data IS Void.
  // Also: if Void is the ONLY non-Field terrain, the data confirms its own emptiness.
  const nonTrivial = covered.filter((t) => t !== "Field" && t !== "Lens" && t !== "Void");
  const hasStructure = nonTrivial.length > 0;

  if (!hasStructure) {
    return {
      signalDetected: false,
      dominantTerrain: "Void",
      reason: `no non-Field terrain detected in ${medium} data`,
      evidence: { covered, medium, unitCount: reading.units?.length ?? 0 },
    };
  }

  if (medium === "structured" && report.evidence?.states != null) {
    if (report.evidence.states < 2) {
      return {
        signalDetected: false,
        dominantTerrain: "Void",
        reason: "structured data: mode detection found 1 or 0 states (DEF abstained)",
        evidence: { states: report.evidence.states, covered, medium },
      };
    }
  }

  // For audio/video: if chapter detection abstained, no signal
  if ((medium === "audio" || medium === "video") && report.evidence?.unitCount != null) {
    if (report.evidence.unitCount < 2) {
      return {
        signalDetected: false,
        dominantTerrain: "Void",
        reason: `${medium}: insufficient units for structural analysis`,
        evidence: { units: report.evidence.unitCount, medium },
      };
    }
  }

  // For text: if no terrain amplitudes above floor, no signal
  if (medium === "text") {
    const amps = report.evidence?.terrainAmplitudes ?? [];
    const aboveFloor = amps.filter((a) => a.amplitude > 0.05);
    if (aboveFloor.length <= 1) { // only Field likely
      return {
        signalDetected: false,
        dominantTerrain: "Void",
        reason: "text: no terrain amplitudes above noise floor",
        evidence: { amplitudes: amps.length, aboveFloor: aboveFloor.length, medium },
      };
    }
  }

  return {
    signalDetected: true,
    dominantTerrain: nonTrivial[0] ?? "Field",
    reason: `${covered.length} terrains detected in ${medium} data`,
    evidence: { covered, nonTrivial, medium },
  };
}

/**
 * attachTerrainReport(reading) -> reading
 *
 * Convenience: builds a terrain report and Born gate, attaches both to
 * the reading as reading.terrain_report and reading.born_gate.
 * Returns the modified reading.
 */
export function attachTerrainReport(reading) {
  const report = buildTerrainReport(reading);
  const gate = bornGate({ ...reading, terrain_report: report });
  return {
    ...reading,
    terrain_report: report,
    born_gate: gate,
  };
}
