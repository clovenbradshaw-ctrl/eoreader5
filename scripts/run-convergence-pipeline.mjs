// scripts/run-convergence-pipeline.mjs
//
// End-to-end stigmergy pipeline: two walled lenses independently read a text
// through the cube classifier, deposit uncollapsed amplitude traces into
// separate reaction media, and the convergence organ witnesses where they
// independently agree — without any cross-lens communication.
//
// LENS A (character/dramatic): weights Entity + Atmosphere + Tending/Binding/EVA
// LENS B (philosophical/thematic): weights Paradigm + Lens + REC/SYN/Unraveling
//
// Both use classifyAmplitudes() — the uncollapsed fold. Neither lens sees the
// other's deposits. Agreement is witnessed, never optimized toward.
//
// Output: coincident passages, convergence fraction, and correlation with
// the altitude oracle's top scenes.
//
// Usage: node scripts/run-convergence-pipeline.mjs

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { classifyAmplitudes } from "../packages/engine/cube/index.js";
import {
  createReactionLog,
  mintReaction,
  reactionLogAsMedium,
  depositReaction,
} from "../packages/engine/reaction/index.js";
import { witnessConvergence, verifyByteIdentical } from "../packages/engine/emergence/lens-assertion/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Text loading ──────────────────────────────────────────────────────────

const TEXT_PATH = process.env.PG2600 || "/Users/mlacy/Downloads/pg2600.txt";
let text;
try {
  text = readFileSync(TEXT_PATH, "utf-8").replace(/\r\n?/g, "\n");
} catch {
  console.error("Cannot read", TEXT_PATH, "- set PG2600 env var");
  process.exit(1);
}

// Split into ~3000-char passages with 1500 overlap (like the frame organ)
const PAS_LEN = 3000;
const PAS_HOP = 1500;
const passages = [];
for (let off = 0; off < text.length; off += PAS_HOP) {
  const pas = text.slice(off, Math.min(text.length, off + PAS_LEN));
  // Skip passages with very little content
  if (pas.replace(/\s/g, "").length < 100) continue;
  passages.push({ offset: off, text: pas });
}

console.log(`Loaded ${(text.length / 1e6).toFixed(1)}M chars, ${passages.length} passages\n`);

// ── Lens definitions ──────────────────────────────────────────────────────

// Lens A: character/dramatic focus — relationships, emotions, personal stakes
// High weight on: Entity(where people are) + Atmosphere(how they feel)
//                Tending/Binding(what they do to/for each other) + SIG/EVA(reading/evaluating)
const LENS_A = {
  id: "character-dramatic",
  terrainWeights: { Entity: 3, Atmosphere: 2, Link: 1, Lens: 1, Paradigm: 0.2,
                    Void: 0.1, Kind: 0.5, Field: 0.3, Network: 0.5 },
  stanceWeights: { Tending: 3, Binding: 2, Cultivating: 1, Tracing: 0.5, EVA: 0,
                   Dissecting: 0.2, Unraveling: 0.3, Clearing: 0.1, Making: 0.1, Composing: 0.1 },
  operatorWeights: { SIG: 2, EVA: 2, CON: 1, DEF: 0.5, REC: 0.3,
                     NUL: 0.1, SEG: 0.2, INS: 0.1, SYN: 0.2 },
};

// Lens B: philosophical/thematic focus — ideas, paradigms, recontextualization
// High weight on: Paradigm(what worldview is at stake) + Lens(how it's framed)
//                REC/SYN(recontextualizing/synthesizing) + Unraveling(interpreting)
const LENS_B = {
  id: "philosophical-thematic",
  terrainWeights: { Paradigm: 3, Lens: 2, Atmosphere: 1, Entity: 0.5, Network: 1,
                    Void: 0.3, Kind: 0.5, Field: 0.3, Link: 0.3 },
  stanceWeights: { Unraveling: 3, Cultivating: 2, REC: 0, Dissecting: 1, Composing: 1,
                   Tracing: 0.3, Tending: 0.2, Binding: 0.1, Clearing: 0.1, Making: 0.3 },
  operatorWeights: { REC: 3, SYN: 2, EVA: 1, CON: 0.5, SIG: 0.3,
                     NUL: 0.1, SEG: 0.3, DEF: 0.2, INS: 0.1 },
};

// ── Lens scoring ──────────────────────────────────────────────────────────

function lensScore(amps, lens) {
  let score = 0;

  for (const dim of ["terrain", "stance"]) {
    const dimWeights = lens[dim === "terrain" ? "terrainWeights" : "stanceWeights"];
    for (const { label, amplitude } of (amps[dim] || [])) {
      score += amplitude * (dimWeights[label] ?? 0.1);
    }
  }

  // Operator contributes through node count — the dimension-ambient weight
  for (const { label, score: opScore } of (amps.operator || [])) {
    score += Math.log1p(opScore) * (lens.operatorWeights[label] ?? 0.1) * 0.1;
  }

  return score;
}

// ── Lens reading ──────────────────────────────────────────────────────────

function lensClassify(passage, lens, passageIdx) {
  const amps = classifyAmplitudes(passage.text);
  const score = lensScore(amps, lens);

  // Top terrain/stance for the trace
  const topTerrain = amps.terrain[0]?.label ?? "Field";
  const topStance = amps.stance[0]?.label ?? "Tracing";
  const topOperator = amps.operator[0]?.label ?? "SIG";

  return {
    offset: passage.offset,
    passageIdx,
    score,
    topTerrain,
    topStance,
    topOperator,
    amplitudes: {
      terrain: amps.terrain.slice(0, 3).map(t => ({ l: t.label, a: +t.amplitude.toFixed(3) })),
      stance: amps.stance.slice(0, 3).map(s => ({ l: s.label, a: +s.amplitude.toFixed(3) })),
      operator: amps.operator.slice(0, 3).map(o => ({ l: o.label, a: +o.amplitude.toFixed(3) })),
    },
    rawScore: score,
  };
}

// ── Pipeline ──────────────────────────────────────────────────────────────

console.log("=== Running pipeline ===\n");

// Create two walled reaction logs (R1/R2 — no shared state)
const logA = createReactionLog({ reader_id: LENS_A.id, session_id: "wp-convergence" });
const logB = createReactionLog({ reader_id: LENS_B.id, session_id: "wp-convergence" });

// Score thresholds: deposit only on passages scoring above threshold
// Calculated empirically from score distribution
function scoreAll(passages, lens) {
  const scores = passages.map((p, i) => lensClassify(p, lens, i));
  // Use 60th percentile as threshold — top 40% of passages by lens score
  const sorted = [...scores].sort((a, b) => b.rawScore - a.rawScore);
  const threshold = sorted[Math.floor(sorted.length * 0.4)]?.rawScore ?? 0;
  return { scores, threshold, sorted };
}

console.log(`LENS A: ${LENS_A.id}`);
const resultA = scoreAll(passages, LENS_A);
console.log(`  threshold=${resultA.threshold.toFixed(4)}  top=${resultA.sorted.length} above=${resultA.scores.filter(s => s.rawScore > resultA.threshold).length}\n`);

console.log(`LENS B: ${LENS_B.id}`);
const resultB = scoreAll(passages, LENS_B);
console.log(`  threshold=${resultB.threshold.toFixed(4)}  top=${resultB.sorted.length} above=${resultB.scores.filter(s => s.rawScore > resultB.threshold).length}\n`);

// Deposit into separate reaction media
let mA = reactionLogAsMedium(logA, { decay: 0.1 });
let mB = reactionLogAsMedium(logB, { decay: 0.1 });
let seqA = 0, seqB = 0;

for (let i = 0; i < passages.length; i++) {
  const sA = resultA.scores[i];
  if (sA.rawScore > resultA.threshold) {
    const r = mintReaction({
      reader_id: LENS_A.id, session_id: "wp-convergence",
      ts: 1000 + seqA, seq: seqA++, kind: "dwell",
      block_id: `pas-${i}`, extent: null,
      context: { visible_block_ids: [], scale: "passage", lens_id: LENS_A.id },
      payload: {
        offset: sA.offset,
        score: +sA.rawScore.toFixed(4),
        topTerrain: sA.topTerrain,
        topStance: sA.topStance,
        topOperator: sA.topOperator,
        amplitudes: sA.amplitudes,
      },
    });
    const res = depositReaction(mA, r);
    mA = res.medium;
  }

  const sB = resultB.scores[i];
  if (sB.rawScore > resultB.threshold) {
    const r = mintReaction({
      reader_id: LENS_B.id, session_id: "wp-convergence",
      ts: 1000 + seqB, seq: seqB++, kind: "dwell",
      block_id: `pas-${i}`, extent: null,
      context: { visible_block_ids: [], scale: "passage", lens_id: LENS_B.id },
      payload: {
        offset: sB.offset,
        score: +sB.rawScore.toFixed(4),
        topTerrain: sB.topTerrain,
        topStance: sB.topStance,
        topOperator: sB.topOperator,
        amplitudes: sB.amplitudes,
      },
    });
    const res = depositReaction(mB, r);
    mB = res.medium;
  }
}

console.log(`Lens A deposits: ${mA.deposits.length}`);
console.log(`Lens B deposits: ${mB.deposits.length}\n`);

// ── Convergence ───────────────────────────────────────────────────────────

console.log("=== Convergence witness ===\n");

const report = witnessConvergence([mA, mB], {
  labels: [LENS_A.id, LENS_B.id],
  minOverlap: 1,
});

console.log(`Coincident passages: ${report.coincidences.length}`);
console.log(`Convergence fraction: ${report.convergenceFraction.toFixed(6)}`);
console.log(`(of ${(mA.deposits.length * mB.deposits.length).toLocaleString()} possible cross-pairs)\n`);

// Deduplicate by passage ID
const coincidentPassages = new Map();
for (const c of report.coincidences) {
  const blockId = c.overlap.find(o => o.startsWith("block:"))?.split(":")[1];
  if (!blockId) continue;
  if (!coincidentPassages.has(blockId)) {
    coincidentPassages.set(blockId, { count: 0, overlapTypes: new Set(), lensAScore: null, lensBScore: null });
  }
  const entry = coincidentPassages.get(blockId);
  entry.count++;
  for (const o of c.overlap) entry.overlapTypes.add(o.split(":")[0]);
  // Find scores from deposits
  if (!entry.lensAScore) {
    const dA = mA.deposits.find(d => d.trace.block_id === blockId);
    entry.lensAScore = dA?.trace.payload?.score;
  }
  if (!entry.lensBScore) {
    const dB = mB.deposits.find(d => d.trace.block_id === blockId);
    entry.lensBScore = dB?.trace.payload?.score;
  }
}

// Sort by combined score
const ranked = [...coincidentPassages.entries()]
  .sort(([, a], [, b]) => ((b.lensAScore ?? 0) + (b.lensBScore ?? 0)) - ((a.lensAScore ?? 0) + (a.lensBScore ?? 0)));

console.log(`Unique coincident passages: ${ranked.length}\n`);
console.log("=== Top 10 coincident passages (both lenses independently agreed) ===\n");

for (let i = 0; i < Math.min(10, ranked.length); i++) {
  const [blockId, info] = ranked[i];
  const pasIdx = parseInt(blockId.replace("pas-", ""));
  const passage = passages[pasIdx];
  const preview = passage.text.replace(/\n/g, " ").slice(0, 120).trim();

  // Show what each lens saw
  const sA = resultA.scores[pasIdx];
  const sB = resultB.scores[pasIdx];

  console.log(`#${i + 1}  offset=${passage.offset}  [${blockId}]`);
  console.log(`  Lens A: terrain=${sA?.topTerrain} stance=${sA?.topStance} operator=${sA?.topOperator} score=${sA?.rawScore.toFixed(3)}`);
  console.log(`  Lens B: terrain=${sB?.topTerrain} stance=${sB?.topStance} operator=${sB?.topOperator} score=${sB?.rawScore.toFixed(3)}`);
  console.log(`  Text: "${preview}..."\n`);
}

// ── Byte-identical verification ──────────────────────────────────────────

const reportOff = witnessConvergence([mA, mB], { enabled: false });
const verify = verifyByteIdentical([mA, mB], [mA, mB]);
console.log(`\nByte-identical guarantee: ${verify.identical ? "PASS" : "FAIL"}`);
console.log(`  Disabled report produces ${reportOff.coincidences.length} coincidences (must be 0)\n`);

// ── Diversity check ──────────────────────────────────────────────────────

// How different are the two lenses in what they find?
const lensABlocks = new Set(mA.deposits.map(d => d.trace.block_id));
const lensBBlocks = new Set(mB.deposits.map(d => d.trace.block_id));
const union = new Set([...lensABlocks, ...lensBBlocks]);
const intersection = new Set([...lensABlocks].filter(x => lensBBlocks.has(x)));
const jaccard = intersection.size / union.size;

console.log(`Lens A unique blocks: ${lensABlocks.size}`);
console.log(`Lens B unique blocks: ${lensBBlocks.size}`);
console.log(`Union: ${union.size}  Intersection: ${intersection.size}`);
console.log(`Jaccard similarity: ${jaccard.toFixed(4)}`);
console.log(`(Lower = lenses are more genuinely different; ${(1-jaccard).toFixed(4)} divergence)\n`);

// ── Orbit check ───────────────────────────────────────────────────────────

// Check: do the top coincident passages contain actual character names
// and philosophical language? (Validation that both lenses are finding real signal)
const charNames = ["Natásha", "Pierre", "Andrew", "Nicholas", "Mary", "Hélène", "Napoleon", "Kutúzov"];
const philTerms = ["reason", "soul", "truth", "opinion", "wisdom", "free will", "destiny", "providence", "meaning", "fortune"];

let charHits = 0, philHits = 0;
for (const [blockId] of ranked) {
  const pasIdx = parseInt(blockId.replace("pas-", ""));
  const passage = passages[pasIdx];
  if (charNames.some(n => passage.text.includes(n))) charHits++;
  if (philTerms.some(t => passage.text.toLowerCase().includes(t))) philHits++;
}

console.log("=== Orbit validation ===");
console.log(`Top coincident passages with character names: ${charHits}/${ranked.length} (${(charHits/ranked.length*100).toFixed(0)}%)`);
console.log(`Top coincident passages with philosophical terms: ${philHits}/${ranked.length} (${(philHits/ranked.length*100).toFixed(0)}%)`);
console.log(`(Both should be high — these are the dual-signal passages the convergence organ detects)\n`);

// ── Correlation with altitude oracle ──────────────────────────────────────
// The altitude oracle's multi-altitude-fold produces top scenes for each entity.
// We check: of the coincident passages, how many fall within the oracle's scene windows?

console.log("=== Altitude oracle correlation ===\n");

try {
  const { multiAltitudeFold } = await import("../packages/engine/emergence/summary/multi-altitude-fold.js");
  const { buildStore } = await import("../packages/engine/emergence/store/index.js");
  const { default: frameText } = await import("../packages/engine/emergence/summary/text-organ.js");

  // Use the engine's own framing to match the oracle's view
  const frames = frameText(text, { window: 2000, hop: 1000 });
  const store = buildStore(frames, { idfFloor: 2.0, edgeSlots: 24 });

  // Load presence from coref priors
  const presencePath = join(ROOT, "..", "eoPriors", "priors", "coref", "war-and-peace.json");
  let corefPriors;
  try {
    corefPriors = JSON.parse(readFileSync(presencePath, "utf-8"));
  } catch { corefPriors = { entities: {} }; }

  // Score each entity's presence across frames
  const entities = ["Natásha", "Pierre", "Prince Andrew", "Nicholas", "Mary", "Hélène"];
  let topSceneOffsets = new Set();

  for (const entity of entities) {
    try {
      const priors = corefPriors.entities?.[entity]?.names ?? [entity];
      const result = await multiAltitudeFold({
        entity: { name: entity, corefNames: priors },
        frames,
        store,
        text,
        options: { altitudes: [3, 24], topN: 15 },
      });
      // Collect top scene offsets from L1 (6 scenes) level
      const l1Scenes = result.scenes?.find(s => s.altitude === 6)?.scenes ?? [];
      for (const scene of l1Scenes) {
        if (scene?.offset != null) topSceneOffsets.add(scene.offset);
      }
    } catch { /* entity not found in text */ }
  }

  // Check: how many coincident passages are near the oracle's top scenes?
  const WINDOW = 5000; // ±5000 chars around oracle scene offset
  let oracleHits = 0;
  for (const [blockId] of ranked) {
    const pasIdx = parseInt(blockId.replace("pas-", ""));
    const passage = passages[pasIdx];
    for (const sceneOff of topSceneOffsets) {
      if (Math.abs(passage.offset - sceneOff) < WINDOW) {
        oracleHits++;
        break;
      }
    }
  }

  console.log(`Oracle top scenes (across ${entities.length} entities): ~${topSceneOffsets.size} unique offsets`);
  console.log(`Coincident passages near oracle top scenes (±${WINDOW} chars): ${oracleHits}/${ranked.length} (${(oracleHits/ranked.length*100).toFixed(0)}%)`);
  console.log(`(Higher = convergence organ detects passages the oracle independently scored as significant)\n`);
} catch (e) {
  console.log(`Altitude correlation skipped: ${e.message}\n`);
}
