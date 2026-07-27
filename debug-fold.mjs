#!/usr/bin/env node
// debug-fold.mjs — Debug why the fold produces nothing

import { readFileSync } from "fs";
import { segmentSentences, findEntityMentions, extractRelations } from "./packages/engine/emergence/summary/entity-fold.js";

const wp = readFileSync(process.env.WP_PATH ?? "data/pg2600.txt", "utf-8");

// 1. Sentence segmentation
console.log("=== SENTENCE SEGMENTATION ===");
const sentences = segmentSentences(wp);
console.log(`Total sentences: ${sentences.length}`);
console.log(`First 3:`, sentences.slice(0, 3).map(s => s.text.substring(0, 80)));

// 2. Entity mentions
console.log("\n=== ENTITY MENTIONS ===");
const mentions = findEntityMentions(sentences, "Natasha Rostova");
console.log(`Mentions of "Natasha Rostova": ${mentions.length}`);

const mentions2 = findEntityMentions(sentences, "Natásha");
console.log(`Mentions of "Natásha": ${mentions2.length}`);

// Check first few lines for the accent
const lines = wp.split("\n");
const natashaLines = lines.filter(l => l.toLowerCase().includes("natasha") || l.toLowerCase().includes("natásha"));
console.log(`Lines with natasha/natásha: ${natashaLines.length}`);
console.log(`First 3:`, natashaLines.slice(0, 3).map(l => l.substring(0, 100)));

// 3. Try with just "Natasha" (no accent)
const mentions3 = findEntityMentions(sentences, "Natasha");
console.log(`\nMentions of "Natasha" (no accent): ${mentions3.length}`);

// 4. Sample a sentence to check segmentation
console.log("\n=== SAMPLE SENTENCES ===");
// Find a line with Natásha
const sampleLine = lines.find(l => l.includes("Natásha"));
if (sampleLine) {
  console.log(`Sample line: "${sampleLine.substring(0, 120)}"`);
  const sampleSentences = segmentSentences(sampleLine);
  console.log(`Segmented into ${sampleSentences.length} sentences:`);
  for (const s of sampleSentences) {
    console.log(`  "${s.text.substring(0, 100)}"`);
  }
}
