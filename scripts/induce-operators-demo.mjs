// The REC -> INS seam as a running helix (spec "EO Emergent Mathematics for
// Predictive Competency" sections 11.2, 15.3, and the section 11 recursion).
//
// One pass of the nine operators ends at REC; here REC restructures the search
// grammar by minting a competent composition as a reusable operator, which
// re-enters the next pass as a cost-1 INS primitive. The demo runs that loop on
// a hierarchical (trend + seasonal) series and prints each promoted operator,
// the lens it won under, the born-null it cleared, and whether it was built
// atop an earlier operator — the recursion made visible.
//
// It decides nothing beyond what the data rewards: every operator clears a
// held-out transfer gate (invariant 7.6) and a shuffle-derived null
// (section 12.8). Structureless noise promotes nothing.

import { induceOperators } from "@eoreader/engine/emergence/operators";
import { createSeededRng } from "@eoreader/engine";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

function series(seed, length, { base, slope, amp, period }) {
  const rng = createSeededRng(seed);
  return Array.from({ length }, (_, t) => base + slope * t + amp * Math.sin((2 * Math.PI * t) / period) + (rng() - 0.5));
}

function short(program) {
  return JSON.stringify(program).replace(/"op":/g, "").replace(/[{}"]/g, "").slice(0, 88);
}

export function runInductionDemo() {
  const trendSeason = series("ts", 48, { base: 2, slope: 1.5, amp: 8, period: 6 });
  const noise = Array.from({ length: 40 }, ((rng) => () => (rng() - 0.5) * 10)(createSeededRng("noise")));
  return {
    structured: induceOperators(trendSeason, { population: "series:trend-season", shuffles: 40, seasonalPeriod: 6, enumeration: { lags: [1, 6], maxSeriesDepth: 2 } }),
    noise: induceOperators(noise, { population: "series:noise", shuffles: 40 }),
  };
}

function present(label, result) {
  console.log(`\n=== ${label} — ${result.operators.length} operators over ${result.rounds.length} passes ===`);
  for (const op of result.operators) {
    const reused = JSON.stringify(op.canonical_program).includes('"op":"opref"');
    console.log(`\n  pass ${op.emergence.round}  DL=${op.description_length}  ${reused ? "REUSES a prior operator (REC->INS)" : "new structure"}`);
    console.log(`    program : ${short(op.canonical_program)}`);
    console.log(`    lens    : next-value / h=1 / vs ${op.reference_baseline_id}`);
    console.log(`    transfer: +${op.transfer_gain.toFixed(2)} held-out gain  |  null p=${op.promotion_null.p_value.toFixed(3)} (cleared)`);
    console.log(`    epoch   : ${op.emergence.promoted_by} minted it, re-enters as ${op.emergence.reenters_as}`);
  }
  if (result.operators.length === 0) console.log("  (nothing promoted — no transferable structure survived the gates)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = runInductionDemo();
  const b = runInductionDemo();
  present("trend + season", a.structured);
  present("white noise", a.noise);
  const deterministic = canonicalHashSync(a.structured.operators.map((o) => o.id)) === canonicalHashSync(b.structured.operators.map((o) => o.id));
  console.log(`\ndeterministic replay (operator ids stable): ${deterministic}`);
  if (!deterministic) process.exitCode = 1;
}
