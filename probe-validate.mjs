// probe-validate.mjs — Does `Cult x Atmo x log1p(density)` transfer?
//
// The scorer was fitted on 8 Natasha scenes. Applying it UNCHANGED to a second
// character in the same text (Pierre) and a different author/century/narrative
// mode (Frankenstein's creature) is the only way to tell physics from curve fit.
// No parameter is re-tuned here.

import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";
import { classifyAmplitudes } from "./packages/engine/cube/index.js";

const amp = (l, k) => l.find((x) => x.label === k)?.amplitude ?? 0;
const deaccent = (s) =>
  s.toLowerCase().replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e")
   .replace(/[íìîï]/g, "i").replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u");

// The exact scorer selected on Natasha.
const SCORE = (f) => f.Cult * f.Atmo * Math.log1p(f.density);

const CASES = [
  {
    name: "Natasha (fitted)",
    src: "/Users/mlacy/Downloads/pg2600.txt",
    terms: ["natasha"],
    golden: [
      ["first-ball", "He asked her to waltz."],
      ["uncle-folk-dance", "Where, how, and when had this young countess"],
      ["anatole-letter", "With trembling hands Natásha held that passionate love letter"],
      ["crisis", "Natásha looked from one to the other as a hunted and wounded animal"],
      ["carts-anger", "“I consider,” Natásha suddenly almost shouted"],
      ["carts-action", "“Papa! Mamma! May I see to it? May I?...”"],
      ["deathbed", "“Forgive me!” she whispered"],
    ],
  },
  {
    name: "Pierre (held out, same text)",
    src: "/Users/mlacy/Downloads/pg2600.txt",
    terms: ["pierre", "bezukhov"],
    golden: [
      ["duel-reflection", "bully,” thought Pierre"],
      ["freemasonry", "Brotherhood of Freemasons under my sponsorship"],
      ["borodino", "Raévski Redoubt"],
      ["assassination-plan", "essential for the execution of his design"],
      ["karataev", "Karatáev,” he added, evidently wishing"],
      ["revelation", "Life is everything"],
    ],
  },
  {
    name: "Creature (held out, other text)",
    src: "/Users/mlacy/Documents/Default Project/pg84.txt",
    terms: ["creature", "monster", "wretch", "fiend", "daemon", "demon", "being"],
    golden: [
      ["creation", "It was on a dreary night of November"],
      ["first-rejection", "I beheld the wretch"],
      ["thy-creature", "Remember that I am thy creature"],
      ["benevolent", "I was benevolent and good"],
      ["cursed-creator", "Cursed, cursed creator"],
      ["demand-mate", "You must create a female"],
      ["belong-to-enemy", "Frankenstein! you belong then to my enemy"],
      ["final", "lost in darkness and distance"],
    ],
  },
];

for (const c of CASES) {
  const text = readFileSync(c.src, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = frameText(text);
  for (const f of frames) {
    const a = classifyAmplitudes(f.text);
    f.Cult = amp(a.stance, "Cultivating");
    f.Atmo = amp(a.terrain, "Atmosphere");
    const t = deaccent(f.text);
    let n = 0;
    for (const term of c.terms) {
      let i = t.indexOf(term);
      while (i !== -1) { n++; i = t.indexOf(term, i + 1); }
    }
    f.density = n;
  }

  const present = frames.filter((f) => f.density > 0);
  const ranked = present.slice().sort((a, b) => SCORE(b) - SCORE(a));
  const rank = new Map(ranked.map((f, i) => [f.offset, i + 1]));

  const rows = [];
  for (const [id, anchor] of c.golden) {
    const at = text.indexOf(anchor);
    if (at < 0) { rows.push([id, null, "anchor missing"]); continue; }
    const f = frames.find((fr) => at >= fr.offset && at < fr.offset + 2000);
    if (!f) { rows.push([id, null, "no frame"]); continue; }
    if (!f.density) { rows.push([id, null, "entity absent from frame"]); continue; }
    rows.push([id, rank.get(f.offset), null]);
  }

  const rs = rows.map((r) => r[1]).filter((x) => x != null).sort((a, b) => a - b);
  const chance = Math.round(present.length / 2);
  const med = rs.length ? rs[Math.floor(rs.length / 2)] : null;

  console.log(`\n=== ${c.name} ===`);
  console.log(`  ${present.length} entity-present frames of ${frames.length}  |  chance median = ${chance}`);
  for (const [id, r, note] of rows)
    console.log(`    ${id.padEnd(20)} ${note ? "— " + note : "rank " + String(r).padStart(4)}`);
  if (med != null) {
    const lift = (chance / med).toFixed(1);
    console.log(`  median rank ${med} / ${present.length}   lift vs chance: ${lift}x`);
    for (const N of [12, 25, 50]) console.log(`    recall@${String(N).padStart(2)}: ${rs.filter((r) => r <= N).length}/${rs.length}`);
  }
}
