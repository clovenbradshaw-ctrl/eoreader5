// scripts/test-holon-level-nexrad.mjs — real-data proof for docs/holon-level.md.
//
// scripts/test-structured-nexrad.mjs already shows the engine discovers a
// states/events/phases/subModes containment ladder from the raw NEXRAD radar
// file-size series. That containment is true by construction (a phase is
// literally computed as a time-sub-segment of an event) but was never
// CONFIRMED as a genuine holon-level relation — an assumed ladder, not a
// discovered one.
//
// This script checks the confirmation `buildHolonicTree` now attaches to
// every event (packages/engine/emergence/structured/index.js's
// confirmEventLevelRelations, via emergence/holon-level/series.js):
//   - existence-dependency: does the whole series depend on this event's
//     scans more than an arbitrary same-size chunk would?
//   - possibility-constraint: does knowing you're inside this event
//     genuinely IMPROVE one-step prediction of the raw series (a real
//     predictive-competency gain, scored with the engine's proper scoring
//     rules), beyond what an arbitrary same-size "regime" would?
//
// No hand-written golden, no forced verdict: a marginal event discovering
// "peer" or "unstable" is printed and accepted, not treated as a failure.
// The one thing this DOES require: at least one major storm discovers
// "above", with the actual competency gain and the Born-null threshold it
// cleared printed — so "this helps with prediction" is a checkable number.
//
// Usage: node scripts/test-holon-level-nexrad.mjs

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildStructuredReading } from "../packages/engine/perceiver/structured/reading.js";
import { extractAllEntities } from "../packages/engine/emergence/structured/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(ROOT, "data", "nexrad-s3-listing.xml");

let failures = 0;
function check(condition, label, detail = "") {
  if (!condition) {
    failures++;
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  PASS: ${label}`);
  }
}

function main() {
  console.log("=== Holon-level discovery on real NEXRAD radar data ===\n");

  let bytes;
  try {
    bytes = readFileSync(DATA_FILE);
  } catch (e) {
    console.log(`SKIP: cannot read ${DATA_FILE}: ${e.message}`);
    process.exit(0);
  }

  console.log("1. Building structured reading + entity tree (this runs the");
  console.log("   real holon-level confirmation per discovered event)...\n");
  const reading = buildStructuredReading(bytes, { format: "s3-xml" });
  const result = extractAllEntities(reading, { minRunLength: 5, minGap: 3 });
  const events = result.tree.tree.events;

  console.log(`Discovered ${events.length} storm events. Confirming each one's`);
  console.log("relation to the whole series (never assumed from containment):\n");

  check(events.length >= 1, "at least one storm event to test", `got ${events.length}`);

  let anyAbove = false;
  let anyGap = false;
  const summaries = [];

  for (const event of events) {
    if (event.level_relation === null) {
      anyGap = true;
      console.log(`event:${event.id} (peak=${event.peak?.toFixed(0)}, length=${event.length}) — GAP: ${event.level_relation_gap}`);
      continue;
    }

    const { relation, existence, constraint } = event.level_relation;
    if (relation === "above") anyAbove = true;

    console.log(`event:${event.id} (peak=${event.peak?.toFixed(0)}, length=${event.length}, anomaly=${event.anomalyScore?.toFixed(2)})`);
    console.log(`  relation: ${relation}`);
    console.log(`  existence-dependency: passed=${existence.passed} observed=${existence.observed_degradation.toFixed(4)} threshold=${existence.null_result.threshold.toFixed(4)}`);
    console.log(`  possibility-constraint (competency gain): passed=${constraint.passed} observed=${constraint.observed_narrowing.toFixed(4)} threshold=${constraint.null_result.threshold.toFixed(4)}`);
    console.log("");

    summaries.push({ id: event.id, relation, gain: constraint.observed_narrowing, threshold: constraint.null_result.threshold });
  }

  check(anyGap === false || events.some((e) => e.level_relation !== null),
    "at least one event had enough gap-free data to confirm a relation");

  check(anyAbove, "at least one major storm event discovers 'above' — a genuine holon-level relation, not an assumed one",
    summaries.length ? `relations found: ${summaries.map((s) => `${s.id}=${s.relation}`).join(", ")}` : "no events evaluated");

  const bestAbove = summaries.filter((s) => s.relation === "above").sort((a, b) => b.gain - a.gain)[0];
  if (bestAbove) {
    console.log(`Strongest result: event:${bestAbove.id} — conditioning on this storm's regime beat the`);
    console.log(`unconditioned baseline by a competency gain of ${bestAbove.gain.toFixed(4)}, clearing the`);
    console.log(`Born-null threshold of ${bestAbove.threshold.toFixed(4)} (i.e. this measurably helped predict`);
    console.log(`the radar's next reading, beyond what an arbitrary same-size regime label would).`);
    check(bestAbove.gain > bestAbove.threshold, "the strongest discovered relation's competency gain actually clears its own threshold");
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Total failures: ${failures}`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
