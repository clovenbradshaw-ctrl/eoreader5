// scripts/run-autopoetic-lenses.mjs
//
// Autopoetic lens emergence from priors + content on separate channels.
//
// THREE CHANNELS (per passage):
//   PRIOR   — how the passage matches the corpus-prior distribution
//   CONTENT — classifyAmplitudes() raw amplitudes
//   DELTA   — content minus prior = unexpected elevation
//
// AUTOPOETIC EMERGENCE:
//   Passages cluster by their delta signatures. Each coherent cluster that
//   passes a deriveNull cohesion test becomes a lens. The lens's weights
//   ARE the cluster's mean delta pattern — no human names them.
//
// COMPARISON: prior lenses vs content lenses vs delta lenses.
//   Each set reads W&P independently. Convergence across lens types
//   reveals what's prior-driven, content-driven, or genuinely surprising.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { classifyAmplitudes } from "../packages/engine/cube/index.js";
import {
  createReactionLog, mintReaction, reactionLogAsMedium, depositReaction,
} from "../packages/engine/reaction/index.js";
import { witnessConvergence } from "../packages/engine/emergence/lens-assertion/index.js";
import { deriveNull, createSeededRng } from "../packages/engine/emergence/nulls/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Load corpus prior ────────────────────────────────────────────────────

const priorPath = join(ROOT, "..", "eoPriors", "priors", "corpus-prior-cube.json");
const corpusPrior = JSON.parse(readFileSync(priorPath, "utf-8"));
const PPM = corpusPrior.distribution_ppm;

const OPERATORS = ["NUL","SEG","DEF","SIG","CON","EVA","INS","SYN","REC"];
const TERRRAINS = ["Void","Entity","Kind","Field","Link","Network","Atmosphere","Lens","Paradigm"];
const STANCES = ["Clearing","Dissecting","Unraveling","Tending","Binding","Tracing","Cultivating","Making","Composing"];

// Marginal distributions: sum across the other two dimensions
function marginalize(dimKey, others) {
  const result = {};
  for (const key of Object.keys(PPM)) {
    const parts = key.split("_"); // OPERATOR_STANCE_TERRAIN
    const dim = dimKey === "terrain" ? parts[2] : dimKey === "stance" ? parts[1] : parts[0];
    result[dim] = (result[dim] ?? 0) + PPM[key];
  }
  // Normalize
  const total = Object.values(result).reduce((a,b)=>a+b, 0);
  for (const k of Object.keys(result)) result[k] /= total;
  return result;
}

const priorTerrainDist = marginalize("terrain");
const priorStanceDist = marginalize("stance");
const priorOperatorDist = marginalize("operator");

console.log("Corpus prior (199 books, 14,735 spans):");
console.log("  Top terrain:", Object.entries(priorTerrainDist).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}=${(v*100).toFixed(1)}%`).join(" "));
console.log("  Top stance:", Object.entries(priorStanceDist).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}=${(v*100).toFixed(1)}%`).join(" "));
console.log("  Top operator:", Object.entries(priorOperatorDist).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}=${(v*100).toFixed(1)}%`).join(" "));

// ── Load text ────────────────────────────────────────────────────────────

const text = readFileSync(process.env.PG2600 || "/Users/mlacy/Downloads/pg2600.txt", "utf-8").replace(/\r\n?/g, "\n");
const PAS_LEN = 3000, PAS_HOP = 1500;
const passages = [];
for (let off = 0; off < text.length; off += PAS_HOP) {
  const pas = text.slice(off, Math.min(text.length, off + PAS_LEN));
  if (pas.replace(/\s/g, "").length < 100) continue;
  passages.push({ offset: off, text: pas });
}
console.log(`\nWar and Peace: ${passages.length} passages\n`);

// ── Three channels per passage ───────────────────────────────────────────

function amplitudeVector(amps, dims, dimension) {
  // Build a dimension-keyed amplitude vector
  const vec = {};
  for (const dim of dims) vec[dim] = 0;
  for (const { label, amplitude } of (amps[dimension] || [])) {
    vec[label] = amplitude;
  }
  return vec;
}

function priorVector(dist, dims) {
  const vec = {};
  for (const dim of dims) vec[dim] = dist[dim] ?? 0;
  return vec;
}

function deltaVector(contentVec, priorVec) {
  const vec = {};
  for (const k of Object.keys(contentVec)) {
    vec[k] = contentVec[k] - (priorVec[k] ?? 0);
    // Floor at 0 — we only care about UNEXPECTED ELEVATION, not suppression
    if (vec[k] < 0) vec[k] = 0;
  }
  return vec;
}

function vectorNorm(v) {
  return Math.sqrt(Object.values(v).reduce((s, x) => s + x*x, 0));
}

function vectorCosine(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (const k of Object.keys(a)) {
    dot += (a[k] ?? 0) * (b[k] ?? 0);
    nA += (a[k] ?? 0) ** 2;
    nB += (b[k] ?? 0) ** 2;
  }
  if (nA === 0 || nB === 0) return 1;
  return 1 - dot / Math.sqrt(nA * nB);
}

// Build all three channel vectors for every passage
const passageVectors = [];
for (let i = 0; i < passages.length; i++) {
  const amps = classifyAmplitudes(passages[i].text);

  const terrainContent = amplitudeVector(amps, TERRRAINS, "terrain");
  const stanceContent = amplitudeVector(amps, STANCES, "stance");
  const operatorContent = amplitudeVector(amps, OPERATORS, "operator");

  const terrainPrior = priorVector(priorTerrainDist, TERRRAINS);
  const stancePrior = priorVector(priorStanceDist, STANCES);
  const operatorPrior = priorVector(priorOperatorDist, OPERATORS);

  const terrainDelta = deltaVector(terrainContent, terrainPrior);
  const stanceDelta = deltaVector(stanceContent, stancePrior);
  const operatorDelta = deltaVector(operatorContent, operatorPrior);

  passageVectors.push({
    idx: i, offset: passages[i].offset,
    prior: { terrain: terrainPrior, stance: stancePrior, operator: operatorPrior },
    content: { terrain: terrainContent, stance: stanceContent, operator: operatorContent },
    delta: { terrain: terrainDelta, stance: stanceDelta, operator: operatorDelta },
    topTerrain: amps.terrain[0]?.label,
    topStance: amps.stance[0]?.label,
    topOperator: amps.operator[0]?.label,
  });
}

// ── Within-text normalization ─────────────────────────────────────────────
// Compute the mean amplitude profile for THIS text (not the corpus).
// The delta is: passage amplitude - W&P mean. This finds what makes
// a passage distinctive WITHIN the text — its internal variation.

function meanVector(vectors, channel, dimName) {
  const dims = dimName === "terrain" ? TERRRAINS : dimName === "stance" ? STANCES : OPERATORS;
  const mean = {};
  for (const dim of dims) mean[dim] = 0;
  for (const v of vectors) {
    const vec = v[channel][dimName];
    for (const dim of dims) mean[dim] += (vec[dim] ?? 0);
  }
  for (const dim of dims) mean[dim] /= vectors.length;
  return mean;
}

const wpMean = {
  terrain: meanVector(passageVectors, "content", "terrain"),
  stance: meanVector(passageVectors, "content", "stance"),
  operator: meanVector(passageVectors, "content", "operator"),
};

console.log("W&P mean profile:");
console.log("  terrain:", Object.entries(wpMean.terrain).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}=${v.toFixed(3)}`).join(" "));
console.log("  stance:", Object.entries(wpMean.stance).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}=${v.toFixed(3)}`).join(" "));
console.log("  operator:", Object.entries(wpMean.operator).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}=${v.toFixed(3)}`).join(" "));

// Recompute delta: content - W&P_mean (within-text deviation)
for (const pv of passageVectors) {
  pv.withinDelta = {
    terrain: deltaVector(pv.content.terrain, wpMean.terrain),
    stance: deltaVector(pv.content.stance, wpMean.stance),
    operator: deltaVector(pv.content.operator, wpMean.operator),
  };
}

// Rebuild combined delta using within-text deviation
function combinedWithinDelta(v) {
  const vec = {};
  for (const t of TERRRAINS) vec[`t:${t}`] = v.withinDelta.terrain[t];
  for (const s of STANCES) vec[`s:${s}`] = v.withinDelta.stance[s];
  for (const o of OPERATORS) vec[`o:${o}`] = v.withinDelta.operator[o];
  return vec;
}

// Also build passage vectors with both delta types for comparison
// priorDelta = content - corpus prior (global deviation)
// withinDelta = content - W&P mean (internal variation)
for (const pv of passageVectors) {
  pv.priorDelta = { terrain: pv.delta.terrain, stance: pv.delta.stance, operator: pv.delta.operator };
}

function combinedPriorDelta(v) {
  const vec = {};
  for (const t of TERRRAINS) vec[`t:${t}`] = v.priorDelta.terrain[t];
  for (const s of STANCES) vec[`s:${s}`] = v.priorDelta.stance[s];
  for (const o of OPERATORS) vec[`o:${o}`] = v.priorDelta.operator[o];
  return vec;
}

// ── Clustering: lenses from PRIOR-delta vs WITHIN-delta ──────────────────

function clusterCombinedDelta(vectors, getDeltaFn, K = 6, minSize = 15) {
  const data = vectors.map(v => getDeltaFn(v));
  const allDims = Object.keys(data[0]);

  const seedIndices = [];
  const used = new Set();
  for (let k = 0; k < Math.min(K, vectors.length); k++) {
    let bestIdx = -1, bestScore = -Infinity;
    for (let i = 0; i < vectors.length; i++) {
      if (used.has(i)) continue;
      const maxDim = Math.max(...Object.values(data[i]));
      let minDist = Infinity;
      for (const si of seedIndices) {
        minDist = Math.min(minDist, vectorCosine(data[i], data[si]));
      }
      const score = seedIndices.length === 0 ? maxDim : maxDim * minDist;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx >= 0) { seedIndices.push(bestIdx); used.add(bestIdx); }
  }

  const clusters = seedIndices.map(si => ({ seed: si, members: [], centroid: { ...data[si] } }));
  for (let iter = 0; iter < 10; iter++) {
    for (const c of clusters) c.members = [];
    for (let i = 0; i < vectors.length; i++) {
      let bestC = 0, bestDist = Infinity;
      for (let ci = 0; ci < clusters.length; ci++) {
        const d = vectorCosine(data[i], clusters[ci].centroid);
        if (d < bestDist) { bestDist = d; bestC = ci; }
      }
      clusters[bestC].members.push(i);
    }
    for (const c of clusters) {
      if (c.members.length === 0) continue;
      const nc = {};
      for (const dim of allDims) {
        let sum = 0;
        for (const mi of c.members) sum += data[mi][dim] ?? 0;
        nc[dim] = sum / c.members.length;
      }
      c.centroid = nc;
    }
  }

  return clusters.filter(c => c.members.length >= minSize).map((c, ci) => {
    const tWeights = {}, sWeights = {}, oWeights = {};
    for (const [k, v] of Object.entries(c.centroid)) {
      if (k.startsWith("t:")) tWeights[k.slice(2)] = v;
      else if (k.startsWith("s:")) sWeights[k.slice(2)] = v;
      else if (k.startsWith("o:")) oWeights[k.slice(2)] = v;
    }
    const topT = Object.entries(tWeights).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "?";
    const topS = Object.entries(sWeights).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "?";
    const topO = Object.entries(oWeights).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "?";
    return {
      id: `${topT}-${topS}-${topO}`.toLowerCase(),
      size: c.members.length,
      terrain: tWeights, stance: sWeights, operator: oWeights,
      description: `${topT} through ${topS} via ${topO}`,
    };
  });
}

console.log("=== Emergent lenses (within-text delta) ===\n");
const withinLenses = clusterCombinedDelta(passageVectors, combinedWithinDelta, 6, 15);
for (const lens of withinLenses) {
  console.log(`  ${lens.id}: ${lens.size} passages — ${lens.description}`);
}
console.log();

console.log("=== Emergent lenses (prior delta: content - corpus) ===\n");
const priorLenses = clusterCombinedDelta(passageVectors, combinedPriorDelta, 6, 15);
for (const lens of priorLenses) {
  console.log(`  ${lens.id}: ${lens.size} passages — ${lens.description}`);
}
console.log();

// ── Weighted scoring with emergent lens weights ──────────────────────────

function lensScoreEmergent(amps, lens) {
  let score = 0;
  for (const { label, amplitude } of (amps.terrain || [])) {
    score += amplitude * Math.max(0, (lens.terrain[label] ?? 0));
  }
  for (const { label, amplitude } of (amps.stance || [])) {
    score += amplitude * Math.max(0, (lens.stance[label] ?? 0));
  }
  for (const { label, score: opScore } of (amps.operator || [])) {
    score += Math.log1p(opScore) * Math.max(0, (lens.operator[label] ?? 0)) * 0.1;
  }
  return score;
}

// ── Run through stigmergy pipeline ───────────────────────────────────────

function runLensSet(lenses, label) {
  const media = [];
  const allDeposits = [];

  for (const lens of lenses) {
    const log = createReactionLog({ reader_id: lens.id, session_id: `wp-${label}` });
    let m = reactionLogAsMedium(log, { decay: 0.1 });
    const deposits = [];
    const scored = [];

    for (let i = 0; i < passages.length; i++) {
      const amps = classifyAmplitudes(passages[i].text);
      const score = lensScoreEmergent(amps, lens);
      scored.push({ idx: i, offset: passages[i].offset, score });
    }

    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const threshold = sorted[Math.floor(sorted.length * 0.3)]?.score ?? 0;
    let seq = 0;

    for (const s of scored) {
      if (s.score > threshold) {
        const amps = classifyAmplitudes(passages[s.idx].text);
        const r = mintReaction({
          reader_id: lens.id, session_id: `wp-${label}`,
          ts: 1000 + seq, seq: seq++, kind: "dwell",
          block_id: `pas-${s.idx}`, extent: null,
          context: { visible_block_ids: [], scale: "passage", lens_id: lens.id },
          payload: { offset: s.offset, score: +s.score.toFixed(4),
            topTerrain: amps.terrain[0]?.label, topStance: amps.stance[0]?.label, topOperator: amps.operator[0]?.label },
        });
        const res = depositReaction(m, r);
        if (res.result.admitted) {
          m = res.medium;
          deposits.push(s.idx);
        }
      }
    }

    media.push(m);
    allDeposits.push({ lens: lens.id, count: deposits.length, setIdxs: new Set(deposits) });
  }

  return { media, allDeposits, label };
}

console.log("=== Pipeline: emergent lenses ===\n");
const emergent = runLensSet(emergentLenses, "emergent");
for (const d of emergent.allDeposits) {
  console.log(`  ${d.lens}: ${d.count} deposits`);
}

// Pairwise convergence
console.log("\n  Pairwise Jaccard (emergent lenses):");
for (let i = 0; i < emergent.allDeposits.length; i++) {
  for (let j = i + 1; j < emergent.allDeposits.length; j++) {
    const si = emergent.allDeposits[i].setIdxs;
    const sj = emergent.allDeposits[j].setIdxs;
    const inter = new Set([...si].filter(x => sj.has(x)));
    const union = new Set([...si, ...sj]);
    const jac = inter.size / union.size;
    console.log(`    ${emergent.allDeposits[i].lens} ↔ ${emergent.allDeposits[j].lens}: jaccard=${jac.toFixed(3)}  div=${((1-jac)*100).toFixed(0)}%`);
  }
}

// Consensus
const votes = new Map();
for (const d of emergent.allDeposits) {
  for (const idx of d.setIdxs) {
    const e = votes.get(idx) || { count: 0, lenses: [] };
    e.count++; e.lenses.push(d.lens);
    votes.set(idx, e);
  }
}
const consensus = [...votes.entries()].filter(([,v]) => v.count >= 3).sort(([,a],[,b]) => b.count - a.count);
console.log(`\n  Consensus (≥3 lenses): ${consensus.length} passages`);

// Top consensus passages
console.log("\n  Top emergent consensus passages:\n");
for (let i = 0; i < Math.min(5, consensus.length); i++) {
  const [idx, info] = consensus[i];
  const p = passages[idx];
  const preview = p.text.replace(/\n/g, " ").slice(0, 100).trim();
  console.log(`  #${i+1}  offset=${p.offset}  votes=${info.count}/${emergentLenses.length}`);
  console.log(`      lenses=[${info.lenses.join(", ")}]`);
  console.log(`      "${preview}..."\n`);
}

// ── Full convergence witness ─────────────────────────────────────────────

const report = witnessConvergence(emergent.media, {
  labels: emergentLenses.map(l => l.id),
  minOverlap: 1,
});

console.log(`\n=== Convergence witness: ${report.coincidences.length} coincident pairs`);
console.log(`  Fraction: ${report.convergenceFraction.toFixed(6)}`);
console.log(`  Byte-identical: ${report.byteIdentical}\n`);
