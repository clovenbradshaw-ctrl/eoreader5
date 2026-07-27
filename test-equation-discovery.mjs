#!/usr/bin/env node
/**
 * Sanity check for the PCFG equation-discovery engine.
 *
 * Builds a small dataset of folds derived from Magic Flute audio frames,
 * defines a KNOWN target as a simple combination of EO primitives
 * (gaussianKernel between two fold-derived scalars), then runs Monte
 * Carlo search over the EO-primitive grammar and checks that the
 * top-ranked discovered expression recovers (or closely approximates)
 * that target — i.e. the search actually converges, not just runs.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

import { gaussianKernel } from './packages/engine/quantum/index.js';
import { discoverEquation, foldToVars, evaluateTree, treeToString } from './packages/engine/discovery/pcfg.js';

const audio = JSON.parse(readFileSync(resolve(__dirname, 'data', 'magic-flute-audio.json'), 'utf-8'));

const OPERATORS = ["NUL","SEG","DEF","SIG","CON","EVA","INS","SYN","REC"];
function audioFold(i) {
  const f = audio.features[i]; const r = f.rms; const spec = f.spectrum;
  const keys = Object.keys(spec).sort((a,b)=>a-b); const mx = Math.max(...Object.values(spec), 0.001);
  const op = {}; for (let j=0;j<OPERATORS.length;j++) op[OPERATORS[j]] = spec[keys[j%keys.length]]/mx;
  const tr = {}; tr.Void=Math.max(0,1-r*10); tr.Entity=r/audio.maxRms*0.5; tr.Field=f.zcr*3; tr.Atmosphere=r/audio.maxRms;
  const st = {}; st.Tracing=i/audio.frames*0.4; st.Making=r>audio.maxRms*0.5?0.3:0.1; st.Clearing=i===0?0.3:0.05;
  const N=(a)=>{const ss=Object.values(a).reduce((s,v)=>s+v*v,0);const n=Math.sqrt(ss)||1;for(const k of Object.keys(a))a[k]/=n;};
  N(op);N(tr);N(st);
  return {operator:op,terrain:tr,stance:st,timestamp:Date.now()};
}

const N = 60;
const folds = Array.from({ length: N }, (_, i) => audioFold(i * 3));

// ── KNOWN target: gaussianKernel(sig, entity) ──
// A simple, EO-native two-variable combination. Curated to a handful of
// fold-derived scalars (standard feature-selection practice for symbolic
// regression) so the search space stays tractable for a sanity check.
// If discovery works, the top candidate's fit error should be near zero
// and ideally reference the same two variables via gaussianKernel.

function curatedVars(fold) {
  const v = foldToVars(fold);
  return {
    sig: v['operator.SIG'],
    entity: v['terrain.Entity'],
    field: v['terrain.Field'],
    void_: v['terrain.Void'],
    making: v['stance.Making'],
  };
}

const dataset = folds.map(fold => {
  const vars = curatedVars(fold);
  const target = gaussianKernel(vars.sig, vars.entity);
  return { vars, target };
});

console.log('Running PCFG Monte Carlo discovery...');
console.log(`Dataset size: ${dataset.length}, target = gaussianKernel(sig, entity)\n`);

const results = discoverEquation(dataset, {
  numSamples: 20000,
  maxDepth: 4,
  lambda: 0.02,
  topK: 10,
});

console.log('Top candidates:');
for (const c of results.slice(0, 5)) {
  console.log(`  score=${c.score.toFixed(4)}  fitError=${c.fitError.toFixed(5)}  prior=${c.priorLogProb.toFixed(2)}  size=${c.size}`);
  console.log(`    ${c.expression}`);
}

const best = results[0];
if (!best) {
  console.error('\nFAIL: no candidates found');
  process.exit(1);
}

console.log(`\nBest: ${best.expression}`);
console.log(`Fit error: ${best.fitError.toFixed(5)}`);

// A converged search should find something with low fit error
// (well below the spread of a random/untrained guess).
const PASS_THRESHOLD = 0.15;
if (best.fitError < PASS_THRESHOLD) {
  console.log(`\nPASS: best candidate fit error ${best.fitError.toFixed(5)} < ${PASS_THRESHOLD}`);
} else {
  console.error(`\nFAIL: best candidate fit error ${best.fitError.toFixed(5)} >= ${PASS_THRESHOLD}`);
  process.exit(1);
}

// ── Second check: simpler target, arithmetic-only ──
// target = operator.SIG - terrain.Void  (a plain binary op, shallower
// grammar derivation → should be found even more easily / exactly)

const dataset2 = folds.map(fold => {
  const vars = curatedVars(fold);
  const target = vars.sig - vars.void_;
  return { vars, target };
});

console.log('\n\nSecond check: target = sig - void_');
const results2 = discoverEquation(dataset2, { numSamples: 20000, maxDepth: 4, lambda: 0.02, topK: 5 });
for (const c of results2.slice(0, 3)) {
  console.log(`  score=${c.score.toFixed(4)}  fitError=${c.fitError.toFixed(5)}  ${c.expression}`);
}
const best2 = results2[0];
if (best2 && best2.fitError < 0.05) {
  console.log(`\nPASS: recovered near-exact arithmetic target (fitError=${best2.fitError.toFixed(5)})`);
} else {
  console.error(`\nFAIL: did not recover simple arithmetic target closely enough`);
  process.exit(1);
}

console.log('\nAll equation-discovery sanity checks passed.');
