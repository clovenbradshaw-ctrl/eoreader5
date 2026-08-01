// conformance/invariants/convergence-firewall.test.js
//
// Verify that convergence scores (from ConvergenceWitness and
// CrossEngineWitness) do NOT feed into any optimization, ranking,
// or motivation path. Convergence is witness-only — it annotates
// post-selection, never gates or ranks.
//
// The architectural rule (closed-loop spec item #3):
//   Convergence witnesses are @audit-surface-only. No convergence
//   summary field may reach any optimizer input path. Scoring a
//   candidate by its convergence would corrupt the independence
//   that makes convergence meaningful — "I should select this
//   passage because other engines converged on it" is optimization,
//   not witnessing.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENGINE = join(ROOT, "packages", "engine");

function readLines(relPath) {
  return readFileSync(join(ENGINE, relPath), "utf-8").split("\n");
}

// ── The ranking modules must not import convergence ──

test("multiAltitudeFold ranking path does not import convergence before the ananda post-pass", () => {
  const lines = readLines("emergence/summary/multi-altitude-fold.js");

  // The ananda witness post-pass starts at line ~428 with "// 11. Ananda (joy) witness"
  // Everything before that is the ranking/selection path.
  let anandaStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Ananda (joy) witness — post-pass")) {
      anandaStart = i;
      break;
    }
  }

  assert(anandaStart > 0, "ananda witness post-pass marker not found — verify line exists");

  // ConvergenceWitness is imported at the top but must only be used after the post-pass
  const convergenceUseLines = [];
  for (let i = 0; i < anandaStart; i++) {
    const line = lines[i];
    if (line.includes("import") && line.includes("ConvergenceWitness")) continue;
    if (line.includes("ConvergenceWitness") || line.includes("convergenceWitness")) {
      // Only flag lines that are actual computation (not destructuring or comments)
      const trimmed = line.trim();
      if (trimmed.startsWith("//")) continue;
      if (trimmed.includes("= null") && (trimmed.includes("convergenceWitness") || trimmed.includes("ConvergenceWitness"))) continue;
      convergenceUseLines.push(`L${i + 1}: ${trimmed}`);
    }
  }

  assert.deepStrictEqual(convergenceUseLines, [],
    `ConvergenceWitness used before ananda post-pass (lines before L${anandaStart + 1}):\n${convergenceUseLines.join("\n")}`);
});

// ── Spine must not import convergence ──

test("significance spine does not import convergence modules", () => {
  const spine = readFileSync(join(ENGINE, "emergence/summary/spine.js"), "utf-8");
  assert(!spine.includes("ConvergenceWitness"), "spine.js imports ConvergenceWitness");
  assert(!spine.includes("convergence"), "spine.js references convergence");
});

test("resonance spine does not import cross-engine convergence", () => {
  const rspine = readFileSync(join(ENGINE, "emergence/summary/resonance-spine.js"), "utf-8");
  // resonance-spine uses computeResonanceScore from discourse/resonance.js,
  // but must not import ConvergenceWitness or CrossEngineWitness
  const lines = rspine.split("\n");
  for (const line of lines) {
    if (line.includes("import") && (line.includes("ConvergenceWitness") || line.includes("CrossEngineWitness"))) {
      assert.fail(`resonance-spine imports convergence witness: ${line.trim()}`);
    }
  }
});

// ── Motivation field must not import convergence ──

test("computeMotivationField does not reference convergence", () => {
  const selfModule = readFileSync(join(ENGINE, "self/index.js"), "utf-8");

  // computeMotivationField uses convergenceTrend (delta trend) but NOT
  // ConvergenceWitness (lens-pair convergence). The distinction matters:
  // delta trend is the collective's OWN convergence toward truth, while
  // ConvergenceWitness is inter-lens agreement. The latter must not feed
  // the motivation path.
  assert(!selfModule.includes("ConvergenceWitness"),
    "self/index.js imports ConvergenceWitness — cross-lens convergence must not feed motivation");
});

// ── Store must not import convergence ──

test("associative memory store does not reference convergence", () => {
  const store = readFileSync(join(ENGINE, "emergence/store/index.js"), "utf-8");
  assert(!store.includes("convergence"), "store/index.js references convergence");
});

// ── Cube must not import convergence ──

test("cube classifier does not reference convergence", () => {
  const cube = readFileSync(join(ENGINE, "cube/index.js"), "utf-8");
  assert(!cube.includes("convergence"), "cube/index.js references convergence");
});

// ── Verify that the ananda witness layer is strictly post-selection ──

test("ananda witness is applied after altitude layers are built in multiAltitudeFold", () => {
  const lines = readLines("emergence/summary/multi-altitude-fold.js");

  let altitudeBuildStart = -1;
  let anandaWitnessStart = -1;
  let returnStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Build altitude layers")) altitudeBuildStart = i;
    if (lines[i].includes("Ananda (joy) witness — post-pass")) anandaWitnessStart = i;
    if (lines[i].includes("return Object.freeze({") && lines[i].includes("altitudes")) returnStart = i;
  }

  assert(altitudeBuildStart > 0, "altitude build marker not found");
  assert(anandaWitnessStart > 0, "ananda witness marker not found");

  // Altitude layers must be built BEFORE ananda witness runs
  assert(altitudeBuildStart < anandaWitnessStart,
    `altitude build (L${altitudeBuildStart + 1}) must come before ananda witness (L${anandaWitnessStart + 1})`);

  // Ananda witness must be before the return
  if (returnStart > 0) {
    assert(anandaWitnessStart < returnStart,
      `ananda witness (L${anandaWitnessStart + 1}) must come before return (L${returnStart + 1})`);
  }
});
