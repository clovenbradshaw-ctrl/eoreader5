// Test golden scorer with moderate sample (first 5K of each text)
import { readFileSync } from "fs";
import { createEncoder } from "../packages/def/embedder.js";
import { loadCentroids } from "../packages/def/cell.js";
import { transitionSignificance, cellKey } from "../packages/def/transition.js";

const TEXTS = {
  "pg2600": "/Users/mlacy/Downloads/pg2600.txt",
  "pg84": "/Users/mlacy/Documents/Default Project/pg84.txt",
};
const GOLDEN = "/Users/mlacy/Documents/Default Project/eoreader5/packages/engine/emergence/summary/golden/span-golden.json";

const golden = JSON.parse(readFileSync(GOLDEN, "utf-8"));
const centroids = loadCentroids();
const enc = await createEncoder("Xenova/all-MiniLM-L6-v2");

const CELL_NAMES = {};
for (const c of centroids) CELL_NAMES[cellKey(c)] = `${c.operator}(${c.resolution},${c.site})`;

for (const [textId, textPath] of Object.entries(TEXTS)) {
  const raw = readFileSync(textPath, "utf-8").replace(/\r\n/g, "\n");
  const sample = raw.slice(0, 5000);
  console.error(`\n--- ${textId} (${sample.length} chars) ---`);

  const t0 = Date.now();
  const result = await transitionSignificance(sample, enc, centroids, { k: 5 });
  console.error(`Elapsed: ${((Date.now()-t0)/1000).toFixed(1)}s, ${result.units} sentences`);

  console.log(`\n=== ${textId}: Cell Transition Entropy ===`);
  console.log(`Sentences: ${result.units}`);
  console.log(`Cells observed: ${new Set(result.cellKeys).size} of 27`);
  console.log(`Uniform entropy: ${result.uniformEntropy.toFixed(3)} bits`);
  console.log(`Mean entropy: ${result.meanEntropy.toFixed(3)} bits`);
  console.log(`Surprise reduction: ${result.surpriseReduction}%`);

  // Check golden anchors
  const entity = golden.entities.find(e => e.text === textId);
  if (!entity) { console.log(`No golden for ${textId}`); continue; }

  console.log(`\n  Golden scenes for ${entity.entity}:`);
  for (const scene of entity.scenes) {
    let foundPos = -1;
    for (let i = 0; i < result.sentences.length; i++) {
      if (result.sentences[i].includes(scene.anchor)) {
        foundPos = i; break;
      }
    }
    if (foundPos < 0) {
      console.log(`    ${scene.id}: anchor not in sample`);
      continue;
    }
    const score = result.scores[foundPos];
    const cell = result.cells[foundPos];
    const cellStr = cell ? `${cell.operator}(${cell.resolution},${cell.site})` : "?";
    const sorted = [...result.scores].sort((a, b) => a - b);
    const rank = sorted.indexOf(score);
    const pct = sorted.length > 0 ? (rank / sorted.length * 100).toFixed(0) : "?";
    const flag = parseInt(pct) >= 80 ? "★" : " ";
    console.log(`    ${flag} ${scene.id.padEnd(20)} score=${score.toFixed(2)} pct=${pct}%  cell=${cellStr}`);
  }
}
console.log("\nDONE");
