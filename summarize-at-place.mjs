#!/usr/bin/env node
// summarize-at-place.mjs — character-perspective summary at a place, as EOT.
//
// Runs the entity fold over a document scoped to a PLACE (a position on the
// document's own axis, located by a search phrase), asserts the character's
// LENS there (trajectory red shift against their rest frame, shaped by a
// reader prior), and emits the result as EOT — assemblies in helix order,
// each closed with its !EVA checkpoint — ready to be prosified later.
//
// Usage:
//   node summarize-at-place.mjs ["Natasha Rostova"] ["first grand ball"] [radius]
// Env:
//   WP_PATH — corpus path (default data/pg2600.txt; run scripts/fetch-warandpeace.mjs)

import { readFileSync, writeFileSync } from "node:fs";
import { entityFold } from "./packages/engine/emergence/summary/entity-fold.js";
import { frameText, snapToSentences } from "./packages/engine/emergence/summary/text-organ.js";
import { extractRelations } from "./packages/engine/perceiver/text/extraction.js";
import { assertLens, speakLensAssertion } from "./packages/engine/emergence/lens-assertion/index.js";
import { createReaderPrior } from "./packages/engine/emergence/reader-priors/index.js";

const entityName = process.argv[2] ?? "Natasha Rostova";
const placeQuery = process.argv[3] ?? "first grand ball";
const radius = Number(process.argv[4] ?? 20);

const text = readFileSync(process.env.WP_PATH ?? "data/pg2600.txt", "utf-8");

// ── Locate the place: the frame whose window contains the query phrase ──
const frames = frameText(text);
const at = text.indexOf(placeQuery);
if (at < 0) {
  console.error(`place query ${JSON.stringify(placeQuery)} not found in the document — nothing to summarize`);
  process.exit(1);
}
let center = frames[0]?.order ?? 0;
for (const f of frames) {
  if (f.offset <= at) center = f.order;
  else break;
}

// ── Fold the entity at the place ──
const packet = entityFold(text, entityName, {
  title: `${entityName} @ "${placeQuery}"`,
  place: { position: center, radius },
  withRelations: true,
  sceneCount: 8,
});

// ── The character's trajectory: rest frame → this place ──
// Rest frame = the character's earliest stretch of the book (who they are
// when the reader first meets them); current frame = the place window.
// Relations come from the perceiver; via = the observed verb.
const tokens = entityName.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
const dia = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const mentions = (t) => {
  const tn = dia(t);
  return tokens.some((tok) => tn.includes(dia(tok)));
};
const targetFramesAll = frames.filter((f) => mentions(f.text));
const restFrames = targetFramesAll.slice(0, Math.max(8, radius));
const placeFrames = targetFramesAll.filter((f) => Math.abs(f.order - center) <= radius);

const phaseRelations = (fs) =>
  extractRelations(fs.map((f) => ({ text: snapToSentences(f.text), foldScore: 0 })), { limit: Infinity })
    .filter((r) => mentions(`${r.subject} ${r.object}`))
    .map((r) => ({ via: r.verb, polarity: r.polarity }));

const restRelations = phaseRelations(restFrames);
const hereRelations = phaseRelations(placeFrames);
const restVias = new Set(restRelations.map((r) => r.via));
const hereVias = new Set(hereRelations.map((r) => r.via));

const traj = {
  focus: entityName,
  focusId: `figure:${dia(entityName).replace(/\s+/g, "-")}`,
  phases: [
    { id: "rest-frame", relations: restRelations },
    { id: `place:${placeQuery}`, relations: hereRelations },
  ],
  gained: [...hereVias].filter((v) => !restVias.has(v)).map((via) => ({ via })),
  lost: [...restVias].filter((v) => !hereVias.has(v)).map((via) => ({ via })),
  turns: 1,
};

const prior = createReaderPrior({
  id: "reader:close-reader",
  label: "close reader, first reading",
  familiarity: 0.5,
  interpretiveFrames: { narrative: 0.7 },
  structural: { medium: "novel" },
});

const assertion = assertLens(traj, prior);
const spoken = assertion ? speakLensAssertion(assertion) : null;

// ── EOT emission ──
// Assemblies in helix order (INS → CON → SYN → DEF → EVA), each set down
// with !EVA before the next begins. Absence is written as ~, never invented.

const q = (s) => JSON.stringify(String(s ?? "").replace(/\s+/g, " ").trim());
const slug = (s) => dia(String(s)).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const lines = [];
const emit = (l = "") => lines.push(l);

const readingId = `reading_${slug(entityName)}_${slug(placeQuery)}`.slice(0, 60);

emit(`# EOT — ${entityName} at "${placeQuery}"`);
emit(`# source: War and Peace (Project Gutenberg #2600), ${text.length} chars, ${frames.length} frames`);
emit(`# emitted by: eoreader5 summarize-at-place (deterministic, model-free)`);
emit();
emit(`# ── assembly 1: the reading room ──────────────────────────────`);
emit(`${readingId} : reading`);
emit(`${readingId}.source = ${q("War and Peace — Project Gutenberg #2600")}`);
emit(`${readingId}.entity = ${q(packet.entity)}`);
emit(`${readingId}.place.query = ${q(placeQuery)}`);
emit(`${readingId}.place.center = ${packet.place?.center ?? center}`);
emit(`${readingId}.place.radius = ${packet.place?.radius ?? radius}`);
emit(`${readingId}.place.frames = ${packet.place ? `${packet.place.from}..${packet.place.to}` : "~"}`);
emit(`${readingId}.contract.ops = NUL, SIG, CON, EVA`);
emit(`${readingId}.contract.terrains = Entity, Field, Lens`);
emit(`${readingId}.contract.stances = Tending, Binding, Dissecting`);
emit(`!EVA ${readingId}`);
emit();

emit(`# ── assembly 2: the figures present at this place ─────────────`);
const target = `figure_${slug(packet.entity)}`;
emit(`${target} : figure`);
emit(`${target}.label = ${q(packet.entity)}`);
emit(`${target}.role = "focus"`);
const figIds = [];
for (const f of packet.figures.slice(0, 8)) {
  const id = `figure_${slug(f.label)}`;
  figIds.push(id);
  emit(`${id} : figure`);
  emit(`${id}.label = ${q(f.label)}`);
  emit(`${id}.co_sightings = ${f.count}`);
  emit(`${target} -> ${id}`);
}
emit(`!EVA ${target}${figIds.length ? ", " + figIds.join(", ") : ""}`);
emit();

emit(`# ── assembly 3: the moments (signal boundaries near the entity) ─`);
const momentIds = [];
if (packet.keyMoments.length === 0) {
  emit(`# no signal boundaries near ${q(packet.entity)} inside this place window`);
  emit(`moments.gap = "no_moments_detected"`);
} else {
  packet.keyMoments.forEach((m, i) => {
    const id = `moment_${i + 1}`;
    momentIds.push(id);
    emit(`${id} : moment`);
    emit(`${id}.type = ${m.type ? q(m.type) : "~"}`);
    emit(`${id}.order = ${m.idx}`);
    emit(`${id}.score = ${Number(m.score ?? 0).toFixed(3)}`);
    emit(`${id}.text = ${q(m.text).slice(0, 400)}`);
    emit(`!SIG ${id}`);
  });
}
emit(`!EVA ${momentIds.length ? momentIds.join(", ") : "moments"}`);
emit();

emit(`# ── assembly 4: relations (perceiver-read; polarity read, never asserted) ─`);
const relIds = [];
if (packet.relations.length === 0) {
  emit(`relations.gap = "no_relations_extracted_at_place"`);
} else {
  packet.relations.slice(0, 10).forEach((r, i) => {
    const id = `rel_${i + 1}`;
    relIds.push(id);
    emit(`${id} : relation`);
    emit(`${id}.subject = ${q(r.subject)}`);
    emit(`${id}.verb = ${q(r.verb)}`);
    emit(`${id}.object = ${q(r.object)}`);
    emit(`${id}.polarity = ${q(r.polarity ?? "~")}`);
    emit(`${id}.position = ${r.time?.position ?? "~"}`);
  });
}
emit(`!EVA ${relIds.length ? relIds.join(", ") : "relations"}`);
emit();

emit(`# ── assembly 5: the lens assertion (reader-relative, red-shift graded) ─`);
emit(`lens : lens_assertion`);
if (assertion) {
  emit(`lens.character = ${q(assertion.character)}`);
  emit(`lens.red_shift = ${assertion.redShift}`);
  emit(`lens.confidence = ${assertion.confidence}`);
  emit(`lens.strength = ${q(assertion.strength)}`);
  emit(`lens.reader = ${q(assertion.prior?.label ?? "~")}`);
  emit(`lens.gained = ${assertion.gained.length ? assertion.gained.map((g) => q(g.via)).join(", ") : "~"}`);
  emit(`lens.lost = ${assertion.lost.length ? assertion.lost.map((g) => q(g.via)).join(", ") : "~"}`);
  emit(`lens.spoken = ${q(spoken)}`);
} else {
  emit(`lens.gap = "insufficient_trajectory_for_assertion"`);
}
emit(`!EVA lens`);
emit();

emit(`# ── assembly 6: the summary (the emergent whole) ───────────────`);
const parts = [readingId, target, ...momentIds, ...relIds, "lens"];
emit(`!SYN summary = ${parts.join(", ")}`);
emit(`summary.scope = ${q(packet.scope)}`);
emit(`summary.turns = ${packet.groups.turns.length}`);
const gapList = packet.gaps ?? [];
emit(`summary.gaps = ${gapList.length ? gapList.map((g) => q(g.reason)).join(", ") : "~"}`);
emit(`!EVA summary`);

const out = lines.join("\n") + "\n";
const outPath = `eot-${slug(entityName)}-${slug(placeQuery)}.eot`;
writeFileSync(outPath, out);
console.log(out);
console.error(`\n[written to ${outPath}]`);
