#!/usr/bin/env node
// test-fold-wp.mjs — Run entity-fold on War and Peace, compare to golden

import { readFileSync } from "fs";
import { entityFold } from "./packages/engine/emergence/summary/entity-fold.js";
import golden from "./packages/engine/emergence/summary/golden/natasha-rostova.js";

// Load W&P
const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8");
console.log(`W&P loaded: ${wp.length} chars, ${wp.split("\n").length} lines\n`);

// Run the fold
const packet = entityFold(wp, "Natasha Rostova", {
  title: "Natasha Rostova",
});

// ── Field-by-field comparison ──

console.log("=== FOLD vs GOLDEN ===\n");

// 1. Properties
console.log("--- PROPERTIES ---");
console.log(`Fold: ${packet.properties.length}  Golden: ${golden.properties.length}`);
for (const p of packet.properties) {
  console.log(`  FOLD: "${p.label}" → "${p.value.substring(0, 80)}"`);
}
console.log();
for (const p of golden.properties) {
  console.log(`  GOLD: "${p.label}" → "${p.value.substring(0, 80)}"`);
}

// 2. Relations
console.log("\n--- RELATIONS ---");
console.log(`Fold: ${packet.relations.length}`);
for (const r of packet.relations.slice(0, 15)) {
  console.log(`  FOLD: "${r.subject}" "${r.verb}" "${r.object}" (pos: ${r.time?.position})`);
}
if (packet.relations.length > 15) console.log(`  ... and ${packet.relations.length - 15} more`);

// 3. Key moments
console.log("\n--- KEY MOMENTS ---");
console.log(`Fold: ${packet.spans.length} spans  Golden: ${golden.keyMoments.length} moments`);
for (const s of packet.spans.slice(0, 5)) {
  console.log(`  FOLD [${s.idx}]: "${s.text.substring(0, 100)}..."`);
}
console.log();
for (const m of golden.keyMoments) {
  console.log(`  GOLD: "${m.scene}" — ${m.significance}`);
}

// 4. Groups
console.log("\n--- GROUPS ---");
console.log(`Fold settled: ${packet.groups.settled.length}  Golden: ${golden.groups.settled.length}`);
console.log(`Fold heldOpen: ${packet.groups.heldOpen.length}  Golden: ${golden.groups.heldOpen.length}`);
console.log(`Fold turns: ${packet.groups.turns.length}  Golden: ${golden.groups.turns.length}`);

// 5. Figures
console.log("\n--- FIGURES ---");
console.log(`Fold: ${packet.figures.length}  Golden: N/A (golden doesn't have figures from W&P)`);
for (const f of packet.figures.slice(0, 10)) {
  console.log(`  FOLD: "${f.label}" (count: ${f.count})`);
}

// 6. Missing fields
console.log("\n--- MISSING FROM FOLD ---");
const goldenFields = ["characterArc", "keyMoments", "relationships", "essayAngles", "connectedCharacters"];
for (const f of goldenFields) {
  const foldHas = f in packet;
  const goldHas = f in golden;
  console.log(`  ${f}: fold=${foldHas ? "EXISTS" : "MISSING"}  golden=${goldHas ? "EXISTS" : "MISSING"}`);
}

// 7. Connections
console.log("\n--- CONNECTIONS ---");
console.log(`Fold: ${packet.connections.length}`);
for (const c of packet.connections.slice(0, 5)) {
  console.log(`  FOLD: "${c.subject}" "${c.verb}" "${c.object}" (strength: ${c.strength}, count: ${c.count})`);
}
