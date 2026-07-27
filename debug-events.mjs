#!/usr/bin/env node
import { readFileSync } from "fs";
import { segmentSentences, findEntityMentions, extractEvents } from "./packages/engine/emergence/summary/entity-fold.js";

const wp = readFileSync(process.env.WP_PATH ?? "data/pg2600.txt", "utf-8");
const sentences = segmentSentences(wp);
const relevant = findEntityMentions(sentences, "Natasha Rostova");
const events = extractEvents(relevant, "Natasha Rostova");

console.log(`Total events: ${events.length}`);
const byType = new Map();
for (const e of events) {
  byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
}
console.log("By type:", Object.fromEntries(byType));

const turningTypes = ["love", "engagement", "breakup", "elopement", "thwarting", "death", "marriage", "nursing", "evacuation", "rescue"];
const turning = events.filter(e => turningTypes.includes(e.type));
console.log(`\nTurning events: ${turning.length}`);
for (const e of turning) {
  console.log(`  [${e.type}] "${e.text.substring(0, 100).replace(/\n/g, ' ')}"`);
}
