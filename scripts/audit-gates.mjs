#!/usr/bin/env node
// audit-gates.mjs — of the decisions this system actually MAKES, how many
// does it set its own number for?
//
// audit-derivation.mjs counts every decision-position literal, which
// overstates: a codec constant or a JSON indent width is not hand-waving.
// This pass narrows to GATES — functions that admit, promote, veto, accept,
// reject, or declare something significant — and asks two questions of each:
//
//   1. does its threshold come from a literal, or from the data?
//   2. does its file consult emergence/nulls at all?
//
// A gate with a hardcoded threshold and no null is an assertion wearing a
// number. That is the population we want counted.
//
// Usage:  node scripts/audit-gates.mjs [rootDir]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import * as acorn from "acorn";

const ROOT = process.argv[2] ?? "packages";
const SKIP = new Set(["node_modules", ".git", "dist", "build", "archive", "golden"]);

// a function is a GATE if its name says it decides admission or significance
const GATE_NAME = /^(is|has|can|should|must|check|validate|verify|assert|admit|accept|reject|refuse|veto|gate|promote|supersede|qualif|pass|fail|meets|exceeds|sufficient|significant|detect|select|filter|threshold|clear)/i;
const GATE_NAME_MID = /(Gate|Veto|Threshold|Admit|Promote|Accept|Reject|Significan|Qualif|Eligib)/;

const NULL_IMPORT = /from\s+["'][^"']*emergence\/nulls[^"']*["']|\b(deriveNull|extremeValueNull|boundedNull|seededShuffle|extremeValueZ)\b/;
const DERIVE_ON_LINE = /\b(quantile|percentile|median|mean|stdev|std|variance|mad|iqr|deriveNull|extremeValueNull|boundedNull|induce\w*|estimate\w*|calibrat\w*|floor\w*From|fromData)\b/i;

const STRUCTURAL = new Set([0, 1, -1, 2]);
const CMP_OPS = new Set([">", "<", ">=", "<=", "===", "!==", "==", "!="]);

function files(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e), st = statSync(p);
    if (st.isDirectory()) files(p, out);
    else if (extname(p) === ".js" && !p.endsWith(".test.js")) out.push(p);
  }
  return out;
}
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
const nameOf = (n, parent) =>
  n.id?.name ??
  (parent?.type === "VariableDeclarator" && parent.id?.type === "Identifier" ? parent.id.name : null) ??
  (parent?.type === "Property" && parent.key?.name ? parent.key.name : null) ??
  (parent?.type === "MethodDefinition" && parent.key?.name ? parent.key.name : null);

const gates = [];
for (const file of files(ROOT)) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 2023, sourceType: "module", locations: true }); }
  catch { continue; }
  const fileHasNull = NULL_IMPORT.test(src);

  walk(ast, (n, parent) => {
    if (!/Function(Declaration|Expression)|ArrowFunctionExpression/.test(n.type)) return;
    const name = nameOf(n, parent);
    if (!name || !(GATE_NAME.test(name) || GATE_NAME_MID.test(name))) return;

    // collect literal thresholds inside this function's comparisons
    const lits = [];
    walk(n, (m, mp) => {
      if (m.type !== "Literal" || typeof m.value !== "number") return;
      if (STRUCTURAL.has(m.value)) return;
      if (!mp || mp.type !== "BinaryExpression" || !CMP_OPS.has(mp.operator)) return;
      const lineTxt = lines[m.loc.start.line - 1] ?? "";
      lits.push({ value: m.value, line: m.loc.start.line, derived: DERIVE_ON_LINE.test(lineTxt) });
    });
    // does the gate receive its threshold as a parameter (caller-supplied)?
    const params = (n.params ?? []).map((p) =>
      p.type === "Identifier" ? p.name :
      p.type === "AssignmentPattern" && p.left.type === "Identifier" ? p.left.name :
      p.type === "ObjectPattern" ? p.properties.map((q) => q.key?.name).filter(Boolean).join(",") : "");
    const paramised = /threshold|alpha|floor|cutoff|min|max|tol|epsilon|k\b/i.test(params.join(","));

    gates.push({
      file: relative(process.cwd(), file),
      name,
      line: n.loc.start.line,
      hardcoded: lits.filter((l) => !l.derived).length,
      derived: lits.filter((l) => l.derived).length,
      paramised,
      fileHasNull,
    });
  });
}

// ── report ──────────────────────────────────────────────────────────────
const N = gates.length;
const hard = gates.filter((g) => g.hardcoded > 0);
const clean = gates.filter((g) => g.hardcoded === 0 && (g.derived > 0 || g.paramised));
const noThreshold = gates.filter((g) => g.hardcoded === 0 && g.derived === 0 && !g.paramised);
const withNull = gates.filter((g) => g.fileHasNull);
const hardNoNull = gates.filter((g) => g.hardcoded > 0 && !g.fileHasNull);

console.log("═".repeat(76));
console.log("GATE AUDIT — of the decisions this system makes, how many set their own number");
console.log("═".repeat(76));
console.log(`gate-shaped functions found: ${N}\n`);
console.log(`  hardcoded threshold          ${String(hard.length).padStart(4)}   ${(100 * hard.length / N).toFixed(1)}%`);
console.log(`  derived or caller-supplied   ${String(clean.length).padStart(4)}   ${(100 * clean.length / N).toFixed(1)}%`);
console.log(`  no numeric threshold at all  ${String(noThreshold.length).padStart(4)}   ${(100 * noThreshold.length / N).toFixed(1)}%\n`);
console.log(`  in a file that consults emergence/nulls   ${String(withNull.length).padStart(4)}   ${(100 * withNull.length / N).toFixed(1)}%`);
console.log(`  HARDCODED **AND** NO NULL IN THE FILE     ${String(hardNoNull.length).padStart(4)}   ${(100 * hardNoNull.length / N).toFixed(1)}%`);
console.log(`     ^ an assertion wearing a number\n`);

console.log("── every hardcoded gate with no null, worst first ──");
console.log("consts  gate                                        file:line");
for (const g of hardNoNull.sort((a, b) => b.hardcoded - a.hardcoded).slice(0, 30)) {
  console.log(`${String(g.hardcoded).padStart(6)}  ${g.name.slice(0, 42).padEnd(42)}  ${g.file}:${g.line}`);
}

console.log("\n── null-module adoption, by directory ──");
const byDir = new Map();
for (const g of gates) {
  const d = g.file.split("/").slice(0, 4).join("/");
  if (!byDir.has(d)) byDir.set(d, { n: 0, withNull: 0, hard: 0 });
  const b = byDir.get(d); b.n++; if (g.fileHasNull) b.withNull++; if (g.hardcoded > 0) b.hard++;
}
console.log("directory                                     gates  w/null  hardcoded");
for (const [d, b] of [...byDir].sort((a, b) => b[1].hard - a[1].hard).slice(0, 18)) {
  console.log(`${d.slice(0, 44).padEnd(44)}  ${String(b.n).padStart(5)}  ${String(b.withNull).padStart(6)}  ${String(b.hard).padStart(9)}`);
}
