// The reaction-channel firewall (HANDOFF Part 4).
//
// A ReactionEvent@1 is an observation of a READER, not an engine inference.
// It must never reach the semantic ledger, where it could mint an
// observation, referent, hypothesis, task, frame, or resolution that a citing
// surface can then read back as evidence. Same reasoning as the corpus-role
// firewall (docs/corpus-role.md), one channel over.
//
// The naming convention and the separate module are conventions. This test is
// what makes them an invariant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createState, appendEvents, applyCommand } from "@eoreader/engine/replay";
import { mintReaction } from "@eoreader/engine/reaction";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const ENGINE = resolve(import.meta.dirname, "../../engine");

const priorSnapshot = {
  schema_version: "PriorSnapshot@1",
  prior_id: `prior:${canonicalHashSync({ prior: "reaction-firewall" })}`,
  operator_epoch: "eo-2026-07",
  ledger_head: "head:empty",
  basis_id: "basis:test",
  content_hash: canonicalHashSync({ basis: "reaction-firewall" }),
};

const state = () => createState({ engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot });

const aReaction = () => mintReaction({
  reader_id: "reader:alice",
  session_id: "session:1",
  ts: 1_700_000_000_000,
  seq: 0,
  kind: "dwell",
  block_id: "block:a",
  extent: null,
  context: { visible_block_ids: ["block:a"], scale: "paragraph", lens_id: "lens:default" },
  payload: { dwell_ms: 4200 },
});

test("the semantic ledger refuses a ReactionEvent@1", () => {
  // It is not a SemanticEvent@1 and the ledger must say so rather than
  // coercing it into one.
  assert.throws(() => appendEvents(state(), [aReaction()]), /schema_version must be SemanticEvent@1/);
});

test("there is no command type that admits a reaction into the ledger", () => {
  for (const type of ["reaction.admit", "reaction.record", "reaction.observe"]) {
    assert.throws(() => applyCommand(state(), { type, payload: aReaction() }), /unknown command type/,
      `${type} must not exist: a reaction is not an engine operation`);
  }
});

test("no reaction kind is a valid operator, so a reaction can never carry one", () => {
  // The nine reaction kinds and the nine operators are disjoint vocabularies.
  // If they ever collided, a reaction could be mistaken for an operation.
  const reactionKinds = ["dwell", "reread", "scrub", "decollapse", "follow-figure", "skip", "query", "span-select", "abandon"];
  const operators = ["NUL", "INS", "SIG", "DEF", "EVA", "REC", "SYN", "SEG", "CON"];
  for (const kind of reactionKinds) {
    assert.equal(operators.includes(kind.toUpperCase()), false, `reaction kind ${kind} collides with an operator`);
  }
});

/** follow relative imports transitively from an entrypoint */
function reachable(entry, seen = new Set()) {
  const abs = resolve(ENGINE, entry);
  if (seen.has(abs) || !existsSync(abs)) return seen;
  seen.add(abs);
  const src = readFileSync(abs, "utf8");
  for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    reachable(resolve(dirname(abs), m[1]).replace(ENGINE + "/", ""), seen);
  }
  return seen;
}

test("the reaction channel is a leaf: nothing in the engine reads it back as evidence", () => {
  // The channel collects. Until HANDOFF Part 6, nothing consumes it — and
  // when something does, it should be a deliberate edit to this list, not a
  // quiet import. The ledger and the projection are the two surfaces that
  // would turn a reaction into evidence.
  for (const entry of ["replay/index.js", "projection/index.js"]) {
    for (const file of reachable(entry)) {
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.equal(/from\s+["'][^"']*reaction\/index\.js["']/.test(src), false,
        `${file.replace(ENGINE + "/", "")} is reachable from ${entry} and imports the reaction channel`);
    }
  }
});
