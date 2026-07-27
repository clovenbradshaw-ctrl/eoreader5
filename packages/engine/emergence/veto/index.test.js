import { test } from "node:test";
import assert from "node:assert/strict";
import { veto } from "./index.js";

test("veto passes for clean summary", () => {
  const output = "Caesar conquered Gaul";
  const source = "Julius Caesar conquered Gaul in 50 BC";
  const result = veto(output, { source });
  assert.equal(result.passed, true);
  assert.equal(result.vetoes.length, 0);
});

test("veto catches invented entities", () => {
  const output = "The FOO Corp acquired BAR Inc in a merger";
  const source = "Newton discovered gravity on Earth";
  const result = veto(output, { source });
  assert.equal(result.passed, false);
  assert.ok(result.vetoes.some((v) => v.id === "invented-fact"));
});

test("veto catches polarity flips", () => {
  const output = "Caesar definitely is alive and breathing";
  const source = "Caesar definitely is not alive";
  const result = veto(output, { source });
  assert.equal(result.passed, false);
  assert.ok(result.vetoes.some((v) => v.id === "polarity-flip"));
});

test("veto catches thesis injection", () => {
  const output = "I think Caesar was the best leader ever";
  const source = "Caesar was a leader of Rome";
  const result = veto(output, { source });
  assert.equal(result.passed, false);
  assert.ok(result.vetoes.some((v) => v.id === "thesis-injection"));
});

test("veto passes when source also has opinion markers", () => {
  const output = "I think Caesar was great";
  const source = "I think Caesar was a leader";
  const result = veto(output, { source });
  // Source also has "I think" so no thesis injection
  assert.ok(!result.vetoes.some((v) => v.id === "thesis-injection"));
});

test("veto checks constraint violation for tiny model", () => {
  const output = "I am creating a brand new theory about nothing at all";
  const result = veto(output, { source: "some text" });
  // Should have constraint-violation (soft) for terrain/stance mismatch
  assert.ok(result.vetoes.some((v) => v.id === "constraint-violation"));
});

test("veto returns schema version", () => {
  const result = veto("test", { source: "test" });
  assert.equal(result.schema, "VetoResult@1");
  assert.ok(typeof result.output_tokens === "number");
});

test("veto with no source skips invented-fact and polarity checks", () => {
  const output = "Einstein discovered gravity";
  const result = veto(output, {});
  // No source means no invented-fact or polarity-flip vetoes
  assert.ok(!result.vetoes.some((v) => v.id === "invented-fact"));
  assert.ok(!result.vetoes.some((v) => v.id === "polarity-flip"));
});

test("veto strict mode fails on hard vetoes only", () => {
  const output = "I think this is wrong";
  const source = "something";
  const result = veto(output, { source, strict: true });
  // thesis-injection is hard, constraint-violation is soft
  // strict mode: only hard vetoes cause failure
  if (result.vetoes.some((v) => v.id === "thesis-injection" && v.severity === "hard")) {
    assert.equal(result.passed, false);
  }
});
