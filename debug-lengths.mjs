#!/usr/bin/env node
import { readFileSync } from "fs";
import { segmentSentences, findEntityMentions } from "./packages/engine/emergence/summary/entity-fold.js";

const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8");
const sentences = segmentSentences(wp);
const relevant = findEntityMentions(sentences, "Natasha Rostova");

// Check length distribution
const lengths = relevant.map(s => s.text.length);
lengths.sort((a,b) => a-b);
console.log("Length distribution:");
console.log("  min:", lengths[0]);
console.log("  p10:", lengths[Math.floor(lengths.length*0.1)]);
console.log("  p50:", lengths[Math.floor(lengths.length*0.5)]);
console.log("  p90:", lengths[Math.floor(lengths.length*0.9)]);
console.log("  max:", lengths[lengths.length-1]);

console.log("\nShort fragments (<15 chars), first 20:");
const short = relevant.filter(s => s.text.length < 15);
console.log(`Count: ${short.length} of ${relevant.length}`);
for (const s of short.slice(0, 20)) {
  console.log(`  "${s.text}"`);
}
