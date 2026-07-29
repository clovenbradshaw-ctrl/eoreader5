#!/usr/bin/env node
// SELF-GENERATING HOLON DISCOVERY — practical edition v3.
//
// The holon mechanism knows nothing about NL. It sees only the cube
// amplitude stream. Pipeline:
//   1. Frame text → classify through cube → 27 amplitude series
//   2. For each key series: DEF finds natural states → contiguous runs
//   3. Top runs (by peak × log1p(length)) → full holon test:
//      existence-dependency + possibility-constraint (Born-null gated)
//   4. Events clearing both gates → genuine holons above background
//
// Usage: node scripts/experiment-holon-self-generating.mjs [--bible-only|--wp-only]

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

import { frameText } from "../packages/engine/emergence/summary/text-organ.js";
import { classifyAmplitudes } from "../packages/engine/cube/index.js";
import { detectModes, findStateRuns } from "../packages/engine/emergence/states/index.js";
import { discoverSeriesLevelRelation } from "../packages/engine/emergence/holon-level/series.js";

// ── Data prep ────────────────────────────────────────────────────────

function buildSeries(frames) {
  const s = { dominant: new Float64Array(frames.length) };
  const cats = [
    ["NUL","SEG","DEF","SIG","CON","EVA","INS","SYN","REC"],
    ["Void","Entity","Kind","Field","Link","Network","Atmosphere","Lens","Paradigm"],
    ["Clearing","Dissecting","Unraveling","Tending","Binding","Tracing","Cultivating","Making","Composing"],
  ];
  for (const g of cats) for (const l of g) s[l] = new Float64Array(frames.length);

  for (let i = 0; i < frames.length; i++) {
    const amps = classifyAmplitudes(frames[i].text);
    for (const { label, amplitude } of amps.operator) s[label][i] = amplitude;
    for (const { label, amplitude } of amps.terrain) s[label][i] = amplitude;
    for (const { label, amplitude } of amps.stance) s[label][i] = amplitude;
    s["dominant"][i] = (amps.operator[0].amplitude + amps.terrain[0].amplitude + amps.stance[0].amplitude) / 3;
  }
  return s;
}

function excerpts(frames) {
  return frames.map(f => f.text.slice(0, 90).replace(/\n/g, " ").trim());
}

// ── Holon discovery ──────────────────────────────────────────────────

function discoverHolons(values, name, excerpts, frames, opts = {}) {
  const { minRun = 2, maxTest = 6, perms = 20 } = opts;
  if (values.length < 10) return null;

  const modes = detectModes(values, { maxK: 5 });
  if (modes.k <= 1) {
    console.log(`  ${name}: only ${modes.k} state — nothing to discover`);
    return null;
  }

  // Find runs in all non-baseline states
  const eventStates = [...Array(modes.k).keys()].filter(i => i !== 0);
  const positions = values.map((_, i) => i);
  const allRuns = findStateRuns(modes.labels, positions, [...values], { minRunLength: minRun, eventStates });

  if (allRuns.length === 0) {
    // Try without state filter — just use any non-baseline run
    const runs2 = findStateRuns(modes.labels, positions, [...values], { minRunLength: minRun });
    const nonBaseline = runs2.filter(r => r.state !== 0);
    if (nonBaseline.length === 0) {
      console.log(`  ${name}: no non-baseline runs (k=${modes.k} but runs all state 0)`);
      return null;
    }
    // Score by peak amplitude × log1p(length)
    const scored = nonBaseline.map(r => ({ ...r, score: (r.max ?? r.peak ?? 0) * Math.log1p(r.length) }));
    const candidates = scored.sort((a, b) => b.score - a.score).slice(0, maxTest);
    return runFullTest(values, candidates, name, excerpts, perms);
  }

  // Score by peak × log1p(length) — high intensity + duration
  const scored = allRuns.map(r => ({ ...r, score: (r.max ?? r.peak ?? 0) * Math.log1p(r.length) }));
  const candidates = scored.sort((a, b) => b.score - a.score).slice(0, maxTest);
  return runFullTest(values, candidates, name, excerpts, perms);
}

function runFullTest(values, candidates, name, excerpts, perms) {
  console.log(`  ${name}: ${candidates.length} candidates (${perms} permutations each)`);

  const confirmed = [];
  for (let i = 0; i < candidates.length; i++) {
    const ev = { ...candidates[i], id: i };
    const idxs = [];
    for (let j = ev.startIndex; j <= ev.endIndex; j++) {
      if (typeof values[j] === "number" && Number.isFinite(values[j])) idxs.push(j);
    }
    if (idxs.length < 2 || values.length < idxs.length + 4) {
      confirmed.push({ ...ev, level_relation: null, level_relation_gap: "insufficient data" });
      continue;
    }
    try {
      const lr = discoverSeriesLevelRelation({ series: [...values], candidateIndices: idxs, permutations: perms, quantile: 0.95 });
      confirmed.push({ ...ev, level_relation: lr });
    } catch (e) {
      confirmed.push({ ...ev, level_relation: null, level_relation_gap: e.message });
    }
  }

  const above = confirmed.filter(e => e.level_relation?.relation === "above");
  const peers = confirmed.filter(e => e.level_relation?.relation === "peer");
  const unstable = confirmed.filter(e => e.level_relation?.relation === "unstable");
  const gaps = confirmed.filter(e => e.level_relation === null);

  console.log(`  Tested: ${confirmed.length}  |  Above: ${above.length}  |  Peer: ${peers.length}  |  Unstable: ${unstable.length}  |  Gaps: ${gaps.length}`);

  for (const ev of above) {
    const lr = ev.level_relation;
    const start = excerpts[ev.startIndex] ?? "";
    const g = lr.constraint?.observed_narrowing?.toFixed(3) ?? "?";
    const t = lr.constraint?.null_result?.threshold?.toFixed(3) ?? "?";
    console.log(`\n  ★ ABOVE  event:${ev.id}  frames [${ev.startIndex}–${ev.endIndex}] (${ev.length}f)  score=${ev.score.toFixed(3)}`);
    console.log(`    existence: ${lr.existence.passed} (obs=${lr.existence.observed_degradation.toFixed(4)} null=${lr.existence.null_result.threshold.toFixed(4)})`);
    console.log(`    constraint: ${lr.constraint?.passed} (gain=${g} null=${t})`);
    console.log(`    "${start.slice(0, 70)}..."`);
  }

  for (const ev of peers.slice(0, 3)) {
    const start = excerpts[ev.startIndex] ?? "";
    console.log(`  · peer  event:${ev.id}  [${ev.startIndex}–${ev.endIndex}] (${ev.length}f)  "${start.slice(0, 50)}..."`);
  }

  return { name, confirmed, above: above.length, peers: peers.length, unstable: unstable.length, gaps: gaps.length };
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const doWp = !args.includes("--bible-only");
  const doBible = !args.includes("--wp-only");

  const texts = [];
  if (doWp) texts.push({ label: "WAR AND PEACE", path: "/Users/mlacy/Downloads/pg2600.txt" });
  if (doBible) texts.push({ label: "KING JAMES BIBLE", path: "/Users/mlacy/Downloads/pg10.txt" });

  console.log("SELF-GENERATING HOLON DISCOVERY");
  console.log("═".repeat(72));
  console.log("The engine has zero NL priors. It sees only 27-dim amplitude");
  console.log("streams per 2000-char frame. It discovers its own states (DEF),");
  console.log("its own events (contiguous state runs), and tests each event");
  console.log("against Born-null-gated existence-dependency + possibility-");
  console.log("constraint. Events that clear both are genuine holons.");
  console.log("");

  for (const { label, path } of texts) {
    process.stderr.write(`${label}...`);
    const raw = readFileSync(path, "utf8");
    const fr = frameText(raw);
    const ex = excerpts(fr);
    const s = buildSeries(fr);
    process.stderr.write(` ${fr.length} frames, ${raw.length.toLocaleString()} chars\n`);

    console.log(`\n${label}`);
    console.log("─".repeat(60));

    const targets = [
      ["Entity", "Entity amplitude (character focus)"],
      ["Atmosphere", "Atmosphere amplitude (emotion/mood)"],
      ["REC", "REC amplitude (recontextualisation)"],
      ["Cultivating", "Cultivating amplitude (growth/realisation)"],
      ["EVA", "EVA amplitude (evaluation/judgment)"],
      ["dominant", "Dominant-cell composite amplitude"],
      ["Network", "Network amplitude (social/political)"],
    ];

    const allResults = [];
    for (const [key, name] of targets) {
      const vals = s[key];
      if (!vals) continue;
      const minRun = Math.max(2, Math.floor(fr.length / 300));
      const result = discoverHolons(vals, name, ex, fr, { minRun, maxTest: 5, perms: 15 });
      if (result) allResults.push(result);
      console.log("");
    }

    if (allResults.length > 0) {
      console.log("── SYNTHESIS ──");
      for (const r of allResults) {
        const pct = r.confirmed.length > 0 ? ` (${((r.above / r.confirmed.length) * 100).toFixed(0)}%)` : "";
        console.log(`  ${r.name.padEnd(42)} ${r.above}/${r.confirmed.length} above${pct}`);
      }
    }
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log("Done. No NL assumptions used.");
}
main();
