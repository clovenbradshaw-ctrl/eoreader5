// Host boundary gate: nothing outside this repo may reach into
// packages/engine or packages/spec by relative filesystem path.
//
// The engine declares a curated `exports` map. Before this test, every
// consumer ignored it and imported like:
//
//     import { search } from "../../eoreader5/packages/engine/search/index.js";
//
// which makes the DIRECTORY LAYOUT the de facto API — rename a folder and four
// external repos break — and grants access to modules the package never
// exported (`observation-index.js` was imported by three consumers while
// appearing nowhere in `exports`).
//
// The concrete cost was not hypothetical. Each host also hand-rolled its own
// `ObservationBlock@1` construction, the copies drifted, and
// `eoreader-mcp/lib/engine-bridge.js` sat on a `byte_start: 0` bug that
// `eoreader-proxy` had already found and fixed — so quotes from the MCP server
// could not be verified against their source files at all.
//
// The supported entry points are the package specifiers:
//   @eoreader/host/corpus   — admit text, search, read spans verbatim, fold
//   @eoreader/engine/...    — only paths named in the engine's exports map
//
// Sibling consumers live outside this repo, so this test scans the workspace
// directory that contains eoreader5 when it is present and skips cleanly when
// it is not (CI checkouts of this repo alone). Skipping is honest here: the
// rule is enforced wherever the consumers actually exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", ".."); // .../eoreader5
const workspaceRoot = join(repoRoot, "..");

// Product hosts known to link against this engine. Directories that are
// absent are simply not checked.
//
// `harness/` is deliberately NOT listed. Those are research probes that drive
// individual organs — presence.js, text-organ.js, entity-fold.js — to measure
// them. Several of those organs are not in the engine's exports map at all,
// which is correct: a probe studying an organ is a different relationship than
// a host consuming a product surface, and routing probes through a corpus
// facade would defeat their purpose. If a probe's import ever becomes load-
// bearing for a shipped path, it belongs in the exports map and in this list.
const CONSUMER_DIRS = [
  "eoreader-proxy",
  "eoreader-mcp",
  "eoreader-chat",
  "eoreaderapp",
  "eoInsights",
];

const SKIP_DIRS = new Set(["node_modules", ".git", "_archive", "dist", "build", "coverage"]);

// Any relative specifier that tunnels into this repo's package internals.
const DEEP_IMPORT = /['"][^'"]*eoreader5\/packages\/(engine|spec)\/[^'"]*['"]/;

function walkJs(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) walkJs(full, out);
      else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(full);
    } catch {
      // Unreadable entry — not this test's business.
    }
  }
  return out;
}

function offendingLines(file) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const hits = [];
  source.split("\n").forEach((line, i) => {
    // Only import/require sites, so prose in a comment explaining the rule
    // (including this file's own header) is not itself a violation.
    if (!/\b(import|require)\b/.test(line)) return;
    if (DEEP_IMPORT.test(line)) hits.push(`${relative(workspaceRoot, file)}:${i + 1}: ${line.trim()}`);
  });
  return hits;
}

const presentConsumers = CONSUMER_DIRS
  .map((name) => join(workspaceRoot, name))
  .filter((dir) => existsSync(dir) && statSync(dir).isDirectory());

test("no consumer imports engine or spec internals by relative path", (t) => {
  if (presentConsumers.length === 0) {
    t.skip("no sibling consumer repos in this checkout");
    return;
  }

  const violations = presentConsumers
    .flatMap((dir) => walkJs(dir))
    .flatMap((file) => offendingLines(file));

  assert.deepEqual(
    violations,
    [],
    `Consumers must import via package specifiers, not filesystem paths.\n` +
      `Use @eoreader/host/corpus for admit/search/span/fold; it owns the\n` +
      `ObservationBlock@1 construction these call sites used to duplicate.\n\n` +
      violations.join("\n"),
  );
});

test("the corpus adapter is the only host-facing admission path", (t) => {
  if (presentConsumers.length === 0) {
    t.skip("no sibling consumer repos in this checkout");
    return;
  }

  // A host constructing ObservationBlock@1 itself is re-forking the schema —
  // the precise failure that produced four divergent copies.
  const violations = presentConsumers
    .flatMap((dir) => walkJs(dir))
    .flatMap((file) => {
      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        return [];
      }
      // Match the CONSTRUCTION site (`schema: "ObservationBlock@1"`), not any
      // mention — the migrated hosts name the schema in comments explaining
      // why they no longer build it, and those must not trip the gate.
      const hits = [];
      source.split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // comment line
        if (/\bschema\s*:\s*['"]ObservationBlock@1['"]/.test(line)) {
          hits.push(`${relative(workspaceRoot, file)}:${i + 1}: constructs ObservationBlock@1 directly`);
        }
      });
      return hits;
    });

  assert.deepEqual(
    violations,
    [],
    `Schema construction belongs to @eoreader/host/corpus, not to hosts.\n` +
      `admitText/admitChunked build the block; a host that builds its own will\n` +
      `drift (see the byte_start:0 regression in engine-bridge.js).\n\n` +
      violations.join("\n"),
  );
});
