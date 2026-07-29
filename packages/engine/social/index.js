// social/index.js — Shared utilities and re-exports for the social module.
//
// The social module enables multiple CGI engine instances to compare notes,
// converge on identity, and witness each other's joy. Every interaction is
// mediated by a host orchestrator — no engine calls another engine directly.
// The engine has no I/O.

export { mintWitnessArtifact, CrossEngineWitness } from "./witness-exchange.js";
export { consensus, engineDossier, engineDossiersFromPackets } from "./consensus.js";
export { playExchange, PlaySession } from "./play.js";
export { createEngineOrientation, engineCouncil, archetypeDossier, ARCHETYPES } from "./specialization.js";
export { createHive, hiveRead } from "./hive.js";
export { CommonsCharter, foundCommons, replayCharter, mintCharterEvent, CHARTER_EVENT_KINDS } from "./commons.js";
export { reactionChannelAsMedium, reactionLogDeposit, storeAsMedium, storeSense } from "./medium-adapters.js";

// ── Shared: fold cosine similarity (used by both witness-exchange and consensus) ──

export function foldCosineSimilarity(foldA, foldB) {
  if (!foldA || !foldB) return 0;

  let dot = 0, normA = 0, normB = 0;
  const faces = ["operator", "terrain", "stance"];

  for (const face of faces) {
    const aa = foldA[face] ?? {};
    const bb = foldB[face] ?? {};
    const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
    for (const k of keys) {
      const a = aa[k] ?? 0;
      const b = bb[k] ?? 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
  }

  return normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

// ── Engine identity ───────────────────────────────────────────────────────────

const ENGINE_ID_PREFIX = "engine";

/**
 * mintEngineId(seed) -> string
 *
 * Stable identity derived from an initialization seed. Same seed = same
 * engine id = deterministic replay. The seed should include:
 *   - The initial reaction log seed
 *   - The initial orientation
 *   - The initial priors
 *
 * The engine uses this id in all witness artifacts and social events.
 *
 * @param {string} seed — stable seed for this engine instance
 * @returns {string}
 */
export function mintEngineId(seed) {
  // Simple deterministic hash from seed — same discipline as content-addressed
  // IDs but using the seed as input rather than a content body.
  return `${ENGINE_ID_PREFIX}:${hashSeed(seed)}`;
}

function hashSeed(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}
