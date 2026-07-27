// probe-signal.mjs — For each verified golden scene, ask: does the current
// physics rank it highly at all? If the golden frames sit at median rank, the
// signal is absent, not merely mis-selected.

import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";

const SRC = "/Users/mlacy/Downloads/pg2600.txt";
const text = readFileSync(SRC, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const frames = frameText(text);

const deaccent = (s) =>
  s.toLowerCase().replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e")
   .replace(/[íìîï]/g, "i").replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u");

for (const f of frames) {
  const t = deaccent(f.text);
  let n = 0, i = t.indexOf("natasha");
  while (i !== -1) { n++; i = t.indexOf("natasha", i + 1); }
  f.density = n;
}

function kl(p, q) {
  let d = 0, pT = 0, qT = 0;
  for (const v of p.values()) pT += v;
  for (const v of q.values()) qT += v;
  if (!pT || !qT) return 0;
  for (const [w, c] of p) {
    const pv = c / pT;
    const qv = ((q.get(w) ?? 0) + 0.5) / (qT + 0.5 * (q.size + 1));
    d += pv * Math.log(pv / qv);
  }
  return d;
}
const W = 20;
for (let i = 0; i < frames.length; i++) {
  const prior = new Map();
  for (let j = Math.max(0, i - W); j < i; j++)
    for (const [w, c] of frames[j].dist) prior.set(w, (prior.get(w) ?? 0) + c);
  frames[i].surprise = prior.size ? kl(frames[i].dist, prior) : 0;
}
const L = 50;
for (let i = 0; i < frames.length; i++) {
  const from = Math.max(0, i - L), to = Math.min(frames.length, i + L);
  let sum = 0, n = 0;
  for (let j = from; j < to; j++) { sum += frames[j].surprise; n++; }
  const mean = sum / n;
  let v = 0;
  for (let j = from; j < to; j++) v += (frames[j].surprise - mean) ** 2;
  frames[i].localZ = (frames[i].surprise - mean) / (Math.sqrt(v / n) || 1);
}

// dialogue / affect density — cheap proxies for dramatic peak
for (const f of frames) {
  const q = (f.text.match(/[“”]/g) ?? []).length;
  f.dialogue = q / (f.text.length / 1000);
  const excl = (f.text.match(/[!?]/g) ?? []).length;
  f.affect = excl / (f.text.length / 1000);
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

const pctile = (arr, val) => (arr.filter((x) => x < val).length / arr.length * 100);
const zs = frames.map((f) => f.localZ);
const ds = frames.map((f) => f.density);
const dl = frames.map((f) => f.dialogue);
const af = frames.map((f) => f.affect);

console.log("Percentile rank of each golden scene's frame (100 = top of document):\n");
console.log("scene                 localZ%  density%  dialogue%  affect%");
for (const [id, anchor] of GOLDEN) {
  const at = text.indexOf(anchor);
  const f = frames.find((fr) => at >= fr.offset && at < fr.offset + 2000);
  if (!f) { console.log(`${id.padEnd(20)} — frame not found`); continue; }
  console.log(
    `${id.padEnd(20)} ${pctile(zs, f.localZ).toFixed(0).padStart(6)}  ${pctile(ds, f.density).toFixed(0).padStart(7)}  ${pctile(dl, f.dialogue).toFixed(0).padStart(8)}  ${pctile(af, f.affect).toFixed(0).padStart(6)}`
  );
}
