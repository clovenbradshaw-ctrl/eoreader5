// scripts/score-span-golden.mjs — THE number for significance work.
//
// Scores entityFold spans against the frozen multi-entity span golden
// (packages/engine/emergence/summary/golden/span-golden.json): 21 canonical
// scenes, 3 entities, 3 arc kinds, 2 narrative modes. Any significance change
// must move TOTAL recall without regressing an entity — the golden exists
// because a scorer fitted on one entity (Cult*Atmo*density, 5.5x on Natasha)
// transferred at 0.7x (worse than chance) to Pierre.
//
// Current best: 5/21 (frame forward-surprise x referent presence, stratified).
// The residual gap is a MISSING OBSERVABLE (relations/dialogue/affect — what
// the entity does and feels), not a rearrangement of lexical KL. Measured
// dead ends are logged beside the selector in entity-fold.js.
//
// Usage: node scripts/score-span-golden.mjs
// Texts: pg2600 = ~/Downloads/pg2600.txt (War and Peace),
//        pg84   = "Default Project"/pg84.txt (Frankenstein).
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { entityFold } from "../packages/engine/emergence/summary/entity-fold.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN = JSON.parse(readFileSync(
  join(ROOT, "packages/engine/emergence/summary/golden/span-golden.json"), "utf-8"));
const TEXTS = {
  pg2600: "/Users/mlacy/Downloads/pg2600.txt",
  pg84: "/Users/mlacy/Documents/Default Project/pg84.txt",
};
const COREF = JSON.parse(readFileSync(
  "/Users/mlacy/Documents/Default Project/eoPriors/priors/coref/pg84-frankenstein.json", "utf-8"));

const tol = GOLDEN.tolerance;
let totalHit = 0, totalScenes = 0;

for (const e of GOLDEN.entities) {
  const text = readFileSync(TEXTS[e.text], "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const referent = e.referentPrior ? COREF.referents.find((r) => r.id === e.entity) : null;
  // withEchoes:false — echoes decorate spans but don't move selection, and
  // building the store 3x here doubles the runtime for nothing.
  const packet = entityFold(text, e.entity, {
    title: e.entity, sceneCount: 12, withEchoes: false, ...(referent ? { referent } : {}),
  });
  const offsets = packet.spans.map((s) => s.offset).filter((o) => o != null);
  const pcts = offsets.map((o) => (o / text.length) * 100).sort((a, b) => a - b);

  let hits = 0;
  const lines = [];
  for (const sc of e.scenes) {
    const at = text.indexOf(sc.anchor);
    if (at === -1) { lines.push(`  ??   ${sc.id} (anchor missing)`); continue; }
    const hit = offsets.some((o) => Math.abs(o - at) <= tol);
    if (hit) hits++;
    lines.push(`  ${hit ? "HIT " : "MISS"} ${((at / text.length) * 100).toFixed(1).padStart(5)}%  ${sc.kind.padEnd(22)} ${sc.id}`);
  }
  totalHit += hits; totalScenes += e.scenes.length;

  console.log(`\n=== ${e.entity} (${e.arc}) — recall ${hits}/${e.scenes.length} ===`);
  console.log(`  span coverage: ${pcts[0]?.toFixed(1)}% → ${pcts[pcts.length - 1]?.toFixed(1)}%  (${offsets.length} spans)`);
  for (const l of lines) console.log(l);
}
console.log(`\nTOTAL recall: ${totalHit}/${totalScenes}`);
