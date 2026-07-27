// probe-creature-fold.mjs — quality entity fold on an EMANON, driven by the
// per-text coref prior (eoPriors/priors/coref/pg84-frankenstein.json).
import { readFileSync } from "fs";
import { entityFold } from "./packages/engine/emergence/summary/entity-fold.js";

const PRIOR = JSON.parse(readFileSync(
  "/Users/mlacy/Documents/Default Project/eoPriors/priors/coref/pg84-frankenstein.json", "utf-8"));
const creaturePrior = PRIOR.referents.find((r) => r.id === "creature");

function report(label, packet, textLen, goldenAnchors, text) {
  console.log(`\n================ ${label} ================`);
  console.log(`gaps: ${packet.gaps?.length ? JSON.stringify(packet.gaps) : "none"}`);
  console.log(`\nSPANS (${packet.spans.length}) — position, type, first 70 chars:`);
  for (const s of packet.spans) {
    const pct = s.offset != null ? ((s.offset / textLen) * 100).toFixed(1) + "%" : "  ?  ";
    console.log(`  ${pct.padStart(6)}  ${String(s.coord?.operator ?? "").padEnd(4)} ${JSON.stringify(s.text.slice(0, 70))}`);
  }
  console.log(`\nFIGURES: ${packet.figures.map((f) => `${f.label}(${f.count})`).join("  ")}`);
  console.log(`\nRELATIONS (${packet.relations.length}):`);
  for (const r of packet.relations.slice(0, 10))
    console.log(`  "${r.subject}" ${r.verb} "${String(r.object).slice(0, 55)}"`);
  if (goldenAnchors) {
    console.log(`\nGOLDEN SCENE COVERAGE (span within 2000 chars):`);
    let hits = 0;
    for (const [id, anchor] of goldenAnchors) {
      const at = text.indexOf(anchor);
      const hit = packet.spans.some((s) => s.offset != null && at >= s.offset - 2000 && at <= s.offset + 2000);
      if (hit) hits++;
      console.log(`  ${hit ? "HIT " : "MISS"} ${((at / textLen) * 100).toFixed(1).padStart(5)}%  ${id}`);
    }
    console.log(`  recall: ${hits}/${goldenAnchors.length}`);
  }
}

// ── Creature ──
const fr = readFileSync("/Users/mlacy/Documents/Default Project/pg84.txt", "utf-8")
  .replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const creaturePacket = entityFold(fr, "creature", {
  title: "The Creature", referent: creaturePrior, withRelations: true, sceneCount: 12,
});
report("CREATURE (emanon, coref prior)", creaturePacket, fr.length, [
  ["creation", "It was on a dreary night of November"],
  ["first-rejection", "I beheld the wretch"],
  ["thy-creature", "Remember that I am thy creature"],
  ["cursed-creator", "Cursed, cursed creator"],
  ["demand-mate", "You must create a female"],
  ["belong-to-enemy", "Frankenstein! you belong then to my enemy"],
  ["final", "lost in darkness and distance"],
], fr);

// ── Natasha regression (name path, no prior) ──
const wp = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8")
  .replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const natashaPacket = entityFold(wp, "Natasha Rostova", { title: "Natasha Rostova", withRelations: true });
report("NATASHA (holon regression)", natashaPacket, wp.length, null, wp);
console.log(`\nNatasha relations count: ${natashaPacket.relations.length} (was 24)  figures[0..4]: ${natashaPacket.figures.slice(0, 5).map((f) => f.label).join(", ")}`);
