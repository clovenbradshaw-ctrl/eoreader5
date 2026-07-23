import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCanonicalDecimal, fromFixedPoint, toFixedPoint } from "./fixed-point.js";

test("canonical decimals round-trip through fixed-point integers", () => {
  assert.equal(toFixedPoint("12.34", 3), 12340n);
  assert.equal(fromFixedPoint(-1200n, 2), "-12");
});

test("rejects non-canonical decimal payloads", () => {
  assert.throws(() => assertCanonicalDecimal("01.0"));
  assert.throws(() => toFixedPoint("1.234", 2));
});
