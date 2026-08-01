#!/usr/bin/env node
import { readFileSync } from "fs";
import { buildFoldCache, structuralQuery } from "../packages/engine/emergence/structural-query/index.js";

const args = process.argv.slice(2);
const help = `structural-query-cli: cross-modal structural similarity search

Usage:
  node scripts/structural-query-cli.mjs <corpus-file> <archetype-ref> [options]

Options:
  --window-units <n>    Units per window (default: 16)
  --stride <n>          Window stride (default: 8)
  --top-k <n>           Results to return (default: 10)

Archetype references:
  synth:sonata-allegro-form    Synthesized sonata form (experimental)
  synth:fugue-form             Synthesized fugue form (experimental)
  <kind-id>                    A Kind from priors/kind registry
  <instance-id>                A specific ingested instance

Examples:
  node scripts/structural-query-cli.mjs pg2600.txt synth:sonata-allegro-form --top-k 5
`;

if (args.length < 2 || args[0] === "--help" || args[0] === "-h") {
  console.log(help);
  process.exit(0);
}

const corpusFile = args[0];
const archetypeRef = args[1];
const opts = {};
for (let i = 2; i < args.length; i += 2) {
  switch (args[i]) {
    case "--window-units": opts.windowUnits = parseInt(args[i + 1]); break;
    case "--stride": opts.stride = parseInt(args[i + 1]); break;
    case "--top-k": opts.topK = parseInt(args[i + 1]); break;
  }
}

let text;
try {
  text = readFileSync(corpusFile, "utf-8");
} catch (err) {
  console.error(JSON.stringify({ error: `cannot read corpus file: ${err.message}` }));
  process.exit(1);
}

// The engine has no clock: this CLI is the host, so it is the one that reads
// the wall clock and hands `ts` down. Engine-side the field would just be null.
const ts = Date.now();

const cache = buildFoldCache(corpusFile, text, { ...opts, ts });
console.error(`  indexed ${cache.nWindows} windows from ${cache.nUnits} units`);
if (cache.nWindows === 0) {
  console.error(`  text too short for window size ${opts.windowUnits ?? 16} — use --window-units to reduce`);
}

const result = structuralQuery(corpusFile, archetypeRef, {
  foldCache: cache,
  topK: opts.topK ?? 10,
  windowUnits: opts.windowUnits,
  stride: opts.stride,
  permutationSamples: 200,
  ts,
});

console.log(JSON.stringify(result, null, 2));
