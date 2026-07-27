#!/usr/bin/env node
import { readFileSync } from "fs";
import {
  segmentSentences,
  findEntityMentions,
  extractRelations,
  extractEvents,
} from "./packages/engine/emergence/summary/text-organ.js";
import {
  buildGraph,
  couplingByNode,
  rankBySalience,
  filterCast,
} from "./packages/engine/emergence/summary/graph.js";

const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8");
const sentences = segmentSentences(wp);
const relevant = findEntityMentions(sentences, "Natasha Rostova");
const relations = extractRelations(relevant, "Natasha Rostova");
const events = extractEvents(relevant, "Natasha Rostova");

const graph = buildGraph(relations, relevant);
const coupling = couplingByNode(graph);

console.log("=== GRAPH DUMP ===\n");

console.log(`Entities: ${graph.entities.size}`);
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
