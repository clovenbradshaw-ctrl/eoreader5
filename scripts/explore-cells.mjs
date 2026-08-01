import { readFileSync } from "fs";
import { createEncoder } from "../packages/def/embedder.js";
import { loadCentroids, nearestCell } from "../packages/def/cell.js";

const text = readFileSync("/Users/mlacy/Documents/Default Project/pg84.txt", "utf-8");
const enc = await createEncoder("Xenova/all-MiniLM-L6-v2");
const centroids = await loadCentroids();

const cellKeys = {};
for (const c of centroids) {
  cellKeys[`${c.q1},${c.q2},${c.q3}`] = `${c.operator}(${c.resolution},${c.site})`;
}

// Split into sentences, embed each, assign to cell
const sents = text.replace(/\n/g, " ").split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20).slice(0, 500);
console.log(`Processing ${sents.length} sentences`);

const cells = [];
for (const [i, sent] of sents.entries()) {
  if (i % 100 === 0) console.error(`  ${i}/${sents.length}`);
  const v = await enc.encode(sent);
  const cell = nearestCell(v, centroids);
  cells.push(cell);
}

// Build transition matrix (27 x 27)
const cellNames = [...new Set(cells.map(c => `${c.q1},${c.q2},${c.q3}`))].sort();
const cellIdx = {};
for (const [i, name] of cellNames.entries()) cellIdx[name] = i;
const n = cellNames.length;
const trans = Array.from({ length: n }, () => Array(n).fill(0));

for (let i = 0; i < cells.length - 1; i++) {
  const from = `${cells[i].q1},${cells[i].q2},${cells[i].q3}`;
  const to = `${cells[i+1].q1},${cells[i+1].q2},${cells[i+1].q3}`;
  trans[cellIdx[from]][cellIdx[to]]++;
}

// Normalize rows
const totals = trans.map(row => row.reduce((s, x) => s + x, 0));
for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++) {
    trans[i][j] = totals[i] > 0 ? trans[i][j] / totals[i] : 0;
  }
}

// Measure: mean entropy per row
const meanEntropy = trans.map(row => {
  const H = row.reduce((s, p) => s + (p > 0 ? -p * Math.log2(p) : 0), 0);
  return H;
});

const uniform = Math.log2(n);
const avgH = meanEntropy.reduce((s, x) => s + x, 0) / meanEntropy.length;

console.log(`\n=== Cell Transition Entropy ===`);
console.log(`Number of cells observed: ${n}`);
console.log(`Uniform entropy (baseline): ${uniform.toFixed(3)} bits`);
console.log(`Mean observed entropy: ${avgH.toFixed(3)} bits`);
console.log(`Surprise reduction: ${((1 - avgH / uniform) * 100).toFixed(1)}%`);

// Show top transitions (most surprising and most predictable)
console.log(`\n=== Most Predictable Transitions (lowest entropy) ===`);
const cellsByH = meanEntropy.map((h, i) => ({ name: cellNames[i], h, total: totals[i] }))
  .filter(c => c.total >= 5)
  .sort((a, b) => a.h - b.h);
for (const c of cellsByH.slice(0, 5)) {
  const idx = cellIdx[c.name];
  const topDest = trans[idx].map((p, j) => ({ name: cellNames[j], p }))
    .sort((a, b) => b.p - a.p)
    .filter(t => t.p > 0)
    .slice(0, 3);
  console.log(`  ${cellKeys[c.name]} (H=${c.h.toFixed(3)}, n=${c.total})`);
  for (const d of topDest) {
    console.log(`    -> ${cellKeys[d.name]} (p=${(d.p*100).toFixed(0)}%)`);
  }
}

console.log(`\n=== Most Surprising Transitions (highest entropy) ===`);
for (const c of cellsByH.slice(-5).reverse()) {
  const idx = cellIdx[c.name];
  const topDest = trans[idx].map((p, j) => ({ name: cellNames[j], p }))
    .sort((a, b) => b.p - a.p)
    .filter(t => t.p > 0)
    .slice(0, 3);
  console.log(`  ${cellKeys[c.name]} (H=${c.h.toFixed(3)}, n=${c.total})`);
  for (const d of topDest) {
    console.log(`    -> ${cellKeys[d.name]} (p=${(d.p*100).toFixed(0)}%)`);
  }
}

// Uniformity test: chi-square against uniform
const chiSq = trans.reduce((s, row) => {
  const T = row.reduce((ss, x) => ss + x, 0);
  return s + row.reduce((ss, p) => ss + (T > 0 ? (p * T - T / n) ** 2 / (T / n) : 0), 0);
}, 0);
const df = n * (n - 1);
console.log(`\nChi-square (vs uniform): ${chiSq.toFixed(1)} (df=${df})`);
console.log(`Non-uniform: ${chiSq > n * n ? "YES" : "weak"}`);
