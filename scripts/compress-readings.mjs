// scripts/compress-readings.mjs
// Full-engine reading of War and Peace: classify each passage via the cube,
// fold operator events into the 27-cell phasepost space, compare against
// every book's pre-computed fold distribution in the corpus prior.
//
// Usage: node scripts/compress-readings.mjs

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { classifyAmplitudes } from "../packages/engine/cube/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EOPRIORS = join(ROOT, "..", "eoPriors");
const TEXT_PATH = process.env.PG2600 || "/Users/mlacy/Downloads/pg2600.txt";

// Framing: sliding windows (same as the engine's frame organ)
const FRAME_LEN = 2000;
const FRAME_HOP = 1000;

const PPM = 1_000_000;

function main() {
  // 1. Load phasepost cells for operator→grain→cell mapping
  const cellsBundle = JSON.parse(readFileSync(join(EOPRIORS, "data", "phasepost-cells.json"), "utf8"));
  const CELL_KEYS = Object.keys(cellsBundle.cells);

  // Build (op, grain) → cell index
  const cellIndex = {};
  for (const [cellKey, def] of Object.entries(cellsBundle.cells)) {
    cellIndex[`${def.op}:${def.grain}`] = cellKey;
  }

  // 2. Load corpus prior per-book distributions in the same 27-cell space
  const cubePrior = JSON.parse(readFileSync(join(EOPRIORS, "priors", "corpus-prior-cube.json"), "utf8"));
  const books = cubePrior.generated_from.per_book;

  // 3. Read W&P and frame it
  const wpFull = readFileSync(TEXT_PATH, "utf8");
  const frames = [];
  for (let off = 0; off + FRAME_LEN <= wpFull.length; off += FRAME_HOP) {
    frames.push(wpFull.slice(off, off + FRAME_LEN));
  }
  console.error(`W&P: ${frames.length} frames, text length ${wpFull.length}`);

  // 4. Classify every frame and build operator events
  // Each frame produces ONE operator event at Figure grain with weight_ppm = PPM
  // The operator is the argmax over that frame's amplitude distribution.
  const operatorEvents = [];
  let nullCount = 0;
  for (let i = 0; i < frames.length; i++) {
    const amps = classifyAmplitudes(frames[i]);
    // Find the operator with highest amplitude
    const bestOp = amps.operator.reduce((best, a) => a.amplitude > best.amplitude ? a : best, amps.operator[0]);
    // Ground: amplitude >= 0.5 (strong signal)
    // Figure: amplitude >= 0.2 (moderate signal)
    // Pattern: amplitude < 0.2 (weak signal)
    let grain = "Figure";
    if (bestOp.amplitude >= 0.5) grain = "Ground";
    else if (bestOp.amplitude < 0.2) grain = "Pattern";
    
    operatorEvents.push({ op: bestOp.label, grain, weight_ppm: PPM });
    if (bestOp.label === "NUL") nullCount++;
  }
  console.error(`Operator events: ${operatorEvents.length}, NUL: ${nullCount}`);

  // 5. Fold operator events into the 27-cell space (same as eo-fold-compression@1.0.0)
  const rawWeights = Object.fromEntries(CELL_KEYS.map(c => [c, 0]));
  for (const ev of operatorEvents) {
    const cell = cellIndex[`${ev.op}:${ev.grain}`];
    if (cell) rawWeights[cell] += ev.weight_ppm;
  }

  // Normalize to PPM (same as toFoldMeasurements)
  const sum = Object.values(rawWeights).reduce((a, b) => a + b, 0);
  const scale = sum > PPM ? PPM / sum : 1;
  const wpDist = {};
  let allocated = 0;
  CELL_KEYS.forEach((cell, i) => {
    const isLast = i === CELL_KEYS.length - 1;
    wpDist[cell] = sum > 0
      ? (isLast ? PPM - allocated : Math.round((rawWeights[cell] / sum) * PPM))
      : 0;
    allocated += isLast ? 0 : wpDist[cell];
  });

  // Top cells
  console.error("\nW&P reading's top fold cells:");
  const sortedCells = Object.entries(wpDist).sort((a, b) => b[1] - a[1]);
  for (const [cell, ppm] of sortedCells.slice(0, 10)) {
    const def = cellsBundle.cells[cell];
    console.error(`  ${cell} = ${ppm} ppm  (${def ? def.label || `${def.op}/${def.stance}/${def.terrain}` : ''})`);
  }

  // 6. Compare against every book's distribution in the cube prior
  function toUnit(dist) {
    let n = 0;
    for (const k of CELL_KEYS) n += (dist[k] || 0) ** 2;
    n = Math.sqrt(n);
    if (n === 0) return null;
    const v = {};
    for (const k of CELL_KEYS) v[k] = (dist[k] || 0) / n;
    return v;
  }

  const wpUnit = toUnit(wpDist);
  const results = [];
  for (const book of books) {
    const bu = toUnit(book.distribution_ppm);
    if (!bu) continue;
    let dot = 0;
    for (const k of CELL_KEYS) dot += (wpUnit[k] || 0) * (bu[k] || 0);
    results.push({ file: book.file, sim: dot, spans: book.spans });
  }
  results.sort((a, b) => b.sim - a.sim);

  // 7. Look up titles
  const pullScript = readFileSync(join(ROOT, "..", "eoPriors", "scripts", "pull-great-books-corpus.py"), "utf8");
  const lines = pullScript.split("\n");
  const diverseScript = readFileSync(join(ROOT, "..", "eoPriors", "scripts", "pull-diverse-corpus.py"), "utf8");
  const dLines = diverseScript.split("\n");

  function lookup(file) {
    const m = file.match(/pg(\d+)/);
    if (!m) return file.replace(/.*__(?:gutenberg__)?/, "").replace(/\.txt$/, "");
    const id = m[1];
    for (const l of lines) {
      if (l.includes(`"${id}"`)) {
        const parts = l.match(/"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/);
        if (parts) return `${parts[3]} (${parts[2]}, ${parts[1].split("_").pop()})`;
      }
    }
    for (const l of dLines) {
      if (l.includes(`pg${id}`)) {
        const parts = l.match(/"([^"]+)"/g);
        if (parts) return parts[0] || `Gutenberg ${id}`;
      }
    }
    return `Gutenberg ${id}`;
  }

  // 8. Output
  console.log(`\nWar and Peace folded reading vs ${results.length} corpus books`);
  console.log(`Protocol: eo-fold-compression@1.0.0 (cube classify → 27-cell fold)`);
  console.log(`Frames: ${frames.length} × ${FRAME_LEN}ch windows`);
  console.log("=".repeat(90));
  console.log("RANK  TITLE                                                   COSINE    SPANS");
  console.log("-".repeat(90));
  for (let i = 0; i < 25; i++) {
    const r = results[i];
    const title = lookup(r.file);
    console.log(`${(i+1).toString().padStart(2)}    ${title.padEnd(55)} ${r.sim.toFixed(6)}  ${r.spans}`);
  }

  console.log("\nBOTTOM 5:");
  for (let i = results.length - 5; i < results.length; i++) {
    const r = results[i];
    const title = lookup(r.file);
    console.log(`     ${title.padEnd(55)} ${r.sim.toFixed(6)}  ${r.spans}`);
  }
}

main();
