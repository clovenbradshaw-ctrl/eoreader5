#!/usr/bin/env node
import { readFileSync } from "fs";
import { entityFold } from "./packages/engine/emergence/summary/entity-fold.js";

const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8");
const packet = entityFold(wp, "Natasha Rostova", { title: "Natasha Rostova", sceneCount: 12 });

console.log(`Key moments: ${packet.keyMoments.length}\n`);
for (const m of packet.keyMoments) {
  console.log(`[${m.type ?? "?"}] idx=${m.idx} score=${m.score?.toFixed(2)}`);
  console.log(`  "${m.text.substring(0, 150).replace(/\n/g, ' ')}"`);
  console.log();
}
