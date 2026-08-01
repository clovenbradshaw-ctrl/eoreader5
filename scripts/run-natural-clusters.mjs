// scripts/run-natural-clusters.mjs
//
// No lenses. No weights. No priors. No delta.
// Just classifyAmplitudes() on every passage and let the text self-organize.
//
// 1. Run classifyAmplitudes on 2152 W&P passages → 27-dim amplitude vectors
// 2. Cluster passages by raw amplitude similarity (no subtraction, no weighting)
// 3. Each cluster IS an emergent reading mode — the text's own organization
// 4. Name each cluster AFTER it forms by its centroid's top terrain/stance/operator
// 5. Report what each cluster sees, divergence between clusters, consensus

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { classifyAmplitudes } from "../packages/engine/cube/index.js";

const ROOT = dirname(fileURLToPath(import.meta.url));

const text = readFileSync(process.env.PG2600 || "/Users/mlacy/Downloads/pg2600.txt", "utf-8").replace(/\r\n?/g, "\n");
const PAS_LEN = 3000, PAS_HOP = 1500;
const passages = [];
for (let off = 0; off < text.length; off += PAS_HOP) {
  const pas = text.slice(off, Math.min(text.length, off + PAS_LEN));
  if (pas.replace(/\s/g, "").length < 100) continue;
  passages.push({ offset: off, text: pas });
}

const TERRAINS = ["Void","Entity","Kind","Field","Link","Network","Atmosphere","Lens","Paradigm"];
const STANCES = ["Clearing","Dissecting","Unraveling","Tending","Binding","Tracing","Cultivating","Making","Composing"];
const OPERATORS = ["NUL","SEG","DEF","SIG","CON","EVA","INS","SYN","REC"];

// ── 1. Classify every passage → 27-dim vector ────────────────────────────

const vectors = [];
for (let i = 0; i < passages.length; i++) {
  const amps = classifyAmplitudes(passages[i].text);

  // Build a flat 27-dim vector: 9t + 9s + 9o
  const vec = [];
  const tMap = {}, sMap = {}, oMap = {};
  for (const { label, amplitude } of amps.terrain) tMap[label] = amplitude;
  for (const { label, amplitude } of amps.stance) sMap[label] = amplitude;
  for (const { label, score } of amps.operator) oMap[label] = Math.log1p(score) * 0.1;

  for (const t of TERRAINS) vec.push(tMap[t] ?? 0);
  for (const s of STANCES) vec.push(sMap[s] ?? 0);
  for (const o of OPERATORS) vec.push(oMap[o] ?? 0);

  vectors.push({
    idx: i, offset: passages[i].offset,
    vec,
    topTerrain: amps.terrain[0]?.label,
    topStance: amps.stance[0]?.label,
    topOperator: amps.operator[0]?.label,
  });
}

console.log(`War and Peace: ${passages.length} passages, each → 27-dim amplitude vector\n`);

// ── 2. Cluster by raw amplitude similarity ──────────────────────────────

function cosDist(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  if (nA === 0 || nB === 0) return 1;
  return 1 - dot / Math.sqrt(nA * nB);
}

function centroid(members) {
  if (members.length === 0) return new Array(27).fill(0);
  const c = new Array(27).fill(0);
  for (const mi of members) {
    for (let i = 0; i < 27; i++) c[i] += vectors[mi].vec[i];
  }
  for (let i = 0; i < 27; i++) c[i] /= members.length;
  return c;
}

// k-means with multiple K values to find natural cluster count
function cluster(k) {
  // Seeds: pick k passages with max pairwise distance
  const seeds = [];
  const used = new Set();
  seeds.push(0); used.add(0);
  for (let s = 1; s < k; s++) {
    let best = -1, bestDist = -1;
    for (let i = 0; i < vectors.length; i++) {
      if (used.has(i)) continue;
      let minDist = Infinity;
      for (const si of seeds) minDist = Math.min(minDist, cosDist(vectors[i].vec, vectors[si].vec));
      if (minDist > bestDist) { bestDist = minDist; best = i; }
    }
    if (best >= 0) { seeds.push(best); used.add(best); }
  }

  let clusters = seeds.map(si => ({ seed: si, members: [], centroid: [...vectors[si].vec] }));
  for (let iter = 0; iter < 20; iter++) {
    for (const c of clusters) c.members = [];
    for (let i = 0; i < vectors.length; i++) {
      let bestC = 0, bestDist = Infinity;
      for (let ci = 0; ci < clusters.length; ci++) {
        const d = cosDist(vectors[i].vec, clusters[ci].centroid);
        if (d < bestDist) { bestDist = d; bestC = ci; }
      }
      clusters[bestC].members.push(i);
    }

    let moved = false;
    for (const c of clusters) {
      if (c.members.length === 0) continue;
      const newC = centroid(c.members);
      if (cosDist(c.centroid, newC) > 0.0001) moved = true;
      c.centroid = newC;
    }
    if (!moved) break;
  }

  // Within-cluster cohesion (average distance to centroid)
  let totalCohesion = 0;
  for (const c of clusters) {
    let cSum = 0;
    for (const mi of c.members) cSum += cosDist(vectors[mi].vec, c.centroid);
    totalCohesion += c.members.length > 0 ? cSum / c.members.length : 0;
  }
  const avgCohesion = totalCohesion / clusters.length;

  // Between-cluster separation (average centroid-centroid distance)
  let totalSep = 0, sepCount = 0;
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      totalSep += cosDist(clusters[i].centroid, clusters[j].centroid);
      sepCount++;
    }
  }
  const avgSep = sepCount > 0 ? totalSep / sepCount : 0;

  return { k, clusters, avgCohesion, avgSep, ratio: avgSep / (avgCohesion + 0.001) };
}

// Try K=2..8 and pick the one with best separation/cohesion ratio
console.log("=== Natural cluster quality (separation/cohesion ratio) ===\n");
let bestK = 2, bestRatio = 0;
for (let k = 2; k <= 8; k++) {
  const result = cluster(k);
  console.log(`  K=${k}: cohesion=${result.avgCohesion.toFixed(4)}  separation=${result.avgSep.toFixed(4)}  ratio=${result.ratio.toFixed(2)}  sizes=${result.clusters.map(c=>c.members.length).join(",")}`);
  if (result.ratio > bestRatio) { bestRatio = result.ratio; bestK = k; }
}

console.log(`\n  Best K = ${bestK} (ratio=${bestRatio.toFixed(2)})\n`);

// ── 3. Analyze the best clustering ──────────────────────────────────────

const best = cluster(bestK);

function decodeCentroid(cent) {
  const tVals = cent.slice(0, 9);
  const sVals = cent.slice(9, 18);
  const oVals = cent.slice(18, 27);

  const topT = TERRAINS[tVals.indexOf(Math.max(...tVals))];
  const topS = STANCES[sVals.indexOf(Math.max(...sVals))];
  const topO = OPERATORS[oVals.indexOf(Math.max(...oVals))];

  return { topT, topS, topO, tVals, sVals, oVals };
}

console.log("=== Natural emergent clusters (self-organized from raw amplitudes) ===\n");

for (let ci = 0; ci < best.clusters.length; ci++) {
  const c = best.clusters[ci];
  const { topT, topS, topO } = decodeCentroid(c.centroid);

  // Distribution of terrains/stances/operators within this cluster
  const tCounts = {}, sCounts = {}, oCounts = {};
  for (const mi of c.members) {
    tCounts[vectors[mi].topTerrain] = (tCounts[vectors[mi].topTerrain] ?? 0) + 1;
    sCounts[vectors[mi].topStance] = (sCounts[vectors[mi].topStance] ?? 0) + 1;
    oCounts[vectors[mi].topOperator] = (oCounts[vectors[mi].topOperator] ?? 0) + 1;
  }

  const topTTally = Object.entries(tCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}(${v})`).join(" ");
  const topSTally = Object.entries(sCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}(${v})`).join(" ");
  const topOTally = Object.entries(oCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}(${v})`).join(" ");

  const name = `${topT}:${topS}:${topO}`;
  console.log(`  Cluster ${ci+1} (${name}): ${c.members.length} passages`);
  console.log(`    terrain: ${topTTally}`);
  console.log(`    stance:  ${topSTally}`);
  console.log(`    operator: ${topOTally}`);

  // Sample passages from this cluster
  const samples = c.members.slice(0, 3).sort(() => Math.random() - 0.5);
  for (const si of samples.slice(0, 2)) {
    const p = passages[si];
    const preview = p.text.replace(/\n/g, " ").slice(0, 100).trim();
    console.log(`    off=${p.offset}: "${preview}..."`);
  }
  console.log();
}

// ── 4. Between-cluster distances ─────────────────────────────────────────

console.log("=== Between-cluster cosine distances ===\n");
for (let i = 0; i < best.clusters.length; i++) {
  for (let j = i + 1; j < best.clusters.length; j++) {
    const d = cosDist(best.clusters[i].centroid, best.clusters[j].centroid);
    const ni = decodeCentroid(best.clusters[i].centroid);
    const nj = decodeCentroid(best.clusters[j].centroid);
    console.log(`  ${ni.topT}:${ni.topS}:${ni.topO} ↔ ${nj.topT}:${nj.topS}:${nj.topO}: ${(d*100).toFixed(1)}% distance`);
  }
}

// ── 5. Distribution: which terrains/stances/operators dominate W&P? ──────

console.log("\n=== Global W&P distribution (what the text IS) ===\n");

const globalT = {}, globalS = {}, globalO = {};
for (const v of vectors) {
  globalT[v.topTerrain] = (globalT[v.topTerrain] ?? 0) + 1;
  globalS[v.topStance] = (globalS[v.topStance] ?? 0) + 1;
  globalO[v.topOperator] = (globalO[v.topOperator] ?? 0) + 1;
}

console.log("Terrain dominance:");
for (const [k, v] of Object.entries(globalT).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k}: ${(v/vectors.length*100).toFixed(1)}%`);
}
console.log("\nStance dominance:");
for (const [k, v] of Object.entries(globalS).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k}: ${(v/vectors.length*100).toFixed(1)}%`);
}
console.log("\nOperator dominance:");
for (const [k, v] of Object.entries(globalO).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k}: ${(v/vectors.length*100).toFixed(1)}%`);
}
