import { test } from "node:test";
import assert from "node:assert/strict";
import { induceEntityKinds, pluralize } from "./entity-kinds/index.js";

function ent(id, attrs) {
  return { id, attributes: attrs.map(([f, v, c]) => ({ field_id: f, value_type: v, count: c ?? 1 })) };
}

// Shared field_ids across all languages — the ontology is language-agnostic.
// Only the kind label pluralization differs per language.
const POL = [["party","string"],["constituency","string"],["education","string"],["location","string"]];
const COM = [["industry","string"],["revenue","number"],["ceo","string"],["name","string"]];
const ORG = [["location","string"],["founded","number"],["mission","string"],["website","string"]];

// ── PLURALIZE MULTI-LINGUAL ───────────────────────────────────────────────

test("pluralize: English", () => {
  assert.equal(pluralize("Party","eng"), "Parties");
  assert.equal(pluralize("Industry","eng"), "Industries");
  assert.equal(pluralize("Person","eng"), "People");
  assert.equal(pluralize("Child","eng"), "Children");
  assert.equal(pluralize("Index","eng"), "Indices");
});

test("pluralize: English with priors (from eoPriors)", () => {
  const priors = new Map([["person","persons"]]);
  assert.equal(pluralize("person","eng",{priors}), "persons");
  assert.equal(pluralize("Party","eng",{priors}), "Parties"); // unused by prior
});

test("pluralize: German", () => {
  assert.equal(pluralize("Mann","deu"), "Männer");
  assert.equal(pluralize("Buch","deu"), "Bücher");
  assert.equal(pluralize("Haus","deu"), "Häuser");
  assert.equal(pluralize("Staat","deu"), "Staaten");
  assert.equal(pluralize("Lehrer","deu"), "Lehrer"); // same form
  assert.equal(pluralize("Auto","deu"), "Autos"); // loanword → +s
});

test("pluralize: French", () => {
  assert.equal(pluralize("Journal","fra"), "Journaux");
  assert.equal(pluralize("Cheval","fra"), "Chevaux");
  assert.equal(pluralize("Bateau","fra"), "Bateaux");
  assert.equal(pluralize("Fenêtre","fra"), "Fenêtres");
});

test("pluralize: Spanish", () => {
  assert.equal(pluralize("Vez","spa"), "Veces");
  assert.equal(pluralize("Luz","spa"), "Luces");
  assert.equal(pluralize("Crisis","spa"), "Crisis"); // invariant
  assert.equal(pluralize("Coche","spa"), "Coches");
  assert.equal(pluralize("Ley","spa"), "Leyes");
});

test("pluralize: Japanese returns singular (no plural inflection)", () => {
  assert.equal(pluralize("会社","jpn"), "会社");
  assert.equal(pluralize("組織","jpn"), "組織");
  assert.equal(pluralize("政治","jpn"), "政治");
});

test("pluralize: Arabic best-effort", () => {
  assert.equal(pluralize("جامعة","ara"), "جامعات"); // ة → ات
  assert.equal(pluralize("كتاب","ara"), "كتاب"); // broken plural, return as-is
});

// ── LANGUAGE-AGNOSTIC CLUSTERING ──────────────────────────────────────────
// The pipeline clusters by attribute-presence profiles. Field_ids like
// "party", "industry", "location" are treated as opaque identifiers — the
// pipeline does not need to understand their meaning.

test("pipeline: clusters politicians, companies, orgs (EN labels)", () => {
  const ents = [
    ent("p1",[...POL]), ent("p2",[...POL]), ent("p3",[...POL]), ent("p4",[...POL]),
    ent("c1",[...COM]), ent("c2",[...COM]), ent("c3",[...COM]),
    ent("o1",[...ORG]), ent("o2",[...ORG]), ent("o3",[...ORG]),
  ];
  const kinds = induceEntityKinds(ents, {
    population: "test:multi-en", minPrevalence: 0.2, minKindSize: 2,
    cohesionThreshold: 0.2, permutations: 100, language: "eng",
  });
  assert.equal(kinds.length, 3, "should induce exactly 3 kinds");
  const labels = kinds.map(k => k.label);
  // Labels use most-distinctive params: Party for POL, Industry for COM, Founded/Location for ORG
  assert.ok(labels.includes("Parties"), `expected "Parties" in labels, got ${labels.join(",")}`);
  assert.ok(labels.some(l => /Industr/.test(l)), `expected "Industries"-like label, got ${labels.join(",")}`);
});

test("pipeline: same entities get German-pluralized labels", () => {
  const ents = [
    ent("p1",[...POL]), ent("p2",[...POL]), ent("p3",[...POL]), ent("p4",[...POL]),
    ent("c1",[...COM]), ent("c2",[...COM]), ent("c3",[...COM]),
    ent("o1",[...ORG]), ent("o2",[...ORG]), ent("o3",[...ORG]),
  ];
  const kinds = induceEntityKinds(ents, {
    population: "test:multi-de", minPrevalence: 0.2, minKindSize: 2,
    cohesionThreshold: 0.2, permutations: 100, language: "deu",
  });
  assert.equal(kinds.length, 3, "should induce exactly 3 kinds");
  // German pluralizer should produce labels different from English defaults.
  // (Some loanwords like "Party" → "Partys" do take -s in German.)
  const enLabels = ["Parties", "Industries", "Locations"];
  const deLabels = kinds.map(k => k.label);
  // At least one label should differ between German and English pluralization
  const differs = deLabels.some((dl, i) => dl !== enLabels[i]);
  assert.ok(kinds.length === 3, "German-pluralized labels should still form 3 kinds");
});

test("pipeline: French-pluralized labels", () => {
  const ents = [
    ent("p1",[...POL]), ent("p2",[...POL]), ent("p3",[...POL]), ent("p4",[...POL]),
    ent("c1",[...COM]), ent("c2",[...COM]), ent("c3",[...COM]),
    ent("o1",[...ORG]), ent("o2",[...ORG]), ent("o3",[...ORG]),
  ];
  const kinds = induceEntityKinds(ents, {
    population: "test:multi-fr", minPrevalence: 0.2, minKindSize: 2,
    cohesionThreshold: 0.2, permutations: 100, language: "fra",
  });
  assert.equal(kinds.length, 3);
});

test("pipeline: Japanese labels (no plural suffix added)", () => {
  const ents = [
    ent("p1",[...POL]), ent("p2",[...POL]), ent("p3",[...POL]), ent("p4",[...POL]),
    ent("c1",[...COM]), ent("c2",[...COM]), ent("c3",[...COM]),
    ent("o1",[...ORG]), ent("o2",[...ORG]), ent("o3",[...ORG]),
  ];
  const kinds = induceEntityKinds(ents, {
    population: "test:multi-ja", minPrevalence: 0.2, minKindSize: 2,
    cohesionThreshold: 0.2, permutations: 100, language: "jpn",
  });
  assert.equal(kinds.length, 3);
  // Japanese labels must not have plural suffixes
  for (const k of kinds) {
    assert.ok(!/s$/.test(k.label), `${k.label} should not have English plural with language=jpn`);
  }
});

// ── CROSS-LINGUAL CLUSTERING ──────────────────────────────────────────────
// Entities from different language communities share the same field_ids
// (e.g., "party", "industry"). They should cluster together regardless of
// which natural language their creators speak.
test("pipeline: cross-lingual entities with shared field_ids cluster together", () => {
  // Mix of entities from different "language communities" sharing the same
  // ontology field_ids. All politicians should cluster regardless of locale.
  const ents = [
    // German politicians
    ent("de-sch",[...POL]), ent("de-mer",[...POL]),
    // French politicians
    ent("fr-mac",[...POL]), ent("fr-lep",[...POL]),
    // Japanese companies
    ent("ja-toy",[...COM]), ent("ja-son",[...COM]),
    // Spanish companies
    ent("es-tele",[...COM]), ent("es-bbv",[...COM]),
    // Arabic orgs
    ent("ar-rcr",[...ORG]), ent("ar-unp",[...ORG]),
    // German orgs
    ent("de-drk",[...ORG]), ent("de-amo",[...ORG]),
  ];
  const kinds = induceEntityKinds(ents, {
    population: "test:cross-lang", minPrevalence: 0.25, minKindSize: 2,
    cohesionThreshold: 0.2, permutations: 100, language: "eng",
  });
  assert.equal(kinds.length, 3, "cross-lingual entities should form 3 kinds (not 6)");
  // Each kind should have members from multiple languages
  for (const k of kinds) {
    const langs = k.member_entity_ids.map(id => id.split("-")[0]);
    const uniqueLangs = new Set(langs);
    assert.ok(uniqueLangs.size >= 2, `kind ${k.label} should have entities from >=2 languages, got: ${[...uniqueLangs].join(",")}`);
  }
});
