#!/usr/bin/env node
// scripts/train-genre-dictionaries.mjs
//
// Genre classification via eoreader5 engine reading fingerprints.
// Compares a query fingerprint against per-genre concatenated exemplar
// fingerprints using zstd compressed-length — the "compress against 100
// exemplars" approach from the eoPriors design.
//
// No dictionary training needed. The query is compressed together with
// each genre's exemplar set; the genre whose exemplars add the least
// new information to the query (smallest compressed-length growth)
// is the prediction.
//
// Also reports cosine similarity for comparison.
//
// Usage:
//   node scripts/train-genre-dictionaries.mjs
//   node scripts/train-genre-dictionaries.mjs --rebuild  # regen fingerprints

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { readdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execSync } from "child_process";
import { gzipSync } from "zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = join(ROOT, "..", "eoPriors", "corpus_newconsolidated");
const CACHE = join(ROOT, ".fingerprint-cache");
const TMP = join(ROOT, ".tmp-genre-compare");
const ENC = new TextEncoder();

import { frameText } from "../packages/engine/emergence/summary/text-organ.js";
import { classifyAmplitudes } from "../packages/engine/cube/index.js";

const OP = ["NUL","SEG","DEF","SIG","CON","EVA","INS","SYN","REC"];
const TE = ["Void","Entity","Kind","Field","Link","Network","Atmosphere","Lens","Paradigm"];
const ST = ["Clearing","Dissecting","Unraveling","Tending","Binding","Tracing","Cultivating","Making","Composing"];

// ── Quick fingerprint v2 (cube + amplitudes + temporal features) ──

function sum(a) { let s = 0; for (const v of a) s += v; return s; }
function mean(a) { return a.length > 0 ? sum(a) / a.length : 0; }
function variance(a) { const m = mean(a); let v = 0; for (const x of a) v += (x - m) ** 2; return a.length > 0 ? v / a.length : 0; }

function entropy(amps) {
  const s = sum(amps);
  if (s === 0) return 0;
  let h = 0;
  for (const a of amps) {
    if (a > 0) { const p = a / s; h -= p * Math.log2(p); }
  }
  return +h.toFixed(3);
}
function argmaxIdx(arr) {
  let mi = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[mi]) mi = i;
  return mi;
}
function transitionRate(wins) {
  let changes = 0;
  for (let i = 1; i < wins.length; i++) if (wins[i] !== wins[i - 1]) changes++;
  return +(changes / Math.max(1, wins.length - 1)).toFixed(4);
}
function transitionRateAt(wins, stride) {
  let changes = 0, pairs = 0;
  for (let i = stride; i < wins.length; i += stride) {
    if (wins[i] !== wins[i - stride]) changes++;
    pairs++;
  }
  return pairs > 0 ? +(changes / pairs).toFixed(4) : 0;
}
function runVariance(wins) {
  if (wins.length < 2) return 0;
  const runs = [];
  let run = 1;
  for (let i = 1; i < wins.length; i++) {
    if (wins[i] === wins[i - 1]) run++;
    else { runs.push(run); run = 1; }
  }
  runs.push(run);
  const m = runs.reduce((s, v) => s + v, 0) / runs.length;
  return +(runs.reduce((s, v) => s + (v - m) ** 2, 0) / runs.length).toFixed(2);
}
function transEntropy(wins, nStates) {
  // Transition matrix → average conditional entropy H(next | current)
  const counts = Array.from({ length: nStates }, () => new Array(nStates).fill(0));
  const rowSum = new Array(nStates).fill(0);
  for (let i = 1; i < wins.length; i++) {
    const from = wins[i - 1], to = wins[i];
    counts[from][to]++; rowSum[from]++;
  }
  let totalH = 0, activeRows = 0;
  for (let s = 0; s < nStates; s++) {
    if (rowSum[s] === 0) continue;
    let h = 0;
    for (let t = 0; t < nStates; t++) {
      if (counts[s][t] > 0) { const p = counts[s][t] / rowSum[s]; h -= p * Math.log2(p); }
    }
    totalH += h * rowSum[s];
    activeRows += rowSum[s];
  }
  return activeRows > 0 ? +(totalH / activeRows).toFixed(3) : 0;
}
function meanRunLen(wins) {
  if (wins.length === 0) return 0;
  let runs = [], run = 1;
  for (let i = 1; i < wins.length; i++) {
    if (wins[i] === wins[i - 1]) run++;
    else { runs.push(run); run = 1; }
  }
  runs.push(run);
  return +mean(runs).toFixed(2);
}

function quickFingerprint(text) {
  const normText = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = frameText(normText);
  const f = frames.length;
  if (f === 0) return null;

  // Aggregate
  const opAgg = new Array(9).fill(0), teAgg = new Array(9).fill(0), stAgg = new Array(9).fill(0);
  const opAmpSum = new Array(9).fill(0), teAmpSum = new Array(9).fill(0), stAmpSum = new Array(9).fill(0);

  // Temporal tracking
  const opWins = new Array(f), teWins = new Array(f), stWins = new Array(f);
  const opEnts = new Array(f), teEnts = new Array(f), stEnts = new Array(f);
  const halfAgg = [new Array(9).fill(0), new Array(9).fill(0)];

  for (let i = 0; i < f; i++) {
    const amps = classifyAmplitudes(frames[i].text);
    const oi = OP.indexOf(amps.operator[0].label);
    const ti = TE.indexOf(amps.terrain[0].label);
    const si = ST.indexOf(amps.stance[0].label);
    opWins[i] = oi; teWins[i] = ti; stWins[i] = si;
    opAgg[oi]++; teAgg[ti]++; stAgg[si]++;
    opAmpSum[oi] += amps.operator[0].amplitude;
    teAmpSum[ti] += amps.terrain[0].amplitude;
    stAmpSum[si] += amps.stance[0].amplitude;

    const opA = amps.operator.map(a => a.amplitude);
    const teA = amps.terrain.map(a => a.amplitude);
    const stA = amps.stance.map(a => a.amplitude);

    opEnts[i] = entropy(opA); teEnts[i] = entropy(teA); stEnts[i] = entropy(stA);
    const hi = i < f / 2 ? 0 : 1;
    halfAgg[hi][oi]++;
  }

  const pct = (a) => a.map(c => +((c / f) * 100).toFixed(1));
  const avg = (s, c) => s.map((v, i) => +(c[i] > 0 ? (v / c[i] * 100).toFixed(1) : 0));
  const opDist = pct(opAgg), teDist = pct(teAgg), stDist = pct(stAgg);

  // Temporal features
  const opTrans = transitionRate(opWins), teTrans = transitionRate(teWins), stTrans = transitionRate(stWins);
  const opTrans5 = transitionRateAt(opWins, 5), opTrans20 = transitionRateAt(opWins, 20);
  const opRun = meanRunLen(opWins), teRun = meanRunLen(teWins), stRun = meanRunLen(stWins);
  const opRunV = runVariance(opWins), teRunV = runVariance(teWins), stRunV = runVariance(stWins);
  const opEntM = +mean(opEnts).toFixed(3), teEntM = +mean(teEnts).toFixed(3), stEntM = +mean(stEnts).toFixed(3);
  const opEntV = +variance(opEnts).toFixed(3), teEntV = +variance(teEnts).toFixed(3), stEntV = +variance(stEnts).toFixed(3);
  const opTxEn = transEntropy(opWins, 9);

  // Trajectory: top-3 operator first-half → second-half shift
  const top3 = opDist.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).slice(0, 3);
  const h1p = pct(halfAgg[0]), h2p = pct(halfAgg[1]);
  const traj = top3.map(t => +(h2p[t.i] - h1p[t.i]).toFixed(1));

  // Text compressibility (first 10KB for speed)
  const sample = normText.slice(0, 10000);
  const gzRatio = +(gzipSync(ENC.encode(sample), { level: 9 }).length / sample.length * 100).toFixed(1);

  return [
    opDist.join(","), teDist.join(","), stDist.join(","),
    avg(opAmpSum, opAgg).join(","), avg(teAmpSum, teAgg).join(","), avg(stAmpSum, stAgg).join(","),
    gzRatio,
    opTrans, teTrans, stTrans, opTrans5, opTrans20,
    opRun, teRun, stRun, opRunV, teRunV, stRunV,
    opEntM, teEntM, stEntM, opEntV, teEntV, stEntV,
    opTxEn,
    traj.join(","),
  ].join("|");
}

// Frame sequence: compact temporal signal preserving order of (op, te, st) per frame
// Each frame encoded as 3 bytes (e.g. "000", "881"), all frames concatenated.
function frameSeq(text) {
  const normText = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = frameText(normText);
  const f = frames.length;
  if (f === 0) return null;
  const buf = new Uint8Array(f * 3);
  for (let i = 0; i < f; i++) {
    const amps = classifyAmplitudes(frames[i].text);
    buf[i * 3] = 48 + OP.indexOf(amps.operator[0].label);
    buf[i * 3 + 1] = 48 + TE.indexOf(amps.terrain[0].label);
    buf[i * 3 + 2] = 48 + ST.indexOf(amps.stance[0].label);
  }
  return new TextDecoder().decode(buf);
}

// Amplitude matrix: per-frame full 27-float amplitude vectors (9 op + 9 te + 9 st)
// Each frame is L2-normalized so only the distributional shape survives.
function ampMat(text) {
  const normText = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = frameText(normText);
  const f = frames.length;
  if (f === 0) return null;
  const lines = [];
  for (let i = 0; i < f; i++) {
    const amps = classifyAmplitudes(frames[i].text);
    const all = amps.operator.concat(amps.terrain).concat(amps.stance);
    const vals = all.map(a => a.amplitude);
    const norm = Math.sqrt(vals.reduce((s, v) => s + v * v, 0));
    lines.push(norm > 1e-8 ? vals.map(v => (v / norm).toFixed(4)).join(",") : vals.map(() => "0").join(","));
  }
  return lines.join("\n");
}

// ── Fingerprint vector (for cosine similarity) ──
function fpVector(fp) {
  return fp.split("|").flatMap(s => s.split(",")).map(Number).filter(n => !isNaN(n));
}
function cosine(a, b) {
  const av = fpVector(a), bv = fpVector(b);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(av.length, bv.length); i++) {
    dot += av[i] * bv[i];
    na += av[i] * av[i];
    nb += bv[i] * bv[i];
  }
  const norm = Math.sqrt(na) * Math.sqrt(nb);
  return norm > 0 ? dot / norm : 0;
}

// ── Genre inference ──

function inferGenre(filename) {
  const parts = filename.replace(/\.txt$/, "").split("__");
  const seg1 = parts[1] || "";
  const seg2 = parts[2] || "";
  if (seg1 === "gutenberg")  return "english_fiction";
  if (seg1 === "chinese")    return "chinese_philosophy";
  if (seg1 === "sanskrit")   return "sanskrit_religious";
  if (seg1 === "fiction")    return "fiction";
  if (seg1 === "poetry")     return "poetry";
  if (seg1 === "drama")      return "drama";
  if (seg1 === "science")    return "science";
  if (seg1 === "history")    return "history";
  if (seg1 === "critical")   return "critical";
  if (seg1 === "wikisource") return `wikisource_${seg2 || "unknown"}`;
  return "other";
}

function cosTwo(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return Math.sqrt(na) * Math.sqrt(nb) > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Per-channel similarity: compute cosine independently per feature group
// Groups: [op|te|st]_dist (9 each), [op|te|st]_amp (9 each), gzRatio (1),
//         {op|te|st}_trans (1 each), {op|te|st}_run (1 each),
//         {op|te|st}_entM (1 each), {op|te|st}_entV (1 each),
//         traj (3)
function channelSimilarity(qv, cv) {
  const groups = [
    { name: "op_dist",    start: 0, count: 9 },
    { name: "te_dist",    start: 9, count: 9 },
    { name: "st_dist",    start: 18, count: 9 },
    { name: "op_amp",     start: 27, count: 9 },
    { name: "te_amp",     start: 36, count: 9 },
    { name: "st_amp",     start: 45, count: 9 },
    { name: "gzRatio",    start: 54, count: 1 },
    { name: "op_trans",   start: 55, count: 1 },
    { name: "te_trans",   start: 56, count: 1 },
    { name: "st_trans",   start: 57, count: 1 },
    { name: "op_tr5",     start: 58, count: 1 },
    { name: "op_tr20",    start: 59, count: 1 },
    { name: "op_run",     start: 60, count: 1 },
    { name: "te_run",     start: 61, count: 1 },
    { name: "st_run",     start: 62, count: 1 },
    { name: "op_runV",    start: 63, count: 1 },
    { name: "te_runV",    start: 64, count: 1 },
    { name: "st_runV",    start: 65, count: 1 },
    { name: "op_entM",    start: 66, count: 1 },
    { name: "te_entM",    start: 67, count: 1 },
    { name: "st_entM",    start: 68, count: 1 },
    { name: "op_entV",    start: 69, count: 1 },
    { name: "te_entV",    start: 70, count: 1 },
    { name: "st_entV",    start: 71, count: 1 },
    { name: "op_txen",    start: 72, count: 1 },
    { name: "traj",       start: 73, count: 3 },
  ];

  const byGroup = {};
  for (const g of groups) {
    const ea = qv.slice(g.start, g.start + g.count);
    const eb = cv.slice(g.start, g.start + g.count);
    byGroup[g.name] = cosTwo(ea, eb);
  }

  // Aggregate: mean of all distribution channels, mean of all temporal channels
  const distNames = ["op_dist","te_dist","st_dist","op_amp","te_amp","st_amp","gzRatio"];
  const tempNames = ["op_trans","te_trans","st_trans","op_tr5","op_tr20",
                     "op_run","te_run","st_run","op_runV","te_runV","st_runV",
                     "op_entM","te_entM","st_entM","op_entV","te_entV","st_entV",
                     "op_txen","traj"];

  byGroup.agg_dist  = mean(distNames.map(n => byGroup[n]));
  byGroup.agg_temp  = mean(tempNames.map(n => byGroup[n]));
  byGroup.agg_all   = mean(groups.map(g => byGroup[g.name]));

  return byGroup;
}

// ── Single-file zstd compressed size ──

function zstSize(text) {
  const inp = join(TMP, "in.txt");
  const out = join(TMP, "out.zst");
  writeFileSync(inp, text);
  execSync(`zstd -f -q "${inp}" -o "${out}"`, { stdio: "ignore" });
  const sz = readFileSync(out).length;
  return sz;
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const rebuild = args.includes("--rebuild");

  mkdirSync(CACHE, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  // Gather corpus
  const files = (await readdir(CORPUS)).filter(f => f.endsWith(".txt"));
  console.error(`Corpus: ${files.length} files`);

  const byGenre = {};
  for (const f of files) {
    const g = inferGenre(f);
    if (!byGenre[g]) byGenre[g] = [];
    byGenre[g].push(f);
  }

  const genreOrder = Object.entries(byGenre)
    .filter(([_, list]) => list.length >= 3)  // at least 3 for meaningful comparison
    .sort((a, b) => b[1].length - a[1].length);

  console.error("\nGenre groups:");
  for (const [g, list] of genreOrder) {
    console.error(`  ${g}: ${list.length} books`);
  }

  // Generate fingerprints and frame sequences (cached)
  const allFP = {};
  const genreFP = {};
  const genreFS = {};
  const genreAM = {};
  let processed = 0;

  for (const [genre, list] of genreOrder) {
    for (const f of list) {
      const base = f.replace(/\.txt$/, "");
      const fpCache = join(CACHE, base + ".fp");
      const fsCache = join(CACHE, base + ".fseq");
      const amCache = join(CACHE, base + ".amp");
      let fp, fs, am;
      if (!rebuild) {
        try { fp = readFileSync(fpCache, "utf8"); } catch {}
        try { fs = readFileSync(fsCache, "utf8"); } catch {}
        try { am = readFileSync(amCache, "utf8"); } catch {}
      }
      if (!fp || !fs || !am) {
        const text = readFileSync(join(CORPUS, f), "utf8");
        if (!fp) { fp = quickFingerprint(text); if (fp) writeFileSync(fpCache, fp); }
        if (!fs) { fs = frameSeq(text); if (fs) writeFileSync(fsCache, fs); }
        if (!am) { am = ampMat(text); if (am) writeFileSync(amCache, am); }
      }
      if (fp && fs && am) {
        allFP[f] = fp;
        if (!genreFP[genre]) genreFP[genre] = [];
        genreFP[genre].push({ file: f, fp });
        if (!genreFS[genre]) genreFS[genre] = [];
        genreFS[genre].push({ file: f, fs });
        if (!genreAM[genre]) genreAM[genre] = [];
        genreAM[genre].push({ file: f, am });
        processed++;
      }
    }
  }
  console.error(`\nProcessed ${processed} books with fingerprints + frame sequences + amp matrices`);

  // ── Phase A: compress-against-exemplar genre classification ──

  console.error("\n=== Compress-against-exemplar: predicting genre for W&P and Bible ===\n");

  const wpRaw = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf8");
  const bibleRaw = readFileSync("/Users/mlacy/Downloads/pg10.txt", "utf8");
  const wpFP = quickFingerprint(wpRaw);
  const bibleFP = quickFingerprint(bibleRaw);
  const wpFS = frameSeq(wpRaw);
  const bibleFS = frameSeq(bibleRaw);
  const wpAM = ampMat(wpRaw);
  const bibleAM = ampMat(bibleRaw);
  const queries = [
    { name: "War and Peace", fp: wpFP, fs: wpFS, am: wpAM },
    { name: "King James Bible", fp: bibleFP, fs: bibleFS, am: bibleAM },
  ];

  // Bayesian baseline: compress against ALL exemplars
  function growthOverExemplar(fpOrFs, genreExemplars, key) {
    const concat = genreExemplars.map(e => e[key]).join("\n");
    const cGenre = zstSize(concat);
    const cCombined = zstSize(concat + "\n" + fpOrFs);
    return cCombined - cGenre;
  }

  const allFPexemplar = Object.values(genreFP).flat().map(e => e.fp).join("\n");
  const allFSexemplar = Object.values(genreFS).flat().map(e => e.fs).join("\n");
  const allAMexemplar = Object.values(genreAM).flat().map(e => e.am).join("\n");

  const runGrowth = (name, fp, fs, am) => {
    const cAllFP = zstSize(allFPexemplar);
    const cAllFPq = zstSize(allFPexemplar + "\n" + fp);
    const fpBaseline = cAllFPq - cAllFP;

    const cAllFS = zstSize(allFSexemplar);
    const cAllFSq = zstSize(allFSexemplar + "\n" + fs);
    const fsBaseline = cAllFSq - cAllFS;

    const cAllAM = zstSize(allAMexemplar);
    const cAllAMq = zstSize(allAMexemplar + "\n" + am);
    const amBaseline = cAllAMq - cAllAM;

    console.log(`  ${name}:`);
    console.log(`  ${"GENRE".padEnd(22)} FP_IMP     FS_IMP     AM_IMP`);
    console.log("  " + "-".repeat(60));

    const results = [];
    for (const [genre, exemplars] of Object.entries(genreFP)) {
      const gFP = growthOverExemplar(fp, exemplars, "fp");
      const gFS = growthOverExemplar(fs, genreFS[genre], "fs");
      const gAM = growthOverExemplar(am, genreAM[genre], "am");
      const fpImp = fpBaseline - gFP;
      const fsImp = fsBaseline - gFS;
      const amImp = amBaseline - gAM;
      results.push({ genre, fpImp, fsImp, amImp });
    }
    results.sort((a, b) => (b.fpImp + b.fsImp + b.amImp) - (a.fpImp + a.fsImp + a.amImp));

    for (const r of results) {
      const fpiS = r.fpImp >= 0 ? `+${r.fpImp}` : `${r.fpImp}`;
      const fsiS = r.fsImp >= 0 ? `+${r.fsImp}` : `${r.fsImp}`;
      const amiS = r.amImp >= 0 ? `+${r.amImp}` : `${r.amImp}`;
      console.log(`  ${r.genre.padEnd(22)} ${fpiS.padStart(5)}B   ${fsiS.padStart(5)}B   ${amiS.padStart(5)}B`);
    }
    console.log();
  };

  runGrowth("War and Peace", wpFP, wpFS, wpAM);
  runGrowth("King James Bible", bibleFP, bibleFS, bibleAM);

  // ── Phase B: Leave-one-out cross-validation ──

  console.error("=== Leave-one-out CV (per-genre accuracy, zstd growth) ===\n");

  const genreNames = Object.keys(genreFP);

  for (const [genre, exemplars] of Object.entries(genreFP)) {
    if (exemplars.length < 4) {
      console.log(`  ${genre.padEnd(22)} N/A (only ${exemplars.length} exemplars)`);
      continue;
    }

    let correct = 0, total = 0;
    for (let holdout = 0; holdout < exemplars.length; holdout++) {
      const heldFP = exemplars[holdout].fp;
      let bestGrowth = Infinity, bestGenre = "";

      for (const g of genreNames) {
        const all = genreFP[g];
        const train = (g === genre) ? all.filter((_, i) => i !== holdout) : all;
        if (train.length === 0) continue;

        const concat = train.map(e => e.fp).join("\n");
        const cTrain = zstSize(concat);
        const cCombined = zstSize(concat + "\n" + heldFP);
        const growth = cCombined - cTrain;
        if (growth < bestGrowth) { bestGrowth = growth; bestGenre = g; }
      }

      total++;
      if (bestGenre === genre) correct++;
    }

    const pct = total > 0 ? ((correct / total) * 100).toFixed(0) : "N/A";
    console.log(`  ${genre.padEnd(22)} ${correct}/${total} correct (${pct}%)`);
  }

  // ── Phase C: Structural fingerprint cosine against genre centroids ──

  console.error("\n=== Structural fingerprint cosine against genre centroids ===\n");

  // Compute per-genre centroid vectors
  const centroids = {};
  for (const [genre, exemplars] of Object.entries(genreFP)) {
    if (exemplars.length < 2) continue;
    const fvs = exemplars.map(e => fpVector(e.fp));
    const n = fvs.length;
    const centroid = new Array(fvs[0].length).fill(0);
    for (const fv of fvs) {
      for (let i = 0; i < fv.length; i++) centroid[i] += fv[i];
    }
    centroids[genre] = centroid.map(v => v / n);
  }

  // Cosine to centroids
  const centroidGenres = Object.keys(centroids).sort();

  const runCentroid = (name, fp) => {
    const qv = fpVector(fp);
    const results = centroidGenres.map(g => ({
      genre: g,
      channels: channelSimilarity(qv, centroids[g]),
    })).sort((a, b) => b.channels.agg_temp - a.channels.agg_temp);

    console.log(`  ${name}:`);
    console.log(`  ${"GENRE".padEnd(22)} DIST_ALL    TEMP_ALL    DIST+       TEMP+`);
    for (const r of results.slice(0, 10)) {
      const c = r.channels;
      console.log(`  ${r.genre.padEnd(22)} ${c.agg_dist.toFixed(4)}    ${c.agg_temp.toFixed(4)}    ${c.agg_all.toFixed(4)}`);
    }
    const bestDist = results.reduce((a, b) => a.channels.agg_dist > b.channels.agg_dist ? a : b);
    const bestTemp = results.reduce((a, b) => a.channels.agg_temp > b.channels.agg_temp ? a : b);
    console.log(`  Best by dist: ${bestDist.genre} (${bestDist.channels.agg_dist.toFixed(4)})`);
    console.log(`  Best by temp: ${bestTemp.genre} (${bestTemp.channels.agg_temp.toFixed(4)})`);
    console.log();
  };

  runCentroid("War and Peace", wpFP);
  runCentroid("King James Bible", bibleFP);

  // Basics: per-genre centroid distributions (9 operator + 9 terrain + 9 stance = 27 values)
  // How different are the mean distribution vectors across genres?
  console.error("--- Genre centroid pairwise cosine (operator × terrain × stance, no compression) ---\n");

  const centMap = {};
  for (const [genre, exemplars] of Object.entries(genreFP)) {
    const fvs = exemplars.map(e => fpVector(e.fp));
    const n = fvs.length;
    if (n < 2) continue;
    const cent = new Array(18).fill(0); // first 18 values: op_dist + te_dist
    for (const fv of fvs) {
      for (let i = 0; i < 18; i++) cent[i] += fv[i];
    }
    for (let i = 0; i < 18; i++) cent[i] /= n;
    centMap[genre] = { cent, n };
  }

  const sortedGenres = Object.keys(centMap).sort();
  const matrix = [];
  for (const g1 of sortedGenres) {
    const row = [];
    for (const g2 of sortedGenres) {
      const a = centMap[g1].cent, b = centMap[g2].cent;
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < 18; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      row.push(dot / (Math.sqrt(na) * Math.sqrt(nb) || 1));
    }
    matrix.push(row);
  }

  // Print header
  console.log(`  ${"".padEnd(24)} ${sortedGenres.map(g => g.slice(0, 8).padEnd(8)).join(" ")}`);
  for (let i = 0; i < sortedGenres.length; i++) {
    console.log(`  ${sortedGenres[i].padEnd(24)} ${matrix[i].map(v => v.toFixed(4).padStart(8)).join(" ")}`);
  }

  // Most and least similar pairs (excluding self)
  let minSim = 1, maxSim = 0, minPair = "", maxPair = "";
  for (let i = 0; i < sortedGenres.length; i++) {
    for (let j = i + 1; j < sortedGenres.length; j++) {
      const s = matrix[i][j];
      if (s < minSim) { minSim = s; minPair = `${sortedGenres[i]} vs ${sortedGenres[j]}`; }
      if (s > maxSim) { maxSim = s; maxPair = `${sortedGenres[i]} vs ${sortedGenres[j]}`; }
    }
  }
  console.log(`\n  Most similar (op+te dist): ${maxPair} = ${maxSim.toFixed(4)}`);
  console.log(`  Least similar (op+te dist): ${minPair} = ${minSim.toFixed(4)}`);

  // Operator-only centroids (9 values)
  console.error("\n--- Operator centroid per genre (9-vector) ---\n");
  for (const g of sortedGenres) {
    const c = centMap[g].cent.slice(0, 9);
    console.log(`  ${g.padEnd(24)} ${c.map(v => v.toFixed(1).padStart(5)).join(" ")}`);
  }
  // Intra vs cross per-channel
  console.error("--- Intra vs cross by channel (English genres) ---\n");
  const englishGenres = ["english_fiction", "poetry", "drama", "science", "history", "critical", "fiction"];

  for (const g of englishGenres) {
    const fps = genreFP[g];
    if (!fps || fps.length < 3) continue;

    // Intra: channel similarity between all pairs within genre
    let intraDist = 0, intraTemp = 0, intraN = 0;
    const vecs = fps.map(e => fpVector(e.fp));
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        const ch = channelSimilarity(vecs[i], vecs[j]);
        intraDist += ch.agg_dist; intraTemp += ch.agg_temp; intraN++;
      }
    }

    // Cross: channel similarity against other English genre centroids
    let crossDist = 0, crossTemp = 0, crossN = 0;
    for (const og of englishGenres) {
      if (og === g || !centroids[og]) continue;
      const cv = centroids[og];
      for (const ex of fps) {
        const ch = channelSimilarity(fpVector(ex.fp), cv);
        crossDist += ch.agg_dist; crossTemp += ch.agg_temp; crossN++;
      }
    }

    const idM = intraN ? (intraDist / intraN) : 0;
    const itM = intraN ? (intraTemp / intraN) : 0;
    const cdM = crossN ? (crossDist / crossN) : 0;
    const ctM = crossN ? (crossTemp / crossN) : 0;

    console.log(`  ${g.padEnd(22)} DIST intra=${idM.toFixed(4)} cross=${cdM.toFixed(4)} ratio=${idM && cdM ? (idM/cdM).toFixed(3) : "N/A"}  |  TEMP intra=${itM.toFixed(4)} cross=${ctM.toFixed(4)} ratio=${itM && ctM ? (itM/ctM).toFixed(3) : "N/A"}`);
  }

  // Cleanup
  try { execSync(`rm -rf "${TMP}"`, { stdio: "ignore" }); } catch {}
  console.error("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
