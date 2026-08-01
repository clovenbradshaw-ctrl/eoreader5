#!/usr/bin/env node
// audit-mutation.mjs — which of this system's numbers are actually checked?
//
// Static counting tells you how many constants exist. It cannot tell you
// whether any of them MATTER. This does: perturb each numeric constant in a
// decision position by ±25%, run the test suite, and record whether anything
// notices.
//
//   SURVIVED   the number changed and every test still passed
//              -> nothing in the system checks this value. It is an
//                 assertion, not a parameter. Changing it changes behaviour
//                 that no one has ever verified.
//   KILLED     a test failed
//              -> the value is load-bearing AND pinned. Still hand-set, but
//                 at least a regression would catch a change.
//
// The SURVIVED rate is the honest answer to "how much of this is hand-waving".
//
// Usage:  node scripts/audit-mutation.mjs <file.js> <testGlob...>

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import * as acorn from "acorn";

const [, , target, ...testArgs] = process.argv;
if (!target || !testArgs.length) {
  console.error("usage: node scripts/audit-mutation.mjs <file.js> <test paths...>");
  process.exit(1);
}

const STRUCTURAL = new Set([0, 1, -1, 2]);
const CMP_OPS = new Set([">", "<", ">=", "<=", "===", "!==", "==", "!="]);
const WEIGHT_OPS = new Set(["*", "/", "+", "-"]);

const original = readFileSync(target, "utf8");
const ast = acorn.parse(original, { ecmaVersion: 2023, sourceType: "module", locations: true });

function walk(node, fn, parent = null) {
  if (!node || typeof node.type !== "string") return;
  fn(node, parent);
  for (const k of Object.keys(node)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c === "object" && walk(c, fn, node));
    else if (v && typeof v === "object") walk(v, fn, node);
  }
}

const targets = [];
walk(ast, (n, parent) => {
  if (n.type !== "Literal" || typeof n.value !== "number") return;
  if (STRUCTURAL.has(n.value)) return;
  if (Number.isInteger(n.value) && Math.abs(n.value) > 1e5) return;
  if (!parent) return;
  const inDecision =
    (parent.type === "BinaryExpression" && (CMP_OPS.has(parent.operator) || WEIGHT_OPS.has(parent.operator))) ||
    parent.type === "AssignmentPattern" ||
    (parent.type === "VariableDeclarator");
  if (!inDecision) return;
  targets.push({ start: n.start, end: n.end, value: n.value, line: n.loc.start.line });
});

const runTests = () => {
  try {
    execSync(`node --test ${testArgs.join(" ")}`, { stdio: "pipe", timeout: 180000 });
    return true;                       // all passed
  } catch { return false; }            // something failed
};

console.log(`target: ${target}`);
console.log(`mutable decision constants: ${targets.length}`);
console.log(`tests: ${testArgs.join(" ")}\n`);

if (!runTests()) {
  console.error("baseline is already red — fix that first.");
  process.exit(1);
}
console.log("baseline green.\n");

const survived = [], killed = [];
for (const t of targets) {
  // perturb by +25% (or +1 for integers where 25% rounds to nothing)
  let mutated = t.value * 1.25;
  if (Number.isInteger(t.value) && Math.round(mutated) === t.value) mutated = t.value + 1;
  if (Number.isInteger(t.value)) mutated = Math.round(mutated);
  const patched = original.slice(0, t.start) + String(mutated) + original.slice(t.end);
  writeFileSync(target, patched);
  const green = runTests();
  (green ? survived : killed).push({ ...t, mutated });
  process.stdout.write(green ? "." : "x");
}
writeFileSync(target, original);
console.log("\n");

const n = targets.length;
console.log("─".repeat(64));
console.log(`SURVIVED (nothing noticed)  ${String(survived.length).padStart(4)}   ${(100 * survived.length / n).toFixed(1)}%`);
console.log(`KILLED   (a test noticed)   ${String(killed.length).padStart(4)}   ${(100 * killed.length / n).toFixed(1)}%`);
console.log("─".repeat(64));

if (survived.length) {
  console.log("\nunchecked constants — changing these changes behaviour no test verifies:");
  for (const s of survived) console.log(`  line ${String(s.line).padStart(4)}   ${s.value}  ->  ${s.mutated}`);
}
if (killed.length) {
  console.log("\npinned constants — load-bearing and covered:");
  for (const k of killed) console.log(`  line ${String(k.line).padStart(4)}   ${k.value}  ->  ${k.mutated}`);
}
