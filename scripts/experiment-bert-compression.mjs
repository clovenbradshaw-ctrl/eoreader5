#!/usr/bin/env node
// scripts/experiment-bert-compression.mjs
// Compare BERT embedding compression to DEF-based holon discovery.
// Embeds all frames via Ollama nomic-embed-text (768-dim BERT-family),
// then compresses via PCA + k-means, and compares discovered segments
// to the holon-discovered events.

import { readFileSync } from "fs";
import { frameText } from "../packages/engine/emergence/summary/text-organ.js";

const EMBED_ENDPOINT = "http://localhost:11434/api/embeddings";
const EMBED_MODEL = "nomic-embed-text:latest";

async function embed(text) {
  const resp = await fetch(EMBED_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!resp.ok) throw new Error(`Embed API ${resp.status}`);
  const data = await resp.json();
  return data.embedding;
}

function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// PCA via SVD on the centered embedding matrix
function pca(embeddings, nComponents) {
  const n = embeddings.length;
  const d = embeddings[0].length;

  // Center the data
  const mean = new Array(d).fill(0);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < d; j++)
      mean[j] += embeddings[i][j] / n;
  const centered = embeddings.map(row => row.map((v, j) => v - mean[j]));

  // Compute covariance matrix (d x d)
  const cov = Array.from({ length: d }, () => new Array(d).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < d; j++)
      for (let k = 0; k < d; k++)
        cov[j][k] += centered[i][j] * centered[i][k] / (n - 1);

  // Power iteration for top nComponents eigenvectors (simplified)
  // Since d=768, we use a randomized SVD approach
  // Generate random matrix
  const Q = Array.from({ length: d }, () =>
    Array.from({ length: nComponents }, () => Math.random() * 2 - 1)
  );
  // Normalize columns
  for (let c = 0; c < nComponents; c++) {
    let norm = 0;
    for (let r = 0; r < d; r++) norm += Q[r][c] * Q[r][c];
    norm = Math.sqrt(norm);
    for (let r = 0; r < d; r++) Q[r][c] /= norm;
  }

  // Power iteration
  for (let iter = 0; iter < 5; iter++) {
    // Q = cov * Q
    const newQ = Array.from({ length: d }, () => new Array(nComponents).fill(0));
    for (let i = 0; i < d; i++)
      for (let j = 0; j < nComponents; j++)
        for (let k = 0; k < d; k++)
          newQ[i][j] += cov[i][k] * Q[k][j];
    // QR normalize
    for (let c = 0; c < nComponents; c++) {
      for (let r = 0; r < d; r++) Q[r][c] = newQ[r][c];
      let norm = 0;
      for (let r = 0; r < d; r++) norm += Q[r][c] * Q[r][c];
      norm = Math.sqrt(norm);
      for (let r = 0; r < d; r++) Q[r][c] /= norm;
      // Gram-Schmidt orthogonalize against previous columns
      for (let c2 = 0; c2 < c; c2++) {
        let dot = 0;
        for (let r = 0; r < d; r++) dot += Q[r][c] * Q[r][c2];
        for (let r = 0; r < d; r++) Q[r][c] -= dot * Q[r][c2];
      }
      let norm2 = 0;
      for (let r = 0; r < d; r++) norm2 += Q[r][c] * Q[r][c];
      norm2 = Math.sqrt(norm2);
      if (norm2 > 1e-10) for (let r = 0; r < d; r++) Q[r][c] /= norm2;
    }
  }

  // Project data onto principal components
  const projected = centered.map(row =>
    Array.from({ length: nComponents }, (_, c) => {
      let val = 0;
      for (let j = 0; j < d; j++) val += row[j] * Q[j][c];
      return val;
    })
  );

  // Compute eigenvalues (variance explained)
  const eigenvalues = Array.from({ length: nComponents }, (_, c) => {
    let var_ = 0;
    for (let i = 0; i < n; i++) var_ += projected[i][c] * projected[i][c] / (n - 1);
    return var_;
  });
  const totalVar = eigenvalues.reduce((a, b) => a + b, 0);

  return { projected, eigenvalues, totalVar, explained: eigenvalues.map(v => v / totalVar) };
}

// k-means clustering
function kMeans(data, k, maxIter = 50) {
  const n = data.length;
  const d = data[0].length;

  // Initialize with k-means++ like seeding
  const centers = [];
  centers.push(data[Math.floor(Math.random() * n)]);
  for (let c = 1; c < k; c++) {
    const dists = data.map(p => {
      const minDist = Math.min(...centers.map(ctr => {
        let sq = 0;
        for (let j = 0; j < d; j++) sq += (p[j] - ctr[j]) ** 2;
        return sq;
      }));
      return minDist;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < n; i++) { r -= dists[i]; if (r <= 0) { idx = i; break; } }
    centers.push(data[idx]);
  }

  const labels = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign labels
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        let sq = 0;
        for (let j = 0; j < d; j++) sq += (data[i][j] - centers[c][j]) ** 2;
        if (sq < bestDist) { bestDist = sq; best = c; }
      }
      if (labels[i] !== best) changed++;
      labels[i] = best;
    }
    if (changed === 0) break;

    // Update centers
    const sums = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      counts[labels[i]]++;
      for (let j = 0; j < d; j++) sums[labels[i]][j] += data[i][j];
    }
    for (let c = 0; c < k; c++)
      if (counts[c] > 0)
        for (let j = 0; j < d; j++)
          centers[c][j] = sums[c][j] / counts[c];
  }

  // Count transitions (cluster changes between consecutive frames)
  let transitions = 0;
  for (let i = 1; i < n; i++)
    if (labels[i] !== labels[i - 1]) transitions++;

  // Find the longest contiguous run per cluster
  const runs = [];
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || labels[i] !== labels[i - 1]) {
      runs.push({ cluster: labels[runStart], start: runStart, end: i - 1, length: i - runStart });
      runStart = i;
    }
  }
  const longestPerCluster = new Map();
  for (const r of runs) {
    const prev = longestPerCluster.get(r.cluster);
    if (!prev || r.length > prev.length) longestPerCluster.set(r.cluster, r);
  }

  return { labels, centers, transitions, runs, longestPerCluster };
}

// ── Main ──

async function main() {
  const textPath = process.argv[2] || "/Users/mlacy/Downloads/pg2600.txt";
  const textName = textPath.includes("pg10") ? "KJV Bible" : textPath.includes("pg2600") ? "War and Peace" : textPath;
  console.log(`\n=== BERT Embedding Compression: ${textName} ===\n`);

  const raw = readFileSync(textPath, "utf-8");
  const frames = frameText(raw);
  console.log(`Frames: ${frames.length}`);

  // Step 1: Embed all frames
  console.log("\nEmbedding frames via nomic-embed-text (768-dim)...");
  const embeddings = [];
  for (let i = 0; i < frames.length; i++) {
    const text = frames[i].text.slice(0, 1500); // Fit within 2048 token limit
    const vec = await embed(text);
    embeddings.push(vec);
    if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${frames.length} embedded`);
  }
  console.log(`  Done: ${embeddings.length} frames embedded`);

  // Step 2: PCA compression
  console.log("\n--- PCA Compression ---");
  const pcaResult = pca(embeddings, 5);
  console.log(`  Variance explained by top 5 components:`);
  pcaResult.explained.forEach((v, i) =>
    console.log(`    PC${i + 1}: ${(v * 100).toFixed(1)}%`)
  );
  console.log(`  Total variance (5 PCs): ${(pcaResult.explained.reduce((a, b) => a + b, 0) * 100).toFixed(1)}%`);

  // Reconstruction error per frame (using top 5 PCs)
  const d = embeddings[0].length;
  const mean = new Array(d).fill(0);
  for (let i = 0; i < embeddings.length; i++)
    for (let j = 0; j < d; j++)
      mean[j] += embeddings[i][j] / embeddings.length;

  // Reconstruct from PCA: need the eigenvectors (Q matrix we computed inside pca)
  // For simplicity, use cosine distance from projection — frames with high
  // reconstruction error are "novel" or "anomalous" in BERT space

  // Compute frame-to-frame cosine similarity as a segmentation signal
  console.log("\n--- Frame-to-Frame Cosine Similarity ---");
  const similarities = [];
  for (let i = 0; i < embeddings.length; i++) {
    const sim = i > 0 ? cosine(embeddings[i], embeddings[i - 1]) : 1;
    similarities.push(sim);
  }

  // Find sharp drops in similarity (potential narrative boundaries)
  const boundaries = [];
  const windowSize = 10;
  for (let i = windowSize; i < similarities.length - windowSize; i++) {
    const local = similarities.slice(i - windowSize, i + windowSize + 1);
    const meanLocal = local.reduce((a, b) => a + b, 0) / local.length;
    let varLocal = 0;
    for (const v of local) varLocal += (v - meanLocal) ** 2;
    varLocal /= local.length;
    const stdLocal = Math.sqrt(varLocal) || 0.001;
    const z = (meanLocal - similarities[i]) / stdLocal; // Positive when similarity dips below local mean
    if (z > 2.5) {
      boundaries.push({
        order: frames[i].order,
        offset: frames[i].offset,
        similarity: similarities[i],
        z,
        text: frames[i].text.slice(0, 80)
      });
    }
  }
  console.log(`  Found ${boundaries.length} sharp boundaries (z>2.5)`);
  const topBoundaries = boundaries.sort((a, b) => b.z - a.z).slice(0, 20);
  for (const b of topBoundaries) {
    console.log(`  frame ${String(b.order).padStart(4)}  z=${b.z.toFixed(2)}  sim=${b.similarity.toFixed(3)}  ${b.text.replace(/\n/g, ' ').slice(0, 60)}`);
  }

  // Step 3: k-means clustering
  console.log("\n--- K-Means Clustering on BERT Embeddings ---");
  for (const k of [5, 8, 12]) {
    const result = kMeans(embeddings, k);
    const longestRuns = [...result.longestPerCluster.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cluster, run]) =>
        `  C${cluster}: ${run.length}f frames ${run.start}→${run.end} (${(run.start / frames.length * 100).toFixed(0)}%–${(run.end / frames.length * 100).toFixed(0)}% of text)`
      );
    console.log(`\n  k=${k}: ${result.transitions} cluster transitions, ${result.runs.length} total runs`);
    for (const l of longestRuns) console.log(l);

    // Map cluster transitions to text regions
    const transitions = [];
    for (let i = 1; i < result.labels.length; i++) {
      if (result.labels[i] !== result.labels[i - 1]) {
        transitions.push({
          from: result.labels[i - 1],
          to: result.labels[i],
          atFrame: i,
          atPct: ((frames[i].offset / raw.length) * 100).toFixed(0)
        });
      }
    }
    console.log(`  Key transitions:`);
    const spread = 5;
    const sampleTransitions = transitions.filter((t, idx) => {
      if (idx === 0 || idx === transitions.length - 1) return true;
      if (t.from !== transitions[idx - 1].from || t.to !== transitions[idx - 1].to) return true;
      const prev = transitions[idx - 1];
      return (t.atFrame - prev.atFrame) > 3;
    });
    for (const t of sampleTransitions.slice(0, 15)) {
      const preview = frames[t.atFrame]?.text.slice(0, 80).replace(/\n/g, ' ') || '';
      console.log(`  frame ${String(t.atFrame).padStart(4)} (${t.atPct}%)  C${t.from}→C${t.to}  "${preview}"`);
    }
  }

  // Step 4: Compare to holon-discovered events
  console.log("\n=== COMPARISON: BERT Boundaries vs Holon Events ===\n");

  // Reference: W&P holon events from the experiment
  const HOLON_EVENTS_WP = [
    { type: "Atmosphere ★", range: [2576, 2597], label: "Prince Andrew's death" },
    { type: "Atmosphere ★", range: [844, 863], label: "Pierre after duel, Natasha's illness, Rostov family" },
    { type: "Atmosphere ★", range: [1713, 1733], label: "Battle scenes with Rostov" },
    { type: "Network ★", range: [2634, 2649], label: "Free will/destiny philosophy" },
    { type: "Network ★", range: [2821, 2831], label: "'Ridicule' line" },
    { type: "Network ★", range: [388, 403], label: "Characters in society introductions" },
    { type: "Network ★", range: [1994, 2004], label: "Military position discourse" },
  ];

  const HOLON_EVENTS_BIBLE = [
    { type: "Entity ★", range: [519, 557], label: "Numbers census (chapters 1-7)" },
    { type: "Entity ★", range: [215, 242], label: "Exodus — Moses in Midian, plagues" },
    { type: "Entity ★", range: [1606, 1629], label: "1 Chronicles genealogies, David's rise" },
    { type: "Entity ★", range: [2924, 2943], label: "Ezekiel's throne vision, judgment" },
    { type: "Atmosphere ★", range: [3186, 3202], label: "Hosea prophecy" },
    { type: "Atmosphere ★", range: [2304, 2320], label: "Psalms 137-140 lament" },
  ];

  const holonEvents = textPath.includes("pg10") ? HOLON_EVENTS_BIBLE : HOLON_EVENTS_WP;

  console.log("How many BERT k-means cluster transitions fall WITHIN each holon event:\n");
  for (const ev of holonEvents) {
    // Check with k=12 clustering
    const result = kMeans(embeddings, 12);
    const [start, end] = ev.range;
    let internalTransitions = 0;
    for (let i = start + 1; i <= end; i++) {
      if (result.labels[i] !== result.labels[i - 1]) internalTransitions++;
    }
    // Also check: is there a boundary (cosine similarity dip) at the edges?
    const startBoundary = boundaries.find(b => Math.abs(b.order - start) <= 3);
    const endBoundary = boundaries.find(b => Math.abs(b.order - end) <= 3);
    console.log(`  ${ev.type} "${ev.label}" (f${start}-${end}):`);
    console.log(`    Internal cluster transitions: ${internalTransitions}`);
    console.log(`    BERT cosine boundary at start: ${startBoundary ? `yes (z=${startBoundary.z.toFixed(1)})` : "no"}`);
    console.log(`    BERT cosine boundary at end:   ${endBoundary ? `yes (z=${endBoundary.z.toFixed(1)})` : "no"}`);
  }

  // BERT-based segmentation quality: are cluster labels more consistent within
  // holon events than across the whole text?
  console.log("\n--- Segmentation Quality: BERT clusters within holon events ---\n");
  const k12 = kMeans(embeddings, 12);
  const globalEntropy = computeEntropy(k12.labels);
  console.log(`  Global cluster entropy: ${globalEntropy.toFixed(3)}`);

  for (const ev of holonEvents) {
    const [start, end] = ev.range;
    const segmentLabels = k12.labels.slice(start, end + 1);
    const localEntropy = computeEntropy(segmentLabels);
    const dominantCluster = getDominant(segmentLabels);
    const proportion = segmentLabels.filter(l => l === dominantCluster).length / segmentLabels.length;
    console.log(`  ${ev.type} "${ev.label}": local entropy=${localEntropy.toFixed(3)} (global=${globalEntropy.toFixed(3)})  dominant=C${dominantCluster} in ${(proportion*100).toFixed(0)}% of frames`);
  }
}

function computeEntropy(labels) {
  const counts = new Map();
  for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / labels.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function getDominant(arr) {
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null, bestCount = 0;
  for (const [k, v] of counts) if (v > bestCount) { best = k; bestCount = v; }
  return best;
}

main().catch(e => { console.error(e); process.exit(1); });
