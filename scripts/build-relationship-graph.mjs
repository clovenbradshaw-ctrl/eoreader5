// scripts/build-relationship-graph.mjs — build a referent relationship graph
// for ANY text, given a per-text coref prior and a language relation-lexicon.
//
// This script is deliberately generic: it does not know it is being run on
// War and Peace, or on English. Everything text-specific (the cast and their
// name aliases) and everything language-specific (which words imply which
// relation category) is loaded as data from the coref/lexicon JSON files —
// see priors/coref/*.json and priors/lexicon/*.json. Swap those two files
// and the same script builds a relationship graph for a different book or
// a different language.
//
// Usage:
//   node scripts/build-relationship-graph.mjs <textPath> <corefPriorPath> [lexiconPath] [outPath]
//
// Example (War and Peace):
//   node scripts/build-relationship-graph.mjs \
//     /path/to/pg2600.txt \
//     priors/coref/war-and-peace.json \
//     priors/lexicon/en-relations.json \
//     out/war-and-peace-graph.json

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { splitSentences } from "../packages/engine/emergence/summary/text-organ.js";
import { buildRelationshipGraph } from "../packages/engine/emergence/summary/relationship-graph.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const [textPath, corefPriorPath, lexiconPath, outPath] = process.argv.slice(2);

if (!textPath || !corefPriorPath) {
  console.error(
    "Usage: node scripts/build-relationship-graph.mjs <textPath> <corefPriorPath> [lexiconPath] [outPath]"
  );
  process.exit(1);
}

const resolvedLexiconPath = lexiconPath ?? join(ROOT, "priors/lexicon/en-relations.json");
const resolvedOutPath = outPath ?? join(ROOT, "out/relationship-graph.json");

const fullText = readFileSync(textPath, "utf-8");
const corefArtifact = JSON.parse(readFileSync(corefPriorPath, "utf-8"));
const lexiconArtifact = JSON.parse(readFileSync(resolvedLexiconPath, "utf-8"));

const referents = corefArtifact.referents ?? corefArtifact.cast ?? [];
const lexicon = lexiconArtifact.categories ?? {};

console.error(`[build-relationship-graph] text: ${textPath} (${fullText.length} chars)`);
console.error(`[build-relationship-graph] coref prior: ${corefPriorPath} (${referents.length} referents)`);
console.error(`[build-relationship-graph] lexicon: ${resolvedLexiconPath} (${Object.keys(lexicon).length} categories)`);

const sentences = splitSentences(fullText);
console.error(`[build-relationship-graph] ${sentences.length} sentences`);

const graph = buildRelationshipGraph(fullText, referents, {
  sentences,
  lexicon,
  significance: { minCount: 3, minLift: 1.5 },
});

const gapCount = graph.nodes.reduce((n, node) => n + (node.gaps?.length ?? 0), 0);
console.error(
  `[build-relationship-graph] ${graph.nodes.length} nodes, ${graph.edges.length} co-occurrence edges ` +
  `(${graph.edges.filter((e) => e.reliable).length} reliable), ${gapCount} admission gaps`
);

mkdirSync(dirname(resolvedOutPath), { recursive: true });
writeFileSync(resolvedOutPath, JSON.stringify({
  source: { textPath, corefPriorPath, lexiconPath: resolvedLexiconPath },
  sentenceCount: graph.sentenceCount,
  nodes: graph.nodes,
  edges: graph.edges,
}, null, 2));
console.error(`[build-relationship-graph] wrote ${resolvedOutPath}`);
