// probe-golden-recall.mjs — score entityFold spans against the frozen
// span-golden across all three entities. This is THE number for step-3 work:
// any significance change must move it without regressing an entity.
import { readFileSync } from "fs";
import { entityFold } from "./packages/engine/emergence/summary/entity-fold.js";

const GOLDEN = JSON.parse(readFileSync(
  "./packages/engine/emergence/summary/golden/span-golden.json", "utf-8"));
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
  const packet = entityFold(text, e.entity, {
    title: e.entity, sceneCount: 12, ...(referent ? { referent } : {}),
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
