import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_OPERATOR_EPOCH,
  OPERATOR_CODES,
  LEGACY_OPERATOR_MAP,
  isCurrentOperator,
  resolveOperator,
} from "./epoch.js";

test("current epoch has exactly the nine closed operator codes", () => {
  assert.deepEqual(
    [...OPERATOR_CODES].sort(),
    ["CON", "DEF", "EVA", "INS", "NUL", "REC", "SEG", "SIG", "SYN"]
  );
});

test("isCurrentOperator rejects historical codes", () => {
  assert.equal(isCurrentOperator("NUL"), true);
  assert.equal(isCurrentOperator("ALT"), false);
  assert.equal(isCurrentOperator("DES"), false);
});

test("all three known historical terms are mapped, none unmapped", () => {
  for (const term of ["ALT", "SUP", "DES"]) {
    assert.equal(LEGACY_OPERATOR_MAP[term].status, "mapped");
  }
  assert.equal(LEGACY_OPERATOR_MAP.ALT.to, "DEF");
  assert.equal(LEGACY_OPERATOR_MAP.SUP.to, "EVA");
  assert.equal(LEGACY_OPERATOR_MAP.DES.to, "SIG");
});

test("resolveOperator maps historical codes at import boundary", () => {
  assert.equal(resolveOperator("ALT", "eo-legacy-pre-2026"), "DEF");
  assert.equal(resolveOperator("SUP", "eo-legacy-pre-2026"), "EVA");
  assert.equal(resolveOperator("DES", "eo-legacy-pre-2026"), "SIG");
  assert.equal(resolveOperator("NUL", CURRENT_OPERATOR_EPOCH), "NUL");
});

test("resolveOperator throws rather than guessing on unknown epoch/code pairs", () => {
  assert.throws(() => resolveOperator("XYZ", "eo-legacy-pre-2026"));
  assert.throws(() => resolveOperator("ALT", CURRENT_OPERATOR_EPOCH));
});
