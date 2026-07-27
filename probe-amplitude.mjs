// probe-amplitude.mjs — Select on the UNCOLLAPSED fold.
//
// Cell-level prior surprise collapses 3228 frames into 43 distinct values, so
// within any stratum hundreds of frames tie and the pick is arbitrary.
// classifyAmplitudes keeps the superposition, which has real resolution.
// This compares candidate significance functions by recall against the 8
// verified golden scenes.

import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";
import { classifyAmplitudes } from "./packages/engine/cube/index.js";

const SRC = "/Users/mlacy/Downloads/pg2600.txt";
const text = readFileSync(SRC, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const frames = frameText(text);

const deaccent = (s) =>
  s.toLowerCase().replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e")
   .replace(/[íìîï]/g, "i").replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u");

const amp = (list, label) => list.find((x) => x.label === label)?.amplitude ?? 0;

for (const f of frames) {
  const a = classifyAmplitudes(f.text);
  f.REC = amp(a.operator, "REC");
  f.EVA = amp(a.operator, "EVA");
  f.Cult = amp(a.stance, "Cultivating");
  f.Atmo = amp(a.terrain, "Atmosphere");
  f.Lens = amp(a.terrain, "Lens");
  f.Para = amp(a.terrain, "Paradigm");
  const t = deaccent(f.text);
  let n = 0, i = t.indexOf("natasha");
  while (i !== -1) { n++; i = t.indexOf("natasha", i + 1); }
  f.density = n;
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
const goldOffsets = GOLDEN.map(([id, a]) => [id, text.indexOf(a)]).filter(([, o]) => o >= 0);

const SCORERS = {
  "density only":            (f) => Math.log1p(f.density),
  "atmosphere x density":    (f) => f.Atmo * Math.log1p(f.density),
  "REC x density":           (f) => f.REC * Math.log1p(f.density),
  "triad(REC+Cult+Atmo)":    (f) => (f.REC + f.Cult + f.Atmo) * Math.log1p(f.density),
  "triad x density^2":       (f) => (f.REC + f.Cult + f.Atmo) * Math.log1p(f.density) ** 2,
  "recontext(REC+Cult)":     (f) => (f.REC + f.Cult) * Math.log1p(f.density),
  "affect+recontext":        (f) => (f.Atmo + f.EVA + f.REC + f.Cult) * Math.log1p(f.density),
};

const K = 12;
function pick(scorer) {
  const scored = frames.filter((f) => f.density > 0).map((f) => ({ f, s: scorer(f) }));
  const strata = Array.from({ length: K }, () => []);
  for (const x of scored) strata[Math.min(K - 1, Math.floor((x.f.offset / text.length) * K))].push(x);
  return strata.map((b) => b.sort((a, b2) => b2.s - a.s)[0]?.f).filter(Boolean);
}

console.log(`frames=${frames.length}  golden=${goldOffsets.length}  K=${K}  (hit = pick within 2000 chars)\n`);
const results = [];
for (const [name, fn] of Object.entries(SCORERS)) {
  const picked = pick(fn);
  const hitIds = [];
  for (const [id, at] of goldOffsets)
    if (picked.some((f) => at >= f.offset - 2000 && at <= f.offset + 2000)) hitIds.push(id);
  results.push({ name, n: hitIds.length, hitIds });
  console.log(`${String(hitIds.length)}/${goldOffsets.length}  ${name.padEnd(24)} ${hitIds.join(", ")}`);
}

// How near does the best scorer get on the ones it misses?
const best = results.sort((a, b) => b.n - a.n)[0];
console.log(`\nBest: ${best.name}`);
const picked = pick(SCORERS[best.name]);
console.log("distance from each golden scene to nearest pick:");
for (const [id, at] of goldOffsets) {
  let d = Infinity;
  for (const f of picked) d = Math.min(d, Math.abs(f.offset - at));
  console.log(`  ${id.padEnd(20)} ${d === Infinity ? "-" : (d / 1000).toFixed(1) + "k chars"}`);
}
