#!/usr/bin/env node
// audit-derivation.mjs — how much of this system sets its own numbers?
//
// Walks every non-test source file and classifies each numeric constant that
// sits in a DECISION POSITION (a comparison, a threshold, a weight, a cap, a
// default parameter) onto a derivation ladder:
//
//   T0  magic      bare literal in a decision, no name, no derivation
//   T1  declared   named module-level constant — still hand-set, but visible
//   T2  derived    the value comes from the data at runtime (quantile, mean,
//                  sd, percentile of an observed distribution)
//   T3  null-gated derived AND the module validates against a null /
//                  permutation / effect-size floor
//
// T0 and T1 are hand-set. T2 and T3 are self-generating. The ratio is the
// answer to "how much of this is hand-waving".
//
// Deliberately conservative: structural literals (0, 1, -1, 2, array indices,
// loop bounds, string/comment contents, version numbers, schema tags) are
// excluded, so the T0 count is a FLOOR, not a ceiling.
//
// Usage:  node scripts/audit-derivation.mjs [rootDir]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import * as acorn from "acorn";

const ROOT = process.argv[2] ?? "packages";
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "archive", "golden"]);

// ── markers ─────────────────────────────────────────────────────────────
// A value is DERIVED if it is produced by one of these at runtime.
const DERIVE_FNS = /\b(quantile|percentile|median|mean|stdev|stddev|std|variance|mad|iqr|histogram|otsu|kneedle|elbow|threshold(From|Of)|derive\w*|induce\w*|fit\w*|estimate\w*|calibrat\w*)\b/i;
// A module is NULL-GATED if it compares against a chance background.
const NULL_MARKERS = /\b(permut\w*|shuffle\w*|circularShift|nullModel|deriveNull|extremeValueNull|bootstrap|montecarlo|monteCarlo|chanceLevel|effectFloor|effectSize|bonferroni)\b/i;

const STRUCTURAL = new Set([0, 1, -1, 2, 100, 1000]);   // indices, halves, percent, ms

// decision-position parent node types
const CMP = new Set(["BinaryExpression", "LogicalExpression", "ConditionalExpression"]);
const CMP_OPS = new Set([">", "<", ">=", "<=", "===", "!==", "==", "!="]);
const WEIGHT_OPS = new Set(["*", "/", "+", "-", "**"]);

function walkFiles(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (extname(p) === ".js" && !p.endsWith(".test.js")) out.push(p);
  }
  return out;
}

/** minimal recursive AST walk with parent tracking */
function walk(node, fn, parent = null, key = null) {
  if (!node || typeof node.type !== "string") return;
  fn(node, parent, key);
  for (const k of Object.keys(node)) {
    if (k === "type" || k === "start" || k === "end") continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c === "object" && walk(c, fn, node, k));
    else if (v && typeof v === "object") walk(v, fn, node, k);
  }
}

const results = [];
for (const file of walkFiles(ROOT)) {
  const src = readFileSync(file, "utf8");
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 2023, sourceType: "module", locations: true }); }
  catch { continue; }

  const fileIsNullGated = NULL_MARKERS.test(src);
  const fileHasDerive = DERIVE_FNS.test(src);
  const hits = [];

  walk(ast, (n, parent, key) => {
    if (n.type !== "Literal" || typeof n.value !== "number") return;
    const v = n.value;
    if (STRUCTURAL.has(v)) return;
    if (Number.isInteger(v) && Math.abs(v) > 1e5) return;      // ids, hashes, seeds

    let position = null;
    if (parent && CMP.has(parent.type) && CMP_OPS.has(parent.operator)) position = "comparison";
    else if (parent && parent.type === "BinaryExpression" && WEIGHT_OPS.has(parent.operator)) position = "weight";
    else if (parent && parent.type === "AssignmentPattern") position = "default-param";
    else if (parent && parent.type === "Property" && !parent.computed) position = "config";
    else if (parent && parent.type === "VariableDeclarator") position = "const";
    else if (parent && parent.type === "CallExpression" &&
             /\b(min|max|clamp|round|toFixed|slice|repeat)\b/.test(src.slice(parent.callee.start, parent.callee.end))) position = "cap";
    if (!position) return;
    if (position === "const" && parent.id?.type === "Identifier" && /^[A-Z0-9_]+$/.test(parent.id.name)) position = "declared-const";

    // classify
    let tier;
    if (position === "declared-const") tier = "T1";
    else tier = "T0";

    hits.push({ line: n.loc.start.line, value: v, position, tier });
  });

  // a file whose decision values come from derive fns gets its T0s reclassified
  // only where the literal is an ARGUMENT to a derivation (e.g. quantile(x, 0.95))
  for (const h of hits) {
    const lineTxt = src.split("\n")[h.line - 1] ?? "";
    if (DERIVE_FNS.test(lineTxt)) h.tier = fileIsNullGated ? "T3" : "T2";
  }

  results.push({
    file: relative(process.cwd(), file),
    nullGated: fileIsNullGated,
    hasDerive: fileHasDerive,
    hits,
  });
}

// ── report ──────────────────────────────────────────────────────────────
const tally = { T0: 0, T1: 0, T2: 0, T3: 0 };
for (const r of results) for (const h of r.hits) tally[h.tier] += 1;
const total = Object.values(tally).reduce((a, b) => a + b, 0);
const handset = tally.T0 + tally.T1;
const selfgen = tally.T2 + tally.T3;

console.log("═".repeat(74));
console.log("DERIVATION AUDIT — how many of this system's decision numbers it sets itself");
console.log("═".repeat(74));
console.log(`files scanned (non-test): ${results.length}`);
console.log(`decision constants found: ${total}\n`);
console.log(`  T0 magic       ${String(tally.T0).padStart(5)}   bare literal in a decision`);
console.log(`  T1 declared    ${String(tally.T1).padStart(5)}   named constant, still hand-set`);
console.log(`  T2 derived     ${String(tally.T2).padStart(5)}   computed from the data`);
console.log(`  T3 null-gated  ${String(tally.T3).padStart(5)}   computed AND validated against a null`);
console.log(`  ${"─".repeat(50)}`);
console.log(`  HAND-SET       ${String(handset).padStart(5)}   ${(100 * handset / total).toFixed(1)}%`);
console.log(`  SELF-GENERATING${String(selfgen).padStart(5)}   ${(100 * selfgen / total).toFixed(1)}%\n`);

console.log("── by package ──");
const byPkg = new Map();
for (const r of results) {
  const pkg = r.file.split("/").slice(0, 2).join("/");
  if (!byPkg.has(pkg)) byPkg.set(pkg, { T0: 0, T1: 0, T2: 0, T3: 0, files: 0, nullGated: 0 });
  const b = byPkg.get(pkg); b.files++; if (r.nullGated) b.nullGated++;
  for (const h of r.hits) b[h.tier]++;
}
console.log("package                    files  null-gated    T0    T1    T2    T3   self-gen%");
for (const [pkg, b] of [...byPkg].sort((a, b) => (b[1].T0 + b[1].T1) - (a[1].T0 + a[1].T1))) {
  const t = b.T0 + b.T1 + b.T2 + b.T3;
  console.log(`${pkg.padEnd(26)} ${String(b.files).padStart(5)}  ${String(b.nullGated).padStart(5)}/${String(b.files).padEnd(4)} ${String(b.T0).padStart(5)} ${String(b.T1).padStart(5)} ${String(b.T2).padStart(5)} ${String(b.T3).padStart(5)}   ${t ? (100 * (b.T2 + b.T3) / t).toFixed(0) : "0"}%`);
}

console.log("\n── worst offenders: most hand-set decision numbers, no null in the file ──");
const worst = results
  .map((r) => ({ ...r, hand: r.hits.filter((h) => h.tier === "T0" || h.tier === "T1").length }))
  .filter((r) => r.hand > 0 && !r.nullGated)
  .sort((a, b) => b.hand - a.hand)
  .slice(0, 15);
console.log("hand-set  file");
for (const r of worst) console.log(`${String(r.hand).padStart(8)}  ${r.file}`);

console.log("\n── the good news: files that derive AND null-gate ──");
for (const r of results.filter((r) => r.nullGated && r.hasDerive)) {
  const t3 = r.hits.filter((h) => h.tier === "T3").length;
  const hand = r.hits.filter((h) => h.tier === "T0" || h.tier === "T1").length;
  console.log(`  ${r.file.padEnd(58)} T3 ${String(t3).padStart(3)}  still-hand-set ${hand}`);
}
