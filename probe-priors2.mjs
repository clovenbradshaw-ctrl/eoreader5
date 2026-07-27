// probe-priors2.mjs — Does the rebuilt cube-basis prior actually discriminate?
import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";
import { classify } from "./packages/engine/cube/index.js";

const SRC = "/Users/mlacy/Downloads/pg2600.txt";
const OLD = "/Users/mlacy/Documents/Default Project/eoPriors/priors/corpus-prior.json";
const NEW = "/Users/mlacy/Documents/Default Project/eoPriors/priors/corpus-prior-cube.json";

const text = readFileSync(SRC, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const oldP = JSON.parse(readFileSync(OLD, "utf-8")).distribution_ppm;
const newP = JSON.parse(readFileSync(NEW, "utf-8")).distribution_ppm;

const frames = frameText(text);
const deaccent = (s) =>
  s.toLowerCase().replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e")
   .replace(/[íìîï]/g, "i").replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u");

for (const f of frames) {
  const c = classify(f.text);
  f.cell = `${c.operator}_${c.stance}_${c.terrain}`;
  f.sOld = -Math.log(((oldP[f.cell] ?? 0) + 1) / 1e6);
  f.sNew = -Math.log((newP[f.cell] ?? 1) / 1e6);
  const t = deaccent(f.text);
  let n = 0, i = t.indexOf("natasha");
  while (i !== -1) { n++; i = t.indexOf("natasha", i + 1); }
  f.density = n;
}

const uniq = (a) => new Set(a).size;
console.log(`frames=${frames.length}`);
console.log(`distinct surprise values — OLD prior: ${uniq(frames.map((f) => f.sOld.toFixed(4)))}, NEW prior: ${uniq(frames.map((f) => f.sNew.toFixed(4)))}\n`);

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

const pct = (arr, v) => (arr.filter((x) => x < v).length / arr.length) * 100;
const oldArr = frames.map((f) => f.sOld);
const newArr = frames.map((f) => f.sNew);

console.log("scene                 cell                          OLD%   NEW%");
for (const [id, anchor] of GOLDEN) {
  const at = text.indexOf(anchor);
  const f = frames.find((fr) => at >= fr.offset && at < fr.offset + 2000);
  if (!f) continue;
  console.log(
    `${id.padEnd(20)} ${f.cell.padEnd(28)} ${pct(oldArr, f.sOld).toFixed(0).padStart(5)}  ${pct(newArr, f.sNew).toFixed(0).padStart(5)}`
  );
}

// Combined selector: prior surprise x entity density, stratified for coverage.
const K = 12;
const scored = frames.filter((f) => f.density > 0).map((f) => ({ ...f, score: f.sNew * Math.log1p(f.density) }));
const strata = Array.from({ length: K }, () => []);
for (const f of scored) strata[Math.min(K - 1, Math.floor((f.offset / text.length) * K))].push(f);
const picked = strata.map((b) => b.sort((a, b2) => b2.score - a.score)[0]).filter(Boolean);

console.log("\nSelector = priorSurprise(NEW) x log1p(density), stratified:");
let hits = 0;
for (const [id, anchor] of GOLDEN) {
  const at = text.indexOf(anchor);
  const hit = picked.some((f) => at >= f.offset - 2000 && at <= f.offset + 2000);
  if (hit) hits++;
  console.log(`  ${hit ? "HIT " : "MISS"} ${id}`);
}
console.log(`\n  recall = ${hits}/${GOLDEN.length}`);
