#!/usr/bin/env node
// scripts/holon-bert-profiler.mjs
// Post-hoc semantic profiling of holon-discovered events via BERT embedding.
// Takes the events from the holon discovery experiment, re-embeds their
// frame ranges, and produces a semantic fingerprint per event.
//
// Usage: node scripts/holon-bert-profiler.mjs [--bible]
// Caches frame embeddings at /tmp/bert-cache-{text}.json

import { readFileSync, writeFileSync, existsSync } from "fs";
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
  return (await resp.json()).embedding;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function meanVec(vecs) {
  const d = vecs[0].length;
  const m = new Array(d).fill(0);
  for (const v of vecs) for (let i = 0; i < d; i++) m[i] += v[i] / vecs.length;
  return m;
}

function pairwiseMeanCosine(vecs) {
  let total = 0, count = 0;
  for (let i = 0; i < vecs.length; i++)
    for (let j = i + 1; j < vecs.length; j++) {
      total += cosine(vecs[i], vecs[j]); count++;
    }
  return count > 0 ? total / count : 0;
}

// ── Holon events (from experiment output) ──

const WAP_EVENTS = [
  { terrain: "Atmosphere", result: "ABOVE", range: [2576, 2597], label: "Prince Andrew's death" },
  { terrain: "Atmosphere", result: "ABOVE", range: [844, 863], label: "Pierre after duel, Natasha's illness" },
  { terrain: "Atmosphere", result: "ABOVE", range: [1713, 1733], label: "Battle scenes with Rostov" },
  { terrain: "Network", result: "ABOVE", range: [2634, 2649], label: "Free will/destiny philosophy" },
  { terrain: "Network", result: "ABOVE", range: [2821, 2831], label: "Ridicule line" },
  { terrain: "Network", result: "ABOVE", range: [388, 403], label: "Society introductions" },
  { terrain: "Network", result: "ABOVE", range: [1994, 2004], label: "Military position discourse" },
  { terrain: "Entity", result: "NONE", note: "0/5 above — entity alone doesn't form regimes in W&P" },
];

const BIBLE_EVENTS = [
  { terrain: "Entity", result: "ABOVE", range: [519, 557], label: "Numbers census" },
  { terrain: "Entity", result: "ABOVE", range: [215, 242], label: "Exodus — Moses, plagues" },
  { terrain: "Entity", result: "ABOVE", range: [1606, 1629], label: "1 Chronicles genealogies, David" },
  { terrain: "Entity", result: "ABOVE", range: [2924, 2943], label: "Ezekiel's throne vision" },
  { terrain: "Atmosphere", result: "ABOVE", range: [3186, 3202], label: "Hosea prophecy" },
  { terrain: "Atmosphere", result: "ABOVE", range: [2304, 2320], label: "Psalms 137-140 lament" },
];

// ── Embed or load cache ──

async function embedFrames(frames, textId) {
  const cachePath = `/tmp/bert-cache-${textId}.json`;
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
    if (cached.length === frames.length) {
      console.log(`  Loaded ${cached.length} cached embeddings`);
      return cached;
    }
    console.log(`  Cache stale (${cached.length} vs ${frames.length}), re-embedding`);
  }

  const embeddings = [];
  for (let i = 0; i < frames.length; i++) {
    const text = frames[i].text.slice(0, 1500);
    const vec = await embed(text);
    embeddings.push(vec);
    if ((i + 1) % 500 === 0) console.log(`  ${i + 1}/${frames.length} embedded`);
  }
  writeFileSync(cachePath, JSON.stringify(embeddings));
  console.log(`  Embedded + cached ${embeddings.length} frames`);
  return embeddings;
}

// ── Main ──

async function main() {
  const useBible = process.argv.includes("--bible");
  const textId = useBible ? "pg10" : "pg2600";
  const textPath = useBible ? "/Users/mlacy/Downloads/pg10.txt" : "/Users/mlacy/Downloads/pg2600.txt";
  const events = useBible ? BIBLE_EVENTS : WAP_EVENTS;
  const textName = useBible ? "KJV Bible" : "War and Peace";

  console.log(`\n=== Holon + BERT Semantic Profiler: ${textName} ===\n`);

  const raw = readFileSync(textPath, "utf-8");
  const frames = frameText(raw);
  console.log(`Total frames: ${frames.length}`);

  console.log(`\nEmbedding frames...`);
  const embeddings = await embedFrames(frames, textId);

  // Compute a global semantic similarity baseline
  const sampleSize = Math.min(500, frames.length);
  const idxs = Array.from({ length: sampleSize }, () => Math.floor(Math.random() * frames.length));
  let globalSum = 0, globalCount = 0;
  for (let i = 0; i < sampleSize; i++)
    for (let j = i + 1; j < sampleSize; j++) {
      globalSum += cosine(embeddings[idxs[i]], embeddings[idxs[j]]); globalCount++;
    }
  const globalBaseline = globalSum / globalCount;
  console.log(`\nGlobal mean frame cosine (random sample): ${globalBaseline.toFixed(3)}`);

  // Per-event semantic profile
  console.log(`\n=== Per-Event Semantic Profile ===\n`);
  const profiled = [];

  for (const ev of events) {
    if (ev.result === "NONE") {
      console.log(`${ev.terrain}: ${ev.note}\n`);
      continue;
    }
    const [start, end] = ev.range;
    const eventVecs = embeddings.slice(start, end + 1);
    const centroid = meanVec(eventVecs);
    const coherence = pairwiseMeanCosine(eventVecs);
    const range_len = end - start + 1;

    // Boundary contrast: centroid similarity to pre-event and post-event frames
    const preStart = Math.max(0, start - 5);
    const preEnd = Math.max(0, start - 1);
    const postStart = Math.min(frames.length - 1, end + 1);
    const postEnd = Math.min(frames.length - 1, end + 5);
    const preSims = [];
    for (let i = preStart; i <= preEnd; i++) preSims.push(cosine(centroid, embeddings[i]));
    const postSims = [];
    for (let i = postStart; i <= postEnd; i++) postSims.push(cosine(centroid, embeddings[i]));
    const preMean = preSims.reduce((a, b) => a + b, 0) / preSims.length;
    const postMean = postSims.reduce((a, b) => a + b, 0) / postSims.length;

    // Contrast ratio: how much more similar is the event to itself vs. neighbors?
    const contrast = coherence / ((preMean + postMean) / 2 + 1e-9);

    // Within-event vs global baseline
    const lift = coherence - globalBaseline;

    profiled.push({ ...ev, centroid, coherence, preMean, postMean, contrast, lift, range_len });

    console.log(`${ev.terrain} ★ "${ev.label}" (f${start}-${end}, ${range_len}f)`);
    console.log(`  Coherence:  ${coherence.toFixed(3)} (lift vs global: +${lift.toFixed(3)})`);
    console.log(`  Boundary:   pre=${preMean.toFixed(3)}  post=${postMean.toFixed(3)}  contrast=${contrast.toFixed(2)}x`);
    console.log(`  Contrast = coherence/(pre+post)/2 — higher = sharper semantic boundary`);
  }

  // Event × Event similarity matrix
  console.log(`\n=== Event × Event Semantic Similarity (cosine of centroids) ===\n`);
  const confirmed = profiled;
  const n = confirmed.length;

  // Header
  header: for (let i = 0; i < n; i++) {
    const label = `${confirmed[i].terrain[0]}${i}`;
    process.stdout.write(`${label.padStart(8)}`);
  }
  process.stdout.write("\n");
  for (let i = 0; i < n; i++) {
    process.stdout.write(`${confirmed[i].terrain[0]}${i}`.padStart(4));
    for (let j = 0; j < n; j++) {
      if (i === j) { process.stdout.write("  ——  "); continue; }
      const sim = cosine(confirmed[i].centroid, confirmed[j].centroid);
      // Color: >0.8 = high, >0.6 = med, else low
      const s = sim.toFixed(3);
      process.stdout.write(`${s.padStart(8)}`);
    }
    process.stdout.write(`  ${confirmed[i].terrain} "${confirmed[i].label}"\n`);
  }

  // Closest event pairs
  console.log(`\n=== Closest Event Pairs ===\n`);
  const pairs = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      pairs.push({ i, j, sim: cosine(confirmed[i].centroid, confirmed[j].centroid) });
  pairs.sort((a, b) => b.sim - a.sim);
  for (const p of pairs) {
    const a = confirmed[p.i], b = confirmed[p.j];
    console.log(`  ${a.terrain} "${a.label}" ↔ ${b.terrain} "${b.label}"  sim=${p.sim.toFixed(3)}`);
  }

  // Semantic fingerprint per event: find the single frame closest to the centroid
  console.log(`\n=== Semantic Fingerprint (frame closest to event centroid) ===\n`);
  for (const ev of profiled) {
    const [start, end] = ev.range;
    let bestSim = -1, bestIdx = start;
    for (let i = start; i <= end; i++) {
      const sim = cosine(ev.centroid, embeddings[i]);
      if (sim > bestSim) { bestSim = sim; bestIdx = i; }
    }
    const text = frames[bestIdx].text.slice(0, 200).replace(/\n/g, ' ');
    console.log(`${ev.terrain} ★ "${ev.label}"  (centroid frame ${bestIdx}, sim=${bestSim.toFixed(3)})`);
    console.log(`  ${text}\n`);
  }

  // Same-terrain event clustering: do events of the same terrain cluster in BERT space?
  console.log(`\n=== Same-Terrain Semantic Similarity vs Cross-Terrain ===\n`);
  let sameSum = 0, sameCount = 0, crossSum = 0, crossCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosine(confirmed[i].centroid, confirmed[j].centroid);
      if (confirmed[i].terrain === confirmed[j].terrain) {
        sameSum += sim; sameCount++;
        console.log(`  SAME ${confirmed[i].terrain}: "${confirmed[i].label}" ↔ "${confirmed[j].label}"  sim=${sim.toFixed(3)}`);
      } else {
        crossSum += sim; crossCount++;
      }
    }
  }
  console.log(`\n  Mean same-terrain similarity:  ${(sameSum / sameCount).toFixed(3)} (${sameCount} pairs)`);
  console.log(`  Mean cross-terrain similarity: ${(crossSum / crossCount).toFixed(3)} (${crossCount} pairs)`);
  console.log(`  Ratio: ${(sameSum * crossCount / (crossSum * sameCount)).toFixed(2)}x`);
}

main().catch(e => { console.error(e); process.exit(1); });
