// Level-3 calculus induction: SYN assembling a coherent vocabulary, EVA
// judging it across sources (spec "EO Emergent Mathematics for Predictive
// Competency" section 16). Once operators exist
// (scripts/induce-operators-demo.mjs), a calculus asks a harder question than
// any single operator can answer alone: does a VOCABULARY of operators that
// recurred across several series ALSO transfer to entirely different series
// it was never shown? Section 16.1 draws the line sharply — "a fitted formula
// is not automatically a new mathematics" — a calculus candidate only exists
// when reusable rules generalize across a FAMILY of models, not one series.
//
// This demo runs induceCalculus over three families: one genuine family
// (independent noise realizations of the same trend+season generative
// structure) and two negative controls. The second negative control —
// individually-structured but mutually UNRELATED series — is not a
// hypothetical: it caught a real false positive during development. The
// transfer statistic was originally "best-of-vocabulary" per holdout series
// (a "closure" framing: apply whichever member fits). That statistic let a
// vocabulary look like it transferred by cherry-picking whichever member
// happened to help on each series, even when the members DISAGREED IN SIGN
// across sources — helping hugely on one, hurting hugely on another. The fix
// (mean-over-members, not max) is what this demo's second case guards.
//
// The genuine family also opts into section 16.3 step 9 (composeExtensions):
// composing NEW cross-vocabulary programs from the promoted vocabulary,
// gated the same way plus one more bar — beating the best single member's own
// holdout gain. This is honestly expected to stay empty here: a vocabulary
// member is required to be a full-scale competent predictor to qualify, so
// `add` of two such members roughly doubles an accurate signal and `sub`
// collapses toward the wrong output scale — see packages/engine/emergence/
// calculus/index.js's header for the structural (not fixture-specific)
// argument, and its test file for a white-box case proving the gates are
// independent: a candidate that numerically clears "beats best member" is
// still correctly refused by the temporal-order permutation null.

import { induceCalculus } from "@eoreader/engine/emergence/calculus";
import { createSeededRng } from "@eoreader/engine";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const FAST_OPTS = { shuffles: 15, maxRounds: 2, maxOperators: 2, enumeration: { lags: [1, 6], maxSeriesDepth: 2 } };
const OPTS = { operatorOptions: FAST_OPTS, shuffles: 20 };
const GENUINE_OPTS = { ...OPTS, composeExtensions: true };

function trendSeason(seed, length = 36) {
  const rng = createSeededRng(seed);
  return Array.from({ length }, (_, t) => 2 + 1.5 * t + 8 * Math.sin((2 * Math.PI * t) / 6) + (rng() - 0.5));
}
function stationaryAr1(seed, rho, n = 40) {
  const rng = createSeededRng(seed);
  let x = 100;
  return Array.from({ length: n }, () => {
    x = 100 + rho * (x - 100) + (rng() - 0.5) * 2;
    return x;
  });
}
function trendFlat(seed, blocks = 5, blockLen = 8) {
  const rng = createSeededRng(seed);
  const xs = [];
  let base = 100;
  for (let b = 0; b < blocks; b += 1) {
    const trend = b % 2 === 0;
    for (let i = 0; i < blockLen; i += 1) {
      base += trend ? 8 + (rng() - 0.5) * 0.4 : (rng() - 0.5) * 8;
      xs.push(base);
    }
  }
  return xs;
}
function randomWalk(seed, n = 40) {
  const rng = createSeededRng(seed);
  let x = 100;
  return Array.from({ length: n }, () => {
    x += (rng() - 0.5) * 2;
    return x;
  });
}
function homogeneousFlat(seed, n = 40) {
  const rng = createSeededRng(seed);
  return Array.from({ length: n }, () => 100 + (rng() - 0.5) * 8);
}
function whiteNoise(seed, n = 40) {
  const rng = createSeededRng(seed);
  return Array.from({ length: n }, () => (rng() - 0.5) * 10);
}

export function runCalculusDemo() {
  const cases = [
    {
      label: "family:trend-season (independent noise realizations of one generative structure)",
      family: ["a", "b", "c", "d", "e"].map((s) => ({ id: `series:${s}`, series: trendSeason(`fam-${s}`) })),
      opts: { ...GENUINE_OPTS, seasonalPeriod: 6 },
    },
    {
      label: "family:unrelated (individually structured, mutually unrelated — the caught false positive)",
      family: [
        { id: "s1", series: trendSeason("neg1", 40) },
        { id: "s2", series: stationaryAr1("neg2", 0.5) },
        { id: "s3", series: trendFlat("neg3") },
        { id: "s4", series: randomWalk("neg4") },
        { id: "s5", series: homogeneousFlat("neg5") },
      ],
      opts: OPTS,
    },
    {
      label: "family:white-noise (no structure to recur at all)",
      family: ["a", "b", "c", "d", "e"].map((s) => ({ id: `n${s}`, series: whiteNoise(`wn-${s}`) })),
      opts: OPTS,
    },
  ];
  return cases.map(({ label, family, opts }) => ({ label, calculus: induceCalculus(family, { ...opts, population: label }) }));
}

function present(results) {
  for (const { label, calculus } of results) {
    console.log(`\n=== ${label} ===`);
    if (!calculus) {
      console.log("  no calculus induced — no vocabulary cleared support, the cross-series null, and the effect-size floor together");
      continue;
    }
    console.log(`  vocabulary : ${calculus.vocabulary.length} members (support >= ${(calculus.min_support_fraction * 100).toFixed(0)}% of ${calculus.split.propose_count} propose series)`);
    for (const m of calculus.vocabulary) {
      console.log(`    - ${m.program_key.slice(0, 20)}  support=${m.support.count}/${calculus.split.propose_count}  holdout mean gain=${m.holdout_transfer.mean_gain.toFixed(3)}`);
    }
    console.log(`  propose/holdout: ${calculus.propose_series_ids.join(",")} / ${calculus.holdout_series_ids.join(",")}`);
    console.log(`  transfer   : aggregate=${calculus.aggregate_transfer_gain.toFixed(3)}  rel.effect=${(calculus.relative_effect * 100).toFixed(1)}% of reference scale`);
    console.log(`  null       : p=${calculus.transfer_null.p_value.toFixed(3)} (${calculus.transfer_null.null_protocol.name}, ${calculus.transfer_null.sample_count} shuffles)`);
    console.log(`  emergence  : ${calculus.emergence.synthesized_by} assembled it, ${calculus.emergence.validated_by} judged it against ${calculus.reference_baseline_id}`);
    if (calculus.proposed_extensions.length === 0) {
      console.log(`  step 9     : proposed_extensions=[] — composing members via add/sub found no candidate that beats the best member (structural, see module header)`);
    } else {
      console.log(`  step 9     : ${calculus.proposed_extensions.length} extension(s) promoted:`);
      for (const e of calculus.proposed_extensions) {
        console.log(`    - ${e.program_key.slice(0, 20)}  beats best member by +${e.beats_best_member_by.toFixed(3)}  rel.effect=${(e.relative_effect * 100).toFixed(1)}%`);
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = runCalculusDemo();
  const b = runCalculusDemo();
  present(a);
  const deterministic = canonicalHashSync(a.map((r) => r.calculus?.id ?? null)) === canonicalHashSync(b.map((r) => r.calculus?.id ?? null));
  console.log(`\ndeterministic replay: ${deterministic}`);
  if (!deterministic) process.exitCode = 1;
}
