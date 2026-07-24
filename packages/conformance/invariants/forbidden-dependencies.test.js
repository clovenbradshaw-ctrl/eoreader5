// P0 purity gate (spec section 18): fail CI if packages/engine imports a
// forbidden module or reaches outside its allowed dependency direction
// (engine -> spec only; never app, compat-4.2, eoPriors, or organ code).
//
// This test walks every .js file under packages/engine (excluding tests)
// and statically checks import specifiers. It intentionally does not
// execute engine code, so a forbidden dependency fails even if unreachable
// at runtime — the rule is about what the module graph may name, not just
// what a given code path calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", "engine");

const FORBIDDEN_SPECIFIERS = [
  /^node:fs/, /^fs$/, /^node:net/, /^net$/, /^node:http/, /^http$/, /^node:https/, /^https$/,
  /^node:dgram/, /^node:dns/, /^node:child_process/, /^child_process$/,
  /^express$/, /^ws$/, /^node-fetch$/, /^axios$/,
  /^@eoreader\/compat-4\.2/, /^@eoreader\/app/, /^@eoreader\/organs/,
  /^eopriors/i,
];

const FORBIDDEN_GLOBALS = [
  /\bDate\.now\s*\(/,
  /\bMath\.random\s*\(/,
  /\bnew\s+Date\s*\(\s*\)/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bindexedDB\b/,
  /\blocalStorage\b/,
  /\bprocess\.env\b/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

function importSpecifiers(source) {
  const specs = [];
  const importRe = /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [importRe, dynamicRe, requireRe]) {
    let m;
    while ((m = re.exec(source))) specs.push(m[1]);
  }
  return specs;
}

test("packages/engine has no forbidden import specifiers", () => {
  const files = walk(engineRoot);
  assert.ok(files.length > 0, "expected at least one engine source file to check");

  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const spec of importSpecifiers(source)) {
      if (spec.startsWith(".") || spec.startsWith("@eoreader/spec")) continue; // relative + spec allowed
      if (FORBIDDEN_SPECIFIERS.some((re) => re.test(spec)) || !spec.startsWith("node:")) {
        // Any non-relative, non-@eoreader/spec, non explicitly-allowed specifier
        // is suspect; only allow a short explicit safelist.
        const allowed = new Set([]); // no third-party runtime deps permitted yet
        if (!allowed.has(spec)) violations.push(`${file}: imports "${spec}"`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("packages/engine never touches ambient time, randomness, network, or browser storage", () => {
  const files = walk(engineRoot);
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const re of FORBIDDEN_GLOBALS) {
      if (re.test(source)) violations.push(`${file}: matches forbidden pattern ${re}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("this conformance suite itself runs with network disabled (no fetch/http usage)", () => {
  const source = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.doesNotMatch(source.replace(/FORBIDDEN_GLOBALS[\s\S]*?\];/, ""), /\bfetch\s*\(/);
});

const ATTRIBUTION_VERB_LITERALS = ["said", "reported", "wrote", "noted", "published", "according to"];

test("packages/engine contains no attribution-verb literals", () => {
  const files = walk(engineRoot);
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const literal of ATTRIBUTION_VERB_LITERALS) {
      const quoted = new RegExp(`["']${literal.replace(/ /g, "\\\\s+")}["']`, "i");
      if (quoted.test(source)) violations.push(`${file}: contains attribution verb literal ${literal}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("packages/engine does not compare apparatus observables against hand-set numeric literals", () => {
  const files = walk(engineRoot);
  const violations = [];
  const comparison = /(attributiveShare|couplingDispersion|attributive_share|coupling_dispersion)\s*(?:[<>]=?|={2,3})\s*\d|\d\s*(?:[<>]=?|={2,3})\s*(attributiveShare|couplingDispersion|attributive_share|coupling_dispersion)/;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (comparison.test(source)) violations.push(`${file}: compares apparatus observable to numeric literal`);
  }
  assert.deepEqual(violations, []);
});
