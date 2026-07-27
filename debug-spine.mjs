#!/usr/bin/env node
import { readFileSync } from "fs";
import { segmentSentences, findEntityMentions } from "./packages/engine/emergence/summary/entity-fold.js";
import { significanceSpine } from "./packages/engine/emergence/summary/spine.js";

const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8");
const sentences = segmentSentences(wp);
const relevant = findEntityMentions(sentences, "Natasha Rostova");

console.log(`Total relevant sentences: ${relevant.length}`);

// The golden scenes are at these approximate W&P line numbers:
// first ball: 25556, folk dance: 28400, elopement: 32235, nursing: 53042, carts: 47136
// Let's see roughly what POSITION in the `relevant` array these correspond to
const goldenLines = {
  "first ball": 25556,
  "folk dance": 28400,
  "elopement": 32235,
  "nursing": 53042,
  "carts": 47136,
};

// Need to map sentence idx -> approximate original line number.
// segmentSentences doesn't track line numbers, only sentence idx across
// the whole document. Let's estimate: find sentences whose text appears
// near these known scenes by searching for keywords.
for (const [name, line] of Object.entries(goldenLines)) {
  console.log(`\n${name} (~line ${line}):`);
}

// Instead, let's just run the spine with full diagnostics and print ALL scores
const spine = significanceSpine(relevant, { budget: 600, k: 30 });
console.log(`\nStride: ${spine.stride}, Sampled: ${spine.sampled}, Units: ${spine.units}`);
console.log(`\nTop 30 peaks (by position in relevant array):`);
const sortedPeaks = [...spine.scoreByPos.entries()].sort((a,b) => b[1]-a[1]);
for (const [pos, score] of sortedPeaks.slice(0, 30)) {
  const s = relevant[pos];
  console.log(`  pos=${pos} score=${score.toFixed(3)}: "${s.text.substring(0, 90).replace(/\n/g,' ')}"`);
}

// Check position distribution - what fraction of the 1194 array is each golden scene at?
console.log("\n\n=== Searching for golden scene text in relevant array ===");
const searches = {
  "first ball (danced exquisitely)": "danced exquisitely",
  "folk dance (Uncle)": "niece!",
  "elopement (abduction)": "abduction",
  "nursing (gazing at her)": "gazing at her",
  "carts (Papa! Mamma!)": "Papa! Mamma!",
};
for (const [name, kw] of Object.entries(searches)) {
  const idx = relevant.findIndex(s => s.text.includes(kw));
  console.log(`  ${name}: found at array position ${idx} (of ${relevant.length}) = ${(idx/relevant.length*100).toFixed(1)}%`);
}
