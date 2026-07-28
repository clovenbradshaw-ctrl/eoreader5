// Chat with the ingested book, engine-first.
//
//   node scripts/demo/chat.mjs "who created the creature"
//   node scripts/demo/chat.mjs                      # runs the demo question set
//
// Env: EO_LLM_URL (default http://127.0.0.1:8080), EO_TEXT, EO_COREF.
//
// The pipeline, and which part is allowed to decide what:
//
//   question -> store.surface()      ENGINE picks the evidence (Hebbian recall)
//            -> presence re-rank     ENGINE prefers frames the referent occupies
//            -> offset round-trip    ENGINE proves the evidence points where it says
//            -> talker               MODEL phrases it, and may do nothing else
//            -> veto                 ENGINE checks the phrasing invented nothing
//            -> answer               grounded quote + offset, always
//
// The model can be removed entirely and every answer still stands, because
// the answer IS the evidence; the model only supplies the sentence around
// it. That is the property the split is for.

import { ingest, retrieve, verifyOffset } from "./lib.mjs";
import { phrase, talkerAvailable, DEFAULT_URL } from "./talker.mjs";

// Chosen to exercise all three outcomes, not to flatter the engine:
// two in the book's own vocabulary (answerable at ENGINE tier), two
// paraphrases (MODEL-tier gap), one off-corpus (also a gap, for a
// different reason the output distinguishes).
const DEMO_QUESTIONS = [
  "what happened on the dreary night of November",
  "the instruments of life and the lifeless thing at my feet",
  "who created the creature",
  "what did the creature do to William",
  "what is the capital of France",
];

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const argQuestion = process.argv.slice(2).join(" ").trim();
const questions = argQuestion ? [argQuestion] : DEMO_QUESTIONS;

console.log(dim("ingesting..."));
const organs = ingest({ referentId: process.env.EO_REFERENT ?? "creature" });
console.log(dim(`${organs.frames.length} frames, ${organs.store.posting.size.toLocaleString()} motifs, referent present in ${[...organs.presence.values()].filter((v) => v > 0).length} frames`));

const llmUp = await talkerAvailable();
console.log(llmUp
  ? dim(`talker: CPU LLM at ${DEFAULT_URL} (phrasing only)`)
  : dim(`talker: OFFLINE at ${DEFAULT_URL} — answers stay grounded, prose degrades to the raw quote`));

let asked = 0, phrased = 0, copied = 0, vetoed = 0, abstained = 0;

for (const q of questions) {
  console.log(`\n${bold("Q:")} ${q}`);
  asked += 1;

  const { evidence, gaps } = retrieve(organs, q, { limit: 2 });
  if (!evidence.length) {
    console.log(`  ${bold("A:")} (no answer — typed gap, not a guess)`);
    for (const g of gaps) {
      console.log(dim(`     gap [${g.kind}] tier=${g.tier ?? "?"} needsWitness=${g.needsWitness ?? "?"}`));
      console.log(dim(`     ${g.detail}`));
      if (g.why) console.log(dim(`     ${g.why}`));
    }
    abstained += 1;
    continue;
  }

  const top = evidence[0];
  const grounded = verifyOffset(organs.text, { text: top.excerpt, offset: top.excerptOffset });
  const quote = top.excerpt.replace(/\s+/g, " ");

  console.log(dim(`  evidence @${top.excerptOffset} (frame ${top.order} @${top.offset}, activation ${top.activation}, presence ${top.referentPresence ?? "n/a"}, ${top.termsCovered} question terms, offset ${grounded ? "verified" : "UNVERIFIED"})`));
  console.log(dim(`  "${quote}"`));

  // The facts handed to the model are the engine's, verbatim and bounded.
  // A 270M model cannot summarize 2000 characters, so it gets the leading
  // sentences of the winning passage and nothing else to work with.
  const facts = quote.slice(0, 220);
  const said = await phrase(facts);

  if (!said.available) {
    console.log(`  ${bold("A:")} ${quote.slice(0, 200)}`);
    console.log(dim(`     (engine-only: no talker reachable)`));
  } else if (said.text && said.copied) {
    console.log(`  ${bold("A:")} ${said.text}`);
    console.log(dim(`     veto passed, but the talker COPIED the evidence rather than phrasing it`));
    console.log(dim(`     (a verbatim copy passes every veto trivially — reported separately so "veto passed" cannot stand in for "the model did its job")`));
    copied += 1;
  } else if (said.text) {
    console.log(`  ${bold("A:")} ${said.text}`);
    console.log(dim(`     talker phrased it; veto passed`));
    phrased += 1;
  } else {
    console.log(`  ${bold("A:")} ${quote.slice(0, 200)}`);
    console.log(dim(`     talker said: "${(said.raw ?? "").slice(0, 120)}"`));
    if (said.degenerate) console.log(dim(`     REJECTED: repetition loop — grounded, so no veto fires on it, but it is not an answer`));
    if (said.ungrounded?.length) console.log(dim(`     REJECTED: ungrounded tokens not in the evidence: ${said.ungrounded.map((w) => `"${w}"`).join(", ")} — the veto's invented-fact check is entity-level and misses common-noun substitution`));
    for (const v of said.vetoResult?.vetoes ?? []) console.log(dim(`     VETO [${v.severity}] ${v.id}: ${v.message.slice(0, 120)}`));
    console.log(dim(`     fell back to the engine's grounded quote`));
    vetoed += 1;
  }
}

console.log(`\n${bold("SUMMARY")}  ${asked} asked · ${phrased} phrased · ${copied} copied verbatim · ${vetoed} vetoed · ${abstained} abstained (typed gap)`);
console.log(dim("every answer above is a pointer into the source; the model never chose one."));
