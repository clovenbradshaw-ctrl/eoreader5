// probe-coref-test.mjs — find a test that separates ALIASES from ASSOCIATES.
//
// Frame-level lift failed: "the room" and "the guitar" co-occur with Natasha as
// strongly as any alias would, because they share her scenes. Association is
// not identity.
//
// Hypothesis: aliases are in COMPLEMENTARY DISTRIBUTION. "the creature" and
// "the monster" substitute for one another, so they rarely appear in the SAME
// SENTENCE. An associate ("the room", "the hair") sits in the same sentence as
// the referent constantly. So:
//
//   frameLift    high for both  (same scenes)
//   sentenceLift LOW for aliases, HIGH for associates
//
// Test that separation on known aliases vs known associates.

import { readFileSync } from "fs";

const deacc = (s) => s.toLowerCase()
  .replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e").replace(/[íìîï]/g, "i")
  .replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u");

function analyse(label, src, seed, probes) {
  const text = deacc(readFileSync(src, "utf-8").replace(/\r\n/g, "\n"));
  const sentences = text.split(/(?<=[.!?])\s+|\n\n+/).filter((s) => s.length > 15);
  const N = sentences.length;

  const has = (s, w) => new RegExp(`\\b${w}\\b`).test(s);
  const seedSents = sentences.map((s) => has(s, seed));
  const seedN = seedSents.filter(Boolean).length;

  // frame proxy: a window of 12 consecutive sentences
  const W = 12;
  const winCount = Math.ceil(N / W);
  const seedWin = new Set();
  for (let i = 0; i < N; i++) if (seedSents[i]) seedWin.add(Math.floor(i / W));

  console.log(`\n===== ${label}  seed="${seed}"  (${N} sentences, seed in ${seedN}) =====`);
  console.log(`  candidate        sentLift  winLift   ratio(win/sent)`);
  const rows = [];
  for (const [w, kind] of probes) {
    const wSents = sentences.map((s) => has(s, w));
    const wN = wSents.filter(Boolean).length;
    if (!wN) { console.log(`  ${w.padEnd(16)} — absent`); continue; }
    let both = 0;
    for (let i = 0; i < N; i++) if (wSents[i] && seedSents[i]) both++;
    const sentExp = (wN * seedN) / N;
    const sentLift = sentExp > 0 ? both / sentExp : 0;

    const wWin = new Set();
    for (let i = 0; i < N; i++) if (wSents[i]) wWin.add(Math.floor(i / W));
    let bothW = 0;
    for (const o of wWin) if (seedWin.has(o)) bothW++;
    const winExp = (wWin.size * seedWin.size) / winCount;
    const winLift = winExp > 0 ? bothW / winExp : 0;

    const ratio = sentLift > 0 ? winLift / sentLift : Infinity;
    rows.push({ w, kind, sentLift, winLift, ratio });
    console.log(
      `  ${w.padEnd(16)} ${sentLift.toFixed(2).padStart(7)}  ${winLift.toFixed(2).padStart(7)}  ${ratio.toFixed(2).padStart(7)}   ${kind}`
    );
  }
  const al = rows.filter((r) => r.kind === "ALIAS").map((r) => r.ratio);
  const as = rows.filter((r) => r.kind === "associate").map((r) => r.ratio);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  console.log(`  mean ratio — ALIAS ${mean(al).toFixed(2)}   associate ${mean(as).toFixed(2)}`);
}

analyse("Frankenstein", "/Users/mlacy/Documents/Default Project/pg84.txt", "creature", [
  ["monster", "ALIAS"], ["wretch", "ALIAS"], ["fiend", "ALIAS"], ["daemon", "ALIAS"],
  ["hair", "associate"], ["aunt", "associate"], ["duty", "associate"], ["room", "associate"],
  ["cottage", "associate"], ["ice", "associate"],
]);

analyse("War and Peace", "/Users/mlacy/Downloads/pg2600.txt", "natasha", [
  ["rostova", "ALIAS"],
  ["sonya", "associate"], ["room", "associate"], ["guitar", "associate"],
  ["dress", "associate"], ["countess", "associate"], ["nicholas", "associate"],
]);
