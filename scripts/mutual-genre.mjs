#!/usr/bin/env node
// scripts/mutual-genre.mjs
//
// Genre as mutual recognition: each book's store surfaces its own frames
// through every other book's store. The 199×199 symmetric recognition matrix
// is clustered to find self-contained genre structure — no external target.
//
// Usage:
//   node scripts/mutual-genre.mjs \
//     --corpus-dir ./corpus_newconsolidated \
//     --out ./priors/genre-matrix.json \
//     [--max-books N] [--frames-per-book N]

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { frameText } from "../packages/engine/emergence/summary/text-organ.js";
import { buildStore, surface } from "../packages/engine/emergence/store/index.js";

function parseArgs(argv) {
  const get = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
  return {
    corpusDir: get("--corpus-dir", null),
    out: get("--out", null),
    maxBooks: Number(get("--max-books", 0)) || Infinity,
    idfFloor: Number(get("--idf-floor", 2.0)),
    edgeSlots: Number(get("--edge-slots", 18)),
    surfaceTop: Number(get("--surface-top", 10)),
  };
}

function stripGutenberg(t) {
  const a = t.search(/\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  const b = t.search(/\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  return a >= 0 && b > a ? t.slice(t.indexOf("\n", a) + 1, b) : t;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.corpusDir || !args.out) {
    console.error("usage: mutual-genre.mjs --corpus-dir <dir> --out <file.json> [--max-books N]");
    process.exit(1);
  }

  const files = readdirSync(args.corpusDir).filter((f) => f.endsWith(".txt")).sort();
  const n = Math.min(files.length, args.maxBooks);
  console.error(`Reading ${n} books through engine...`);

  const books = [];
  for (let i = 0; i < n; i++) {
    let text;
    try { text = stripGutenberg(readFileSync(`${args.corpusDir}/${files[i]}`, "utf8")); }
    catch (e) { continue; }
    const frames = frameText(text);
    if (!frames.length) continue;
    const store = buildStore(frames, { idfFloor: args.idfFloor, edgeSlots: args.edgeSlots });
    const id = files[i].replace(/\.txt$/, "").replace(/^global_south_corpus__/, "").replace(/^gutenberg_corpus__/, "").slice(0, 70);
    books.push({ id, file: files[i], frames, store });
    if (books.length % 25 === 0) console.error(`  ${books.length} books read (avg ${Math.round(books.reduce((s,b)=>s+b.frames.length,0)/books.length)} frames/book)...`);
  }
  console.error(`  ${books.length} books read\n`);

  // ── Mutual recognition: surface each book through every other book's store
  console.error(`Computing ${books.length}×${books.length} mutual recognition...`);

  const M = Array.from({ length: books.length }, () => new Array(books.length).fill(0));

  for (let i = 0; i < books.length; i++) {
    const storeI = books[i].store;
    for (let j = 0; j < books.length; j++) {
      if (i === j) { M[i][j] = 999; continue; }
      let sum = 0;
      const framesJ = books[j].frames;
      for (const f of framesJ) {
        const results = surface(storeI, f.text, {
          completion: 0.5, topEdges: 6, idfFloor: args.idfFloor,
        });
        sum += results.slice(0, args.surfaceTop).reduce((s, r) => s + r.activation, 0);
      }
      M[i][j] = sum / framesJ.length;
    }
    if ((i + 1) % 10 === 0) console.error(`  ${i + 1}/${books.length} rows...`);
  }

  // Symmetrize: mutual = min(forward, backward)
  const mutual = Array.from({ length: books.length }, () => new Array(books.length).fill(0));
  for (let i = 0; i < books.length; i++) {
    for (let j = i + 1; j < books.length; j++) {
      const v = Math.min(M[i][j], M[j][i]);
      mutual[i][j] = v;
      mutual[j][i] = v;
    }
  }

  console.error(`  Complete\n`);

  // ── Distribution ──────────────────────────────────────────────────────
  const allMutuals = [];
  for (let i = 0; i < books.length; i++)
    for (let j = i + 1; j < books.length; j++)
      allMutuals.push(mutual[i][j]);
  allMutuals.sort((a, b) => b - a);

  const p90 = allMutuals[Math.floor(allMutuals.length * 0.1)];
  const p95 = allMutuals[Math.floor(allMutuals.length * 0.05)];
  const p99 = allMutuals[Math.floor(allMutuals.length * 0.01)];

  console.error(`Mutual recognition distribution:`);
  console.error(`  max: ${allMutuals[0].toFixed(4)}`);
  console.error(`  p99: ${p99.toFixed(4)}`);
  console.error(`  p95: ${p95.toFixed(4)}`);
  console.error(`  p90: ${p90.toFixed(4)}`);
  console.error(`  median: ${allMutuals[Math.floor(allMutuals.length / 2)].toFixed(4)}`);

  // ── Genre clusters at multiple thresholds ─────────────────────────────
  function components(threshold) {
    const adj = new Map();
    for (let i = 0; i < books.length; i++) adj.set(i, new Set());
    for (let i = 0; i < books.length; i++)
      for (let j = i + 1; j < books.length; j++)
        if (mutual[i][j] >= threshold) { adj.get(i).add(j); adj.get(j).add(i); }

    const vis = new Set();
    const comps = [];
    for (let i = 0; i < books.length; i++) {
      if (vis.has(i)) continue;
      const c = [];
      const stk = [i];
      while (stk.length > 0) {
        const node = stk.pop();
        if (vis.has(node)) continue;
        vis.add(node);
        c.push(node);
        for (const nb of (adj.get(node) ?? new Set())) {
          if (!vis.has(nb)) stk.push(nb);
        }
      }
      comps.push(c);
    }
    comps.sort((a, b) => b.length - a.length);
    return comps;
  }

  const thresholds = [
    { name: "p99", value: p99 },
    { name: "p95", value: p95 },
    { name: "p90", value: p90 },
  ];

  console.error(`\n=== Genre counts ===`);
  for (const t of thresholds) {
    const comps = components(t.value);
    console.error(`  ${t.name} (${t.value.toFixed(2)}): ${comps.length} genres, sizes: [${comps.slice(0, 10).map(c => c.length).join(", ")}]`);
  }

  const p95Comps = components(p95);
  console.error(`\n=== Genres at p95 ===`);
  for (const c of p95Comps.slice(0, 15)) {
    const names = c.map(i => books[i].id.slice(0, 40));
    console.error(`  ${c.length} books: ${names.slice(0, 5).join(", ")}${c.length > 5 ? ` +${c.length - 5}` : ""}`);
  }

  // ── Output ────────────────────────────────────────────────────────────
  const payload = JSON.stringify({
    books: books.map(b => b.id),
    p95_genres: p95Comps.map(c => c.map(i => books[i].id)),
  });
  const hash = createHash("sha256").update(payload).digest("hex");

  const artifact = {
    schema: "MutualGenreMatrix@1",
    version: "1.0.0",
    parameters: { corpus_dir: args.corpusDir.split("/").filter(Boolean).pop(), books: books.length,
      idf_floor: args.idfFloor, edge_slots: args.edgeSlots, surface_top: args.surfaceTop },
    matrix_hash: hash,
    distribution: { max: allMutuals[0], p99, p95, p90, median: allMutuals[Math.floor(allMutuals.length / 2)] },
    threshold_analysis: thresholds.map(t => {
      const comps = components(t.value);
      return { name: t.name, threshold: +t.value.toFixed(4), genres: comps.length,
        top_sizes: comps.slice(0, 10).map(c => c.length) };
    }),
    genres_p95: p95Comps.map(c => ({ size: c.length, books: c.map(i => books[i].id) })),
  };

  writeFileSync(args.out, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  console.error(`\nWrote ${args.out}\n  hash: ${hash.slice(0, 12)}`);
}

main();
