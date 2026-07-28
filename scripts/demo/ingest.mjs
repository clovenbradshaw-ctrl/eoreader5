// Watch the organs form over a real book.
//
//   node scripts/demo/ingest.mjs
//
// Env: EO_TEXT (source text), EO_COREF (coref prior JSON).

import { ingest, verifyOffset, formatCoord } from "./lib.mjs";

const bar = (n, max, width = 28) => "█".repeat(Math.max(0, Math.round((n / max) * width)));
const h = (s) => `\n\x1b[1m${s}\x1b[0m`;

const organs = ingest({ referentId: process.env.EO_REFERENT ?? "creature" });
const { text, frames, store, referentPrior, admitted, presence, packet, timings } = organs;

console.log(h("SOURCE"));
console.log(`  text   ${organs.textFile}`);
console.log(`  coref  ${organs.corefFile}`);
console.log(`  ${text.length.toLocaleString()} chars, newline-normalized (frameText's contract)`);

console.log(h("ORGAN 1 — framing  (summary/text-organ.js::frameText)"));
console.log(`  ${frames.length} frames, 2000-char windows at 1000 hop`);
console.log(`  first offset ${frames[0].offset}, last offset ${frames.at(-1).offset}`);
console.log(`  frames are the substrate every other organ reads; offsets are into the normalized text`);

console.log(h("ORGAN 2 — associative memory  (emergence/store/index.js::buildStore)"));
console.log(`  ${store.posting.size.toLocaleString()} motifs indexed (sparse-BAND: idf >= floor AND df >= 2)`);
console.log(`  ${store.edges.size.toLocaleString()} motifs carry Hebbian edges wired at co-occurrence`);
{
  const top = [...store.edges.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 5);
  const max = top[0]?.[1].size ?? 1;
  for (const [motif, es] of top) console.log(`    ${String(motif).padEnd(18)} ${bar(es.size, max)} ${es.size} edges`);
}

console.log(h("ORGAN 3 — referent presence  (perceiver/text/presence.js::admitReferent)"));
if (!admitted) {
  console.log(`  no prior for this referent — the engine reports a gap rather than guessing`);
} else {
  console.log(`  referent ${admitted.referentId}  (individuation: ${referentPrior.individuation})`);
  console.log(`  ${admitted.surfaces.length} surfaces admitted by ${admitted.events.length} explicit events`);
  console.log(`  ${admitted.gaps.length} typed gaps  ${admitted.gaps.length === 0 ? "(every scoped anchor resolved)" : ""}`);
  for (const g of admitted.gaps.slice(0, 3)) console.log(`    gap: ${g.kind ?? JSON.stringify(g).slice(0, 80)}`);
  const scoped = admitted.surfaces.filter((s) => s.scope);
  console.log(`  ${scoped.length} of those surfaces are SCOPED — admitted only inside anchor-quoted spans`);
  for (const s of admitted.surfaces.slice(0, 6)) {
    console.log(`    "${s.surface}"${s.scope ? `  [scoped to ${s.scope.length} span(s)]` : ""}  w=${s.weight ?? 1}`);
  }
  console.log(`  identity lives in the referent: "the dæmon" and "my enemy" are evidence FOR it, not names OF it`);
  const occupied = [...presence.entries()].filter(([, v]) => v > 0);
  console.log(`  present in ${occupied.length}/${frames.length} frames`);
}

console.log(h("ORGAN 4 — entity fold  (emergence/summary/entity-fold.js::entityFold)"));
console.log(`  ${packet.spans.length} spans selected across the WHOLE arc (stratified, not slice(0,N))`);
let verified = 0;
for (const s of packet.spans) {
  const ok = verifyOffset(text, s);
  if (ok) verified += 1;
}
console.log(`  ${verified}/${packet.spans.length} offsets verified by round-trip against the source`);
console.log(`  ${packet.gaps?.length ?? 0} gaps, ${packet.keyMoments?.length ?? 0} key moments`);
for (const s of packet.spans.slice(0, 4)) {
  const echo = s.echoes?.length ? `  echoes<-${s.echoes.map((e) => e.offset).join(",")}` : "";
  console.log(`    @${String(s.offset).padStart(6)} [${formatCoord(s.coord)}]${echo}`);
  console.log(`      ${s.text.replace(/\s+/g, " ").slice(0, 96)}...`);
}

console.log(h("TIMINGS"));
for (const [k, v] of Object.entries(timings)) console.log(`  ${k.padEnd(10)} ${v} ms`);
console.log(`  ${Object.values(timings).reduce((a, b) => a + b, 0)} ms total — no model was called to build any of this`);
console.log("");
