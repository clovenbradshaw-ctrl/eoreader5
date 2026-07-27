// probe-triad.mjs — Is the significance triad firing at all?
//
// Hypothesis: a narratively significant moment is one where the reader's
// perspective on a character or event CHANGES — a recontextualisation. That
// should classify as REC, and when operator/stance/terrain agree, as the
// diagonal cell REC_Cultivating_Paradigm.
//
// If REC almost never fires, and the diagonal almost never fires, then the
// classifier cannot express significance and no prior built on top of it can
// detect significance either.

import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";
import { classify, isDiagonal, coherence } from "./packages/engine/cube/index.js";

const SRC = "/Users/mlacy/Downloads/pg2600.txt";
const PRIOR = "/Users/mlacy/Documents/Default Project/eoPriors/priors/corpus-prior-cube.json";
const text = readFileSync(SRC, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const frames = frameText(text);

const OPS = ["NUL", "SIG", "INS", "SEG", "CON", "SYN", "DEF", "EVA", "REC"];
const opN = new Map(OPS.map((o) => [o, 0]));
const stN = new Map();
const teN = new Map();
let diag = 0;

for (const f of frames) {
  const c = classify(f.text);
  f.c = c;
  opN.set(c.operator, (opN.get(c.operator) ?? 0) + 1);
  stN.set(c.stance, (stN.get(c.stance) ?? 0) + 1);
  teN.set(c.terrain, (teN.get(c.terrain) ?? 0) + 1);
  if (isDiagonal(c)) diag++;
}

const N = frames.length;
console.log(`W&P: ${N} frames\n`);
console.log("OPERATOR distribution:");
for (const o of OPS) {
  const n = opN.get(o) ?? 0;
  console.log(`  ${o}  ${String(n).padStart(5)}  ${((n / N) * 100).toFixed(1).padStart(5)}%  ${"█".repeat(Math.round((n / N) * 60))}`);
}
console.log(`\nSTANCE distribution:`);
for (const [s, n] of [...stN.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${s.padEnd(12)} ${String(n).padStart(5)}  ${((n / N) * 100).toFixed(1).padStart(5)}%`);
console.log(`\nTERRAIN distribution:`);
for (const [t, n] of [...teN.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${t.padEnd(12)} ${String(n).padStart(5)}  ${((n / N) * 100).toFixed(1).padStart(5)}%`);

console.log(`\nDIAGONAL (triad agrees): ${diag}/${N} = ${((diag / N) * 100).toFixed(2)}%`);

// Where does REC fire, and does it coincide with the golden scenes?
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
console.log("\nGolden scenes — operator / stance / terrain / diagonal / coherence:");
for (const [id, anchor] of GOLDEN) {
  const at = text.indexOf(anchor);
  const f = frames.find((fr) => at >= fr.offset && at < fr.offset + 2000);
  if (!f) continue;
  console.log(
    `  ${id.padEnd(20)} ${f.c.operator.padEnd(4)} ${f.c.stance.padEnd(12)} ${f.c.terrain.padEnd(10)} ${isDiagonal(f.c) ? "DIAG" : "    "}  coh=${JSON.stringify(coherence(f.c))}`
  );
}

// Same question of the corpus prior.
const prior = JSON.parse(readFileSync(PRIOR, "utf-8"));
const pOps = new Map(OPS.map((o) => [o, 0]));
let pDiag = 0;
for (const [cell, ppm] of Object.entries(prior.distribution_ppm)) {
  const [o, s, t] = cell.split("_");
  pOps.set(o, (pOps.get(o) ?? 0) + ppm);
  if (isDiagonal({ operator: o, stance: s, terrain: t })) pDiag += ppm;
}
console.log("\nCORPUS PRIOR operator mass (ppm):");
for (const o of OPS) console.log(`  ${o}  ${String(pOps.get(o) ?? 0).padStart(7)}  ${(((pOps.get(o) ?? 0) / 1e6) * 100).toFixed(1)}%`);
console.log(`  diagonal mass: ${pDiag} ppm = ${((pDiag / 1e6) * 100).toFixed(2)}%`);
