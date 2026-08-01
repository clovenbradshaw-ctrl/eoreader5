// scripts/score-transition-golden.mjs — Evaluate transition-based significance
// against the span-golden.
//
// Scores each text through the transition significance pipeline, then checks
// whether golden-scene anchor sentences fall at high-surprisal transitions.
//
// Usage: node scripts/score-transition-golden.mjs [--chars <N>]

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const charLimit = parseInt(args[args.indexOf("--chars") + 1]) || 5000;

const TEXTS = {
  "pg2600": "/Users/mlacy/Downloads/pg2600.txt",
  "pg84": join(ROOT, "pg84.txt"),
};
const GOLDEN = join(ROOT, "packages/engine/emergence/summary/golden/span-golden.json");

import { createEncoder } from "../packages/def/embedder.js";
import { loadCentroids, nearestCell } from "../packages/def/cell.js";
import { buildTransitionMatrix, scoreSequence, findPeaks, cellKey, rowEntropies } from "../packages/def/transition.js";

const golden = JSON.parse(readFileSync(GOLDEN, "utf-8"));
const centroids = loadCentroids();
const enc = await createEncoder("Xenova/all-MiniLM-L6-v2");

const CELL_NAMES = {};
for (const c of centroids) CELL_NAMES[cellKey(c)] = `${c.operator}(${c.resolution},${c.site})`;

// ── Process each text ──────────────────────────────────────────────────────

const allResults = {};

for (const [textId, textPath] of Object.entries(TEXTS)) {
  const raw = readFileSync(textPath, "utf-8").replace(/\r\n/g, "\n");
  const sample = raw.slice(0, charLimit);
  console.error(`\n--- ${textId} (${sample.length} chars) ---`);

  // Split + encode + assign (step by step for progress reporting)
  const sents = sample.replace(/\n/g, " ").split(/(?<=[.!?])\s+/)
    .map(s => s.trim()).filter(s => s.length > 10);

  const cells = [];
  for (let i = 0; i < sents.length; i++) {
    if (i % 20 === 0) console.error(`  encoding ${i}/${sents.length}`);
    const v = await enc.encode(sents[i]);
    cells.push(nearestCell(v, centroids));
  }

  const keys = cells.map(c => cellKey(c));
  const matrix = buildTransitionMatrix(keys, 0.01);
  const entropies = rowEntropies(matrix);
  const scores = scoreSequence(keys, matrix);
  const peaks = findPeaks(scores, 10);

  const meanH = entropies.reduce((s, h) => s + h, 0) / entropies.length;
  const uniformH = Math.log2(27);

  allResults[textId] = { sentences: sents, cells, keys, matrix, scores, peaks, meanH, uniformH };

  // Report
  console.log(`\n=== ${textId}: Cell Transition Entropy ===`);
  console.log(`Sentences: ${sents.length}`);
  console.log(`Cells observed: ${new Set(keys).size} of 27`);
  console.log(`Uniform entropy: ${uniformH.toFixed(3)} bits`);
  console.log(`Mean entropy: ${meanH.toFixed(3)} bits`);
  console.log(`Surprise reduction: ${((1 - meanH / uniformH) * 100).toFixed(1)}%`);

  // Top surprising transitions
  console.log(`\n  Top surprising transitions:`);
  for (const pos of peaks.slice(0, 5)) {
    const fromKey = pos > 0 ? keys[pos - 1] : "START";
    const toKey = keys[pos];
    const fromName = CELL_NAMES[fromKey] || fromKey;
    const toName = CELL_NAMES[toKey] || toKey;
    const snippet = sents[pos].slice(0, 60);
    console.log(`    pos=${pos}  ${fromName} → ${toName}  (${scores[pos].toFixed(2)} bits)`);
    console.log(`      "${snippet}"`);
  }

  // Score golden anchors
  const entity = golden.entities.find(e => e.text === textId);
  if (!entity) { console.log(`  No golden for ${textId}`); continue; }

  console.log(`\n  Golden scenes for ${entity.entity}:`);
  for (const scene of entity.scenes) {
    let foundPos = -1;
    for (let i = 0; i < sents.length; i++) {
      if (sents[i].includes(scene.anchor)) { foundPos = i; break; }
    }
    if (foundPos < 0) {
      console.log(`    ${scene.id.padEnd(20)} anchor not in sample`);
      continue;
    }
    const score = scores[foundPos];
    const cell = cells[foundPos];
    const cellStr = cell ? `${cell.operator}(${cell.resolution},${cell.site})` : "?";
    const sorted = [...scores].sort((a, b) => a - b);
    const rank = sorted.indexOf(score);
    const pct = sorted.length > 0 ? (rank / sorted.length * 100).toFixed(0) : "?";
    const flag = parseInt(pct) >= 80 ? "★" : " ";
    console.log(`    ${flag} ${scene.id.padEnd(20)} score=${score.toFixed(2)} pct=${pct}%  cell=${cellStr}`);
  }
}

// Summary
console.log(`\n\n=== SUMMARY ===`);
for (const [textId, r] of Object.entries(allResults)) {
  console.log(`${textId}: ${r.sentences.length} sents, ${new Set(r.keys).size} cells, ${r.meanH.toFixed(3)} bits mean H (${((1 - r.meanH / r.uniformH) * 100).toFixed(1)}% reduction)`);
}
console.log("\nDONE");
