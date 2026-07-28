// social/hive.js — Hive orchestrator: stigmergy across walled engines.
//
// The hive does NOT merge state. Same discipline as same-string auto-merge
// (docs/nameless-referent.md) applied at the scale of whole creatures:
// multiple engines are genuinely walled off from each other — they share
// NO working memory, NO discourse state, NO store. They communicate only
// through a shared commons: an append-only, content-addressed log of
// witness artifacts that each engine reads through its own individuation
// gate. This IS stigmergy, the mechanism real biological hives use — ants
// leave pheromone trails, termites deposit building material, but no ant's
// mind merges with another's.
//
// The commons is the WitnessArtifact stream. Each engine writes into it
// (what it saw at each passage) and reads from it (what other engines saw).
// The CrossEngineWitness is the individuation gate: engine A reads engine
// B's artifact, but A processes it through A's own fold, orientation, and
// prior — never by direct merge. Agreement is witnessed; disagreement is
// a typed gap. No vote. No average. No shared discourse.
//
// Genuine specialization (not just parameter tweaks):
//   - Different perceiver modalities: text organ vs audio transcript organ
//     vs video description organ (already exist as parallel organs)
//   - Different injected priors: one engine has the Frankenstein coref prior,
//     another doesn't (creating a real wall — the one without will gap)
//   - Different source windows: one engine reads chapters 1-10, another
//     reads 11-20 (different evidence, same text)
//
// Usage (host-side, never inside the engine):
//   const hive = createHive(council);
//   const result = hive.read(text, entityName, { ... });

import { multiAltitudeFold } from "../emergence/summary/multi-altitude-fold.js";
import { ConvergenceWitness } from "../discourse/resonance.js";
import { DiscourseState } from "../discourse/index.js";
import { CrossEngineWitness, mintWitnessArtifact } from "./witness-exchange.js";
import { consensus, engineDossiersFromPackets } from "./consensus.js";
import { engineCouncil } from "./specialization.js";

/**
 * createHive(council) -> Hive
 *
 * Assemble a council of engines with their orientations. The council
 * determines HOW MANY perspectives and WHAT KINDS — use engineCouncil()
 * to generate a differentiated set.
 *
 * @param {Array<{ archetypeId, label, orientation }>} council
 * @returns {Hive}
 */
export function createHive(council = null) {
  const members = council ?? engineCouncil();
  return {
    schema: "Hive@1",
    memberCount: members.length,
    members: members.map((m, i) => ({
      engineId: `${m.archetypeId}:${i}`,
      archetypeId: m.archetypeId,
      label: m.label,
      orientation: m.orientation,
      witnessCount: 0,
    })),
    convergenceWitnesses: new Map(), // engineId -> ConvergenceWitness
    crossWitnesses: new Map(),       // engineId -> CrossEngineWitness
    results: [],
  };
}

/**
 * hiveRead(hive, text, entityName, options) -> HiveResult
 *
 * Run EVERY engine in the hive on the same text+entity. For each engine:
 *   1. Produce a multi-altitude fold packet
 *   2. Extract witness artifacts at each selected span
 *   3. Compare artifacts across engines (cross-witness)
 *   4. Build consensus report
 *
 * This function DOES make multiple calls to multiAltitudeFold — one per
 * engine. Each call is independent (deterministic given its orientation
 * and any discourse state). The engine has no I/O; the hive orchestrator
 * is the host that feeds each engine its inputs and collects outputs.
 *
 * @param {Hive} hive
 * @param {string} text — the source text
 * @param {string} entityName — the entity to fold
 * @param {object} options — passed through to multiAltitudeFold
 * @returns {HiveResult}
 */
export function hiveRead(hive, text, entityName, options = {}) {
  const { withResonance = true, altitude = 4, referent = null } = options;

  const packets = [];
  const allArtifacts = []; // [{ engineId, artifacts: [WitnessArtifact] }]

  // Initialize cross-witness for each engine pair
  for (const member of hive.members) {
    const cw = new CrossEngineWitness(member.engineId);
    hive.crossWitnesses.set(member.engineId, cw);
  }

  // ── Step 1: each engine reads independently ─────────────────────────
  // CRITICAL: every engine gets its OWN DiscourseState with its OWN
  // orientation. No shared working memory — that's the merge-mind problem
  // ("same-string auto-merge" at engine scale). The commons is the ONLY
  // channel between engines.
  for (const member of hive.members) {
    // Each engine's discourse is walled — own motifs, own activation, own
    // resonance events. The orientation drives what the engine cares about.
    const engineDiscourse = new DiscourseState({
      orientation: member.orientation,
    });

    const engineOptions = {
      ...options,
      withResonance,
      altitudes: { [altitude]: 24 },
      discourse: engineDiscourse, // walled, per-engine
    };

    const packet = multiAltitudeFold(text, entityName, {
      ...engineOptions,
      referent,
    });

    packets.push({
      engine_id: member.engineId,
      archetype: member.archetypeId,
      orientation: member.orientation,
      packet,
    });

    // ── Step 2: extract witness artifacts ──
    const spans = packet.altitudes?.[altitude]?.spans ?? [];
    const artifacts = [];

    for (const span of spans) {
      if (span.offset == null) continue;

      // Build a fold from the span's cube coordinate if available
      const fold = span.coord ? {
        operator: span.coord.operator ?? {},
        terrain: span.coord.terrain ?? {},
        stance: span.coord.stance ?? {},
      } : null;

      const artifact = mintWitnessArtifact({
        engine_id: member.engineId,
        self_head: `self-record:${member.engineId}`, // placeholder — real self-record would be tracked
        passage_offset: span.offset,
        passage_length: span.length ?? (span.text?.length ?? 0),
        fold,
        presence: { [entityName]: span.entityPresent === true || span.entityPresent === null ? 1 : 0 },
        resonance_events: span.ananda?.joy_events ?? [],
        spontaneous_connections: span.ananda?.spontaneous_connections ?? [],
      });

      artifacts.push(artifact);
    }

    allArtifacts.push({ engineId: member.engineId, artifacts });
  }

  // ── Step 3: cross-witness — compare each pair of engines ────────────
  const crossEvents = [];
  for (const a of allArtifacts) {
    for (const b of allArtifacts) {
      if (a.engineId >= b.engineId) continue; // only do each pair once

      const cwA = hive.crossWitnesses.get(a.engineId);
      const cwB = hive.crossWitnesses.get(b.engineId);

      // For each shared passage offset, witness convergence/divergence
      const aOffsets = new Set(a.artifacts.map((art) => art.passage_offset));
      for (const artB of b.artifacts) {
        // Find closest artifact from A within tolerance
        let bestArtA = null;
        let bestDist = Infinity;
        for (const artA of a.artifacts) {
          const d = Math.abs(artA.passage_offset - artB.passage_offset);
          if (d < bestDist && d < 500) {
            bestDist = d;
            bestArtA = artA;
          }
        }

        if (bestArtA) {
          if (cwA) {
            const event = cwA.witness(bestArtA, artB, 0, "hive");
            if (event) crossEvents.push({ ...event, direction: `${a.engineId}→${b.engineId}` });
          }
          if (cwB) {
            const event = cwB.witness(artB, bestArtA, 0, "hive");
            if (event) crossEvents.push({ ...event, direction: `${b.engineId}→${a.engineId}` });
          }
        }
      }
    }
  }

  // ── Step 4: consensus ──────────────────────────────────────────────
  const consensusReport = consensus(packets, { altitude });
  const dossiers = engineDossiersFromPackets(packets, consensusReport);

  // ── Step 5: hive ananda — shared joy passages ───────────────────────
  const hiveAnanda = buildHiveAnanda(packets, altitude);

  // ── Step 6: peer graphs — which engines converge most? ─────────────
  const peerGraph = [];
  for (const member of hive.members) {
    const cw = hive.crossWitnesses.get(member.engineId);
    if (cw) {
      peerGraph.push({
        engine_id: member.engineId,
        archetype: member.archetypeId,
        summary: cw.summary(),
      });
    }
  }

  return Object.freeze({
    schema: "HiveResult@1",
    entity: entityName,
    engineCount: hive.members.length,
    packets: packets.map((p) => ({
      engine_id: p.engine_id,
      archetype: p.archetype,
      sceneCount: p.packet.altitudes?.[altitude]?.spans?.length ?? 0,
    })),
    byEngine: packets,
    consensusReport,
    dossiers: Object.fromEntries(dossiers),
    crossEvents: crossEvents.slice(0, 50),
    hiveAnanda,
    peerGraph,
  });
}

// ── Hive ananda — shared joy ─────────────────────────────────────────────────

function buildHiveAnanda(packets, altitude) {
  // Collect all spans that carry ananda witnesses
  const anandaByOffset = new Map();

  for (const entry of packets) {
    const spans = entry.packet?.altitudes?.[altitude]?.spans ?? [];
    for (const span of spans) {
      if (!span.ananda || Object.keys(span.ananda).length === 0) continue;
      if (span.offset == null) continue;

      const key = Math.round(span.offset / 50) * 50;
      let entry2 = anandaByOffset.get(key);
      if (!entry2) {
        entry2 = { offset: key, engines: new Map() };
        anandaByOffset.set(key, entry2);
      }
      entry2.engines.set(entry.engine_id, {
        archetype: entry.archetype,
        ananda: span.ananda,
      });
    }
  }

  // Shared ananda: passages where 2+ engines experienced joy
  const shared = [];
  const solo = [];
  for (const [, entry] of anandaByOffset) {
    if (entry.engines.size >= 2) {
      const types = new Set();
      for (const [, e] of entry.engines) {
        if (e.ananda.savored_surprise) types.add("savored_surprise");
        if (e.ananda.joy_events) types.add("joy_events");
        if (e.ananda.convergences) types.add("convergences");
        if (e.ananda.spontaneous_connections) types.add("spontaneous_connections");
      }
      shared.push({
        offset: entry.offset,
        engineCount: entry.engines.size,
        engineIds: [...entry.engines.keys()],
        archetypes: [...new Set([...entry.engines.values()].map((e) => e.archetype))],
        joyTypes: [...types],
      });
    } else {
      solo.push({
        offset: entry.offset,
        engineId: [...entry.engines.keys()][0],
      });
    }
  }

  shared.sort((a, b) => b.engineCount - a.engineCount);

  return {
    sharedJoyPassages: shared.length,
    soloJoyPassages: solo.length,
    topShared: shared.slice(0, 10),
  };
}
