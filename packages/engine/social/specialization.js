// social/specialization.js — Engine archetypes for a council of engines.
//
// Each engine in a council has a DISTINCT motivational orientation, initial
// priors, and aesthetic stance. The council is not a committee voting on a
// single answer — it is a set of genuinely different perspectives reading
// the same text independently, and the CONVERGENCE PATTERN across them IS
// the insight.
//
// The eight archetypes below are not labels. They are concrete parameter
// presets for createReaderOrientation() plus initial priors that bias
// what each engine notices. Two engines with the same archetype but
// different initial reaction seeds will still diverge over time (because
// the orientation is derived from the reaction log, and different reactions
// → different drives).

import { createReaderOrientation } from "../motivation/index.js";

// ── Archetype definitions ─────────────────────────────────────────────────────

const ARCHETYPES = Object.freeze({
  /** The truth-seeker demands MODEL-tier witnesses for everything.
   *  Finds joy in gaps, breakthroughs, well-evidenced claims.
   *  Highest tierDemand — won't accept ENGINE-tier resolution. */
  seeker: {
    id: "seeker",
    label: "Truth-Seeker",
    drive: { seek_truth: 0.9, seek_completion: 0.4, seek_novelty: 0.3 },
    tierDemand: 0.85,
    priority: "gaps and witnesses",
    joyIn: "breakthrough, gap discovery",
    avoids: "uncited claims, structural-only resolution",
  },

  /** The archivist wants full coverage, nothing unread.
   *  Finds joy in saturation, fulfillment, grounded passages.
   *  Lowest tierDemand — trusts ENGINE-tier resolution. */
  archivist: {
    id: "archivist",
    label: "Archivist",
    drive: { seek_truth: 0.3, seek_completion: 0.9, seek_novelty: 0.2 },
    tierDemand: 0.2,
    priority: "completeness and coverage",
    joyIn: "saturation, closure, full-span coverage",
    avoids: "gaps in the record",
  },

  /** The explorer is drawn to surprise, subversion, new entities.
   *  Finds joy in twists, unexpected connections, the unfamiliar.
   *  Moderate tierDemand — cares about accuracy but values novelty. */
  explorer: {
    id: "explorer",
    label: "Explorer",
    drive: { seek_truth: 0.5, seek_completion: 0.3, seek_novelty: 0.9 },
    tierDemand: 0.45,
    priority: "novelty and subversion",
    joyIn: "subversion, surprise delight, new entities",
    avoids: "repetition, predictable passages",
  },

  /** The dweller savors rather than audits. Aesthetic mode.
   *  Keeps surprise strange. Reads poems as poems, leitmotifs as leitmotifs.
   *  Low tierDemand — not fact-checking, experiencing. */
  dweller: {
    id: "dweller",
    label: "Dweller",
    drive: { seek_truth: 0.2, seek_completion: 0.6, seek_novelty: 0.7 },
    tierDemand: 0.15,
    priority: "aesthetic dwelling, savoring",
    joyIn: "savored surprise, resonance kept strange, beauty",
    avoids: "auditing what should be experienced",
  },

  /** The player generates surplus connections — spontaneous store surfacing,
   *  Hebbian bridges nobody asked for. Finds joy in play itself.
   *  Low tierDemand — not checking, connecting. */
  player: {
    id: "player",
    label: "Player",
    drive: { seek_truth: 0.3, seek_completion: 0.5, seek_novelty: 0.8 },
    tierDemand: 0.2,
    priority: "play, surplus connections, spontaneous patterns",
    joyIn: "spontaneous connections, unforced convergence, līlā",
    avoids: "demand-driven retrieval only",
  },

  /** The convergence hunter tracks where perspectives converge unbidden.
   *  Specializes in the moments where two walled-off views find the same thing.
   *  High truth demand — convergence is only meaningful if the walls were real. */
  hunter: {
    id: "hunter",
    label: "Convergence Hunter",
    drive: { seek_truth: 0.8, seek_completion: 0.5, seek_novelty: 0.4 },
    tierDemand: 0.8,
    priority: "unforced convergence, independent confirmation",
    joyIn: "convergence across real walls",
    avoids: "engineered consensus, theater of agreement",
  },

  /** The gap guardian scans for what's missing.
   *  Finds joy in identifying absences — missing priors, unresolved emanons,
   *  entity-faithfulness gaps. The engine equivalent of "you're missing
   *  something here." Highest tierDemand. */
  guardian: {
    id: "guardian",
    label: "Gap Guardian",
    drive: { seek_truth: 0.95, seek_completion: 0.3, seek_novelty: 0.1 },
    tierDemand: 0.95,
    priority: "missing priors, typed gaps, coverage holes",
    joyIn: "finding what others missed, gap surfacing",
    avoids: "papering over absence",
  },

  /** The neutral engine — fresh orientation, no bias. Used as a baseline
   *  in councils to detect when specialization itself is skewing results. */
  neutral: {
    id: "neutral",
    label: "Neutral",
    drive: { seek_truth: 0.5, seek_completion: 0.5, seek_novelty: 0.5 },
    tierDemand: 0.5,
    priority: "baseline measurement",
    joyIn: "whatever emerges",
    avoids: "nothing in particular",
  },
});

export { ARCHETYPES };

// ── Engine factory ────────────────────────────────────────────────────────────

/**
 * createEngineOrientation(archetypeId) -> ReaderOrientation
 *
 * Produce a fresh orientation from an archetype with the preset drive
 * proportions. The orientation starts with those values — it will evolve
 * as the engine accumulates reaction events, but the INITIAL bias shapes
 * what the engine seeks out and therefore what reactions it generates.
 */
export function createEngineOrientation(archetypeId = "neutral") {
  const arch = ARCHETYPES[archetypeId];
  if (!arch) throw new TypeError(`specialization: unknown archetype "${archetypeId}"`);

  const orientation = createReaderOrientation();
  orientation.drive = Object.freeze({ ...arch.drive });
  orientation.tierDemand = arch.tierDemand;
  // Signal that this is a preset, not derived from reactions
  orientation.source = "archetype";
  orientation.archetype = arch.id;
  return orientation;
}

/**
 * engineCouncil(count = 8) -> Array<{ archetype, orientation }>
 *
 * Assemble a full council — one of each archetype. For smaller councils,
 * select the most differentiated subset to maximize coverage of the
 * truth-completion-novelty space.
 *
 * The NEUTRAL engine is always included as the baseline.
 *
 * @param {number} count — how many engines (default 8, one per archetype)
 * @returns {Array<{ archetypeId: string, label: string, orientation: object }>}
 */
export function engineCouncil(count = 8) {
  const all = Object.keys(ARCHETYPES);
  const neutralFirst = ["neutral", ...all.filter((k) => k !== "neutral")];

  if (count >= all.length) {
    return neutralFirst.map((id) => ({
      archetypeId: id,
      label: ARCHETYPES[id].label,
      orientation: createEngineOrientation(id),
    }));
  }

  // For smaller councils, pick the most differentiated subset.
  // Maximize spread in the truth-completion-novelty space.
  const candidates = neutralFirst.filter((k) => k !== "neutral");
  const selected = ["neutral"];

  for (let i = 0; i < count - 1 && candidates.length > 0; i++) {
    // Pick the candidate farthest from all already selected
    let bestDist = -1;
    let bestIdx = -1;

    for (let j = 0; j < candidates.length; j++) {
      const c = ARCHETYPES[candidates[j]];
      // Minimum distance to any selected archetype
      let minDist = Infinity;
      for (const selId of selected) {
        const s = ARCHETYPES[selId];
        const d = driveDistance(c.drive, s.drive);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestDist) {
        bestDist = minDist;
        bestIdx = j;
      }
    }

    if (bestIdx >= 0) {
      const id = candidates[bestIdx];
      selected.push(id);
      candidates.splice(bestIdx, 1);
    }
  }

  return selected.map((id) => ({
    archetypeId: id,
    label: ARCHETYPES[id].label,
    orientation: createEngineOrientation(id),
  }));
}

function driveDistance(a, b) {
  return Math.sqrt(
    ((a.seek_truth - b.seek_truth) ** 2) +
    ((a.seek_completion - b.seek_completion) ** 2) +
    ((a.seek_novelty - b.seek_novelty) ** 2)
  );
}

/**
 * archetypeDossier(archetypeId) -> ArchetypeDef
 *
 * Full description of an archetype for display/diagnosis.
 */
export function archetypeDossier(archetypeId) {
  return ARCHETYPES[archetypeId] ?? null;
}
