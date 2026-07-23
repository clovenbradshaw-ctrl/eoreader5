import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLegacy42OperatorRecord } from "./operators.js";

test("mapped legacy operators normalize at the compatibility boundary", () => {
  assert.deepEqual(
    normalizeLegacy42OperatorRecord({
      legacy42_id: "turn-7",
      legacy42_hash: "sha256:abc",
      operator: "ALT",
      operator_epoch: "eo-legacy-pre-2026",
    }),
    {
      status: "normalized",
      operator: "DEF",
      operator_epoch: "eo-2026-07",
      original_operator: "ALT",
      original_operator_epoch: "eo-legacy-pre-2026",
      provenance: { legacy42_id: "turn-7", legacy42_hash: "sha256:abc" },
    }
  );
});

test("unmapped DES records are held for review rather than coerced", () => {
  const result = normalizeLegacy42OperatorRecord({
    legacy42_id: "turn-8",
    operator: "DES",
    operator_epoch: "eo-legacy-pre-2026",
  });

  assert.equal(result.status, "held_for_review");
  assert.equal(result.reason, "unmapped_legacy_operator");
  assert.equal(result.original_operator, "DES");
});
