#!/usr/bin/env node
import { readFileSync } from "fs";
import { frameText, discoverEntities, detectBoundaries } from "./packages/engine/emergence/summary/text-organ.js";

const wp = readFileSync(process.env.WP_PATH ?? "data/pg2600.txt", "utf-8");
console.log(`Text: ${wp.length} chars`);

const t0 = Date.now();
const frames = frameText(wp);
console.log(`frameText: ${frames.length} frames in ${Date.now() - t0}ms`);

const t1 = Date.now();
const entities = discoverEntities(frames);
console.log(`discoverEntities: ${entities.length} entities in ${Date.now() - t1}ms`);

const t2 = Date.now();
const boundaries = detectBoundaries(frames);
console.log(`detectBoundaries: ${boundaries.length} boundaries in ${Date.now() - t2}ms`);

console.log(`Total: ${Date.now() - t0}ms`);
