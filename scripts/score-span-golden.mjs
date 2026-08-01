// scripts/score-span-golden.mjs — THE number for significance work.
//
// Scores entityFold spans against the frozen multi-entity span golden
// (packages/engine/emergence/summary/golden/span-golden.json): 21 canonical
// scenes, 3 entities, 3 arc kinds, 2 narrative modes. Any significance change
// must move TOTAL recall without regressing an entity — the golden exists
// because a scorer fitted on one entity (Cult*Atmo*density, 5.5x on Natasha)
// transferred at 0.7x (worse than chance) to Pierre.
//
// Best recorded: 5/21 (frame forward-surprise x referent presence, stratified).
// LIVE baseline as of 2026-07-29: 5/21 (Natasha 1/8, Pierre 0/6, creature 4/7).
// The residual gap is a MISSING OBSERVABLE (relations/dialogue/affect — what
// the entity does and feels), not a rearrangement of lexical KL. Measured
// dead ends are logged beside the selector in entity-fold.js.
//
// MEASURED 2026-07-29 on restore from _archive/: 1/21 (Natasha 0/8,
// Pierre 0/6, creature 1/7).
//
// RESOLVED 2026-07-29 — 5/21 was REAL, not a stale claim, and is restored.
// An earlier note here concluded the 5/21 was "already stale when the file
// was moved," reasoning that the engine was byte-identical to 464b570 (the
// commit that removed this scorer from git). That reasoning checked the
// wrong window. The 5/21 was recorded at 0ef01f1, where this scorer was
// ADDED; the engine differs substantially between 0ef01f1 and 464b570.
// Checking out 0ef01f1 and running this scorer against the same golden
// (md5 03ffae53… — identical) reproduces 5/21 EXACTLY, with the same
// composition (Natasha 1/8, Pierre 0/6, creature 4/7). Bisecting the
// 7-commit window: a8ab3fc, b947f08, 6714560, 2969245 all score 5/21. The
// regression is entirely inside 464b570 — the very commit that removed the
// scorer, which is why nothing caught it.
//
// Mechanism: 464b570 DELETED the 5/21 selector. The stratified
// significance-spine top-up in entity-fold.js (literally "frame
// forward-surprise x referent presence, stratified") was replaced by the
// holon field surfer (readEntityField/selectTopFieldMoments). On real text
// that organ surfaces NOTHING — its `score > 0` gate never fires: Natasha
// 702 target frames → 0 significant sentences, creature 231 → 0. So the
// top-up became a silent no-op and the fold emitted only the 4 moments left
// by one-per-type event dedup. Span count, not ranking, capped recall.
// (Pierre was unaffected at 12 spans — events alone fill his budget, so he
// never enters the top-up path at all; his 0/6 is the original open problem,
// not part of this regression.)
//
// Fix: the field surfer is KEPT (it is the only organ here reading
// prediction error rather than lexis) but no longer leaves the budget
// unspent — when it surfaces < 2 sentences, entity-fold falls back to the
// restored stratified spine. Re-measured: 5/21, per-entity identical to
// 0ef01f1. No entity regressed (Natasha 0→1, Pierre 0→0, creature 1→4).
//
// Why the altitude assay missed it: multiAltitudeFold has its own
// selection path and never exercises entityFold's top-up. The assay's
// numbers are byte-identical before and after this fix (ground 100%,
// faith 80.4–95.9%, mono 100%). The assay does not subsume this scorer.
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
