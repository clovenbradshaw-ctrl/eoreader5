// run-retrieval-json.mjs — output mechanical retrieval results as JSON
// Reads pre-split passages from a JSON file (shared with ColBERT benchmark).
// Builds char-trigram signal vectors and scores by cosine similarity.

import { readFileSync } from "fs";
import {
  extractTextFieldVectors,
  querySignal,
  cosineSimilarity,
} from "../packages/engine/perceiver/text/text-signal.js";

function parseArg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const k = parseInt(parseArg("--k", "3"), 10);
const passagesPath = parseArg("--passages", "");
if (!passagesPath) {
  console.error("Missing --passages <path>");
  process.exit(1);
}

const passages = JSON.parse(readFileSync(passagesPath, "utf-8"));
if (!Array.isArray(passages) || !passages.length) {
  console.error("No passages in file");
  process.exit(1);
}

// Build signal vectors per passage
const index = passages.map((p) => {
  const vectors = extractTextFieldVectors(p.text);
  return {
    id: p.id,
    text: p.text,
    signal: vectors.frames[0]?.field ?? null,
  };
});

const queries = [
  "Natasha's first ball",
  "He asked her to waltz",
  "Pierre's duel with Dolokhov",
  "the creature's creation",
  "war council before Austerlitz",
];

const output = [];

for (const q of queries) {
  const qSig = querySignal(q);
  if (!qSig) { output.push({ query: q, results: [] }); continue; }

  const scored = index
    .map((entry) => ({
      id: entry.id,
      text: entry.text,
      score: entry.signal ? cosineSimilarity(qSig, entry.signal) : 0,
    }))
    .filter((r) => r.score >= 0.05)
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, k);

  output.push({ query: q, results: scored });
}

process.stdout.write(JSON.stringify(output));
