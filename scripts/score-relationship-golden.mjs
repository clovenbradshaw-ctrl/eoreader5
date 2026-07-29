// scripts/score-relationship-golden.mjs — score relationship-graph.js's own
// discovery/typing machinery against the frozen, EXTERNAL-reference
// relationship-golden.json. This is a measurement of the ENGINE, not of any
// hand-fixed output: it runs admitCast -> presenceBySentence ->
// buildCoOccurrenceEdges -> classifyEdges cold, over the real text, using
// only the injected priors (coref cast + lexicon), and reports what came
// out. Nobody should edit the graph to chase this number up — only the
// pipeline's own logic (discovery, significance, edge typing) should move
// it, and every category-vocabulary decision here is a documented mapping,
// not a peek at the answer key.
//
// Usage: node scripts/score-relationship-golden.mjs [textPath]
//   textPath defaults to $EO_PG2600_PATH.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { splitSentences } from "../packages/engine/emergence/summary/text-organ.js";
import { buildRelationshipGraph } from "../packages/engine/emergence/summary/relationship-graph.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const textPath = process.argv[2] ?? process.env.EO_PG2600_PATH;
if (!textPath) {
  console.error("Usage: node scripts/score-relationship-golden.mjs <textPath>  (or set $EO_PG2600_PATH)");
  process.exit(1);
}

const GOLDEN = JSON.parse(readFileSync(
  join(ROOT, "packages/engine/emergence/summary/golden/relationship-golden.json"), "utf-8"));
const corefArtifact = JSON.parse(readFileSync(join(ROOT, "priors/coref/war-and-peace.json"), "utf-8"));
const lexiconArtifact = JSON.parse(readFileSync(join(ROOT, "priors/lexicon/en-relations.json"), "utf-8"));

// Documented, revisable mapping from the golden's external vocabulary onto
// the engine's CURRENT lexicon categories + stated-relation verbs. This is
// scorer-side by design: it should evolve as priors/lexicon/en-relations.json
// does, without touching the golden (the target) or the engine (the thing
// being measured).
const RELATION_TO_CATEGORY = {
  parent_child: ["kinship_parent_child"],
  sibling: ["kinship_sibling"],
  spouse: ["marriage"],
  engaged: ["marriage", "romance"],
  unrequited_romance: ["romance"],
  ward_guardian: ["kinship_extended", "care_nursing"],
};
const RELATION_TO_VERB = {
  parent_child: [],
  sibling: [],
  spouse: ["married", "marry", "marries"],
  engaged: ["married", "marry"],
  unrequited_romance: ["loved", "proposed"],
  ward_guardian: [],
};

const fullText = readFileSync(textPath, "utf-8");
const sentences = splitSentences(fullText);
const graph = buildRelationshipGraph(fullText, corefArtifact.referents ?? corefArtifact.cast, {
  sentences,
  lexicon: lexiconArtifact.categories ?? {},
  significance: { minCount: 3, minLift: 1.5 },
});

const nodeIds = new Set(graph.nodes.map((n) => n.id.replace(/^ref:/, "")));
const edgeByPair = new Map();
for (const e of graph.edges) {
  const a = e.a.replace(/^ref:/, ""), b = e.b.replace(/^ref:/, "");
  edgeByPair.set([a, b].sort().join("|"), e);
}

let referentGap = 0, edgeMiss = 0, categoryHit = 0, dominantHit = 0, categoryMiss = 0, total = 0;
const rows = [];

for (const fact of GOLDEN.facts) {
  total++;
  if (fact.referentGap || !nodeIds.has(fact.a) || !nodeIds.has(fact.b)) {
    referentGap++;
    rows.push({ id: fact.id, status: "REFERENT-GAP", detail: `${fact.a} or ${fact.b} not in current cast` });
    continue;
  }
  const edge = edgeByPair.get([fact.a, fact.b].sort().join("|"));
  if (!edge) {
    edgeMiss++;
    rows.push({ id: fact.id, status: "EDGE-MISS", detail: "no co-occurrence edge found at all" });
    continue;
  }
  const wantCategories = RELATION_TO_CATEGORY[fact.relation] ?? [];
  const wantVerbs = RELATION_TO_VERB[fact.relation] ?? [];
  const hasCategory = wantCategories.some((c) => (edge.categoryCounts?.[c] ?? 0) > 0);
  const hasVerb = wantVerbs.length > 0 && edge.statedRelations.some((r) => wantVerbs.includes(r.verb));
  const isDominant = wantCategories.includes(edge.dominantCategory);
  if (hasCategory || hasVerb) {
    categoryHit++;
    if (isDominant || hasVerb) dominantHit++;
    rows.push({
      id: fact.id, status: isDominant || hasVerb ? "HIT" : "PRESENT-NOT-DOMINANT",
      detail: `dominant=${edge.dominantCategory ?? "-"} counts=${JSON.stringify(edge.categoryCounts)}${hasVerb ? " +verb" : ""}`,
    });
  } else {
    categoryMiss++;
    rows.push({
      id: fact.id, status: "CATEGORY-MISS",
      detail: `edge exists (n=${edge.observed}) but no ${fact.relation} signal — dominant=${edge.dominantCategory ?? "-"} counts=${JSON.stringify(edge.categoryCounts)}`,
    });
  }
}

for (const r of rows) console.log(`  ${r.status.padEnd(20)} ${r.id.padEnd(28)} ${r.detail}`);
console.log(`\nTOTAL: ${total}  |  referent-gap: ${referentGap}  edge-miss: ${edgeMiss}  category-miss: ${categoryMiss}  hit(present): ${categoryHit}  hit(dominant/verb): ${dominantHit}`);
console.log(`Recall (present, of facts with a discoverable referent): ${categoryHit}/${total - referentGap}`);
console.log(`Recall (dominant/verb, of facts with a discoverable referent): ${dominantHit}/${total - referentGap}`);
