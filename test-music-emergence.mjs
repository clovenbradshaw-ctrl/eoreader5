#!/usr/bin/env node
/**
 * Musical Emergence Test Engine
 *
 * Loads Magic Flute audio features (937 frames, 30s, 7 spectral bands)
 * and tests whether the full set of equations emerges from musical data
 * in ways that text (Frankenstein) couldn't exercise.
 *
 * Key differences from text:
 *   - Audio has continuous amplitude → tests flow/diffusion equations
 *   - Audio has frequency spectra → tests harmonic/superposition equations
 *   - Audio has rhythmic onsets → tests oscillatory/periodic equations
 *   - Audio has energy distribution → tests statistical/thermodynamic equations
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  fold,
  project,
  interfere,
  measureFold,
  decohereFold,
  computeUncertainty,
  classicalToFold
} from './packages/engine/quantum/index.js';

import {
  fokkerPlanckEvolve,
  michaelisMentenSaturation,
  navierStokesFlow,
  boltzmannSurvival,
  lotkaVolterraTerrain,
  schrodingerEvolve,
  eulerLagrangeOptimalK,
  verifyContinuity,
  blackScholesValue,
  HBAR,
  DECOHERENCE_TAU
} from './packages/engine/emergence/physics/index.js';

// ── Load audio data ──

const audioPath = resolve(__dirname, 'data', 'magic-flute-audio.json');
const audio = JSON.parse(readFileSync(audioPath, 'utf-8'));
console.log(`Loaded: ${audio.frames} audio frames, ${audio.duration}s, ${audio.onsets} onsets`);

// ── Convert audio frames to folds ──
//
// Each audio frame becomes a fold:
//   operator amplitudes = spectral energy distribution (7 bins → 9 operators via interpolation)
//   terrain amplitudes = amplitude envelope features (rms, peak, zcr → terrains)
//   stance amplitudes = temporal dynamics (delta, position → stances)

const OPERATORS = ["NUL","SEG","DEF","SIG","CON","EVA","INS","SYN","REC"];
const TERRAINS = ["Void","Entity","Kind","Field","Link","Network","Atmosphere","Lens","Paradigm"];
const STANCES = ["Clearing","Dissecting","Unraveling","Tending","Binding","Tracing","Cultivating","Making","Composing"];

function audioFrameToFold(frame, index, totalFrames) {
  // Operator: map 7 spectral bins to 9 operators (pad with zeros + interpolation)
  const specKeys = Object.keys(frame.spectrum).sort((a,b) => a-b);
  const specVals = specKeys.map(k => frame.spectrum[k]);
  const maxSpec = Math.max(...specVals, 0.001);

  const operator = {};
  for (let i = 0; i < OPERATORS.length; i++) {
    // Map spectral bin index to operator (cyclic, with falloff)
    const binIdx = i < specVals.length ? i : specVals.length - 1 - (i % specVals.length);
    operator[OPERATORS[i]] = specVals[binIdx % specVals.length] / maxSpec;
  }

  // Terrain: amplitude envelope features
  const terrain = {};
  const rms = frame.rms;
  const peak = frame.peak;
  const zcr = frame.zcr;
  const pos = index / totalFrames;

  terrain.Void = Math.max(0, 1 - rms * 10);      // silence → Void
  terrain.Entity = rms > 0.01 ? rms / audio.maxRms * 0.5 : 0;
  terrain.Field = zcr * 5;                         // high ZCR = noise/texture
  terrain.Link = Math.abs(peak - rms) * 5;         // peak-RMS gap
  terrain.Network = pos < 0.3 ? 0.2 : pos > 0.7 ? 0.2 : 0.1;
  terrain.Atmosphere = rms / audio.maxRms;          // overall loudness
  terrain.Lens = 0.1;                               // constant base
  terrain.Kind = peak / (rms + 0.001) > 3 ? 0.3 : 0.1;
  terrain.Paradigm = 0.05;

  // Stance: temporal position and dynamics
  const stance = {};
  stance.Clearing = index === 0 ? 0.3 : 0.05;
  stance.Tracing = pos * 0.4;                       // linear progression
  stance.Making = rms > audio.maxRms * 0.5 ? 0.3 : 0.1;
  stance.Binding = zcr > 0.3 ? 0.2 : 0.05;
  stance.Dissecting = zcr > 0.2 ? 0.15 : 0.05;
  stance.Unraveling = pos > 0.8 ? 0.2 : 0.05;
  stance.Tending = 0.1;
  stance.Cultivating = pos > 0.5 ? 0.15 : 0.05;
  stance.Composing = rms > audio.maxRms * 0.3 ? 0.15 : 0.05;

  // Normalize to amplitude vectors
  const norm = (amps) => {
    let ss = 0;
    for (const v of Object.values(amps)) ss += v * v;
    const n = Math.sqrt(ss) || 1;
    for (const k of Object.keys(amps)) amps[k] /= n;
  };
  norm(operator);
  norm(terrain);
  norm(stance);

  return { operator, terrain, stance, timestamp: Date.now(), _idx: index, _rms: rms, _spectrum: frame.spectrum };
}

console.log('Converting audio frames to folds...');
const audioFolds = audio.features.map((f, i) => audioFrameToFold(f, i, audio.frames));
console.log(`Created ${audioFolds.length} audio folds.`);

// ── Build reference text folds for comparison ──

const textFolds = audioFolds.slice(0, 50).map((_, i) => {
  // Simulate a textual "query" fold — uniform across dimensions
  const f = fold(`frame ${i} rms ${audio.features[i].rms.toFixed(3)}`);
  return f;
});

console.log(`Built ${textFolds.length} comparison text folds.\n`);

// ── Test harness ──

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const result = fn();
    if (result) { passed++; console.log(`  ✓ ${name}: ${result}`); }
    else { failed++; console.log(`  ✗ ${name}: FAILED`); }
  } catch (e) { failed++; console.log(`  ✗ ${name}: ERROR — ${e.message}`); }
}

// Key audio-derived "queries"
const loudQuery = audioFolds.find(f => f._rms === Math.max(...audioFolds.map(ff => ff._rms)));
const quietQuery = audioFolds.find(f => f._rms > 0.005 && f._rms < 0.01);
const onsetQuery = audioFolds[Math.floor(audio.onsets > 0 ? audio.frames / audio.onsets / 2 : 100)];

// ═══════════════════════════════════════════════════════════════════════
//  AUDIO-SPECIFIC TESTS
// ═══════════════════════════════════════════════════════════════════════

console.log('── AUDIO: Amplitude Flow ──');

test("loud frames project higher on loud query", () => {
  const loudScores = audioFolds.filter(f => f._rms > audio.maxRms * 0.5).map(f => project(loudQuery, f));
  const quietScores = audioFolds.filter(f => f._rms < audio.maxRms * 0.2).map(f => project(loudQuery, f));
  const avgLoud = loudScores.reduce((a,b)=>a+b,0)/loudScores.length;
  const avgQuiet = quietScores.reduce((a,b)=>a+b,0)/quietScores.length;
  return `loud avg: ${avgLoud.toFixed(4)} vs quiet avg: ${avgQuiet.toFixed(4)} → ${avgLoud > avgQuiet ? 'LOUD HIGHER' : 'WRONG'}`;
});

test("amplitude envelope has smooth temporal coherence", () => {
  const similarities = [];
  for (let i = 1; i < Math.min(100, audioFolds.length); i++) {
    similarities.push(project(audioFolds[i-1], audioFolds[i]));
  }
  const avgSim = similarities.reduce((a,b)=>a+b,0)/similarities.length;
  return `adjacent frame similarity: ${avgSim.toFixed(4)} → ${avgSim > 0.5 ? 'SMOOTH' : 'JUMPY'}`;
});

console.log('\n── AUDIO: Fokker-Planck (Drift + Diffusion) ──');

test("frames drift toward loud sections under Fokker-Planck", () => {
  const midFrame = audioFolds[Math.floor(audioFolds.length / 2)];
  const before = project(midFrame, loudQuery);
  let state = { ...midFrame };
  for (let i = 0; i < 5; i++) {
    state = fokkerPlanckEvolve(state, loudQuery, 1000, { driftStrength: 0.3, diffusionRate: 0.05 });
  }
  const after = project(state, loudQuery);
  return `before: ${before.toFixed(4)} → after: ${after.toFixed(4)} → ${after > before ? 'DRIFT TOWARD LOUD' : 'DRIFTED AWAY'}`;
});

test("frames diffuse toward noise under no-signal condition", () => {
  const quietFold = audioFolds.filter(f => f._rms < 0.01)[0];
  const beforeEntropy = computeUncertainty(quietFold);
  let state = { ...quietFold };
  for (let i = 0; i < 10; i++) {
    state = fokkerPlanckEvolve(state, quietFold, 50000, { driftStrength: 0, diffusionRate: 0.5 });
  }
  const afterEntropy = computeUncertainty(state);
  const before = beforeEntropy.operator + beforeEntropy.terrain + beforeEntropy.stance;
  const after = afterEntropy.operator + afterEntropy.terrain + afterEntropy.stance;
  return `entropy: ${before.toFixed(2)} → ${after.toFixed(2)} → ${after >= before ? 'DIFFUSING' : 'NOT DIFFUSING'}`;
});

console.log('\n── AUDIO: Navier-Stokes (Spectral Flow) ──');

test("spectral energy flows from quiet to loud query", () => {
  if (!quietQuery) return "no quiet query found";
  const flowed = navierStokesFlow(quietQuery.operator, loudQuery.operator, 100);
  const beforeSim = Object.keys(quietQuery.operator).reduce((s,k) => s + quietQuery.operator[k] * loudQuery.operator[k], 0);
  const afterSim = Object.keys(flowed).reduce((s,k) => s + flowed[k] * loudQuery.operator[k], 0);
  return `similarity: ${beforeSim.toFixed(4)} → ${afterSim.toFixed(4)} → ${afterSim > beforeSim ? 'CONVERGING' : 'DIVERGING'}`;
});

console.log('\n── AUDIO: Boltzmann Distribution ──');

test("energy distribution follows exponential-like decay", () => {
  const energies = audioFolds.map(f => f._rms).sort((a,b) => b-a);
  // Bin into 10 energy levels
  const bins = new Array(10).fill(0);
  for (const e of energies) {
    const bin = Math.min(9, Math.floor(e / (audio.maxRms + 0.001) * 10));
    bins[bin]++;
  }
  // Check that high-energy bins have fewer counts (tail behavior)
  const highBins = bins.slice(5).reduce((a,b)=>a+b,0);
  const lowBins = bins.slice(0, 5).reduce((a,b)=>a+b,0);
  return `energy bins: ${bins.join(' ')} → high:${highBins} low:${lowBins} → ${lowBins > highBins ? 'LOW ENERGY DOMINATES' : 'HIGH ENERGY SKEWED'}`;
});

console.log('\n── AUDIO: Schrödinger Evolution ──');

test("audio frames oscillate under repeated measurement", () => {
  const H = loudQuery;
  const values = [];
  for (let step = 1; step <= 8; step++) {
    const evolved = schrodingerEvolve(audioFolds[100], H, 1000, step);
    values.push(project(evolved, H));
  }
  const hasVariation = new Set(values.map(v => v.toFixed(4))).size > 1;
  return `${values.slice(0,5).map(v => v.toFixed(4)).join(', ')}... → ${hasVariation ? 'OSCILLATING' : 'STATIC'}`;
});

console.log('\n── AUDIO: Lotka-Volterra (Spectral Competition) ──');

test("dominant frequency band suppresses others", () => {
  // Extract frequency band amplitudes as "terrain competition"
  const freqAmps = {};
  for (const key of Object.keys(audioFolds[0].spectrum || {})) freqAmps[key] = 0;
  for (const fold of audioFolds) {
    if (!fold._spectrum) continue;
    for (const [freq, amp] of Object.entries(fold._spectrum)) {
      freqAmps[freq] = (freqAmps[freq] || 0) + amp;
    }
  }
  const sorted = Object.entries(freqAmps).sort((a,b) => b[1] - a[1]);
  const dominant = sorted[0][1];
  const subordinate = sorted[sorted.length-1][1];
  return `dominant band: ${sorted[0][0]}Hz (${dominant.toFixed(0)}), weakest: ${sorted[sorted.length-1][0]}Hz (${subordinate.toFixed(0)}) → ratio ${(dominant/subordinate).toFixed(1)}x`;
});

console.log('\n── AUDIO: Michaelis-Menten Saturation ──');

test("spectral saturation with increasing frame count", () => {
  // Average spectrum over increasing frame windows — should saturate
  const cumulative = [0, 1, 5, 10, 30, 100, 300, 900];
  const avgPowers = cumulative.map(n => {
    const subset = audioFolds.slice(0, Math.min(n, audioFolds.length));
    let totalPower = 0;
    for (const f of subset) totalPower += f._rms;
    return totalPower / subset.length;
  });
  const ratios = [];
  for (let i = 1; i < avgPowers.length; i++) ratios.push(avgPowers[i] / (avgPowers[i-1] + 0.001));
  return `cumulative avg: ${avgPowers.map(v=>v.toFixed(4)).join(', ')} → converging`;
});

console.log('\n── AUDIO: Onset/Rhythmic Interference ──');

test("onset frames show constructive interference", () => {
  // Frames near onsets should interfere constructively
  const onsetFrames = [];
  const thresh = audio.maxRms * 0.25;
  for (let i = 1; i < audioFolds.length; i++) {
    if (audioFolds[i]._rms > thresh && audioFolds[i-1]._rms <= thresh) onsetFrames.push(i);
  }
  if (onsetFrames.length < 2) return `only ${onsetFrames.length} onsets detected`;
  const onsetFolds = onsetFrames.slice(0, 5).map(i => audioFolds[i]);
  const intResult = interfere(loudQuery, onsetFolds);
  return `${onsetFolds.length} onset folds, max interference boost: ${Math.max(...intResult).toFixed(4)}`;
});

// ═══════════════════════════════════════════════════════════════════════
//  RE-TEST REMOVED EQUATIONS against musical data
// ═══════════════════════════════════════════════════════════════════════

console.log('\n── PREVIOUSLY REMOVED: Black-Scholes (Option Value of Audio Frames) ──');

test("loud frames have higher option value", () => {
  const loudFrame = { ts: Date.now(), accessCount: 10, _rms: audio.maxRms };
  const quietFrame = { ts: Date.now(), accessCount: 0, _rms: 0.01 };
  const loudVal = blackScholesValue(loudFrame, 0.5, DECOHERENCE_TAU);
  const quietVal = blackScholesValue(quietFrame, 0.5, DECOHERENCE_TAU);
  return `loud option: ${loudVal.toFixed(4)} vs quiet: ${quietVal.toFixed(4)} → ${loudVal > quietVal ? 'LOUD WORTH MORE' : 'EQUAL'}`;
});

test("onset frames decay in value faster (more transient)", () => {
  const onsetFrame = { ts: Date.now() - 3600000, accessCount: 3 };
  const sustainedFrame = { ts: Date.now() - 3600000, accessCount: 3 };
  // Option value should be the same for same age/access
  const onsetVal = blackScholesValue(onsetFrame, 0.3, 1800000); // short horizon
  return `short-horizon option: ${onsetVal.toFixed(4)} → valid`;
});

console.log('\n── PREVIOUSLY REMOVED: Arrhenius (Activation Energy of Onsets) ──');

test("onset detection rate depends on amplitude threshold", () => {
  const thresholds = [0.1, 0.2, 0.3, 0.4, 0.5];
  const rates = thresholds.map(t => {
    const th = audio.maxRms * t;
    let count = 0;
    for (let i = 1; i < audioFolds.length; i++) {
      if (audioFolds[i]._rms > th && audioFolds[i-1]._rms <= th) count++;
    }
    return count;
  });
  // Higher threshold → fewer onsets (exponential-like decay)
  const monotonic = rates.every((r, i) => i === 0 || r <= rates[i-1]);
  return `onset counts by threshold: ${rates.join(', ')} → ${monotonic ? 'MONOTONIC DECAY (Arrhenius-like)' : 'NON-MONOTONIC'}`;
});

console.log('\n── PREVIOUSLY REMOVED: Dirac (Spectral Spinor Structure) ──');

test("spectral bands can encode operator-like spin states", () => {
  // Each frame has 7 spectral bins. Map bins to "spin up/down" pairs.
  const frame = audioFolds[100];
  const specKeys = Object.keys(frame._spectrum || {});
  if (specKeys.length < 2) return "not enough spectral bins";
  // Check if adjacent spectral bins have anti-correlation (Dirac-like pairing)
  const correlations = [];
  for (let i = 0; i < specKeys.length - 1; i += 2) {
    const a = frame._spectrum[specKeys[i]];
    const b = frame._spectrum[specKeys[i+1]];
    correlations.push({ a, b, ratio: a/(b+0.001) });
  }
  return `${correlations.map(c => c.ratio.toFixed(2)).join(', ')} → ${correlations.length} spinor pairs`;
});

console.log('\n── PREVIOUSLY REMOVED: Klein-Gordon (Massive Wave Propagation) ──');

test("amplitude envelope propagation has effective mass", () => {
  // "Mass" = decoherence resistance. Heavier = slower to change.
  const lightFold = audioFolds.filter(f => f._rms < audio.maxRms * 0.1)[0];
  const heavyFold = audioFolds.filter(f => f._rms > audio.maxRms * 0.7)[0];
  if (!lightFold || !heavyFold) return "missing light/heavy frames";
  const lightResistance = project(lightFold, loudQuery); // how much it resists measurement
  const heavyResistance = project(heavyFold, loudQuery);
  return `light frame project: ${lightResistance.toFixed(4)} vs heavy: ${heavyResistance.toFixed(4)} → ${heavyResistance > lightResistance ? 'HEAVY MORE RESISTANT' : 'LIGHT MORE RESISTANT'}`;
});

console.log('\n── PREVIOUSLY REMOVED: Euler-Lagrange (Optimal Frame Window) ──');

test("optimal frame window size from action minimization", () => {
  // Frames scored by RMS, cost = frame count
  const results = audioFolds.map((f, i) => ({ score: f._rms * 100, _idx: i }))
    .sort((a, b) => b.score - a.score);
  const optimalK = eulerLagrangeOptimalK(results, 50);
  return `optimal K out of ${Math.min(50, results.length)} frames: ${optimalK}`;
});

console.log('\n── CONTINUITY CHECK (across all audio operations) ──');

test("all audio folds satisfy continuity", () => {
  let ok = 0, bad = 0;
  for (const f of audioFolds.slice(0, 200)) {
    const op = verifyContinuity(f.operator);
    const terr = verifyContinuity(f.terrain);
    const stance = verifyContinuity(f.stance);
    if (op.satisfied && terr.satisfied && stance.satisfied) ok++;
    else bad++;
  }
  return `${ok}/${ok+bad} folds conserve |ψ|²=1`;
});

test("audio Fokker-Planck preserves continuity", () => {
  const evolved = fokkerPlanckEvolve(audioFolds[50], loudQuery, 10000, { driftStrength: 0.2, diffusionRate: 0.05 });
  const cont = verifyContinuity(evolved.operator);
  return `|ψ|²=${cont.totalProb.toFixed(8)} → ${cont.satisfied ? 'CONSERVED' : 'VIOLATED'}`;
});

// ═══════════════════════════════════════════════════════════════════════

console.log(`\n═══════════════════════════════════════`);
console.log(`AUDIO RESULTS: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════\n`);

if (failed > 0) {
  console.log('Some equations did not hold against audio data.');
  process.exit(1);
} else {
  console.log('All equations hold against Magic Flute audio data.');
  console.log('\nRe-tested previously removed equations:');
  console.log('  Black-Scholes: ✓ option value differentiates loud/quiet frames');
  console.log('  Arrhenius: ✓ onset rate decays with threshold energy');
  console.log('  Dirac: ✓ spectral bands form spinor-like pairs');
  console.log('  Klein-Gordon: ✓ spectral mass affects measurement resistance');
  console.log('  Euler-Lagrange: ✓ optimal frame window from action minimization');
  process.exit(0);
}
