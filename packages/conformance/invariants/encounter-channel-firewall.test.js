// The encounter-channel firewall — same discipline as the reaction
// channel (reaction-channel-firewall.test.js), one register over.
//
// An EncounterEvent@1 is testimony OF one creature ABOUT a peer, not an
// engine inference. It must never reach the semantic ledger, where it
// could mint an observation, referent, hypothesis, task, frame, or
// resolution about the peer that a citing surface could then read back as
// evidence. Same reasoning as the corpus-role firewall (docs/corpus-role.md)
// and the reaction-channel firewall, two channels over.
//
// The naming convention and the separate module are conventions. This test
// is what makes them an invariant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createState, appendEvents, applyCommand } from "@eoreader/engine/replay";
import { mintEncounter } from "@eoreader/engine/encounter";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const ENGINE = resolve(import.meta.dirname, "../../engine");

const priorSnapshot = {
  schema_version: "PriorSnapshot@1",
  prior_id: `prior:${canonicalHashSync({ prior: "encounter-firewall" })}`,
  operator_epoch: "eo-2026-07",
  ledger_head: "head:empty",
  basis_id: "basis:test",
  content_hash: canonicalHashSync({ basis: "encounter-firewall" }),
};

const state = () => createState({ engineVersion: "0.1.0", operatorEpoch: "eo-2026-07", priorSnapshot });

const anEncounter = () => mintEncounter({
  self_id: "referent:emanon-a",
  peer_id: "referent:emanon-b",
  world_id: "world:1",
  ts: 1_700_000_000_000,
  seq: 0,
  kind: "play",
  context: { medium: "text" },
  payload: {},
});

test("the semantic ledger refuses an EncounterEvent@1", () => {
  // It is not a SemanticEvent@1 and the ledger must say so rather than
  // coercing it into one.
  assert.throws(() => appendEvents(state(), [anEncounter()]), /schema_version must be SemanticEvent@1/);
});

test("there is no command type that admits an encounter into the ledger", () => {
  for (const type of ["encounter.admit", "encounter.record", "encounter.observe"]) {
    assert.throws(() => applyCommand(state(), { type, payload: anEncounter() }), /unknown command type/,
      `${type} must not exist: an encounter is not an engine operation`);
  }
});

test("no encounter kind is a valid operator, so an encounter can never carry one", () => {
  // The four encounter kinds and the nine operators are disjoint
  // vocabularies. If they ever collided, an encounter could be mistaken
  // for an operation.
  const encounterKinds = ["observe", "play", "teach", "withdraw"];
  const operators = ["NUL", "INS", "SIG", "DEF", "EVA", "REC", "SYN", "SEG", "CON"];
  for (const kind of encounterKinds) {
    assert.equal(operators.includes(kind.toUpperCase()), false, `encounter kind ${kind} collides with an operator`);
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

test("the encounter channel is a leaf: nothing in the engine reads it back as evidence", () => {
  // The channel collects. Nothing consumes it yet — and when something
  // does, it should be a deliberate edit to this list, not a quiet import.
  // The ledger and the projection are the two surfaces that would turn an
  // encounter into evidence about the peer it describes.
  for (const entry of ["replay/index.js", "projection/index.js"]) {
    for (const file of reachable(entry)) {
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.equal(/from\s+["'][^"']*encounter\/index\.js["']/.test(src), false,
        `${file.replace(ENGINE + "/", "")} is reachable from ${entry} and imports the encounter channel`);
    }
  }
});
