import { test } from "node:test";
import assert from "node:assert/strict";
import { induceParameters, parameterProfiles, profileJaccard } from "./parameters/index.js";
import { induceEntityKinds, buildKindVocabulary } from "./entity-kinds/index.js";
import { validateEntityKindCandidate, validateEntityKindVocabulary } from "@eoreader/spec";

function ent(id, attrs) {
  return { id, attributes: attrs.map(([f, v, c]) => ({ field_id: f, value_type: v, count: c ?? 1 })) };
}

// ── NEWS MEDIA ──────────────────────────────────────────────────────────────
// Realistic entity profiles from news articles: politicians (title, party,
// constituency, education, location), executives (title, organization,
// industry, revenue, stock_exchange), NGOs (organization, location, founded,
// mission, website). Each group has distinctive attributes so Jaccard
// similarity between groups stays low (<0.2) while within-group is high (>0.4).
const POL = [["title","string"],["party","string"],["constituency","string"],["education","string"],["location","string"]];
const EXEC = [["title","string"],["organization","string"],["industry","string"],["revenue","number"],["stock_exchange","string"]];
const NGO = [["organization","string"],["location","string"],["founded","number"],["mission","string"],["website","string"]];
const newsEntities = [
  ent("n1", [...POL, ["military_service","string"]]),
  ent("n2", [...POL]),
  ent("n3", [...POL]),
  ent("n4", [...POL, ["military_service","string"]]),
  ent("n5", [...POL]),
  ent("n6", [...POL]),
  ent("n7", [...EXEC, ["board_member","string"]]),
  ent("n8", [...EXEC]),
  ent("n9", [...EXEC]),
  ent("n10", [...EXEC, ["board_member","string"]]),
  ent("n11", [...NGO]),
  ent("n12", [...NGO, ["ceo","string"]]),
  ent("n13", [...NGO]),
  ent("n14", [...NGO]),
  ent("n15", [...NGO, ["ceo","string"]]),
];

test("news: induceParameters finds standard params across all entities", () => {
  const params = induceParameters(newsEntities, { population: "test:news", minPrevalence: 0.25 });
  assert.ok(params.length >= 3, "should find several standard params across news entities");
  const title = params.find(p => p.domain.attribute === "title");
  const org = params.find(p => p.domain.attribute === "organization");
  const loc = params.find(p => p.domain.attribute === "location");
  assert.ok(title, "title should be a standard param for news entities");
  assert.ok(org, "organization should be a standard param");
  assert.ok(loc, "location should be a standard param");
  for (const p of params) {
    assert.ok(p.null_comparison.passed, `${p.domain.attribute} should pass Born rule null`);
    assert.ok(p.parameter_id.startsWith("param:"), "parameter_id should have correct prefix");
  }
});

test("news: induceParameters respects prevalence threshold", () => {
  const params = induceParameters(newsEntities, { population: "test:news-thresh", minPrevalence: 0.5 });
  const rare = params.find(p => p.domain.attribute === "education");
  assert.equal(rare, undefined, "rare attrs (education, 2/15) should be excluded at 50% threshold");
});

test("news: induceEntityKinds clusters politicians vs execs vs orgs", () => {
  const kinds = induceEntityKinds(newsEntities, {
    population: "test:news-kinds", minPrevalence: 0.2,
    cohesionThreshold: 0.2, minKindSize: 2, permutations: 100, quantile: 0.8,
  });
  assert.ok(kinds.length >= 2, "should induce at least 2 kinds from news entities");
  for (const k of kinds) {
    validateEntityKindCandidate(k);
    assert.ok(k.member_count >= 2, `kind ${k.label} must have >=2 members`);
    assert.ok(k.standard_parameters.length > 0, `kind ${k.label} must have standard parameters`);
    assert.ok(k.cohesion > 0, `kind ${k.label} cohesion must be positive`);
  }
});

// ── BOOK / LITERARY MEDIA ───────────────────────────────────────────────────
// Authors (genre, publisher, birth_year, nationality), characters (role,
// descriptor, relationship), publishers (location, founded, specialty).
const BOOK_AUTHORS = [
  ["genre","string"],["publisher","string"],["birth_year","number"],["nationality","string"]
];
const BOOK_CHARS = [
  ["role","string"],["descriptor","string"],["relationship","string"]
];
const BOOK_PUBLISHERS = [
  ["location","string"],["founded","number"],["specialty","string"]
];
const bookEntities = [
  ent("b1", [...BOOK_AUTHORS, ["death_year","number"]]),
  ent("b2", [...BOOK_AUTHORS]),
  ent("b3", [...BOOK_AUTHORS, ["death_year","number"]]),
  ent("b4", [...BOOK_AUTHORS]),
  ent("b5", [...BOOK_AUTHORS]),
  ent("b6", [...BOOK_AUTHORS, ["death_year","number"]]),
  ent("b7", [...BOOK_CHARS]),
  ent("b8", [...BOOK_CHARS, ["alignment","string"]]),
  ent("b9", [...BOOK_CHARS]),
  ent("b10", [...BOOK_CHARS]),
  ent("b11", [...BOOK_CHARS, ["alignment","string"]]),
  ent("b12", [...BOOK_PUBLISHERS]),
  ent("b13", [...BOOK_PUBLISHERS, ["ceo","string"]]),
  ent("b14", [...BOOK_PUBLISHERS]),
  ent("b15", [...BOOK_PUBLISHERS]),
];

test("books: induceParameters finds author/character/publisher params", () => {
  const params = induceParameters(bookEntities, { population: "test:books", minPrevalence: 0.2 });
  assert.ok(params.length >= 4, "should find standard params across book entities");
  const genre = params.find(p => p.domain.attribute === "genre");
  const role = params.find(p => p.domain.attribute === "role");
  const location = params.find(p => p.domain.attribute === "location");
  assert.ok(genre, "genre should be a standard param");
  assert.ok(role, "role should be a standard param");
  assert.ok(location, "location should be a standard param");
});

test("books: induceEntityKinds clusters authors, chars, publishers", () => {
  const kinds = induceEntityKinds(bookEntities, {
    population: "test:book-kinds", minPrevalence: 0.2,
    cohesionThreshold: 0.2, minKindSize: 2, permutations: 100, quantile: 0.8,
  });
  assert.ok(kinds.length >= 2, "should induce at least 2 kinds from book entities");
  for (const k of kinds) {
    validateEntityKindCandidate(k);
    assert.ok(k.member_count >= 2);
    assert.ok(k.standard_parameters.length > 0);
  }
});

// ── AUDIO / MUSIC MEDIA ─────────────────────────────────────────────────────
// Derived from real FLAC metadata extracted from Wikimedia Commons:
//   Mozart - Die Zauberflöte, K620 - Overture (Musopen Symphony).flac
//   TITLE: "Magic Flute Overture"
//   ARTIST: "Czech National Symphony Orchestra"
//   COMPOSER: "Wolfgang Amadeus Mozart"
//   ALBUM: "Musopen Kickstarter Project"
//   DATE: 2012
//   GENRE: "Classical"
// This test simulates a corpus of audio files with composer, performer, and
// work entities — the same pattern found in the FLAC metadata.
const MUSIC_COMPOSERS = [
  ["period","string"],["birth_year","number"],["death_year","number"],["nationality","string"]
];
const MUSIC_PERFORMERS = [
  ["type","string"],["genre","string"],["founded","number"]
];
const MUSIC_WORKS = [
  ["composer","string"],["duration","number"],["year","number"],["catalog_number","string"]
];
const musicEntities = [
  ent("m1", [...MUSIC_COMPOSERS, ["notable_works","string"]]),
  ent("m2", [...MUSIC_COMPOSERS]),
  ent("m3", [...MUSIC_COMPOSERS, ["notable_works","string"]]),
  ent("m4", [...MUSIC_COMPOSERS]),
  ent("m5", [...MUSIC_COMPOSERS]),
  ent("m6", [...MUSIC_COMPOSERS, ["notable_works","string"]]),
  ent("m7", [...MUSIC_PERFORMERS]),
  ent("m8", [...MUSIC_PERFORMERS, ["conductor","string"]]),
  ent("m9", [...MUSIC_PERFORMERS]),
  ent("m10", [...MUSIC_PERFORMERS]),
  ent("m11", [...MUSIC_WORKS, ["key","string"]]),
  ent("m12", [...MUSIC_WORKS]),
  ent("m13", [...MUSIC_WORKS]),
  ent("m14", [...MUSIC_WORKS, ["key","string"]]),
  ent("m15", [...MUSIC_WORKS]),
];

test("music: induceParameters finds composer/performer/work params", () => {
  const params = induceParameters(musicEntities, { population: "test:music", minPrevalence: 0.2 });
  assert.ok(params.length >= 5, "should find standard params from music metadata");
  const period = params.find(p => p.domain.attribute === "period");
  const type = params.find(p => p.domain.attribute === "type");
  const composer = params.find(p => p.domain.attribute === "composer");
  const catalog = params.find(p => p.domain.attribute === "catalog_number");
  assert.ok(period, "period should be standard for composers");
  assert.ok(type, "performer type should be standard");
  assert.ok(composer || catalog, "composer or catalog_number should be standard for works");
});

test("music: induceEntityKinds clusters composers, performers, works", () => {
  const kinds = induceEntityKinds(musicEntities, {
    population: "test:music-kinds", minPrevalence: 0.2,
    cohesionThreshold: 0.2, minKindSize: 2, permutations: 100, quantile: 0.8,
  });
  assert.ok(kinds.length >= 2, "should induce at least 2 kinds from music entities");
  for (const k of kinds) {
    validateEntityKindCandidate(k);
    assert.ok(k.member_count >= 2);
    assert.ok(k.standard_parameters.length > 0, `kind ${k.label} must have standard params`);
  }
});

// ── ACADEMIC / PDF MEDIA ────────────────────────────────────────────────────
// Authors (field, affiliation, h_index), papers (venue, year, citations),
// institutions (location, founded, type, size).
const ACADEMIC_AUTHORS = [
  ["field","string"],["affiliation","string"],["h_index","number"]
];
const ACADEMIC_PAPERS = [
  ["venue","string"],["year","number"],["citations","number"]
];
const ACADEMIC_INSTITUTIONS = [
  ["location","string"],["founded","number"],["type","string"],["size","string"]
];
const academicEntities = [
  ent("a1", [...ACADEMIC_AUTHORS, ["phd_year","number"]]),
  ent("a2", [...ACADEMIC_AUTHORS]),
  ent("a3", [...ACADEMIC_AUTHORS, ["phd_year","number"]]),
  ent("a4", [...ACADEMIC_AUTHORS]),
  ent("a5", [...ACADEMIC_AUTHORS]),
  ent("a6", [...ACADEMIC_PAPERS]),
  ent("a7", [...ACADEMIC_PAPERS, ["doi","string"]]),
  ent("a8", [...ACADEMIC_PAPERS]),
  ent("a9", [...ACADEMIC_PAPERS, ["doi","string"]]),
  ent("a10", [...ACADEMIC_PAPERS]),
  ent("a11", [...ACADEMIC_INSTITUTIONS]),
  ent("a12", [...ACADEMIC_INSTITUTIONS, ["president","string"]]),
  ent("a13", [...ACADEMIC_INSTITUTIONS]),
  ent("a14", [...ACADEMIC_INSTITUTIONS]),
  ent("a15", [...ACADEMIC_INSTITUTIONS, ["president","string"]]),
];

test("academic: induceParameters finds paper and institution params", () => {
  const params = induceParameters(academicEntities, { population: "test:academic", minPrevalence: 0.2 });
  assert.ok(params.length >= 4, "should find standard params across academic entities");
  const venue = params.find(p => p.domain.attribute === "venue");
  const citations = params.find(p => p.domain.attribute === "citations");
  const location = params.find(p => p.domain.attribute === "location");
  const field = params.find(p => p.domain.attribute === "field");
  const founded = params.find(p => p.domain.attribute === "founded");
  assert.ok(venue || citations, "venue/citations should be standard for papers");
  assert.ok(location, "location should be standard for institutions");
  assert.ok(field, "field should be standard for authors");
});

test("academic: induceEntityKinds clusters authors, papers, institutions", () => {
  const kinds = induceEntityKinds(academicEntities, {
    population: "test:academic-kinds", minPrevalence: 0.2,
    cohesionThreshold: 0.2, minKindSize: 2, permutations: 100, quantile: 0.8,
  });
  assert.ok(kinds.length >= 2, "should induce at least 2 kinds from academic entities");
  for (const k of kinds) {
    validateEntityKindCandidate(k);
    assert.ok(k.member_count >= 2);
    assert.ok(k.standard_parameters.length > 0);
  }
});

// ── MIXED MEDIA (cross-domain stress test) ──────────────────────────────────
// Combine entities from all media types to verify the pipeline handles mixed
// populations without catastrophic failure.
const mixedEntities = [...newsEntities, ...bookEntities, ...musicEntities, ...academicEntities];

test("mixed: induceParameters on combined population across all media", () => {
  const params = induceParameters(mixedEntities, {
    population: "test:mixed", minPrevalence: 0.1, minEntityCount: 6,
  });
  assert.ok(params.length >= 5, "should find params across mixed media population");
  const allPassed = params.every(p => p.null_comparison.passed);
  assert.ok(allPassed, "all induced params should pass the Born rule null");
  // Fields that appear in multiple media types should be found
  const loc = params.find(p => p.domain.attribute === "location");
  assert.ok(loc, "location should be a standard param across media types");
});

test("mixed: induceEntityKinds on combined media population", () => {
  const kinds = induceEntityKinds(mixedEntities, {
    population: "test:mixed-kinds", minPrevalence: 0.15,
    cohesionThreshold: 0.18, minKindSize: 2, permutations: 100, quantile: 0.8,
  });
  assert.ok(kinds.length >= 3, "should induce multiple kinds from mixed media");
  for (const k of kinds) {
    validateEntityKindCandidate(k);
    assert.ok(k.member_count >= 2);
  }
});

// ── EDGE CASES ──────────────────────────────────────────────────────────────

test("edge: returns empty for fewer entities than minEntityCount", () => {
  const params = induceParameters([ent("e1", [["x","string"]])], { minEntityCount: 6 });
  assert.equal(params.length, 0);
  const kinds = induceEntityKinds([ent("e1", [["x","string"]])], { minEntityCount: 6 });
  assert.equal(kinds.length, 0);
});

test("edge: uniform entities (all same single attr) produce one kind", () => {
  const uniform = [
    ent("u1", [["a","string"]]), ent("u2", [["a","string"]]),
    ent("u3", [["a","string"]]), ent("u4", [["a","string"]]),
    ent("u5", [["a","string"]]), ent("u6", [["a","string"]]),
    ent("u7", [["a","string"]]),
  ];
  const kinds = induceEntityKinds(uniform, {
    population: "test:uniform", minPrevalence: 0.3, minKindSize: 2, permutations: 50,
  });
  assert.ok(kinds.length >= 1, "uniform entities should form at least one kind");
  const k = kinds[0];
  assert.ok(k.standard_parameters.some(p => p.label === "A"), "should have A as standard param");
});

test("edge: entities with no overlapping attributes return empty", () => {
  const disjoint = [
    ent("d1", [["a","string"]]), ent("d2", [["b","string"]]),
    ent("d3", [["c","string"]]), ent("d4", [["d","string"]]),
    ent("d5", [["e","string"]]), ent("d6", [["f","string"]]),
    ent("d7", [["g","string"]]),
  ];
  const params = induceParameters(disjoint, { population: "test:disjoint", minPrevalence: 0.2 });
  assert.equal(params.length, 0, "entities with disjoint attrs should not produce shared params");
});

test("edge: entities with no attributes produce empty results", () => {
  const empty = [ent("x1",[]), ent("x2",[]), ent("x3",[]), ent("x4",[]), ent("x5",[]), ent("x6",[])];
  const params = induceParameters(empty, { population: "test:empty", minEntityCount: 6 });
  assert.equal(params.length, 0, "entities with no attrs should produce no params");
});

// ── DETERMINISM ─────────────────────────────────────────────────────────────

test("determinism: induceParameters gives identical results across runs", () => {
  const a = induceParameters(musicEntities, { population: "test:det-music", minPrevalence: 0.2 });
  const b = induceParameters(musicEntities, { population: "test:det-music", minPrevalence: 0.2 });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].parameter_id, b[i].parameter_id);
    assert.equal(a[i]._prevalence, b[i]._prevalence);
  }
});

test("determinism: induceEntityKinds gives identical results across runs", () => {
  const a = induceEntityKinds(musicEntities, {
    population: "test:det-music-kinds", minPrevalence: 0.2,
    cohesionThreshold: 0.2, minKindSize: 2, permutations: 100, quantile: 0.8,
  });
  const b = induceEntityKinds(musicEntities, {
    population: "test:det-music-kinds", minPrevalence: 0.2,
    cohesionThreshold: 0.2, minKindSize: 2, permutations: 100, quantile: 0.8,
  });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].id, b[i].id);
    assert.equal(a[i].member_count, b[i].member_count);
  }
});

// ── APP-LEVEL SIMULATION (inline Born rule) ────────────────────────────────
// Simulates the app's observation-recording logic: from real text passages,
// the app records boolean attribute-presence flags (obs[]), then groups
// entities by shared obs profiles and runs Born rule validation per kind.
// This test models that flow using the engine's structured entity records.

// Simulate the app's obs[] attribute-presence recording from the FLAC
// Wikimedia page: for each entity, the app records which attribute types
// appear in its context passages (title, date, location, org, url).
const FLAC_PAGE_PASSAGES = {
  "Wolfgang Amadeus Mozart":      ["title","date","location_cooccurrence","org_affiliation"],
  "Czech National Symphony Orchestra": ["org_affiliation","date","location_cooccurrence"],
  "Magic Flute Overture":         ["title","date"],
  "Musopen Kickstarter Project":  ["org_affiliation","date","url"],
};

// Build entity records from the simulated passage observations (like the
// app does with obs[]). Each "attribute" is a field_id matching the app's
// observation types.
const appObsEntities = Object.entries(FLAC_PAGE_PASSAGES).map(([name, attrs], i) => ({
  id: `flac_${i}`,
  name,
  attributes: attrs.map(a => ({ field_id: a, value_type: "string", count: 1 })),
}));

test("flac_audio: entities extracted from FLAC page metadata have coherent attribute profiles", () => {
  // Each entity should have at least one attribute
  for (const e of appObsEntities) {
    assert.ok(e.attributes.length > 0, `${e.name} should have at least one attribute`);
  }
  // The composer and orchestra share date + location which should be common
  const allAttrs = appObsEntities.flatMap(e => e.attributes.map(a => a.field_id));
  const unique = new Set(allAttrs);
  assert.ok(unique.has("title"), "title should be observed (composer, work)");
  assert.ok(unique.has("date"), "date should be observed (all entities)");
  assert.ok(unique.has("org_affiliation"), "org_affiliation should be observed");
});

// Expanded audio corpus: 18 entities across composers, performers, works
// (composer: period, birth_year, death_year, nationality, notable_works)
// (performer: type, genre, founded, conductor)
// (work: composer, duration, year, catalog_number, key)
const audioCorpus = [
  ...musicEntities,
  // Add real FLAC-entity-mapped records
  ...appObsEntities.map(e => ({
    ...e,
    id: `audio_ext_${e.id}`,
    attributes: [
      ...e.attributes,
      // Map app observation types to structured params for engine pipeline
      { field_id: e.name.includes("Mozart") ? "composer" : "performer", value_type: "string", count: 1 },
      { field_id: "media_type", value_type: "string", count: 1 },
    ],
  })),
];

test("flac_audio: induces params across expanded audio corpus including real FLAC entities", () => {
  const params = induceParameters(audioCorpus, {
    population: "test:flac-audio", minPrevalence: 0.15, minEntityCount: 6,
  });
  assert.ok(params.length >= 3, "should find standard params across FLAC-derived audio entities");
  const date = params.find(p => p.domain.attribute === "date");
  const title = params.find(p => p.domain.attribute === "title");
  assert.ok(date || title, "date or title should be standard params for audio metadata entities");
});

// ── VOCABULARY BUILDING ─────────────────────────────────────────────────────

test("vocabulary: buildKindVocabulary produces valid EntityKindVocabulary@1", () => {
  const kinds = induceEntityKinds(mixedEntities, {
    population: "test:vocab-mixed", minPrevalence: 0.15,
    cohesionThreshold: 0.18, minKindSize: 2, permutations: 100, quantile: 0.8,
  });
  assert.ok(kinds.length >= 2, "need at least 2 kinds for vocabulary test");
  const vocab = buildKindVocabulary(kinds, { population: "test:vocab-mixed" });
  validateEntityKindVocabulary(vocab);
  assert.ok(vocab.vocabulary_id.startsWith("vocab:"), "vocabulary_id must have correct prefix");
  assert.ok(vocab.kinds.length >= 1, "vocabulary must contain kinds");
  for (const kd of vocab.kinds) {
    assert.ok(kd.standard_parameters.length > 0, `kind ${kd.label} must have standard params in vocabulary`);
  }
});
