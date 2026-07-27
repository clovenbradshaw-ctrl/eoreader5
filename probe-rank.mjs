// probe-rank.mjs — Is the signal strong enough in principle?
//
// Recall depends on both the scorer and the selection budget. If a golden frame
// ranks 15th of 3228 the signal is there and we just need more picks; if it
// ranks 900th no selector will ever recover it. Rank separates those cases.

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
  f.Atmo = amp(a.terrain, "Atmosphere");
  const t = deaccent(f.text);
  let n = 0, i = t.indexOf("natasha");
  while (i !== -1) { n++; i = t.indexOf("natasha", i + 1); }
  f.density = n;
  f.score = f.REC * Math.log1p(f.density);
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
const ranked = present.slice().sort((a, b) => b.score - a.score);
const rankOf = new Map(ranked.map((f, i) => [f.offset, i + 1]));

console.log(`frames with entity: ${present.length} of ${frames.length}\n`);
console.log("scene                 rank   REC    Cult   Atmo   density");
const ranks = [];
for (const [id, anchor] of GOLDEN) {
  const at = text.indexOf(anchor);
  const f = frames.find((fr) => at >= fr.offset && at < fr.offset + 2000);
  if (!f) { console.log(`${id.padEnd(20)} frame not found`); continue; }
  const r = rankOf.get(f.offset);
  ranks.push(r ?? Infinity);
  console.log(
    `${id.padEnd(20)} ${String(r ?? "n/a").padStart(5)}  ${f.REC.toFixed(2)}  ${f.Cult.toFixed(2)}  ${f.Atmo.toFixed(2)}  ${String(f.density).padStart(4)}`
  );
}

const finite = ranks.filter((r) => Number.isFinite(r)).sort((a, b) => a - b);
console.log(`\nmedian rank of golden frames: ${finite[Math.floor(finite.length / 2)]} of ${present.length}`);
for (const N of [12, 24, 50, 100, 200]) {
  const hits = finite.filter((r) => r <= N).length;
  console.log(`  recall@${String(N).padStart(3)} (pure top-N, no strata): ${hits}/${GOLDEN.length}`);
}
