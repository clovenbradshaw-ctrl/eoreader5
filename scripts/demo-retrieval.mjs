import { readFileSync } from "fs";
import { buildSentenceIndex, queryIndex, RetrievalSession } from "../packages/engine/retrieval/index.js";

const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
console.log("=== Indexing ===");
const start = Date.now();
const index = buildSentenceIndex(wp);
console.log(`  ${index.length} sentences in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);

const queries = [
  "Natasha's first ball",
  "He asked her to waltz",
  "Pierre's duel with Dolokhov",
  "the creature's creation",
  "war council before Austerlitz",
];

for (const q of queries) {
  console.log(`--- "${q}" ---`);
  const results = queryIndex(index, q, { limit: 3, minScore: 0.05 });
  if (!results.length) { console.log("  No matches\n"); continue; }
  for (const r of results) {
    const pct = (r.score * 100).toFixed(1);
    const t = r.text.slice(0, 130).replace(/\n/g, " ");
    console.log(`  [${pct}%] offset=${r.offset}  "${t}..."`);
  }
  console.log();
}
