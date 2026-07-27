#!/usr/bin/env node
import { readFileSync } from "fs";
import { segmentSentences, findEntityMentions } from "./packages/engine/emergence/summary/text-organ.js";
import { detectFigures } from "./packages/engine/emergence/summary/graph.js";
import { stripDiacritics } from "./packages/engine/emergence/summary/text-organ.js";

const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8");
const sentences = segmentSentences(wp);
const relevant = findEntityMentions(sentences, "Natasha Rostova");

const figures = detectFigures(relevant, "Natasha Rostova");
console.log("Figures:");
for (const f of figures.slice(0, 15)) {
  console.log(`  ${JSON.stringify(f.label)} (count: ${f.count}) norm=${stripDiacritics(f.label).toLowerCase()}`);
}

// Check why "Natasha" is still in the figures
const natEntry = figures.find(f => f.label.toLowerCase().includes("natásha"));
if (natEntry) {
  console.log(`\nNatásha found: ${JSON.stringify(natEntry.label)}`);
  const n = stripDiacritics(natEntry.label).toLowerCase();
  console.log(`norm = ${JSON.stringify(n)}`);
  console.log(`includes 'natasha'? ${n.includes("natasha")}`);
  console.log(`equals 'natasha'? ${n === "natasha"}`);
  console.log(`equals 'natasha rostova'? ${n === "natasha rostova"}`);
}
