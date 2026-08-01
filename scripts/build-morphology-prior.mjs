#!/usr/bin/env node
// Build the verb morphology prior from a UniMorph language dump.
//
// UniMorph is external witness knowledge about a LANGUAGE — the kind of fact
// the engine must never derive from the text it is reading. So it lands in
// eoPriors as a pinned artifact with provenance, exactly like the coref priors,
// and the engine consumes it as an injected prior.
//
// The full English dump is ~18MB and mostly irrelevant here: this keeps verb
// rows only, and drops forms whose lemma a suffix rule already recovers, since
// carrying those would triple the file to restate something derivable.
//
// Usage:
//   curl -sL https://raw.githubusercontent.com/unimorph/eng/master/eng -o eng.tsv
//   node scripts/build-morphology-prior.mjs eng.tsv <out.json> [--lang eng]

import fs from "node:fs";
import { parseUnimorphLemmas } from "../packages/def/morphology.js";
import { verbStem } from "../packages/def/svo.js";

const [src, out] = process.argv.slice(2);
const langIdx = process.argv.indexOf("--lang");
const LANG = langIdx > 0 ? process.argv[langIdx + 1] : "eng";
if (!src || !out) {
  console.error("usage: build-morphology-prior.mjs <unimorph.tsv> <out.json> [--lang eng]");
  process.exit(1);
}

const text = fs.readFileSync(src, "utf8");
const full = parseUnimorphLemmas(text, { pos: "V" });
console.log(`parsed ${full.size} verb surface forms`);

// Keep only what a rule CANNOT recover.
//
// If verbStem(form) already equals verbStem(lemma), a suffix rule handles that
// pair and storing it buys nothing. What must be stored is precisely the
// irregular tail — lay/lie, went/go, brought/bring — which is where the rule
// fails and where real prose lives.
const irregular = {};
let dropped = 0;
for (const [form, lemmas] of full) {
  const keep = [...lemmas].filter((l) => verbStem(form) !== verbStem(l));
  if (!keep.length) { dropped++; continue; }
  irregular[form] = keep;
}

const prior = {
  schema: "MorphologyPrior@1",
  id: `morphology-${LANG}`,
  language: LANG,
  provenance: {
    basis: "external",
    source: "UniMorph (https://unimorph.github.io) — " + LANG,
    method: "verb rows only (bundle starts with V;); forms a suffix rule already recovers are dropped",
    dropped_rule_recoverable: dropped,
    note:
      "witness-tier: an external fact about a language, injected and never derived from the text " +
      "being read. A form may map to MORE THAN ONE lemma (saw -> see, saw) and the ambiguity is " +
      "preserved rather than resolved here.",
  },
  forms: Object.keys(irregular).length,
  irregular,
};

fs.writeFileSync(out, JSON.stringify(prior));
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`kept ${prior.forms} irregular forms, dropped ${dropped} rule-recoverable`);
console.log(`wrote ${out} (${kb} KB)`);

// Spot-check the pairs a suffix stripper provably fails.
const check = [["lay", "lie"], ["went", "go"], ["brought", "bring"], ["saw", "see"], ["spoke", "speak"], ["fled", "flee"]];
for (const [form, lemma] of check) {
  const got = irregular[form] || [];
  console.log(`  ${got.includes(lemma) ? "✓" : "✗"} ${form} -> ${lemma}  ${got.length ? `[${got.join(", ")}]` : "(absent)"}`);
}
