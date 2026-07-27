// probe-priors.mjs — Score significance against the CORPUS PRIOR instead of a
// trailing in-document window.
//
// Trailing-window KL measures "is this vocabulary new to this book" — which
// ranks the deathbed at the 9th percentile. The corpus prior measures "is this
// cube cell rare across 495 books" — information content relative to
// accumulated knowledge, which is what the fold is supposed to project onto.

import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";
import { classify, coherence, isDiagonal } from "./packages/engine/cube/index.js";

const SRC = "/Users/mlacy/Downloads/pg2600.txt";
const PRIOR = "/Users/mlacy/Documents/Default Project/eoPriors/priors/corpus-prior.json";

const text = readFileSync(SRC, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const prior = JSON.parse(readFileSync(PRIOR, "utf-8"));
const ppm = prior.distribution_ppm;
const TOTAL = Object.values(ppm).reduce((a, b) => a + b, 0);

const frames = frameText(text);
console.log(`${frames.length} frames | prior: ${Object.keys(ppm).length} cells from ${prior.generated_from.books} books\n`);

const deaccent = (s) =>
  s.toLowerCase().replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e")
   .replace(/[íìîï]/g, "i").replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u");

for (const f of frames) {
  const t = deaccent(f.text);
  let n = 0, i = t.indexOf("natasha");
  while (i !== -1) { n++; i = t.indexOf("natasha", i + 1); }
  f.density = n;

  const c = classify(f.text);
  f.cell = `${c.operator}_${c.stance}_${c.terrain}`;
  const p = (ppm[f.cell] ?? 1) / TOTAL;
  f.priorSurprise = -Math.log(p); // information content vs accumulated corpus
  f.coherence = coherence(c);
  f.diagonal = isDiagonal(c);
}

const cellCounts = new Map();
for (const f of frames) cellCounts.set(f.cell, (cellCounts.get(f.cell) ?? 0) + 1);
console.log("Cube cells occupied by W&P frames (vs prior ppm):");
for (const [cell, n] of [...cellCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cell.padEnd(28)} frames=${String(n).padStart(5)}  prior_ppm=${String(ppm[cell] ?? 0).padStart(6)}  -logp=${(-Math.log((ppm[cell] ?? 1) / TOTAL)).toFixed(2)}`);
}

const GOLDEN = [
  ["first-appearance", "This black-eyed, wide-mouthed girl"],
  ["first-ball", "He asked her to waltz."],
  ["uncle-folk-dance", "Where, how, and when had this young countess"],
  ["anatole-letter", "With trembling hands Natásha held that passionate love letter"],
  ["crisis", "Natásha looked from one to the other as a hunted and wounded animal"],
  ["carts-anger", "“I consider,” Natásha suddenly almost shouted"],
  ["carts-action", "“Papa! Mamma! May I see to it? May I?...”"],
  ["deathbed", "“Forgive me!” she whispered"],
];

const pctile = (arr, v) => (arr.filter((x) => x < v).length / arr.length) * 100;
const ps = frames.map((f) => f.priorSurprise);
const co = frames.map((f) => f.coherence);

console.log("\nGolden scenes under PRIOR-relative scoring:\n");
console.log("scene                 cell                         priorS%  coher%  diagonal");
for (const [id, anchor] of GOLDEN) {
  const at = text.indexOf(anchor);
  const f = frames.find((fr) => at >= fr.offset && at < fr.offset + 2000);
  if (!f) { console.log(`${id.padEnd(20)} not found`); continue; }
  console.log(
    `${id.padEnd(20)} ${f.cell.padEnd(28)} ${pctile(ps, f.priorSurprise).toFixed(0).padStart(6)}  ${pctile(co, f.coherence).toFixed(0).padStart(5)}  ${f.diagonal ? "yes" : "no"}`
  );
}
