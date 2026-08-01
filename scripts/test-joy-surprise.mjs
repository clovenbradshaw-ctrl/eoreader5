import { readFileSync } from "fs";
import { createEncoder } from "../packages/def/embedder.js";
import { extractSVO } from "../packages/def/svo.js";
import { loadCentroids, nearestCell, axisScores } from "../packages/def/cell.js";

const text = readFileSync("/Users/mlacy/Documents/Default Project/pg84.txt", "utf-8");
const enc = await createEncoder("Xenova/all-MiniLM-L6-v2");
const centroids = await loadCentroids();

const joyWords = ["joy", "happy", "delight", "pleasure", "glad", "smile", "laugh", "hope", "love"];
const surpriseWords = ["surprise", "astonish", "amaz", "start", "shock", "unexpected", "sudden", "strange"];

const clauses = extractSVO(text).slice(0, 300);

const results = [];

for (const clause of clauses) {
  const contextStart = Math.max(0, clause.offset - 200);
  const contextEnd = Math.min(text.length, clause.offset + 200);
  const context = text.slice(contextStart, contextEnd).toLowerCase();
  
  const joyHits = joyWords.filter(w => context.includes(w)).length;
  const surpriseHits = surpriseWords.filter(w => context.includes(w)).length;
  const isEmotional = joyHits > 0 || surpriseHits > 0;
  
  // Use full clause embedding, not verb delta
  const embedding = await enc.encode(clause.text);
  const cell = nearestCell(embedding, centroids);
  const axes = axisScores(embedding, centroids);
  
  results.push({
    clause,
    isEmotional,
    joy: joyHits,
    surprise: surpriseHits,
    cell: `${cell.q1},${cell.q2},${cell.q3}`,
    cellName: cell.operator,
    similarity: cell.similarity,
    axes,
  });
}

const emotional = results.filter(r => r.isEmotional);
const neutral = results.filter(r => !r.isEmotional);

console.log(`Emotional clauses: ${emotional.length}`);
console.log(`Neutral clauses: ${neutral.length}`);

// Compare cell distributions
const cellCounts = (arr) => {
  const counts = {};
  for (const r of arr) {
    counts[r.cell] = (counts[r.cell] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
};

console.log(`\nTop cells for emotional clauses:`);
for (const [cell, count] of cellCounts(emotional).slice(0, 10)) {
  const pct = (count / emotional.length * 100).toFixed(1);
  console.log(`  ${cell}: ${count} (${pct}%)`);
}

console.log(`\nTop cells for neutral clauses:`);
for (const [cell, count] of cellCounts(neutral).slice(0, 10)) {
  const pct = (count / neutral.length * 100).toFixed(1);
  console.log(`  ${cell}: ${count} (${pct}%)`);
}

// Compare axis distributions
const avgAxes = (arr) => {
  if (arr.length === 0) return null;
  const totals = { q1: {}, q2: {}, q3: {} };
  for (const r of arr) {
    for (const axis of ["q1", "q2", "q3"]) {
      for (const [label, score] of Object.entries(r.axes[axis])) {
        totals[axis][label] = (totals[axis][label] || 0) + score / arr.length;
      }
    }
  }
  return totals;
};

console.log(`\nAvg axis scores for emotional clauses:`);
const emotionalAxes = avgAxes(emotional);
if (emotionalAxes) {
  for (const axis of ["q1", "q2", "q3"]) {
    const sorted = Object.entries(emotionalAxes[axis]).sort((a, b) => b[1] - a[1]);
    console.log(`  ${axis}: ${sorted[0][0]}(${sorted[0][1].toFixed(3)}) ${sorted[1][0]}(${sorted[1][1].toFixed(3)}) ${sorted[2][0]}(${sorted[2][1].toFixed(3)})`);
  }
}

console.log(`\nAvg axis scores for neutral clauses:`);
const neutralAxes = avgAxes(neutral);
if (neutralAxes) {
  for (const axis of ["q1", "q2", "q3"]) {
    const sorted = Object.entries(neutralAxes[axis]).sort((a, b) => b[1] - a[1]);
    console.log(`  ${axis}: ${sorted[0][0]}(${sorted[0][1].toFixed(3)}) ${sorted[1][0]}(${sorted[1][1].toFixed(3)}) ${sorted[2][0]}(${sorted[2][1].toFixed(3)})`);
  }
}

// Compare similarity to centroids
const avgSim = (arr) => arr.reduce((s, r) => s + r.similarity, 0) / arr.length;
console.log(`\nAvg similarity to nearest centroid:`);
console.log(`  Emotional: ${avgSim(emotional).toFixed(3)}`);
console.log(`  Neutral: ${avgSim(neutral).toFixed(3)}`);

// Look for cells that are overrepresented in emotional clauses
console.log(`\nCells overrepresented in emotional clauses (emotional% > neutral%):`);
const emotionalCells = cellCounts(emotional);
const neutralCells = cellCounts(neutral);
const allCells = new Set([...emotionalCells.map(c => c[0]), ...neutralCells.map(c => c[0])]);
for (const cell of allCells) {
  const emoCount = emotionalCells.find(c => c[0] === cell)?.[1] || 0;
  const neuCount = neutralCells.find(c => c[0] === cell)?.[1] || 0;
  const emoPct = emoCount / emotional.length;
  const neuPct = neuCount / neutral.length;
  if (emoPct > neuPct * 1.2 && emoCount >= 3) {
    console.log(`  ${cell}: ${emoPct.toFixed(1)}% emotional vs ${neuPct.toFixed(1)}% neutral`);
  }
}
