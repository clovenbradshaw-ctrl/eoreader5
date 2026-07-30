import test from "node:test";
import assert from "node:assert/strict";
import { checkAttribution, resolveSubject } from "../attribution.js";

// The real passage, and the real generated claim that motivated this module.
// Frankenstein ch. 16, inside the creature's narrator span: the creature is
// killing William. The generated prose handed the act to Victor.
const EVIDENCE =
  "He struggled violently. Let me go, he cried; monster! Ugly wretch! " +
  "I grasped his throat to silence him, and in a moment he lay dead at my feet.";

// The creature narrates chapters 11-16; these offsets stand for that span.
const CREATURE_NARRATES = [{ referent: "creature", start: 0, end: 1000 }];

test("catches the agent swap that every bag-of-words check passes", async () => {
  const claim = "Frankenstein grasped its throat and silenced it.";
  const r = await checkAttribution(claim, EVIDENCE, { narratorSpans: CREATURE_NARRATES });

  const mis = r.vetoes.find((v) => v.id === "misattribution");
  assert.ok(mis, "the swap must be caught");
  assert.equal(mis.severity, "hard");
  assert.equal(r.passed, false);
  // The evidence's "I" resolves to the creature BY SCOPE, not by the string.
  assert.ok(mis.evidenceAgents.some((a) => a.referent === "creature" && a.basis === "narrator-span"));
});

test("the same claim is fine when the evidence really does say it", async () => {
  const claim = "The creature grasped his throat.";
  const r = await checkAttribution(claim, EVIDENCE, { narratorSpans: CREATURE_NARRATES });
  assert.deepEqual(r.vetoes.filter((v) => v.id === "misattribution"), []);
  assert.equal(r.passed, true);
});

test("a first-person subject resolves by scope, never by the token", () => {
  const inside = resolveSubject("I", 500, { narratorSpans: CREATURE_NARRATES });
  assert.equal(inside.referent, "creature");
  assert.equal(inside.basis, "narrator-span");

  const outside = resolveSubject("I", 5000, { narratorSpans: CREATURE_NARRATES, outerNarrator: "Walton" });
  assert.equal(outside.referent, "walton");
  assert.equal(outside.basis, "outer-narrator");
});

test("an unresolvable first person is a typed gap, not a guessed attribution", () => {
  const r = resolveSubject("I", 5000, { narratorSpans: CREATURE_NARRATES });
  assert.equal(r.referent, null);
  assert.equal(r.basis, "unresolved");
  assert.match(r.gap, /cannot be earned/);
});

test("aliases let one referent be named more than one way", async () => {
  const claim = "Victor Frankenstein grasped his throat.";
  // Without the alias, "victor frankenstein" vs "creature" is a mismatch...
  const strict = await checkAttribution(claim, EVIDENCE, { narratorSpans: CREATURE_NARRATES });
  assert.ok(strict.vetoes.some((v) => v.id === "misattribution"));

  // ...and naming the creature's own surfaces does not rescue a wrong agent.
  const aliased = await checkAttribution(claim, EVIDENCE, {
    narratorSpans: CREATURE_NARRATES,
    aliases: [["creature", "the monster", "the wretch"]],
  });
  assert.ok(aliased.vetoes.some((v) => v.id === "misattribution"),
    "an alias group must not launder an attribution to a different referent");
});

test("a verb the evidence never uses is reported softly, not called invention", async () => {
  const r = await checkAttribution("Frankenstein forgave the creature.", EVIDENCE, {
    narratorSpans: CREATURE_NARRATES,
  });
  const un = r.vetoes.find((v) => v.id === "unsupported-relation");
  assert.ok(un);
  assert.equal(un.severity, "soft",
    "this extractor may simply have failed to pair the clause; that is not proof of fabrication");
});
