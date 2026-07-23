import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJsonStringify, canonicalHash, canonicalHashSync } from "./index.js";

test("sorts object keys at every depth", () => {
  const a = canonicalJsonStringify({ b: 1, a: { d: 1, c: 2 } });
  assert.equal(a, '{"a":{"c":2,"d":1},"b":1}');
});

test("same object in different key order canonicalizes identically", () => {
  const x = canonicalJsonStringify({ z: 1, a: 2 });
  const y = canonicalJsonStringify({ a: 2, z: 1 });
  assert.equal(x, y);
});

test("preserves array order", () => {
  const s = canonicalJsonStringify({ inputs: ["b", "a"] });
  assert.equal(s, '{"inputs":["b","a"]}');
});

test("rejects undefined", () => {
  assert.throws(() => canonicalJsonStringify(undefined));
});

test("omits keys with undefined values rather than emitting null", () => {
  const s = canonicalJsonStringify({ a: 1, b: undefined });
  assert.equal(s, '{"a":1}');
});

test("rejects NaN and Infinity", () => {
  assert.throws(() => canonicalJsonStringify({ x: NaN }));
  assert.throws(() => canonicalJsonStringify({ x: Infinity }));
});

test("canonicalHash is stable across key order", async () => {
  const h1 = await canonicalHash({ a: 1, b: 2 });
  const h2 = await canonicalHash({ b: 2, a: 1 });
  assert.equal(h1, h2);
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
});

test("canonicalHashSync matches WebCrypto canonicalHash", async () => {
  const value = { semantic: ["browser", "safe"], nested: { z: false, a: 5 } };
  assert.equal(canonicalHashSync(value), await canonicalHash(value));
});
