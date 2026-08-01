// morphology.js — inflected form → lemma, from UniMorph.
//
// Ported from eoreader4.2's `src/organs/ingest/unimorph.js`, which already had
// the right shape: the PARSE is pure and offline, the FETCH is an injected
// seam. That split is what lets this be tested headlessly and keeps the
// network off the engine's path. 4.2's organ answered "what is the past tense
// of this lemma"; attribution needs the inverse — "what lemma is this form" —
// so the index is built the other way round, but the discipline is unchanged.
//
// Why this exists at all. `svo.js::verbStem` strips suffixes, which handles
// regular inflection and nothing else. Measured on eight pairs an attribution
// check actually meets:
//
//   grasped ~ grasp   PASS
//   lay ~ lie         FAIL      cries ~ cry     FAIL  ("cri")
//   went ~ go         FAIL      spoke ~ speak   FAIL
//   brought ~ bring   FAIL      saw ~ see       FAIL
//   fled ~ flee       FAIL
//
// Seven of eight. And `lay ~ lie` is not hypothetical: the Frankenstein
// passage this was built against ends "he lay dead at my feet", so a claim
// written as "lies dead" walks straight past a suffix stripper. English
// irregulars are exactly the high-frequency verbs prose is made of; a rule
// cannot reach them, only a table can.
//
// UniMorph is WITNESS-TIER knowledge — an external fact about a language, not
// something derivable from the text being read. It is therefore injected as a
// prior and never computed here, the same discipline as the coref priors.
// Missing prior ⇒ typed gap and a documented fallback, never a silent guess.

/**
 * parseUnimorphLemmas(text) -> Map(form -> Set(lemma))
 *
 * UniMorph rows are `lemma <TAB> form <TAB> feature-bundle`. Only VERB bundles
 * are indexed: the same surface is often a noun too ("lies" is both V;PRS;3;SG
 * of "lie" and N;PL of "lie"), and folding nouns in would let a noun/verb
 * homograph match an act it never names.
 *
 * The value is a SET because inflection is genuinely ambiguous — "saw" is the
 * past of "see" AND the lemma of "saw" (to cut). Collapsing that to one answer
 * would be inventing a disambiguation this module cannot perform; callers are
 * expected to accept a match on ANY candidate, which errs toward not firing a
 * veto rather than firing a wrong one.
 */
export function parseUnimorphLemmas(text, { pos = "V" } = {}) {
  const out = new Map();
  const src = String(text || "");
  let start = 0;
  while (start <= src.length) {
    let nl = src.indexOf("\n", start);
    if (nl < 0) nl = src.length;
    const line = src.slice(start, nl);
    start = nl + 1;

    const a = line.indexOf("\t");
    if (a < 0) continue;
    const b = line.indexOf("\t", a + 1);
    if (b < 0) continue;

    const bundle = line.slice(b + 1).trim();
    // Bundle must be for the requested part of speech. Prefix match on
    // "V;" is exact enough — UniMorph bundles lead with the POS tag.
    if (!bundle.startsWith(`${pos};`) && bundle !== pos) continue;

    const lemma = line.slice(0, a).trim().toLowerCase();
    const form = line.slice(a + 1, b).trim().toLowerCase();
    if (!lemma || !form) continue;

    if (!out.has(form)) out.set(form, new Set());
    out.get(form).add(lemma);
    // A lemma is a form of itself, so a claim using the bare infinitive still
    // resolves without a separate NFIN row being present.
    if (!out.has(lemma)) out.set(lemma, new Set());
    out.get(lemma).add(lemma);
  }
  return out;
}

/**
 * createLemmatizer(index) -> { lemmasOf, sameAct, size, gap }
 *
 * `index` is a plain object or Map of form -> lemma[] (the serialized prior).
 * Absent index => every lookup reports a gap and `sameAct` falls back to the
 * caller's comparator, so a missing prior degrades to the previous behaviour
 * loudly rather than silently changing answers.
 */
export function createLemmatizer(index, { fallback = null, stem = null } = {}) {
  const map = new Map();
  if (index instanceof Map) {
    for (const [k, v] of index) map.set(k, new Set(v));
  } else if (index && typeof index === "object") {
    for (const [k, v] of Object.entries(index)) map.set(k, new Set(v));
  }

  const gap = map.size === 0
    ? "no morphology prior loaded — irregular inflections (lay/lie, went/go) will not be recognized"
    : null;

  // The table holds ONLY the irregular tail — forms a suffix rule already
  // recovers were dropped when the prior was built, because storing them
  // restates something derivable and tripled the file.
  //
  // That makes the rule part of the lookup, not an alternative to it. Without
  // this, a REGULAR form absent from the table resolved to itself: "lies"
  // stayed "lies" while "lay" resolved to "lie", the sets never intersected,
  // and a lay/lie misattribution went unreported by the very prior added to
  // catch it. Candidates are therefore the table's lemmas AND the rule's stem.
  const lemmasOf = (word) => {
    const w = String(word || "").trim().toLowerCase();
    if (!w) return new Set();
    const out = new Set(map.get(w) ?? []);
    out.add(w);
    if (stem) {
      out.add(stem(w));
      for (const l of map.get(w) ?? []) out.add(stem(l));
    }
    return out;
  };

  /** Do two surfaces name the same act? True when their lemma sets intersect. */
  const sameAct = (a, b) => {
    const x = String(a || "").toLowerCase();
    const y = String(b || "").toLowerCase();
    if (x && x === y) return true;
    if (map.size === 0) return fallback ? fallback(x, y) : x === y;
    const la = lemmasOf(x);
    for (const l of lemmasOf(y)) if (la.has(l)) return true;
    return false;
  };

  return { lemmasOf, sameAct, size: map.size, gap };
}
