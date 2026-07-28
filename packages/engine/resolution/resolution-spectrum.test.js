import { test } from "node:test";
import assert from "node:assert/strict";
import { TIER, needsWitness, SPECTRUM, spectrumOf } from "./resolution-spectrum.js";

test("SPECTRUM has no duplicate types", () => {
  const types = SPECTRUM.map((s) => s.type);
  assert.equal(new Set(types).size, types.length);
});

test("spectrumOf looks up by type, null for unknown", () => {
  assert.equal(spectrumOf("name-alias")?.tier, TIER.RESOLVED);
  assert.equal(spectrumOf("no-such-type"), null);
});

test("needsWitness maps tiers to the witness requirement", () => {
  assert.equal(needsWitness(TIER.RESOLVED), false);
  assert.equal(needsWitness(TIER.ENGINE), false);
  assert.equal(needsWitness(TIER.MIXED), "tail");
  assert.equal(needsWitness(TIER.MODEL), true);
});

test("genre-self-presentation is MODEL-tier: genre claims a classifier may not settle on its own", () => {
  const entry = spectrumOf("genre-self-presentation");
  assert.ok(entry, "genre-self-presentation must be present in SPECTRUM");
  assert.equal(entry.tier, TIER.MODEL);
  assert.equal(needsWitness(entry.tier), true);
});

test("every SPECTRUM entry with subcases declares tiers on the subcases, not just the parent", () => {
  for (const entry of SPECTRUM) {
    if (!entry.subcases) continue;
    for (const sub of entry.subcases) {
      assert.ok(Object.values(TIER).includes(sub.tier), `${entry.type}/${sub.case} missing a valid tier`);
    }
  }
});
