// scripts/bench-retrieval-vs-colbert.mjs — benchmark our associative-memory
// retrieval organ (emergence/store: Hebbian sparse-code recall, buildStore/
// surface) against a ColBERT-style late-interaction retriever.
//
// HONESTY NOTE (read before trusting any number this prints): this sandbox's
// network policy allows pypi/npm but blocks huggingface.co, so the real
// pretrained ColBERTv2 checkpoint (hosted only on the HF hub) cannot be
// downloaded here. The "colbert-maxsim" system below is the real ColBERT
// ALGORITHM — late interaction: encode every token, score a candidate by
// summing, over each query token, its max cosine similarity to any candidate
// token (MaxSim) — but run over WordLlama's static (non-contextual) per-token
// embeddings (distilled from a real LLM's input embedding table, MIT
// licensed, ships its weights inside the pip package so it needs no network
// access) instead of a fine-tuned contextual BERT. It is a fair test of the
// architectural claim ColBERT makes (dense/semantic late interaction recalls
// things sparse lexical Hebbian recall can't) but NOT a citation-grade
// ColBERTv2 reproduction. See scripts/bench/README.md for the full rationale
// and scripts/bench/RESULTS.md for the last recorded run.
//
// Usage: node scripts/bench-retrieval-vs-colbert.mjs [pg84] [pg2600]
//   (defaults to both books; each book needs its source .txt — see TEXTS)
//
// Pipeline:
//   1. (this file) frame the book with the engine's own frameText, build the
//      real store, rank the frozen memory-golden events AND a large set of
//      auto-derived long-range verbatim-motif pairs (mined straight out of
//      store.posting — the same sparse code the engine itself indexes, not a
//      reinvented co-occurrence counter) with the engine's own surface().
//   2. hand off frames + events to scripts/bench/colbert_baseline.py, which
//      ranks the identical candidate set with MaxSim late interaction and a
//      pooled-cosine dense-bi-encoder baseline.
//   3. merge, score Recall@1/5/10 + MRR per system, print + write RESULTS.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { frameText } from "../packages/engine/emergence/summary/text-organ.js";
import { buildStore, surface } from "../packages/engine/emergence/store/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, "bench", ".cache");
mkdirSync(CACHE_DIR, { recursive: true });

// Same convention as score-memory-golden.mjs / score-span-golden.mjs (this
// repo hardcodes the maintainer's machine paths for these two source texts).
// EO_PG84_PATH / EO_PG2600_PATH override for other machines/sandboxes.
const TEXTS = {
  pg84: process.env.EO_PG84_PATH || "/Users/mlacy/Documents/Default Project/pg84.txt",
  pg2600: process.env.EO_PG2600_PATH || "/Users/mlacy/Downloads/pg2600.txt",
};

const GOLDEN = JSON.parse(readFileSync(
  new URL("../packages/engine/emergence/summary/golden/memory-golden.json", import.meta.url), "utf-8"));

const findFlexible = (text, anchor) =>
  text.search(new RegExp(anchor.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")));
const frameAt = (frames, at) => { let best = null; for (const f of frames) if (f.offset <= at) best = f; return best; };

// ── auto-derived verbatim-motif long-range recall pairs ────────────────────
// Mined directly from store.posting (the organ's own sparse code: idf-gated,
// df>=2 motifs — see emergence/store/index.js header). For each motif that
// recurs, pair its EARLIEST and LATEST occurrence as (source, cue), keeping
// only pairs far enough apart (minGapFrames) that they aren't just the
// trivial 50%-overlap of adjacent frames. This is mechanical and reproducible
// (no hand curation), so it can give large-N statistics to sit beside the 4
// hand-verified frozen golden events, which stay the trusted ground truth.
function deriveMotifPairs(store, frames, { minGapFrames = 15, maxPairs = 60 } = {}) {
  const seenPair = new Set();
  const candidates = [];
  for (const [motif, postingMap] of store.posting) {
    const orders = [...postingMap.keys()].sort((a, b) => a - b);
    if (orders.length < 2) continue;
    const sourceOrder = orders[0], cueOrder = orders[orders.length - 1];
    if (cueOrder - sourceOrder < minGapFrames) continue;
    const key = `${sourceOrder}:${cueOrder}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    candidates.push({ motif, sourceOrder, cueOrder, gap: cueOrder - sourceOrder });
  }
  // Deterministic, evenly-spaced sample across the candidate list (sorted by
  // gap so we cover a range of distances, not just the longest few).
  candidates.sort((a, b) => a.gap - b.gap);
  if (candidates.length <= maxPairs) return candidates;
  const step = candidates.length / maxPairs;
  const sampled = [];
  for (let i = 0; i < maxPairs; i++) sampled.push(candidates[Math.floor(i * step)]);
  return sampled;
}

function rankEvent(store, frames, cueFrame, sourceFrame, charTolerance) {
  const ranked = surface(store, cueFrame.text, { selfOrder: cueFrame.order, cueOrder: cueFrame.order })
    .filter((r) => r.order < cueFrame.order - 1);
  const rank = ranked.findIndex((r) => Math.abs(frames[r.order]?.offset - sourceFrame.offset) <= charTolerance) + 1;
  return {
    rank: rank || null,
    topK: ranked.slice(0, 10).map((r) => ({ order: r.order, offset: frames[r.order].offset, activation: r.activation })),
    candidateCount: ranked.length,
  };
}

function processBook(bookKey) {
  const path = TEXTS[bookKey];
  if (!existsSync(path)) {
    console.log(`SKIP ${bookKey}: source text not found at ${path} (set EO_${bookKey.toUpperCase()}_PATH)`);
    return null;
  }
  const text = readFileSync(path, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = frameText(text);
  const store = buildStore(frames);

  const events = [];
  const engineResults = {};

  for (const ev of GOLDEN.events) {
    if (ev.text !== bookKey) continue;
    const cueAt = findFlexible(text, ev.cueAnchor);
    const srcAt = findFlexible(text, ev.sourceAnchor);
    if (cueAt < 0 || srcAt < 0) { console.log(`SKIP ${ev.id}: anchor missing`); continue; }
    const cueFrame = frameAt(frames, cueAt);
    const sourceFrame = frameAt(frames, srcAt);
    const id = `golden:${ev.id}`;
    events.push({
      id, kind: "golden", tier: ev.tier,
      cueOrder: cueFrame.order, cueOffset: cueFrame.offset,
      sourceOrder: sourceFrame.order, sourceOffset: sourceFrame.offset,
      charTolerance: GOLDEN.charTolerance,
    });
    engineResults[id] = rankEvent(store, frames, cueFrame, sourceFrame, GOLDEN.charTolerance);
  }

  const motifPairs = deriveMotifPairs(store, frames);
  const MOTIF_TOLERANCE = 1000; // one frame hop: overlapping neighbour counts as the same passage
  for (const [i, pair] of motifPairs.entries()) {
    const cueFrame = frames[pair.cueOrder];
    const sourceFrame = frames[pair.sourceOrder];
    const id = `motif:${bookKey}:${i}`;
    events.push({
      id, kind: "motif", tier: "engine",
      cueOrder: cueFrame.order, cueOffset: cueFrame.offset,
      sourceOrder: sourceFrame.order, sourceOffset: sourceFrame.offset,
      charTolerance: MOTIF_TOLERANCE, motif: pair.motif,
    });
    engineResults[id] = rankEvent(store, frames, cueFrame, sourceFrame, MOTIF_TOLERANCE);
  }

  writeFileSync(join(CACHE_DIR, `${bookKey}-frames.json`),
    JSON.stringify(frames.map((f) => ({ order: f.order, offset: f.offset, text: f.text }))));
  writeFileSync(join(CACHE_DIR, `${bookKey}-events.json`), JSON.stringify(events));
  writeFileSync(join(CACHE_DIR, `${bookKey}-engine-results.json`), JSON.stringify(engineResults));

  console.log(`${bookKey}: ${frames.length} frames, ${events.length} events ` +
    `(${events.filter((e) => e.kind === "golden").length} golden, ${events.filter((e) => e.kind === "motif").length} auto-motif)`);
  return { text, frames, events, engineResults };
}

const requestedBooks = process.argv.slice(2).filter((a) => TEXTS[a]);
const books = requestedBooks.length ? requestedBooks : Object.keys(TEXTS);

const prepared = {};
for (const book of books) {
  const result = processBook(book);
  if (result) prepared[book] = result;
}

if (Object.keys(prepared).length === 0) {
  console.log("No books available — nothing to benchmark.");
  process.exit(1);
}

// ── hand off to the ColBERT-style worker ────────────────────────────────
const py = spawnSync("python3", [join(HERE, "bench", "colbert_baseline.py"), "--cache-dir", CACHE_DIR, ...Object.keys(prepared)],
  { stdio: "inherit" });
if (py.status !== 0) {
  console.error("colbert_baseline.py failed — see output above. Is scripts/bench/requirements.txt installed?");
  process.exit(py.status || 1);
}

// ── merge + score ────────────────────────────────────────────────────────
function hitRank(rank, k) { return rank != null && rank <= k; }
function mrrOf(rank) { return rank != null ? 1 / rank : 0; }

const SYSTEMS = ["engine", "colbert-maxsim", "dense-cosine"];
const lines = [];
const push = (s) => { console.log(s); lines.push(s); };

push(`# Retrieval benchmark: associative-memory store vs. ColBERT-style late interaction\n`);
push(`Books: ${Object.entries(prepared).map(([b, p]) => `${b} (${p.frames.length} frames)`).join(", ")}\n`);

for (const [book, { events, engineResults }] of Object.entries(prepared)) {
  const colbertResults = JSON.parse(readFileSync(join(CACHE_DIR, `${book}-colbert-results.json`), "utf-8"));

  push(`## ${book}\n`);
  push(`### Frozen golden events (hand-verified ground truth; tier discipline check)\n`);
  push(`| event | tier | engine | colbert-maxsim | dense-cosine |`);
  push(`|---|---|---|---|---|`);
  const goldenEvents = events.filter((e) => e.kind === "golden");
  for (const ev of goldenEvents) {
    const eRank = engineResults[ev.id]?.rank ?? null;
    const cRank = colbertResults[ev.id]?.maxsim?.rank ?? null;
    const dRank = colbertResults[ev.id]?.dense?.rank ?? null;
    // A rank found somewhere in a long candidate list is not the same as a
    // retriever surfacing it: only within rankTolerance counts as a hit/leak
    // (matches score-memory-golden.mjs's own hit criterion). Anything else,
    // including "not found at all", is a correct gap for a model-tier event.
    const within = (rank) => rank != null && rank <= GOLDEN.rankTolerance;
    const verdict = (rank) => ev.tier === "model"
      ? (within(rank) ? `LEAK (rank ${rank})` : `gap (correct)${rank ? ` [rank ${rank}, outside tolerance]` : ""}`)
      : (within(rank) ? `hit (rank ${rank})` : `MISS${rank ? ` [rank ${rank}, outside tolerance]` : ""}`);
    push(`| ${ev.id.replace("golden:", "")} | ${ev.tier} | ${verdict(eRank)} | ${verdict(cRank)} | ${verdict(dRank)} |`);
  }

  const motifEvents = events.filter((e) => e.kind === "motif");
  if (motifEvents.length) {
    push(`\n### Auto-derived long-range verbatim-motif recall (${motifEvents.length} pairs, engine-tier by construction)\n`);
    push(`| system | Recall@1 | Recall@5 | Recall@10 | MRR |`);
    push(`|---|---|---|---|---|`);
    for (const sys of SYSTEMS) {
      let r1 = 0, r5 = 0, r10 = 0, mrrSum = 0;
      for (const ev of motifEvents) {
        const rank = sys === "engine" ? engineResults[ev.id]?.rank
          : sys === "colbert-maxsim" ? colbertResults[ev.id]?.maxsim?.rank
          : colbertResults[ev.id]?.dense?.rank;
        if (hitRank(rank, 1)) r1++;
        if (hitRank(rank, 5)) r5++;
        if (hitRank(rank, 10)) r10++;
        mrrSum += mrrOf(rank);
      }
      const n = motifEvents.length;
      push(`| ${sys} | ${r1}/${n} | ${r5}/${n} | ${r10}/${n} | ${(mrrSum / n).toFixed(3)} |`);
    }
  }
  push("");
}

push(`---\n_Substitute-baseline caveat: "colbert-maxsim" is the real ColBERT late-interaction (MaxSim) algorithm run over WordLlama static token embeddings, not the pretrained ColBERTv2 checkpoint — huggingface.co (the checkpoint's only host) is blocked by this sandbox's network policy. See scripts/bench/README.md._`);

writeFileSync(join(HERE, "bench", "RESULTS.md"), lines.join("\n") + "\n");
console.log(`\nWrote ${join(HERE, "bench", "RESULTS.md")}`);
