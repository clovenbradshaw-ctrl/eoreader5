import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences } from "./text-organ.js";
import {
  admitCast,
  buildCoOccurrenceEdges,
  presenceBySentence,
  classifyEdges,
  computeNodeKindProfiles,
  buildRelationshipGraph,
} from "./relationship-graph.js";

const LEXICON = {
  kinship_parent_child: ["father", "mother", "son", "daughter"],
  military_command: ["regiment", "colonel", "ordered"],
};

test("admitCast: a multi-word seed does not absorb a bare shared honorific", () => {
  // Regression for the measured failure: seeding a referent as "Prince
  // Vasíli" absorbed every standalone "Prince" used to address OTHER
  // princes in the book, because namesCorefer's containment rule treats a
  // single shared token as a trivial subset match. A one-word candidate
  // carries no distinguishing identity signal for a multi-word seed.
  const text =
    "Prince Vasíli Kurágin arrived. \"Well, Prince,\" said Prince Andrew, greeting his own father, the old prince.";
  const priors = [{ id: "vasili", name: "Prince Vasíli", individuation: "holon" }];
  const { cast } = admitCast(text, priors);
  const admission = cast.get("ref:vasili").admission;
  const labels = admission.surfaces.map((s) => s.surface);
  assert.ok(!labels.includes("Prince"), "bare honorific must not be admitted");
  assert.ok(labels.includes("Prince Vasíli"), "the seed itself is always admitted");
});

test("buildCoOccurrenceEdges: only sentences with BOTH referents present count", () => {
  const text = "Pierre smiled at Natásha. Andrew rode alone. Pierre and Natásha danced.";
  const priors = [
    { id: "pierre", name: "Pierre" },
    { id: "natasha", name: "Natásha" },
    { id: "andrew", name: "Andrew" },
  ];
  const sentences = splitSentences(text);
  const { cast } = admitCast(text, priors);
  const presence = presenceBySentence(sentences, cast);
  const edges = buildCoOccurrenceEdges(sentences, presence);
  const key = (e) => [e.a, e.b].sort().join("|");
  assert.ok(edges.some((e) => key(e) === "ref:natasha|ref:pierre" && e.sentences.length === 2));
  assert.ok(!edges.some((e) => key(e).includes("ref:andrew")), "Andrew never co-occurs with anyone");
});

test("classifyEdges: whole-word matching rejects substrings like 'son' inside 'person'", () => {
  const text = "Pierre and Natásha sat as one lonely person in the crowded room.";
  const priors = [{ id: "pierre", name: "Pierre" }, { id: "natasha", name: "Natásha" }];
  const sentences = splitSentences(text);
  const { cast } = admitCast(text, priors);
  const presence = presenceBySentence(sentences, cast);
  const edges = classifyEdges(buildCoOccurrenceEdges(sentences, presence), LEXICON, cast);
  const e = edges[0];
  assert.equal(e.categoryCounts.kinship_parent_child, undefined, "'son' inside 'person' must not count");
});

test("classifyEdges: a keyword in an unrelated clause of a long sentence is not attributed to the pair", () => {
  // Pierre and Natásha co-occur in this sentence, but "regiment" describes
  // a third clause about someone else entirely — a reader would never take
  // it as describing the Pierre/Natásha relation.
  const text = "Pierre danced with Natásha, while Denísov's regiment marched east, and everyone applauded.";
  const priors = [{ id: "pierre", name: "Pierre" }, { id: "natasha", name: "Natásha" }];
  const sentences = splitSentences(text);
  const { cast } = admitCast(text, priors);
  const presence = presenceBySentence(sentences, cast);
  const edges = classifyEdges(buildCoOccurrenceEdges(sentences, presence), LEXICON, cast);
  assert.equal(edges[0].categoryCounts.military_command, undefined);
});

test("classifyEdges: an appositive in the adjacent clause IS attributed to the pair", () => {
  const text = "Andrew's father, the old colonel, greeted Pierre warmly.";
  const priors = [{ id: "andrew", name: "Andrew" }, { id: "pierre", name: "Pierre" }];
  const sentences = splitSentences(text);
  const { cast } = admitCast(text, priors);
  const presence = presenceBySentence(sentences, cast);
  const edges = classifyEdges(buildCoOccurrenceEdges(sentences, presence), LEXICON, cast);
  assert.equal(edges[0].categoryCounts.military_command, 1);
});

test("classifyEdges: SVO relations resolve to the referent pair, directed", () => {
  const text = "Pierre loved Natásha deeply.";
  const priors = [{ id: "pierre", name: "Pierre" }, { id: "natasha", name: "Natásha" }];
  const sentences = splitSentences(text);
  const { cast } = admitCast(text, priors);
  const presence = presenceBySentence(sentences, cast);
  const edges = classifyEdges(buildCoOccurrenceEdges(sentences, presence), {}, cast);
  const rel = edges[0].statedRelations[0];
  assert.equal(rel.from, "ref:pierre");
  assert.equal(rel.to, "ref:natasha");
  assert.equal(rel.verb, "loved");
});

test("annotateSignificance + computeNodeKindProfiles emerge from buildRelationshipGraph", () => {
  const text =
    "Pierre loved Natásha. Pierre and Natásha danced. Pierre and Natásha talked. " +
    "Andrew's regiment marched. Andrew ordered the regiment forward.";
  const priors = [
    { id: "pierre", name: "Pierre" },
    { id: "natasha", name: "Natásha" },
    { id: "andrew", name: "Andrew" },
  ];
  const graph = buildRelationshipGraph(text, priors, {
    sentences: splitSentences(text),
    lexicon: LEXICON,
    significance: { minCount: 2, minLift: 1 },
  });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  assert.ok(byId.get("ref:pierre").mass > 0);
  const pnEdge = graph.edges.find((e) => [e.a, e.b].sort().join("|") === "ref:natasha|ref:pierre");
  assert.ok(pnEdge.reliable, "a tightly-paired, low-base-rate couple should read as reliable");
  assert.ok("kindProfile" in byId.get("ref:pierre"), "kind profile is emergent, not assigned");
});
