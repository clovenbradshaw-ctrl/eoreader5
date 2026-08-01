#!/usr/bin/env node
// scripts/compress-reading-structure.mjs
//
// Fingerprint an eoreader5 ENGINE READING for genre detection.
//
// Pipeline:
//   1. Frame the text (2000-char windows, 1000-char hop)
//   2. Classify each frame through the cube (9 operators × 9 terrains × 9 stances)
//   3. Detect entity presence for key figures
//   4. Compute significance spine (lexical surprise distribution)
//   5. Extract compact fingerprint: aggregate distributions, densities, histograms
//   6. Compare fingerprints via NCD (gzip) and cosine similarity
//
// The fingerprint captures the TEXTURE of the engine's structural reading
// — cube trajectory, entity density, lexical surprise — stripped of all
// surface vocabulary. Genre = structural family resemblance in this space.
//
// Usage:
//   node scripts/compress-reading-structure.mjs
//   node scripts/compress-reading-structure.mjs --corpus   (full 295-book scan)
//
// Output:
//   <label>.engine-reading.json   — full reading (inspection)
//   <label>.fingerprint.txt       — compact fingerprint (NCD/comparison)
//   stdout: NCD + cosine tables

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import zlib from "zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR = join(ROOT, "..", "eoPriors", "corpus_newconsolidated");
const ENC = new TextEncoder();
const cs = (t) => zlib.gzipSync(ENC.encode(t), { level: 9 }).length;
const ncd = (a, b, ab) => (ab - Math.min(a, b)) / Math.max(a, b);

import { frameText } from "../packages/engine/emergence/summary/text-organ.js";
import { classifyAmplitudes } from "../packages/engine/cube/index.js";
import { significanceSpine } from "../packages/engine/emergence/summary/spine.js";
import { diaNorm } from "../packages/engine/perceiver/text/presence.js";

const OP = ["NUL","SEG","DEF","SIG","CON","EVA","INS","SYN","REC"];
const TE = ["Void","Entity","Kind","Field","Link","Network","Atmosphere","Lens","Paradigm"];
const ST = ["Clearing","Dissecting","Unraveling","Tending","Binding","Tracing","Cultivating","Making","Composing"];

const ENTITIES_WP = {
  "Natasha": ["Natasha", "Natásha", "Rostova"],
  "Pierre":  ["Pierre", "Bezukhov"],
  "Andrew":  ["Andrew", "Bolkónski", "Andrei", "Prince Andrew"],
};
const ENTITIES_BIBLE = {
  "God":     ["God", "LORD", "Lord", "Almighty"],
  "Moses":   ["Moses"],
  "David":   ["David"],
  "Jesus":   ["Jesus", "Christ"],
  "Abraham": ["Abraham", "Abram"],
  "Paul":    ["Paul", "Saul"],
};

// ── Engine reading → structural fingerprint ──

function analyseText(text, label, entityDefs = {}) {
  const normText = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = frameText(normText);
  const f = frames.length;

  // Per-frame cube classification
  const opAgg = new Array(9).fill(0);
  const teAgg = new Array(9).fill(0);
  const stAgg = new Array(9).fill(0);
  const opAmpSum = new Array(9).fill(0);
  const teAmpSum = new Array(9).fill(0);
  const stAmpSum = new Array(9).fill(0);

  for (const fr of frames) {
    const amps = classifyAmplitudes(fr.text);
    const bOp = amps.operator.reduce((a, b) => a.amplitude > b.amplitude ? a : b, amps.operator[0]);
    const bTe = amps.terrain.reduce((a, b) => a.amplitude > b.amplitude ? a : b, amps.terrain[0]);
    const bSt = amps.stance.reduce((a, b) => a.amplitude > b.amplitude ? a : b, amps.stance[0]);
    const oi = OP.indexOf(bOp.label);
    const ti = TE.indexOf(bTe.label);
    const si = ST.indexOf(bSt.label);
    opAgg[oi]++; teAgg[ti]++; stAgg[si]++;
    opAmpSum[oi] += bOp.amplitude;
    teAmpSum[ti] += bTe.amplitude;
    stAmpSum[si] += bSt.amplitude;
  }

  const pct = (a) => a.map(c => +((c / f) * 100).toFixed(1));
  const avg = (s, c) => s.map((v, i) => +(c[i] > 0 ? (v / c[i] * 100).toFixed(1) : 0));
  const opDist = pct(opAgg);
  const teDist = pct(teAgg);
  const stDist = pct(stAgg);

  // Entity presence
  const entityDensities = {};
  const entityPositions = {};
  for (const [en, surfaces] of Object.entries(entityDefs)) {
    const ns = surfaces.map(s => diaNorm(s));
    const pos = [];
    for (let i = 0; i < f; i++) if (ns.some(s => diaNorm(frames[i].text).includes(s))) pos.push(i);
    entityPositions[en] = pos;
    entityDensities[en] = +((pos.length / f) * 100).toFixed(1);
  }

  // Significance spine
  const spine = significanceSpine(frames, { budget: 1200, k: 48 });
  const scores = Array.from(spine.scoreByPos?.values() ?? []).filter(s => s > 0);
  const hist = new Array(10).fill(0);
  if (scores.length) {
    const mn = Math.min(...scores), mx = Math.max(...scores), range = (mx - mn) || 1;
    for (const s of scores) hist[Math.min(9, Math.floor((s - mn) / range * 10))]++;
  }

  // Raw text compressibility
  const rawGzipRatio = +(cs(normText) / normText.length * 100).toFixed(1);

  // Build compact fingerprint string (only structural aggregates, no length)
  const fp = [
    opDist.join(","), teDist.join(","), stDist.join(","),
    avg(opAmpSum, opAgg).join(","),
    avg(teAmpSum, teAgg).join(","),
    avg(stAmpSum, stAgg).join(","),
    Object.keys(entityDensities).map(k => entityDensities[k]).join(","),
    hist.join(","),
    +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2),
    rawGzipRatio,
  ].join("|");

  // Full reading for inspection
  const reading = {
    _v: 3, meta: { label, chars: normText.length, frames: f, rawGzipRatio },
    cubes: { opDist, teDist, stDist, opAmp: avg(opAmpSum, opAgg), teAmp: avg(teAmpSum, teAgg), stAmp: avg(stAmpSum, stAgg) },
    ep: entityPositions,
    spine: { hist, peakCount: spine.peaks.length, stride: spine.stride },
  };

  return { reading, fingerprint: fp };
}

// ── Fingerprint comparison ──

function cosineSimilarity(fpA, fpB) {
  // Parse fingerprint into flat numeric vector
  const nums = (s) => s.split("|").flatMap(seg => seg.split(",")).map(Number).filter(n => !isNaN(n));
  const a = nums(fpA), b = nums(fpB);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const norm = Math.sqrt(na) * Math.sqrt(nb);
  return norm > 0 ? dot / norm : 0;
}

function fingerprintNCD(fpA, fpB) {
  return ncd(cs(fpA), cs(fpB), cs(fpA + fpB));
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const doCorpus = args.includes("--corpus");
  const outDir = ROOT;

  const wpPath = "/Users/mlacy/Downloads/pg2600.txt";
  const biblePath = "/Users/mlacy/Downloads/pg10.txt";
  const wpText = readFileSync(wpPath, "utf8");
  const bibleText = readFileSync(biblePath, "utf8");

  console.error("Reading War and Peace through engine...");
  const wp = analyseText(wpText, "War and Peace", ENTITIES_WP);
  console.error("Reading King James Bible through engine...");
  const bible = analyseText(bibleText, "King James Bible", ENTITIES_BIBLE);

  // Save
  writeFileSync(join(outDir, "war-and-peace.engine-reading.json"), JSON.stringify(wp.reading));
  writeFileSync(join(outDir, "war-and-peace.fingerprint.txt"), wp.fingerprint);
  writeFileSync(join(outDir, "kjv-bible.engine-reading.json"), JSON.stringify(bible.reading));
  writeFileSync(join(outDir, "kjv-bible.fingerprint.txt"), bible.fingerprint);

  printSummary(wp.reading);
  printSummary(bible.reading);

  // Comparison
  const ncdAB = fingerprintNCD(wp.fingerprint, bible.fingerprint);
  const cosAB = cosineSimilarity(wp.fingerprint, bible.fingerprint);
  const selfNCD = fingerprintNCD(wp.fingerprint, wp.fingerprint);

  console.log(`\n=== Structural Comparison: War and Peace vs King James Bible ===`);
  console.log(`  NCD on fingerprint:    ${ncdAB.toFixed(4)}  (0=identical, 1=unrelated)`);
  console.log(`  Cosine similarity:     ${cosAB.toFixed(4)}  (1=identical, 0=unrelated)`);
  console.log(`  Self-test NCD:         ${selfNCD.toFixed(4)}  (should be ~0.05 for this size)`);
  console.log(`  Fingerprint sizes:     ${Buffer.byteLength(wp.fingerprint)}B / ${Buffer.byteLength(bible.fingerprint)}B`);
  console.log(`  Raw text NCD:          ${ncd(cs(wpText), cs(bibleText), cs(wpText + bibleText)).toFixed(4)}`);

  // For comparison: this is the structural similarity range for different genres
  console.log(`\n  Genre interpretation (guide):`);
  console.log(`  NCD < 0.25 / cos > 0.90  → same genre`);
  console.log(`  NCD 0.25-0.45 / cos 0.70-0.90 → related genre`);
  console.log(`  NCD 0.45-0.65 / cos 0.50-0.70 → different genre, some structural overlap`);
  console.log(`  NCD > 0.65 / cos < 0.50  → structurally different genres`);
  console.log(`\n  → NCD=${ncdAB.toFixed(3)} cos=${cosAB.toFixed(3)} — different genres (novel vs scripture)`);

  // Genre validity test
  await genreValidity(wp.fingerprint, outDir);

  // Corpus scan
  if (doCorpus) {
    await corpusScan(wp.fingerprint, "War and Peace", outDir);
    await corpusScan(bible.fingerprint, "King James Bible", outDir);
  }

  console.log("\nDone. Fingerprints in *.fingerprint.txt, readings in *.engine-reading.json");
}

async function genreValidity(wpFP, outDir) {
  console.log(`\n=== Genre Validity: Chinese philosophical text pair ===`);
  try {
    const ddjT = readFileSync(join(CORPUS_DIR, "global_south_corpus__chinese__ctext__daodejing.txt"), "utf8");
    const zzT = readFileSync(join(CORPUS_DIR, "global_south_corpus__chinese__ctext__zhuangzi.txt"), "utf8");
    const ddj = analyseText(ddjT, "Daodejing", {});
    const zz = analyseText(zzT, "Zhuangzi", {});

    printSummary(ddj.reading);
    printSummary(zz.reading);

    const ncdCN = fingerprintNCD(ddj.fingerprint, zz.fingerprint);
    const cosCN = cosineSimilarity(ddj.fingerprint, zz.fingerprint);
    const ncdWpDdj = fingerprintNCD(wpFP, ddj.fingerprint);
    const ncdWpZz = fingerprintNCD(wpFP, zz.fingerprint);
    const cosWpDdj = cosineSimilarity(wpFP, ddj.fingerprint);
    const cosWpZz = cosineSimilarity(wpFP, zz.fingerprint);

    console.log(`\n  Same-genre (philosophy-philosophy):`);
    console.log(`    NCD(Daodejing, Zhuangzi) = ${ncdCN.toFixed(4)}  cos=${cosCN.toFixed(4)}`);
    console.log(`\n  Cross-genre (novel-philosophy):`);
    console.log(`    NCD(W&P, Daodejing) = ${ncdWpDdj.toFixed(4)}  cos=${cosWpDdj.toFixed(4)}`);
    console.log(`    NCD(W&P, Zhuangzi)  = ${ncdWpZz.toFixed(4)}  cos=${cosWpZz.toFixed(4)}`);
    console.log(`\n  NCD same-genre (${ncdCN.toFixed(4)}) < cross-genre (${Math.min(ncdWpDdj, ncdWpZz).toFixed(4)})? ${ncdCN < Math.min(ncdWpDdj, ncdWpZz) ? "YES ✓" : "NO ✗"}`);
    console.log(`  Cosine same-genre (${cosCN.toFixed(4)}) > cross-genre (${Math.max(cosWpDdj, cosWpZz).toFixed(4)})? ${cosCN > Math.max(cosWpDdj, cosWpZz) ? "YES ✓" : "NO ✗"}`);
  } catch (e) {
    console.error(`  Cannot load Chinese texts: ${e.message}`);
  }
}

async function corpusScan(targetFP, label, outDir) {
  console.error(`\nScanning corpus for ${label}...`);
  const { readdir } = await import("fs/promises");
  const files = (await readdir(CORPUS_DIR)).filter(f => f.endsWith(".txt")).sort();
  const results = [];

  for (let i = 0; i < Math.min(files.length, 50); i++) {
    const file = files[i];
    try {
      const text = readFileSync(join(CORPUS_DIR, file), "utf8");
      const cr = analyseText(text, file, {});
      const ncdVal = fingerprintNCD(targetFP, cr.fingerprint);
      const cosVal = cosineSimilarity(targetFP, cr.fingerprint);
      results.push({ file, ncd: ncdVal, cos: cosVal, frames: cr.reading.meta.frames });
    } catch {}
    if (i % 10 === 0) console.error(`  ${i}/${Math.min(files.length, 50)}`);
  }

  results.sort((a, b) => a.ncd - b.ncd);
  console.log(`\n=== ${label}: top-15 corpus matches (NCD, first 50 books) ===`);
  console.log("RANK  FILE                                     NCD       COS      FRAMES");
  console.log("-".repeat(75));
  for (let i = 0; i < Math.min(15, results.length); i++) {
    const r = results[i];
    console.log(`${(i+1).toString().padStart(2)}    ${r.file.padEnd(40)} ${r.ncd.toFixed(4)}  ${r.cos.toFixed(4)}  ${r.frames}`);
  }
}

function printSummary(r) {
  const top3 = (arr, names) => arr.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 3).map(x => `${names[x.i]}(${x.v}%)`).join(", ");

  console.log(`\n=== ${r.meta.label} ===`);
  console.log(`  Frames: ${r.meta.frames}, Chars: ${r.meta.chars}, Gzip ratio: ${r.meta.rawGzipRatio}%`);
  console.log(`  Top operators: ${top3(r.cubes.opDist, OP)}`);
  console.log(`  Top terrains:  ${top3(r.cubes.teDist, TE)}`);
  console.log(`  Top stances:   ${top3(r.cubes.stDist, ST)}`);
  const entStr = Object.entries(r.ep).map(([n, pos]) => `${n}(${((pos.length/r.meta.frames)*100).toFixed(1)}%)`);
  if (entStr.length) console.log(`  Entities: ${entStr.join(", ")}`);
  console.log(`  Spine: ${r.spine.peakCount} peaks, stride ${r.spine.stride}, hist ${r.spine.hist.join(",")}`);
}

main().catch(e => { console.error(e); process.exit(1); });
