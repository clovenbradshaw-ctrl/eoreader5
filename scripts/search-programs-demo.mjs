// Phase 2 demo (spec "EO Emergent Mathematics for Predictive Competency"
// sections 14 and 29.5): bounded typed program search that *rediscovers* useful
// numeric transforms by competency, not by name. It enumerates programs over
// the Section 29 kernel, scores each one prequentially (commit-before-reveal)
// against the standard baselines, and prints the competency-ranked frontier.
//
// Exit criterion touched (Phase 2 / §28): the system rediscovers useful
// arithmetic and sequence transforms on synthetic held-out prediction tasks —
// e.g. a persistence/drift structure on a trending series — and ranks them
// above the global-mean reference by measured competency, not by name. What
// wins is whatever the data rewards under the leakage-safe protocol; the demo
// reports that verdict rather than asserting a particular structure in advance.

import { searchCompetentPrograms } from "@eoreader/engine/emergence/programs";
import { createSeededRng } from "@eoreader/engine";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

function makeSeries({ seed, length, base, slope, amp, period }) {
  const rng = createSeededRng(seed);
  return Array.from({ length }, (_, t) =>
    base + slope * t + amp * Math.sin((2 * Math.PI * t) / period) + (rng() - 0.5)
  );
}

function render(name, series, opts) {
  const ranked = searchCompetentPrograms(series, { population: name, ...opts });
  console.log(`\n=== ${name} (${ranked.length} programs searched, scored by CRPS) ===`);
  for (const r of ranked.slice(0, 5)) {
    console.log(
      `  utility=${r.utility.toFixed(3)}  gainVsMean=${r.reference_gain.toFixed(3)}  dl=${r.description_length}  ${JSON.stringify(r.program)}`
    );
  }
  return ranked;
}

export function runSearchDemo() {
  const trend = makeSeries({ seed: "trend", length: 40, base: 3, slope: 2, amp: 0.4, period: 6 });
  const seasonal = makeSeries({ seed: "seasonal", length: 40, base: 50, slope: 0, amp: 10, period: 6 });
  return {
    trend: render("series:trend", trend, { enumeration: { maxPrograms: 80 } }),
    seasonal: render("series:seasonal", seasonal, { enumeration: { maxPrograms: 80, lags: [1, 6] }, seasonalPeriod: 6 }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = runSearchDemo();
  const b = runSearchDemo();
  const deterministic = canonicalHashSync(a.trend.map((r) => r.key)) === canonicalHashSync(b.trend.map((r) => r.key));
  console.log(`\ndeterministic replay (winning frontier stable): ${deterministic}`);
  if (!deterministic) process.exitCode = 1;
}
