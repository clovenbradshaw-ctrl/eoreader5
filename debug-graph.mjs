#!/usr/bin/env node
// Debug: dump the entity graph the fold pipeline builds around a target
// entity. Reads the corpus from WP_PATH (default data/pg2600.txt —
// run scripts/fetch-warandpeace.mjs first).
import { readFileSync } from "fs";
import {
  frameText,
  extractSurfaces,
} from "./packages/engine/emergence/summary/text-organ.js";
import { extractRelations } from "./packages/engine/perceiver/text/extraction.js";
import {
  buildGraph,
  couplingByNode,
  rankBySalience,
} from "./packages/engine/emergence/summary/graph.js";

const target = process.argv[2] ?? "Natasha Rostova";
const wp = readFileSync(process.env.WP_PATH ?? "data/pg2600.txt", "utf-8");
const frames = frameText(wp);
const tokens = target.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
const relevant = frames
  .filter((f) => tokens.some((t) => f.text.toLowerCase().includes(t)))
  .map((f) => ({ text: f.text, idx: f.order }));
const relations = extractRelations(relevant.map((r) => ({ text: r.text, foldScore: 0 })));

const graph = buildGraph(relations, target);
const coupling = couplingByNode(graph);

console.log("=== GRAPH DUMP ===\n");
console.log(`Frames mentioning "${target}": ${relevant.length}`);
console.log(`Surfaces (sample): ${extractSurfaces(wp).slice(0, 10).join(" | ")}`);

console.log(`\nEntities: ${graph.entities.size}`);
for (const [id, e] of graph.entities) {
  const c = coupling.get(id);
  console.log(`  ${e.label} (sightings: ${e.sightings}, rho: ${c?.rho ?? 0}, aliases: ${(e.aliases ?? []).join(", ") || "none"})`);
}

console.log(`\nEdges: ${graph.edges.length}`);
for (const e of graph.edges) {
  console.log(`  ${e.from} --[${e.via}]--> ${e.to}`);
}

const ranked = rankBySalience(graph.entities, coupling);
console.log(`\nRanked by salience:`);
for (const r of ranked) {
  console.log(`  ${r.label}: sightings=${r.sightings}, rho=${r.rho}, salience=${r.salience.toFixed(2)}`);
}
