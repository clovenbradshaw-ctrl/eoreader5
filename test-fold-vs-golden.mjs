#!/usr/bin/env node
// test-fold-vs-golden.mjs — Run entity-fold on Storgy text, compare to golden

import { readFileSync } from "fs";
import { entityFold } from "./packages/engine/emergence/summary/entity-fold.js";
import natashaGolden from "./packages/engine/emergence/summary/golden/natasha-rostova.js";

// Load Storgy text
const storgyText = readFileSync(process.env.NATASHA_PATH ?? "data/natasha.txt", "utf-8");

// Run the fold
const packet = entityFold(storgyText, "Natasha Rostova", {
  title: "Natasha Rostova",
});

// ── Compare fields ──

console.log("=== FOLD OUTPUT vs GOLDEN ===\n");

// 1. Properties
console.log("--- PROPERTIES ---");
console.log(`Fold: ${packet.properties.length} properties`);
console.log(`Golden: ${natashaGolden.properties.length} properties`);
for (const p of packet.properties) {
  console.log(`  FOLD: "${p.label}" → "${p.value}"`);
}
console.log();
for (const p of natashaGolden.properties) {
  console.log(`  GOLD: "${p.label}" → "${p.value}"`);
}

// 2. Relations
console.log("\n--- RELATIONS ---");
console.log(`Fold: ${packet.relations.length} relations`);
console.log(`Golden: ${natashaGolden.relations.length} relations`);
for (const r of packet.relations) {
  console.log(`  FOLD: "${r.subject}" "${r.verb}" "${r.object}" (pos: ${r.time?.position})`);
}

// 3. Groups
console.log("\n--- GROUPS ---");
console.log(`Fold settled: ${packet.groups.settled.length}`);
console.log(`Fold heldOpen: ${packet.groups.heldOpen.length}`);
console.log(`Fold turns: ${packet.groups.turns.length}`);
console.log(`Golden settled: ${natashaGolden.groups.settled.length}`);
console.log(`Golden heldOpen: ${natashaGolden.groups.heldOpen.length}`);
console.log(`Golden turns: ${natashaGolden.groups.turns.length}`);

// 4. Spans
console.log("\n--- SPANS ---");
console.log(`Fold: ${packet.spans.length} spans`);
for (const s of packet.spans) {
  console.log(`  FOLD [${s.idx}]: "${s.text.substring(0, 80)}..."`);
}

// 5. Figures
console.log("\n--- FIGURES ---");
console.log(`Fold: ${packet.figures.length} figures`);
for (const f of packet.figures) {
  console.log(`  FOLD: "${f.label}" (count: ${f.count})`);
}

// 6. Missing fields
console.log("\n--- MISSING FIELDS ---");
const foldKeys = Object.keys(packet);
const goldenKeys = Object.keys(natashaGolden);
const missing = goldenKeys.filter((k) => !foldKeys.includes(k));
const extra = foldKeys.filter((k) => !goldenKeys.includes(k));
console.log(`Missing from fold: ${missing.join(", ") || "none"}`);
console.log(`Extra in fold: ${extra.join(", ") || "none"}`);

// 7. Fields that exist in both but differ
console.log("\n--- FIELD-BY-FIELD DIFF ---");
const shared = foldKeys.filter((k) => goldenKeys.includes(k));
for (const k of shared) {
  const foldVal = packet[k];
  const goldVal = natashaGolden[k];
  const foldType = typeof foldVal === "object" ? (Array.isArray(foldVal) ? `array[${foldVal.length}]` : "object") : typeof foldVal;
  const goldType = typeof goldVal === "object" ? (Array.isArray(goldVal) ? `array[${goldVal.length}]` : "object") : typeof goldVal;
  const match = JSON.stringify(foldVal) === JSON.stringify(goldVal);
  console.log(`  ${k}: fold=${foldType} golden=${goldType} match=${match}`);
}
