// probe-rank2.mjs — Rank golden frames under competing significance functions.
// Median rank is the honest metric: below 338 (half of 676) means the scorer is
// worse than chance at surfacing the scenes we care about.

import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";
import { classifyAmplitudes } from "./packages/engine/cube/index.js";

const SRC = "/Users/mlacy/Downloads/pg2600.txt";
const text = readFileSync(SRC, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const frames = frameText(text);
const amp = (l, k) => l.find((x) => x.label === k)?.amplitude ?? 0;
const deaccent = (s) =>
  s.toLowerCase().replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e")
   .replace(/[íìîï]/g, "i").replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u");

for (const f of frames) {
  const a = classifyAmplitudes(f.text);
  f.REC = amp(a.operator, "REC");
  f.EVA = amp(a.operator, "EVA");
  f.Cult = amp(a.stance, "Cultivating");
  f.Bind = amp(a.stance, "Binding");
  f.Atmo = amp(a.terrain, "Atmosphere");
  const t = deaccent(f.text);
  let n = 0, i = t.indexOf("natasha");
  while (i !== -1) { n++; i = t.indexOf("natasha", i + 1); }
  f.density = n;
  f.d = Math.log1p(f.density);
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

const present = frames.filter((f) => f.density > 0);
const goldFrames = [];
for (const [id, anchor] of GOLDEN) {
  const at = text.indexOf(anchor);
  const f = frames.find((fr) => at >= fr.offset && at < fr.offset + 2000);
  if (f && f.density > 0) goldFrames.push([id, f]);
}

const SCORERS = {
  "REC x d":                (f) => f.REC * f.d,
  "Cult x d":               (f) => f.Cult * f.d,
  "Atmo x d":               (f) => f.Atmo * f.d,
  "(Cult+Atmo) x d":        (f) => (f.Cult + f.Atmo) * f.d,
  "Cult x Atmo x d":        (f) => f.Cult * f.Atmo * f.d,
  "(Cult+Atmo+EVA) x d":    (f) => (f.Cult + f.Atmo + f.EVA) * f.d,
  "(Cult+Atmo) x d^2":      (f) => (f.Cult + f.Atmo) * f.d * f.d,
  "Cult+Atmo (no density)": (f) => f.Cult + f.Atmo,
  "density only":           (f) => f.d,
};

console.log(`entity-present frames: ${present.length}  (chance median = ${Math.round(present.length / 2)})\n`);
console.log("scorer                    median  ranks of the 8 golden frames");
const rows = [];
for (const [name, fn] of Object.entries(SCORERS)) {
  const ranked = present.slice().sort((a, b) => fn(b) - fn(a));
  const rank = new Map(ranked.map((f, i) => [f.offset, i + 1]));
  const rs = goldFrames.map(([, f]) => rank.get(f.offset)).sort((a, b) => a - b);
  const med = rs[Math.floor(rs.length / 2)];
  rows.push({ name, med, rs });
  console.log(`${name.padEnd(24)} ${String(med).padStart(5)}   ${rs.join(", ")}`);
}

const best = rows.sort((a, b) => a.med - b.med)[0];
console.log(`\nBest by median rank: ${best.name} (median ${best.med} of ${present.length})`);
const fn = SCORERS[best.name];
const ranked = present.slice().sort((a, b) => fn(b) - fn(a));
const rank = new Map(ranked.map((f, i) => [f.offset, i + 1]));
for (const N of [12, 24, 50, 100]) {
  const hits = goldFrames.filter(([, f]) => rank.get(f.offset) <= N).length;
  console.log(`  recall@${String(N).padStart(3)}: ${hits}/${goldFrames.length}`);
}
console.log("\nper-scene under best scorer:");
for (const [id, f] of goldFrames)
  console.log(`  ${id.padEnd(20)} rank ${String(rank.get(f.offset)).padStart(4)}  Cult=${f.Cult.toFixed(2)} Atmo=${f.Atmo.toFixed(2)} n=${f.density}`);
