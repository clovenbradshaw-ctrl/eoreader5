// scripts/score-def-golden.mjs — DEF delta scoring baseline.
//
// Measures verb delta behavior against the 27-cell EO lattice.
// Does NOT require LA2 holdout clause data (which is not yet fetched).
// Instead, extracts SVO clauses from a source text (W&P) and reports:
//   - Delta magnitude distribution (mean, sd per verb)
//   - Per-cell distribution of nearest centroids
//   - Axis score profiles (marginal Q1/Q2/Q3)
//   - Verb-to-cell mapping (which verbs land in which cells)
//   - Comparison to LA2 eval summary (top1/top3 chance baselines)
//
// Usage: node scripts/score-def-golden.mjs [--text path/to/text.txt] [--verbs 'kill,marry,die,...']
//
// Future: --clauses path/to/clauses.json to evaluate against holdout gold labels.
//
// Design: the DEF delta is embed(S V O) - embed(S [MASK] O). This isolates the
// verb's contribution to the relational semantics. If the EO geometric structure
// is real, verb deltas should separate by Q1 axis (Differentiating/Relating/
// Generating) with the LA2 centroids acting as a coarse classifier.

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Parse CLI
const args = process.argv.slice(2);
const textIdx = args.indexOf("--text");
const textPath = textIdx >= 0 && args[textIdx + 1] ? args[textIdx + 1] : "/Users/mlacy/Downloads/pg2600.txt";
const verbsIdx = args.indexOf("--verbs");
const verbFilterArg = verbsIdx >= 0 && args[verbsIdx + 1] ? args[verbsIdx + 1] : null;
const verbFilter = verbFilterArg ? new Set(verbFilterArg.split(",").map(v => v.trim().toLowerCase())) : null;

import { createEncoder, lazyEncoder } from "../packages/def/embedder.js";
import { extractSVO, verbDelta, deltaMagnitude } from "../packages/def/svo.js";
import { loadCentroids, nearestCell, cellProximityProfile, axisScores } from "../packages/def/cell.js";

// ── Load artifacts ──────────────────────────────────────────────────────────

const centroids = await loadCentroids();
console.error(`Loaded ${centroids.length} centroids`);
const enc = await createEncoder("Xenova/all-MiniLM-L6-v2");

// Load LA2 eval summary from embedded archetype data
const archetypePath = join(ROOT, "packages/def/centroids.json");
const archetypeMeta = JSON.parse(readFileSync(archetypePath, "utf-8"));
// The eval summary is not in centroids.json — read from the source
const archetypeSource = "/Users/mlacy/.local/share/opencode/tool-output/tool_faf7f4f5b001kAU3CW5DlQzNRu";
let la2EvalSummary = null;
if (existsSync(archetypeSource)) {
  const src = JSON.parse(readFileSync(archetypeSource, "utf-8"));
  la2EvalSummary = src.eval_summary || null;
  console.error(`LA2 eval summary: top1=${(la2EvalSummary?.top1 * 100).toFixed(1)}% top3=${(la2EvalSummary?.top3 * 100).toFixed(1)}% (n=${la2EvalSummary?.test_n})`);
}

// ── Extract and score SVO clauses ───────────────────────────────────────────

const textRaw = readFileSync(textPath, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
// Use first 20KB for a quick test (increase for full evaluation)
const sample = textRaw.slice(0, 20000);
console.error(`Text sample: ${sample.length} chars`);

const clauses = extractSVO(sample);
console.error(`Extracted ${clauses.length} SVO clauses`);

// Filter by verb if requested
const filtered = verbFilter ? clauses.filter(c => verbFilter.has(c.verb)) : clauses;
console.error(`After verb filter: ${filtered.length} clauses`);

if (filtered.length === 0) {
  console.log("NO CLAUSES FOUND");
  process.exit(0);
}

// ── Process each clause ────────────────────────────────────────────────────

const results = [];
for (const [i, clause] of filtered.entries()) {
  if (i > 0 && i % 50 === 0) console.error(`  processed ${i}/${filtered.length}`);
  const delta = await verbDelta(clause.text, clause.subject, clause.verb, clause.object, { encoder: enc });
  const mag = Math.sqrt(delta.reduce((s, x) => s + x * x, 0));
  const cell = nearestCell(delta, centroids);
  const axes = axisScores(delta, centroids);
  const profile = cellProximityProfile(delta, centroids);
  results.push({ clause, delta: mag, nearest: cell, axes, profile });
}

// ── Aggregate ──────────────────────────────────────────────────────────────

const verbGroups = {};
for (const r of results) {
  const v = r.clause.verb;
  if (!verbGroups[v]) verbGroups[v] = [];
  verbGroups[v].push(r);
}

const cellCounts = {};
for (const r of results) {
  const key = `${r.nearest.q1},${r.nearest.q2},${r.nearest.q3}`;
  cellCounts[key] = (cellCounts[key] || 0) + 1;
}

const cellNames = {};
for (const c of centroids) {
  cellNames[`${c.q1},${c.q2},${c.q3}`] = `${c.operator}(${c.resolution},${c.site})`;
}

// ── Report ─────────────────────────────────────────────────────────────────

console.log(`\n=== DEF SCORING REPORT ===`);
console.log(`Source: ${filtered.length} SVO clauses from ${textPath}`);
if (verbFilter) console.log(`Verb filter: ${verbFilterArg}`);

// Delta magnitude stats
const mags = results.map(r => r.delta);
const meanMag = mags.reduce((s, x) => s + x, 0) / mags.length;
const sortedMags = [...mags].sort((a, b) => a - b);
const medMag = sortedMags[Math.floor(sortedMags.length / 2)];
console.log(`\n--- Delta Magnitude ---`);
console.log(`Mean: ${meanMag.toFixed(4)}  Median: ${medMag.toFixed(4)}  Min: ${sortedMags[0].toFixed(4)}  Max: ${sortedMags[sortedMags.length - 1].toFixed(4)}`);

// Verb frequency table (top 20 by count)
const verbEntries = Object.entries(verbGroups).sort((a, b) => b[1].length - a[1].length).slice(0, 20);
console.log(`\n--- Top ${verbEntries.length} Verbs ---`);
console.log(`${"Verb".padEnd(16)} ${"Count".padEnd(6)} ${"Mean Δ".padEnd(10)} ${"Top Cell".padEnd(32)} ${"Axis (q1/q2/q3)".padEnd(36)}`);
console.log("-".repeat(100));
for (const [verb, rs] of verbEntries) {
  const meanDelta = rs.reduce((s, r) => s + r.delta, 0) / rs.length;
  // Modal cell
  const cellKeyCounts = {};
  for (const r of rs) {
    const k = `${r.nearest.q1},${r.nearest.q2},${r.nearest.q3}`;
    cellKeyCounts[k] = (cellKeyCounts[k] || 0) + 1;
  }
  const topCell = Object.entries(cellKeyCounts).sort((a, b) => b[1] - a[1])[0][0];
  const topCellName = cellNames[topCell] || topCell;
  // Mean axis scores
  const axes = rs.map(r => r.axes);
  const meanAxes = {};
  for (const a of ["q1", "q2", "q3"]) {
    const vals = axes.map(ax => Object.entries(ax[a]));
    const meanObj = {};
    for (const entries of vals) {
      for (const [label, score] of entries) {
        meanObj[label] = (meanObj[label] || 0) + score / vals.length;
      }
    }
    const best = Object.entries(meanObj).sort((x, y) => y[1] - x[1])[0];
    meanAxes[a] = `${best[0]}(${best[1].toFixed(3)})`;
  }
  console.log(`${verb.padEnd(16)} ${String(rs.length).padEnd(6)} ${meanDelta.toFixed(4).padEnd(10)} ${topCellName.padEnd(32)} ${`${meanAxes.q1} ${meanAxes.q2} ${meanAxes.q3}`.padEnd(36)}`);
}

// Cell distribution
const sortedCells = Object.entries(cellCounts).sort((a, b) => b[1] - a[1]);
console.log(`\n--- Cell Distribution ---`);
console.log(`${"Cell".padEnd(34)} ${"Count".padEnd(6)} ${"%".padEnd(6)}`);
console.log("-".repeat(46));
for (const [key, count] of sortedCells) {
  const name = cellNames[key] || key;
  console.log(`${name.padEnd(34)} ${String(count).padEnd(6)} ${(count / results.length * 100).toFixed(1).padEnd(6)}`);
}

// Axis distribution (marginal)
console.log(`\n--- Axis Marginal Distribution ---`);
const axisMarginals = { q1: {}, q2: {}, q3: {} };
for (const r of results) {
  for (const a of ["q1", "q2", "q3"]) {
    const entries = Object.entries(r.axes[a]);
    entries.sort((x, y) => y[1] - x[1]);
    const best = entries[0][0];
    axisMarginals[a][best] = (axisMarginals[a][best] || 0) + 1;
  }
}
const axisLabels = {
  q1: ["DIFFERENTIATING", "RELATING", "GENERATING"],
  q2: ["EXISTENCE", "STRUCTURE", "SIGNIFICANCE"],
  q3: ["CONDITION", "PARTICULAR", "PATTERN"],
};
for (const a of ["q1", "q2", "q3"]) {
  const total = Object.values(axisMarginals[a]).reduce((s, x) => s + x, 0);
  console.log(`\n${a.toUpperCase()} axis (mode ${a === "q1" ? "Q1" : a === "q2" ? "domain" : "obj"}):`);
  for (const label of axisLabels[a]) {
    const count = axisMarginals[a][label] || 0;
    const pct = (count / total * 100).toFixed(1);
    const bar = "█".repeat(Math.round(count / total * 40));
    console.log(`  ${label.padEnd(20)} ${String(count).padEnd(6)} ${pct.padEnd(5)}% ${bar}`);
  }
}

// Per-verb variability (top 5 most common verbs)
const topVerbs = verbEntries.slice(0, 5);
console.log(`\n--- Per-Verb Delta Variability (top ${topVerbs.length} verbs) ---`);
console.log(`${"Verb".padEnd(16)} ${"Mean Δ".padEnd(10)} ${"SD Δ".padEnd(10)} ${"CV".padEnd(10)} ${"N".padEnd(6)}`);
console.log("-".repeat(52));
for (const [verb, rs] of topVerbs) {
  const ds = rs.map(r => r.delta);
  const mean = ds.reduce((s, x) => s + x, 0) / ds.length;
  const sd = Math.sqrt(ds.reduce((s, x) => s + (x - mean) ** 2, 0) / ds.length);
  const cv = sd / mean;
  console.log(`${verb.padEnd(16)} ${mean.toFixed(4).padEnd(10)} ${sd.toFixed(4).padEnd(10)} ${cv.toFixed(3).padEnd(10)} ${String(rs.length).padEnd(6)}`);
}

// LA2 comparison
if (la2EvalSummary) {
  console.log(`\n--- Comparison to LA2 Corpus ---`);
  console.log(`LA2 full-clause embedding top-1: ${(la2EvalSummary.top1 * 100).toFixed(1)}% (chance: ${(la2EvalSummary.chance * 100).toFixed(1)}%)`);
  console.log(`LA2 full-clause embedding top-3: ${(la2EvalSummary.top3 * 100).toFixed(1)}%`);
  const numCells = centroids.length;
  const chance = 1 / numCells;
  
  // Compute DEF delta top-1: fraction of clauses whose nearest centroid matches the
  // cell that would be predicted by majority verb vote
  let correct = 0;
  for (const [verb, rs] of verbEntries) {
    const cellKeyCounts = {};
    for (const r of rs) {
      const k = `${r.nearest.q1},${r.nearest.q2},${r.nearest.q3}`;
      cellKeyCounts[k] = (cellKeyCounts[k] || 0) + 1;
    }
    const topCell = Object.entries(cellKeyCounts).sort((a, b) => b[1] - a[1])[0][0];
    for (const r of rs) {
      const k = `${r.nearest.q1},${r.nearest.q2},${r.nearest.q3}`;
      if (k === topCell) correct++;
    }
  }
  const defTop1 = correct / results.length;
  console.log(`DEF verb-delta consistency (self-prediction): ${(defTop1 * 100).toFixed(1)}%`);
  console.log(`DEF vs LA2 gap: ${(defTop1 - la2EvalSummary.top1).toFixed(3)}`);
  console.log(`\nNote: LA2 top1 is for full clause embeddings with gold labels.`);
  console.log(`DEF top1 measures verb self-consistency (do same verbs map to same cells?).`);
  console.log(`Direct comparison needs LA2 holdout clause data --clauses <file>.`);
}

console.log(`\n=== END ===`);
