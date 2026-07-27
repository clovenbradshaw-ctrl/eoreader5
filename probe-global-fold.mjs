// probe-global-fold.mjs — Discover document structure, then fold across the
// WHOLE document instead of the first N boundaries.
//
// Three defects in the current path this probes:
//   1. selection takes the first K boundaries in document order (front-loading)
//   2. raw surprise drifts: early text is novel against an empty prior, late
//      text is familiar, so global ranking is systematically front-biased
//   3. "near a boundary" is not "about the entity" — proximity window is loose

import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";

const SRC = process.argv[2] ?? "/Users/mlacy/Downloads/pg2600.txt";
const ENTITY = process.argv[3] ?? "Natásha";
const K = 12;

const raw = readFileSync(SRC, "utf-8");
const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const frames = frameText(text);
console.log(`${SRC}\n${text.length.toLocaleString()} chars → ${frames.length} frames\n`);

// ── entity presence per frame ────────────────────────────────────────────────
const tokens = ENTITY.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
const deaccent = (s) =>
  s.toLowerCase().replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e")
   .replace(/[íìîï]/g, "i").replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u");
const want = tokens.map(deaccent);

for (const f of frames) {
  const t = deaccent(f.text);
  let n = 0;
  for (const w of want) {
    let i = t.indexOf(w);
    while (i !== -1) { n++; i = t.indexOf(w, i + 1); }
  }
  f.density = n;
}

// ── surprise: KL of frame against a trailing prior ───────────────────────────
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

// ── local normalization: kill the global drift ───────────────────────────────
// z-score each frame against its own neighbourhood, not the whole document.
const L = 50;
for (let i = 0; i < frames.length; i++) {
  const from = Math.max(0, i - L), to = Math.min(frames.length, i + L);
  let sum = 0, n = 0;
  for (let j = from; j < to; j++) { sum += frames[j].surprise; n++; }
  const mean = sum / n;
  let varSum = 0;
  for (let j = from; j < to; j++) varSum += (frames[j].surprise - mean) ** 2;
  const sd = Math.sqrt(varSum / n) || 1;
  frames[i].localZ = (frames[i].surprise - mean) / sd;
}

// ── stratified selection across the WHOLE document ───────────────────────────
// Score only frames where the entity is actually present, then take the best
// frame in each of K equal strata so the result spans the full arc.
const scored = frames
  .filter((f) => f.density > 0)
  .map((f) => ({ ...f, score: f.localZ * Math.log1p(f.density) }));

const strata = Array.from({ length: K }, () => []);
for (const f of scored) {
  const s = Math.min(K - 1, Math.floor((f.offset / text.length) * K));
  strata[s].push(f);
}
const picked = strata
  .map((bucket) => bucket.sort((a, b) => b.score - a.score)[0])
  .filter(Boolean);

console.log(`entity="${ENTITY}"  frames with entity: ${scored.length}\n`);
console.log("STRATIFIED PICKS (whole-document coverage):");
for (const f of picked) {
  const pct = ((f.offset / text.length) * 100).toFixed(1);
  console.log(
    `  ${pct.padStart(5)}%  @${String(f.offset).padStart(9)}  z=${f.localZ.toFixed(2).padStart(6)}  n=${String(f.density).padStart(3)}  ${JSON.stringify(f.text.slice(0, 64))}`
  );
}

// ── score against verified golden scenes ─────────────────────────────────────
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

if (SRC.includes("pg2600")) {
  console.log("\nRECALL vs verified golden scenes (hit = a pick within 2000 chars):");
  let hits = 0;
  for (const [id, anchor] of GOLDEN) {
    const at = text.indexOf(anchor);
    if (at === -1) { console.log(`  ?? ${id} (anchor missing)`); continue; }
    const hit = picked.some((f) => at >= f.offset - 2000 && at <= f.offset + 2000);
    if (hit) hits++;
    console.log(
      `  ${hit ? "HIT " : "MISS"} ${((at / text.length) * 100).toFixed(1).padStart(5)}%  ${id}`
    );
  }
  console.log(`\n  recall = ${hits}/${GOLDEN.length}`);
}
