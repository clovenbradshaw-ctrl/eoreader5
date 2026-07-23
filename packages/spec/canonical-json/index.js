import { createHash } from "node:crypto";
// Canonical JSON and content-hash rules (spec section 8, P0 work item).
//
// Rules:
// - object keys are sorted lexicographically (code-point order) at every depth;
// - arrays preserve semantic order — callers are responsible for choosing a
//   deterministic element order before canonicalizing (e.g. topological order
//   for causal inputs);
// - undefined values, functions, and symbols are rejected — a public envelope
//   MUST NOT carry them;
// - numbers MUST be finite; NaN/Infinity are rejected so canonical bytes never
//   depend on platform-specific float formatting of non-finite values;
// - strings are left as-is (no Unicode normalization here — normalization, if
//   any, is a modality-adapter concern documented at the point of use, e.g.
//   referent labels in docs/referents.md);
// - the output is a JSON string with no insignificant whitespace.

function assertCanonicalizable(value, path) {
  if (value === undefined) {
    throw new TypeError(`canonicalJson: undefined at ${path || "$"}`);
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`canonicalJson: ${typeof value} at ${path || "$"}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`canonicalJson: non-finite number at ${path || "$"}`);
  }
}

function canonicalize(value, path = "$") {
  assertCanonicalizable(value, path);

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  }

  const sortedKeys = Object.keys(value).sort();
  const result = {};
  for (const key of sortedKeys) {
    const child = value[key];
    if (child === undefined) continue; // omitted field, not a null
    result[key] = canonicalize(child, `${path}.${key}`);
  }
  return result;
}

/** Deterministic JSON string: sorted keys, no whitespace, no undefined/NaN/Infinity. */
export function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * SHA-256 content hash of the canonical JSON encoding, hex-encoded and
 * prefixed with the algorithm tag so hash strings are self-describing and
 * migratable (e.g. "sha256:...").
 */
export async function canonicalHash(value, { subtle = defaultSubtle() } = {}) {
  const bytes = new TextEncoder().encode(canonicalJsonStringify(value));
  const digest = await subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function defaultSubtle() {
  if (typeof crypto !== "undefined" && crypto.subtle) return crypto.subtle;
  throw new Error(
    "canonicalHash: no WebCrypto subtle implementation available; pass { subtle } explicitly"
  );
}


/** Synchronous SHA-256 content hash for Node-based ledger code. */
export function canonicalHashSync(value) {
  return `sha256:${createHash("sha256").update(canonicalJsonStringify(value)).digest("hex")}`;
}
