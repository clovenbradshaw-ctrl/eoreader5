// probe-validate2.mjs — Re-run the held-out validation with referent-aware
// presence instead of substring OR.
//
// The first attempt counted "creature|monster|wretch|fiend|daemon|being" as
// substrings. That was wrong three ways, and the referents organ says so
// explicitly ("Same-string surfaces MUST NOT auto-merge"):
//
//   1. "being" (119 hits) is overwhelmingly the gerund/copula — "being able",
//      "on being informed" — not the referent.
//   2. "wretch" frequently denotes Victor, not the Creature. One surface, two
//      referents.
//   3. Frankenstein is first-person throughout. The Creature narrates 40.2%
//      -> 59.5% of the book, and in his own narration he is "I", never "the
//      creature" — so descriptor-density reads ~0 exactly where he is most
//      present. Three golden scenes fall inside that span.
//
// The Creature is what individuation.js calls an EMANON: high mass, agentive,
// never name-admitted. Presence for an emanon cannot be a name lookup.

import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";
import { classifyAmplitudes } from "./packages/engine/cube/index.js";

const amp = (l, k) => l.find((x) => x.label === k)?.amplitude ?? 0;
const SCORE = (f) => f.Cult * f.Atmo * Math.log1p(f.density); // unchanged, still fitted on Natasha

const FR = "/Users/mlacy/Documents/Default Project/pg84.txt";
const text = readFileSync(FR, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const N = text.length;

// The Creature's own narration — inside it, first person refers to him.
const taleFrom = text.indexOf("“It is with considerable difficulty that I remember");
const taleTo = text.indexOf("The being finished speaking");
console.log(`Creature's first-person narration: ${(taleFrom / N * 100).toFixed(1)}% -> ${(taleTo / N * 100).toFixed(1)}%\n`);

// Article-qualified descriptors only. Bare "being" is excluded; "wretch" is
// kept only with a determiner, which skips most of the Victor-directed uses.
const DESCRIPTORS = [
  /\bthe creature\b/gi, /\bmy creature\b/gi, /\bhis creature\b/gi,
  /\bthe monster\b/gi, /\bthe wretch\b/gi, /\bthe fiend\b/gi,
  /\bthe daemon\b/gi, /\bthe demon\b/gi, /\bthe being\b/gi,
  /\bthy creature\b/gi, /\bthe miserable monster\b/gi,
];
const FIRST_PERSON = /\b(I|my|me|myself)\b/g;

const frames = frameText(text);
for (const f of frames) {
  const a = classifyAmplitudes(f.text);
  f.Cult = amp(a.stance, "Cultivating");
  f.Atmo = amp(a.terrain, "Atmosphere");

  let n = 0;
  for (const re of DESCRIPTORS) n += (f.text.match(re) ?? []).length;
  const inTale = f.offset >= taleFrom && f.offset < taleTo;
  if (inTale) n += (f.text.match(FIRST_PERSON) ?? []).length;
  f.density = n;
  f.inTale = inTale;
}

const GOLDEN = [
  ["creation", "It was on a dreary night of November"],
  ["first-rejection", "I beheld the wretch"],
  ["thy-creature", "Remember that I am thy creature"],
  ["benevolent", "I was benevolent and good"],
  ["cursed-creator", "Cursed, cursed creator"],
  ["demand-mate", "You must create a female"],
  ["belong-to-enemy", "Frankenstein! you belong then to my enemy"],
  ["final", "lost in darkness and distance"],
];

function report(label, filterFn) {
  const present = frames.filter(filterFn);
  const ranked = present.slice().sort((a, b) => SCORE(b) - SCORE(a));
  const rank = new Map(ranked.map((f, i) => [f.offset, i + 1]));
  const rs = [];
  console.log(`--- ${label} ---`);
  console.log(`  ${present.length} present frames of ${frames.length}  |  chance median = ${Math.round(present.length / 2)}`);
  for (const [id, anchor] of GOLDEN) {
    const at = text.indexOf(anchor);
    const f = frames.find((fr) => at >= fr.offset && at < fr.offset + 2000);
    const r = f ? rank.get(f.offset) : null;
    if (r != null) rs.push(r);
    console.log(`    ${id.padEnd(18)} ${r != null ? "rank " + String(r).padStart(4) : "— absent"}${f?.inTale ? "  (in tale)" : ""}`);
  }
  rs.sort((a, b) => a - b);
  const med = rs[Math.floor(rs.length / 2)];
  const chance = Math.round(present.length / 2);
  console.log(`  median ${med} / ${present.length}   lift ${(chance / med).toFixed(1)}x   covered ${rs.length}/${GOLDEN.length}\n`);
}

report("OLD: substring OR incl. 'being'", (f) => {
  const t = f.text.toLowerCase();
  return ["creature", "monster", "wretch", "fiend", "daemon", "demon", "being"].some((x) => t.includes(x));
});
report("NEW: referent-aware (descriptors + first-person in tale)", (f) => f.density > 0);
