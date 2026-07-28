// A11 (spec 09): no file reachable from a GATE may import a content
// classifier. A coordinate that gates is derived from a declaration; a
// coordinate inferred from content is advisory. This test is the enforcement
// — the naming convention alone is a convention, this makes it an invariant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ENGINE = resolve(import.meta.dirname, "../../engine");
const GATE_ENTRYPOINTS = ["emergence/veto/index.js"];
const FORBIDDEN = /\badvisoryClassify(Terrain|Stance|Operator)\b|\bclassifyAmplitudes\b|\bclassify\b\s*[,}]/;

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

test("A11 no file reachable from a gate imports a content classifier", () => {
  for (const entry of GATE_ENTRYPOINTS) {
    for (const file of reachable(entry)) {
      const src = readFileSync(file, "utf8");
      // strip comments: the veto's header legitimately NAMES what it removed
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const importsCube = /from\s+["'][^"']*cube\/index\.js["']/.test(code);
      assert.equal(importsCube, false,
        `${file.replace(ENGINE + "/", "")} is reachable from ${entry} and imports the cube classifier`);
      assert.equal(FORBIDDEN.test(code), false,
        `${file.replace(ENGINE + "/", "")} is reachable from ${entry} and references a content classifier`);
    }
  }
});
