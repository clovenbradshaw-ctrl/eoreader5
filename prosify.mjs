#!/usr/bin/env node
// prosify.mjs — Run entity-fold on W&P for Natasha, prosify the packet.

import { readFileSync } from "fs";
import { entityFold } from "./packages/engine/emergence/summary/entity-fold.js";

const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8");

const packet = entityFold(wp, "Natasha Rostova", { title: "Natasha Rostova", sceneCount: 10 });

// ── Print the raw EOT packet ──
console.log("=== EOT PACKET ===\n");
console.log(JSON.stringify(packet, null, 2));
console.log("\n");

// ── Prosify into a summary ──
const entity = packet.entity;
const keyMoments = packet.keyMoments;
const figures = packet.figures;
const groups = packet.groups;

console.log("=== PROSIFIED SUMMARY ===\n");
console.log(`**${entity}**\n`);

// Properties
if (packet.properties.length > 0) {
  console.log("Properties:");
  for (const p of packet.properties.slice(0, 5)) {
    console.log(`- ${p.label}: ${p.value.substring(0, 120)}`);
  }
  console.log();
}

// Key moments
if (keyMoments.length > 0) {
  console.log("Key moments:");
  for (const km of keyMoments) {
    const type = km.type ? `[${km.type}]` : "";
    const text = km.text.substring(0, 120).replace(/\n/g, " ");
    console.log(`${type} ${text}...`);
  }
  console.log();
}

// Groups
if (groups.settled.length > 0) {
  console.log("Settled:");
  for (const s of groups.settled.slice(0, 5)) {
    console.log(`- ${s.substring(0, 100)}`);
  }
  console.log();
}

if (groups.turns.length > 0) {
  console.log("Turns:");
  for (const t of groups.turns.slice(0, 5)) {
    console.log(`- ${t.substring(0, 100)}`);
  }
  console.log();
}

// Figures
if (figures.length > 0) {
  console.log("Connected figures:");
  for (const f of figures) {
    console.log(`- ${f.label} (${f.count} co-occurrences)`);
  }
  console.log();
}
