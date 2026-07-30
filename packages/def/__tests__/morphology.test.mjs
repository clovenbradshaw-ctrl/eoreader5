import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseUnimorphLemmas, createLemmatizer } from "../morphology.js";
import { verbStem } from "../svo.js";

const SAMPLE = [
  "lie\tlies\tV;PRS;3;SG",
  "lie\tlay\tV;PST",
  "lie\tlain\tV;V.PTCP;PST",
  "lie\tlies\tN;PL",          // noun row — must NOT be indexed as a verb
  "go\twent\tV;PST",
  "see\tsaw\tV;PST",
  "saw\tsawed\tV;PST",        // "saw" is also a lemma; ambiguity is preserved
  "malformed line",
].join("\n");

test("only verb rows are indexed", () => {
  const m = parseUnimorphLemmas(SAMPLE, { pos: "V" });
  assert.ok(m.get("lay").has("lie"));
  assert.ok(m.get("went").has("go"));
  // The N;PL row must not add a noun reading of a verb surface.
  assert.ok(!m.has("lies") || [...m.get("lies")].every((l) => l === "lie"));
});

test("ambiguity is preserved, not resolved", () => {
  const m = parseUnimorphLemmas(SAMPLE, { pos: "V" });
  // "saw" is the past of "see" AND a lemma in its own right.
  assert.ok(m.get("saw").has("see"));
  assert.ok(m.get("saw").has("saw"));
});

test("the rule is part of the lookup, not an alternative to it", () => {
  // Regression: the prior stores only the IRREGULAR tail, so a regular form
  // absent from the table resolved to itself — "lies" stayed "lies" while
  // "lay" resolved to "lie", the sets never intersected, and the lay/lie
  // misattribution went unreported by the very prior added to catch it.
  const lem = createLemmatizer({ lay: ["lie"] }, { stem: verbStem });
  assert.equal(lem.sameAct("lay", "lies"), true, "irregular form must meet a regular one");
  assert.equal(lem.sameAct("lay", "grasped"), false);
});

test("a missing prior reports a gap and degrades to the rule", () => {
  const lem = createLemmatizer(null, { fallback: (a, b) => verbStem(a) === verbStem(b) });
  assert.match(lem.gap, /no morphology prior/);
  assert.equal(lem.sameAct("grasped", "grasp"), true, "regulars still work");
  assert.equal(lem.sameAct("lay", "lies"), false, "irregulars provably do not — hence the gap");
});

test("the built prior resolves the irregulars a suffix rule cannot", (t) => {
  const p = path.resolve(import.meta.dirname, "../../../../eoPriors/priors/morphology-eng.json");
  if (!fs.existsSync(p)) return t.skip("morphology prior not built");
  const prior = JSON.parse(fs.readFileSync(p, "utf8"));
  const lem = createLemmatizer(prior.irregular, { stem: verbStem });
  for (const [a, b] of [["lay", "lie"], ["went", "go"], ["brought", "bring"], ["saw", "see"], ["spoke", "speak"], ["fled", "flee"], ["cries", "cry"]]) {
    assert.equal(lem.sameAct(a, b), true, `${a} ~ ${b} must resolve`);
  }
  // And it must not collapse genuinely different acts.
  assert.equal(lem.sameAct("grasped", "fled"), false);
});
