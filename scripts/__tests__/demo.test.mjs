// End-to-end test for the ingest -> organs -> chat demo.
//
// Two things this test is careful about:
//
//   1. It SKIPS rather than fails when the source text or the coref prior
//      is absent. Those live outside this repo (eo-witness, eoPriors), so a
//      clone without them should not report a red suite for a missing
//      sibling checkout. A skipped test says "not exercised here"; a failing
//      one would say "the engine is broken", which would be false.
//   2. It never requires the CPU LLM. The talker is optional by design —
//      the whole point of the phraser/talker split is that answers stay
//      correct without it — so the test asserts the DEGRADATION path is
//      clean, and the pure-function guards (copy, repetition, ungrounded
//      substitution) are tested directly with no server involved.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { ingest, retrieve, verifyOffset, lexicalReach, excerptAround, TEXT_CANDIDATES, COREF_CANDIDATES } from "../demo/lib.mjs";
import { isCopy, isDegenerate, ungroundedTokens, phrase, TALKER_CELL } from "../demo/talker.mjs";
import { veto } from "../../packages/engine/emergence/veto/index.js";
import { TIER } from "../../packages/engine/resolution/resolution-spectrum.js";

const haveCorpus = TEXT_CANDIDATES.some((p) => p && existsSync(p)) && COREF_CANDIDATES.some((p) => p && existsSync(p));
const corpusTest = (name, fn) => test(name, { skip: haveCorpus ? false : "source text / coref prior not present in this checkout" }, fn);

// Ingest once; it is ~2s and every corpus test reads the same organs.
let organs = null;
const organsOnce = () => (organs ??= ingest({}));

// ── The organs form ──────────────────────────────────────────────────

corpusTest("ingest grows every organ over the real book", () => {
  const o = organsOnce();
  assert.ok(o.frames.length > 100, "framing produced a substrate");
  assert.ok(o.store.posting.size > 1000, "the store indexed motifs");
  assert.ok(o.store.edges.size > 100, "Hebbian edges were wired at co-occurrence");
  assert.ok(o.packet.spans.length > 0, "the fold selected spans");
  assert.ok(o.tokens.length > 10000, "the null's sampling pool is the text's own token stream");
});

corpusTest("the referent is admitted by explicit events, with scoped surfaces", () => {
  const o = organsOnce();
  assert.ok(o.admitted, "the coref prior supplied a referent");
  assert.equal(o.admitted.referentId, "ref:creature");
  assert.ok(o.admitted.events.length > 0, "surfaces arrived through events, not string matching");
  assert.ok(o.admitted.surfaces.some((s) => s.scope), "at least one surface is scope-restricted");
  assert.equal(o.admitted.gaps.length, 0, "every anchor in the prior resolved");
});

corpusTest("every fold span's offset survives a round-trip against the source", () => {
  const o = organsOnce();
  for (const span of o.packet.spans) {
    assert.ok(verifyOffset(o.text, span), `span at ${span.offset} does not point at its own text`);
  }
});

// ── Retrieval answers, and abstains, for stated reasons ──────────────

corpusTest("a question in the book's own vocabulary retrieves a verified passage", () => {
  const o = organsOnce();
  const { evidence, gaps } = retrieve(o, "the instruments of life and the lifeless thing at my feet");
  assert.equal(gaps.length, 0);
  assert.ok(evidence.length > 0);
  const top = evidence[0];
  assert.ok(verifyOffset(o.text, { text: top.excerpt, offset: top.excerptOffset }),
    "the excerpt's offset points at the excerpt");
  assert.match(top.excerpt, /instruments of life/, "the excerpt seeks the question's terms, not the frame's first sentence");
});

corpusTest("an off-corpus question abstains with a typed MODEL-tier gap", () => {
  const o = organsOnce();
  const { evidence, gaps } = retrieve(o, "what is the capital of France");
  assert.equal(evidence.length, 0, "no evidence is better than plausible wrong evidence");
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].kind, "below-chance-activation");
  assert.equal(gaps[0].tier, TIER.MODEL);
  assert.equal(gaps[0].needsWitness, true);
  assert.ok(gaps[0].lexicalReach.missing.includes("capital"), "the gap names the word the text never uses");
});

corpusTest("the abstention floor is derived from a null, not a constant", () => {
  const o = organsOnce();
  const { null: n } = retrieve(o, "what is the capital of France");
  assert.equal(n.schema, "NullProtocol@1");
  assert.equal(n.null_protocol.name, "length-matched-random-cue");
  assert.ok(n.sample_count >= 20);
  assert.equal(n.passed, false);
});

corpusTest("retrieval is deterministic — the same question gets the same floor twice", () => {
  const o = organsOnce();
  const a = retrieve(o, "what is the capital of France").null;
  const b = retrieve(o, "what is the capital of France").null;
  assert.equal(a.threshold, b.threshold);
});

corpusTest("presence boosts the ranking without overriding activation", () => {
  const o = organsOnce();
  const { evidence } = retrieve(o, "what happened on the dreary night of November");
  assert.ok(evidence.length > 0);
  // The regression this pins: sorting by presence alone demoted the
  // activation-237 chapter-5 frame below an activation-18 one.
  assert.ok(evidence[0].activation > 100, "the strongly-activated frame still wins");
});

// ── lexicalReach / excerptAround, as pure functions ──────────────────

corpusTest("lexicalReach separates a paraphrase from the book's own words", () => {
  const o = organsOnce();
  assert.ok(lexicalReach(o, "what is the capital of France").missing.includes("capital"));
  assert.deepEqual(lexicalReach(o, "the dreary night of November").missing, []);
});

test("excerptAround seeks the window covering the most question terms", () => {
  const frame = { text: "aaa ".repeat(100) + "the instruments of life " + "bbb ".repeat(100), offset: 0 };
  const ex = excerptAround(frame, ["instruments", "life"], 120);
  assert.match(ex.text, /instruments of life/);
  assert.ok(ex.start > 0, "it did not just return the head of the frame");
  assert.equal(ex.covered, 2);
});

// ── The talker's guards, no server required ──────────────────────────

test("isCopy catches the model handing the evidence straight back", () => {
  const facts = "I collected the instruments of life around me.";
  assert.equal(isCopy(facts, facts), true);
  assert.equal(isCopy("I collected the instruments of life", facts), true, "a prefix is still a copy");
  assert.equal(isCopy("Victor gathered his tools that night in autumn.", facts), false);
});

test("isDegenerate catches a repetition loop the veto cannot see", () => {
  const looped = "With an anxiety that amounted to agony, I beheld my toils. With an anxiety that amounted to agony, I beheld my toils.";
  assert.equal(isDegenerate(looped), true);
  assert.equal(isDegenerate("With an anxiety that amounted to agony, I beheld my toils."), false);
});

test("ungroundedTokens catches the common-noun substitution the veto misses", () => {
  const facts = "I beheld the accomplishment of my toils.";
  // The real measured case: the talker returned "labors" for "toils".
  assert.deepEqual(ungroundedTokens("I beheld the accomplishment of my labors.", facts), ["labors"]);
  assert.deepEqual(ungroundedTokens("I beheld the accomplishment of my toils.", facts), []);
  // And the veto itself does NOT catch it — this is the hole being pinned,
  // so that closing it in the organ shows up here as a change.
  const v = veto("I beheld the accomplishment of my labors.", { source: facts, declaredCell: TALKER_CELL, strict: true });
  assert.equal(v.passed, true, "veto passes the substitution; ungroundedTokens is what catches it");
});

test("an emission with no declared cell is a hard veto", () => {
  const v = veto("Some grounded sentence.", { source: "Some grounded sentence.", strict: true });
  assert.equal(v.passed, false);
  assert.ok(v.vetoes.some((x) => x.id === "undeclared-emission"));
});

test("the talker declares a cell inside the tiny-model contract", () => {
  assert.equal(TALKER_CELL.operator, "SIG");
  const v = veto("the instruments of life around me", { source: "the instruments of life around me", declaredCell: TALKER_CELL, strict: true });
  assert.equal(v.passed, true, "SIG/Field/Tracing is a legal cell for a phraser");
});

test("an unreachable talker degrades cleanly instead of throwing or inventing", async () => {
  const said = await phrase("some facts", { url: "http://127.0.0.1:9", timeoutMs: 2000 });
  assert.equal(said.available, false);
  assert.equal(said.text, null, "no sentence is fabricated when the model is gone");
  assert.equal(said.usedFallback, true);
});
