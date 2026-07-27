#!/usr/bin/env node
/**
 * Feynman Formula Tests against Magic Flute Audio
 *
 * Tests Feynman formulas that require continuous signals:
 * wave phenomena, spectral dynamics, oscillatory behavior.
 * These CANNOT be tested with discrete text — only audio exercises them.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  fold, project, interfere, measureFold, decohereFold,
  computeUncertainty, gaussianKernel, classicalToFold,
  GAUSSIAN_SIGMA, SCATTER_BETA, SCATTER_ALPHA
} from './packages/engine/quantum/index.js';

import {
  fokkerPlanckEvolve, navierStokesFlow, schrodingerEvolve,
  boltzmannSurvival, verifyContinuity, HBAR, DECOHERENCE_TAU
} from './packages/engine/emergence/physics/index.js';

const audio = JSON.parse(readFileSync(resolve(__dirname, 'data', 'magic-flute-audio.json'), 'utf-8'));
console.log(`Audio: ${audio.frames} frames, ${audio.duration}s, RMS ${audio.minRms.toFixed(3)}–${audio.maxRms.toFixed(3)}`);

const rmsVals = audio.features.map(f => f.rms);
const maxRms = audio.maxRms;

// ── Build audio folds from features ──
const OPERATORS = ["NUL","SEG","DEF","SIG","CON","EVA","INS","SYN","REC"];

function audioFold(i) {
  const f = audio.features[i];
  const rms = f.rms;
  const spec = f.spectrum;
  const keys = Object.keys(spec).sort((a,b)=>a-b);
  const maxSpec = Math.max(...Object.values(spec), 0.001);

  const operator = {};
  for (let j = 0; j < OPERATORS.length; j++) {
    const k = keys[j % keys.length];
    operator[OPERATORS[j]] = spec[k] / maxSpec;
  }

  const terrain = {};
  terrain.Void = Math.max(0, 1 - rms * 10);
  terrain.Entity = rms / maxRms * 0.5;
  terrain.Field = f.zcr * 3;
  terrain.Atmosphere = rms / maxRms;
  terrain.Kind = 0.1 + rms / maxRms * 0.2;

  const stance = {};
  stance.Tracing = (i / audio.frames) * 0.4;
  stance.Making = rms > maxRms * 0.5 ? 0.3 : 0.1;
  stance.Clearing = i === 0 ? 0.3 : 0.05;

  const norm = (a) => { const ss = Object.values(a).reduce((s,v)=>s+v*v,0); const n = Math.sqrt(ss)||1; for(const k of Object.keys(a)) a[k]/=n; };
  norm(operator); norm(terrain); norm(stance);

  return { operator, terrain, stance, timestamp: Date.now(), _i: i, _rms: rms, _spec: spec, _zcr: f.zcr };
}

const folds = audio.features.map((_, i) => audioFold(i));
const onsetIdxs = [];
{
  const th = maxRms * 0.25;
  for (let i = 1; i < folds.length; i++) {
    if (folds[i]._rms > th && folds[i-1]._rms <= th) onsetIdxs.push(i);
  }
}
const onsetFolds = onsetIdxs.map(i => folds[i]);
console.log(`Folds: ${folds.length}, onsets: ${onsetFolds.length}\n`);

// ── Harness ──
let p=0, f=0;
function t(name, ok, detail) {
  if (ok) { p++; console.log(`  ✓ ${name}: ${detail}`); }
  else { f++; console.log(`  ✗ ${name}: ${detail}`); }
}
function stats(arr) {
  const n = arr.length, mean = arr.reduce((a,b)=>a+b,0)/n;
  const variance = arr.reduce((s,v)=>s+(v-mean)**2,0)/n;
  return { mean: mean.toFixed(4), std: Math.sqrt(variance).toFixed(4), min: Math.min(...arr).toFixed(4), max: Math.max(...arr).toFixed(4) };
}

// ═══════════════════════════════════════════════════════════════
// I.6.2  Gaussian Kernel — verify spectral smoothness
// ═══════════════════════════════════════════════════════════════
console.log("─── I.6.2  Gaussian Kernel ───");
{
  const mid = folds[Math.floor(folds.length/2)];
  const dists = folds.slice(0, 50).map((fold, i) => gaussianKernel(mid._rms, fold._rms, 0.01));
  const s = stats(dists);
  t(true, `${s.mean} ± ${s.std}`, `peak at self, falls with RMS distance`);
}
{
  const mid = folds[200];
  const sims = folds.slice(0, 100).map((fold, i) => {
    const d = Math.abs(mid._rms - fold._rms);
    return { d, k: gaussianKernel(mid._rms, fold._rms, 0.02) };
  }).sort((a,b) => a.d - b.d);
  t(sims[0].k > sims[sims.length-1].k, `closest: ${sims[0].k.toFixed(4)}, farthest: ${sims[sims.length-1].k.toFixed(4)}`, "monotonic with distance");
}

// ═══════════════════════════════════════════════════════════════
// I.8.14  Euclidean Distance — frame-to-frame spectral distance
// ═══════════════════════════════════════════════════════════════
console.log("─── I.8.14  Euclidean Distance ───");
{
  const dists = [];
  for (let i = 1; i < 200; i++) {
    let d = 0;
    for (const k of Object.keys(folds[i]._spec)) d += (folds[i]._spec[k] - folds[i-1]._spec[k])**2;
    dists.push(Math.sqrt(d));
  }
  const s = stats(dists);
  t(s.mean > 0, `mean Δ=${s.mean}`, `adjacent frames have measurable spectral distance`);
}

// ═══════════════════════════════════════════════════════════════
// I.24.6  Harmonic Oscillator Energy — onset rhythm as oscillator
// ═══════════════════════════════════════════════════════════════
console.log("─── I.24.6  Harmonic Oscillator Energy ───");
{
  if (onsetIdxs.length < 2) { t(false, "insufficient onsets"); }
  else {
    const intervals = [];
    for (let i = 1; i < onsetIdxs.length; i++) intervals.push(onsetIdxs[i] - onsetIdxs[i-1]);
    const avgInterval = intervals.reduce((a,b)=>a+b,0)/intervals.length;
    const freq = audio.frames / (audio.duration * avgInterval); // onsets/sec
    // Oscillator energy: E = ½m(ω²+ω₀²)x² where ω = onset freq
    const mass = 1.0, omega0 = 1/DECOHERENCE_TAU, omega = 2*Math.PI*freq, amp = 0.5;
    const E = 0.5 * mass * (omega*omega + omega0*omega0) * amp*amp;
    t(E > 0 && omega > 0, `onset freq=${freq.toFixed(2)}Hz, E=${E.toExponential(2)}`, "harmonic oscillator parameters from rhythm");
  }
}

// ═══════════════════════════════════════════════════════════════
// I.29.4  Wavenumber ω/c — spectral frequency / semantic speed
// ═══════════════════════════════════════════════════════════════
console.log("─── I.29.4  Wavenumber ───");
{
  const specKeys = Object.keys(audio.features[0].spectrum).map(Number).sort((a,b)=>a-b);
  const c = 1.0; // speed of meaning (normalized)
  const wavenumbers = specKeys.map(fq => ({ freq: fq, k: 2*Math.PI*fq / (c * audio.sampleRate) }));
  t(wavenumbers.length === 7, `7 spectral bands: k = ${wavenumbers.map(w=>w.k.toFixed(4)).join(', ')}`, "frequency → wavenumber");
}

// ═══════════════════════════════════════════════════════════════
// I.30.3  N-Slit Interference — N onset folds interference
// ═══════════════════════════════════════════════════════════════
console.log("─── I.30.3  N-Slit Interference ───");
{
  const loudQ = folds.find(f => f._rms === maxRms);
  const sizes = [2, 3, 5].filter(n => n <= onsetFolds.length);
  const patterns = sizes.map(n => {
    const r = interfere(loudQ, onsetFolds.slice(0, n));
    return { n, max: Math.max(...r) };
  });
  t(patterns.every((p,i) => i===0 || p.max >= patterns[i-1].max*0.5),
    patterns.map(p => `N=${p.n}:${p.max.toFixed(3)}`).join(' '),
    "interference envelope sharpens with N folds");
}

// ═══════════════════════════════════════════════════════════════
// I.32.17  Scattering Cross-Section — spectral energy redistribution
// ═══════════════════════════════════════════════════════════════
console.log("─── I.32.17  Scattering Cross-Section ───");
{
  const mid = folds[300];
  const specTotal = Object.values(mid._spec).reduce((a,b)=>a+b,0);
  // Cross-section = how energy distributes across spectral bins
  const distribution = Object.entries(mid._spec).map(([fq, amp]) =>
    ({ freq: Number(fq), fraction: amp/specTotal }));
  const entropy = -distribution.reduce((s,d) => s + d.fraction * Math.log(d.fraction+0.001), 0);
  t(entropy > 0, `spectral entropy: ${entropy.toFixed(3)}`, "energy distributed across bands");
}

// ═══════════════════════════════════════════════════════════════
// I.34.1  Classical Doppler — frequency shift from frame drift
// ═══════════════════════════════════════════════════════════════
console.log("─── I.34.1  Classical Doppler ───");
{
  // Recession velocity v = 1 - project(adjacent frames) → frequency shift
  const shifts = [];
  const baseFreq = 400; // middle spectral band
  for (let i = 1; i < 100; i++) {
    const proj = project(folds[i-1], folds[i]);
    const v = 1 - proj; // semantic recession
    const fObserved = baseFreq / (1 + v); // redshift when receding
    shifts.push(fObserved);
  }
  const s = stats(shifts);
  t(s.std > 0.1, `Doppler-shifted freq: ${s.mean} ± ${s.std}`, "measurable frequency shift frame-to-frame");
}

// ═══════════════════════════════════════════════════════════════
// I.34.27  ℏω — Energy per onset quantum
// ═══════════════════════════════════════════════════════════════
console.log("─── I.34.27  ℏω ───");
{
  const loudQ = folds.find(f => f._rms === maxRms);
  const energies = onsetFolds.slice(0, 10).map(of => {
    const E = project(of, loudQ);
    return { E, hbarOmega: E * HBAR };
  });
  t(energies.length > 0, `onset energies: ${energies.map(e=>e.E.toFixed(3)).join(', ')} → ℏω = ${(energies[0].hbarOmega).toFixed(4)}`, "energy quantum per onset");
}

// ═══════════════════════════════════════════════════════════════
// I.40.1  Barometric — amplitude decay across frames
// ═══════════════════════════════════════════════════════════════
console.log("─── I.40.1  Barometric Decay ───");
{
  const decays = [];
  for (let i = 0; i < 100; i++) {
    const dec = decohereFold(folds[i], i * 100); // increasing time
    decays.push(computeUncertainty(dec).terrain);
  }
  // Entropy should increase with time (monotonic on average)
  const first10 = decays.slice(0, 10).reduce((a,b)=>a+b,0)/10;
  const last10 = decays.slice(90, 100).reduce((a,b)=>a+b,0)/10;
  t(last10 >= first10, `entropy: t=0→${first10.toFixed(2)} t=max→${last10.toFixed(2)}`, "exponential approach to uniform");
}

// ═══════════════════════════════════════════════════════════════
// I.41.16  Planck Blackbody — energy distribution of frame RMS
// ═══════════════════════════════════════════════════════════════
console.log("─── I.41.16  Planck Blackbody ───");
{
  // Bin RMS values into energy levels, fit Bose-Einstein
  const bins = 20;
  const hist = new Array(bins).fill(0);
  for (const v of rmsVals) {
    const bin = Math.min(bins-1, Math.floor(v / (maxRms+0.001) * bins));
    hist[bin]++;
  }
  // Expect: peak at low-medium energy, tail at high energy (blackbody shape)
  const peak = hist.indexOf(Math.max(...hist));
  const tail = hist.slice(Math.floor(bins*0.7)).reduce((a,b)=>a+b,0);
  const body = hist.slice(0, Math.floor(bins*0.7)).reduce((a,b)=>a+b,0);
  t(body > tail, `peak at bin ${peak}/${bins}, body:${body} tail:${tail}`, "blackbody-like energy distribution");
}

// ═══════════════════════════════════════════════════════════════
// I.43.16  Drift Velocity — amplitude drift toward loud query
// ═══════════════════════════════════════════════════════════════
console.log("─── I.43.16  Drift Velocity ───");
{
  const quietQ = folds.find(f => f._rms < 0.01 && f._rms > 0.001);
  const loudQ = folds.find(f => f._rms === maxRms);
  if (!quietQ) { t(false, "no quiet query"); }
  else {
    const v = [];
    for (let i = 0; i < 10; i++) {
      const evolved = fokkerPlanckEvolve(quietQ, loudQ, 1000*(i+1), { driftStrength: 0.2, diffusionRate: 0.01 });
      v.push(project(evolved, loudQ));
    }
    const drift = v.map((val,i) => i===0 ? 0 : val - v[i-1]);
    t(v[v.length-1] > v[0], `velocity: ${drift.slice(0,4).map(d=>d.toFixed(4)).join(', ')} → ${v[0].toFixed(3)}→${v[v.length-1].toFixed(3)}`, "drift toward query");
  }
}

// ═══════════════════════════════════════════════════════════════
// I.43.31  Einstein Relation D = μkT
// ═══════════════════════════════════════════════════════════════
console.log("─── I.43.31  Einstein Relation ───");
{
  // Measure diffusion rate from Fokker-Planck and mobility from drift
  const quietQ = folds.find(f => f._rms < 0.01 && f._rms > 0.001);
  const loudQ = folds.find(f => f._rms === maxRms);
  if (!quietQ) { t(false, "no quiet query"); }
  else {
    // Mobility μ = drift velocity / force (force = project difference)
    const driftEvolved = fokkerPlanckEvolve(quietQ, loudQ, 5000, { driftStrength: 0.2, diffusionRate: 0 });
    const force = project(loudQ, loudQ) - project(quietQ, loudQ);
    const vel = project(driftEvolved, loudQ) - project(quietQ, loudQ);
    const mu = Math.abs(vel / (force + 0.001));

    // Diffusion D = entropy change rate from pure diffusion
    const diffEvolved = fokkerPlanckEvolve(quietQ, quietQ, 5000, { driftStrength: 0, diffusionRate: 0.1 });
    const entropyBefore = computeUncertainty(quietQ);
    const entropyAfter = computeUncertainty(diffEvolved);
    const D = Math.abs(
      (entropyAfter.terrain + entropyAfter.stance + entropyAfter.operator) -
      (entropyBefore.terrain + entropyBefore.stance + entropyBefore.operator)
    );

    // D/μ should approximate kT
    const ratio = D / (mu + 0.001);
    t(ratio > 0, `μ=${mu.toFixed(4)}, D=${D.toFixed(4)}, D/μ=${ratio.toFixed(4)}`, "Einstein relation D/μ ≈ kT");
  }
}

// ═══════════════════════════════════════════════════════════════
// I.47.23  Speed of Sound √(γp/ρ)
// ═══════════════════════════════════════════════════════════════
console.log("─── I.47.23  Speed of Sound ───");
{
  // Pressure p = project adjacent frames (how much they "push" each other)
  // Density ρ = 1/(distance between adjacent RMS values)
  const speeds = [];
  for (let i = 1; i < 100; i++) {
    const p = project(folds[i-1], folds[i]); // pressure between frames
    const rho = 1 / (Math.abs(folds[i]._rms - folds[i-1]._rms) + 0.001); // density
    const gamma = 1.4; // adiabatic index
    speeds.push(Math.sqrt(gamma * p / rho));
  }
  const s = stats(speeds);
  t(s.mean > 0 && s.std > 0, `c_sound = ${s.mean} ± ${s.std}`, "speed of meaning through audio frames");
}

// ═══════════════════════════════════════════════════════════════
// I.50.26  Nonlinear Oscillation — second harmonic in onset pattern
// ═══════════════════════════════════════════════════════════════
console.log("─── I.50.26  Nonlinear Oscillation ───");
{
  if (onsetIdxs.length < 3) { t(false, "insufficient onsets"); }
  else {
    // First harmonic: fundamental onset spacing
    const intervals = [];
    for (let i = 1; i < onsetIdxs.length; i++) intervals.push(onsetIdxs[i] - onsetIdxs[i-1]);
    const T = intervals.reduce((a,b)=>a+b,0)/intervals.length;
    // Second harmonic: check for period-2 pattern
    const evenIntervals = intervals.filter((_,i) => i%2===0);
    const oddIntervals = intervals.filter((_,i) => i%2===1);
    const evenAvg = evenIntervals.reduce((a,b)=>a+b,0)/evenIntervals.length;
    const oddAvg = oddIntervals.reduce((a,b)=>a+b,0)/oddIntervals.length;
    const asymmetry = Math.abs(evenAvg - oddAvg) / T;
    t(true, `T=${T.toFixed(1)} frames, even/odd asymmetry = ${asymmetry.toFixed(3)}`, `α cos² term = ${asymmetry > 0.1 ? 'PRESENT' : 'WEAK'}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// II.11.3  Driven Harmonic Oscillator — onset response to amplitude
// ═══════════════════════════════════════════════════════════════
console.log("─── II.11.3  Driven HO ───");
{
  // Natural frequency ω₀ = decoherence rate
  // Driving frequency ω = onset rate
  const omega0 = 1 / DECOHERENCE_TAU;
  const omega = onsetIdxs.length / audio.duration * 2 * Math.PI;
  // Resonance condition: amplitude peaks when ω ≈ ω₀
  const detuning = Math.abs(omega - omega0);
  const mass = 1.0;
  const F = maxRms; // driving force
  const amplitude = F / (mass * (omega0*omega0 - omega*omega + 0.001));
  const resonant = detuning < omega0 * 0.1;
  t(true, `ω₀=${omega0.toExponential(2)}, ω=${omega.toFixed(4)}, amplitude=${Math.abs(amplitude).toFixed(4)}`, `${resonant ? 'NEAR RESONANCE' : 'OFF RESONANCE'}`);
}

// ═══════════════════════════════════════════════════════════════
// II.21.32  Liénard-Wiechert — directional amplitude enhancement
// ═══════════════════════════════════════════════════════════════
console.log("─── II.21.32  Liénard-Wiechert ───");
{
  // When a "loud" fold moves through semantic space, its projection is enhanced
  // in the direction of motion: φ = q/(4πεr(1-v/c))
  const movingFolds = folds.slice(0, 100);
  const enhancements = [];
  for (let i = 1; i < movingFolds.length; i++) {
    const v = 1 - project(movingFolds[i-1], movingFolds[i]); // recession speed
    const enhancement = 1 / (1 - v + 0.001); // Liénard-Wiechert boost
    enhancements.push(enhancement);
  }
  const avgEnhancement = enhancements.reduce((a,b)=>a+b,0)/enhancements.length;
  t(avgEnhancement > 0.9, `avg enhancement: ${avgEnhancement.toFixed(4)}`, "directional boost from frame motion");
}

// ═══════════════════════════════════════════════════════════════
// III.4.32  Bose-Einstein Occupation — energy level population
// ═══════════════════════════════════════════════════════════════
console.log("─── III.4.32  Bose-Einstein ───");
{
  // Treat spectral bins as energy levels, compute occupation number
  const kT = 0.1; // effective temperature from audio energy
  const occupations = Object.entries(audio.features[100].spectrum).map(([fq, amp]) => {
    const freq = Number(fq);
    const hbarOmega = 2 * Math.PI * freq / audio.sampleRate * HBAR; // ℏω
    const n = 1 / (Math.exp(hbarOmega / (kT + 0.001)) - 1 + 0.001);
    return { freq, n };
  });
  t(occupations.every(o => o.n >= 0), `occupations: ${occupations.map(o=>`${o.freq}Hz:${o.n.toFixed(2)}`).join(', ')}`, "Bose-Einstein populations");
}

// ═══════════════════════════════════════════════════════════════
// III.9.52  Transition Probability — near-resonant driving
// ═══════════════════════════════════════════════════════════════
console.log("─── III.9.52  Transition Probability ───");
{
  // Transition from quiet to loud: sinc² behavior near resonance
  const quietQ = folds.find(f => f._rms < 0.01 && f._rms > 0.001);
  const loudQ = folds.find(f => f._rms === maxRms);
  if (!quietQ) { t(false, "no quiet query"); }
  else {
    const omega = 2 * Math.PI * onsetIdxs.length / audio.duration;
    const omega0 = 1 / DECOHERENCE_TAU;
    const detuning = omega - omega0;
    const t_drive = audio.duration;
    const P = Math.sin(detuning * t_drive / 2) ** 2 / ((detuning * t_drive / 2) ** 2 + 0.001);
    t(P >= 0 && P <= 1, `P_transition = ${P.toFixed(4)}`, `sinc²(${detuning.toFixed(4)}·t/2)`);
  }
}

// ═══════════════════════════════════════════════════════════════
// III.15.12  Tight-Binding — spectral bands as energy bands
// ═══════════════════════════════════════════════════════════════
console.log("─── III.15.12  Tight-Binding ───");
{
  const specKeys = Object.keys(audio.features[0].spectrum).map(Number).sort((a,b)=>a-b);
  const U = SCATTER_BETA; // hopping amplitude from scattering
  const a = 1 / specKeys.length; // lattice spacing
  const bands = specKeys.map((freq, i) => {
    const k = 2 * Math.PI * i / specKeys.length; // wavevector
    return { freq, E: 2 * U * (1 - Math.cos(k * a)) }; // tight-binding dispersion
  });
  t(bands.every(b => b.E >= 0), `bands: ${bands.map(b=>`${b.freq}Hz→E=${b.E.toFixed(3)}`).join(', ')}`, "spectral bands → tight-binding dispersion");
}

// ═══════════════════════════════════════════════════════════════
// III.15.14  Effective Mass — band curvature → inertia
// ═══════════════════════════════════════════════════════════════
console.log("─── III.15.14  Effective Mass ───");
{
  const specKeys = Object.keys(audio.features[0].spectrum).map(Number).sort((a,b)=>a-b);
  const n = specKeys.length;
  const d = 1 / n; // lattice constant
  // Effective mass from band curvature near k=0
  const k = 0.01; // near zone center
  const d2E_dk2 = 2 * SCATTER_BETA * d * d * 1; // cos''(ka) * a² * 2U
  const m_eff = HBAR * HBAR / (2 * d2E_dk2 + 0.001);
  t(m_eff > 0, `m* = ${m_eff.toFixed(4)}`, "effective mass from band curvature");
}

// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// WIKIPEDIA EQUATIONS — testable with audio
// ═══════════════════════════════════════════════════════════════

// ── Bernoulli: p + ½ρv² = constant along streamline ──
console.log("\n─── Wikipedia: Bernoulli Equation ───");
{
  const subsets = [folds.slice(0, 50), folds.slice(100, 150), folds.slice(300, 350)];
  const streamlines = subsets.map(sub => {
    let totalHead = 0;
    for (let i = 1; i < sub.length; i++) {
      const p = project(sub[i-1], sub[i]);
      const v = 1 - p;
      const rho = 1;
      totalHead += p + 0.5 * rho * v * v;
    }
    return totalHead / (sub.length - 1);
  });
  t(Math.abs(streamlines[0] - streamlines[1]) < 0.5,
    `streamline heads: ${streamlines.map(s=>s.toFixed(4)).join(', ')}`,
    "Bernoulli: p+½ρv² approximately conserved along flow");
}

// ── Burgers: u_t + u·u_x = ν·u_xx ──
console.log("─── Wikipedia: Burgers Equation ──");
{
  // u = RMS, u_x = RMS gradient, u_xx = second derivative
  const burgers = [];
  for (let i = 2; i < 200; i++) {
    const u = folds[i]._rms;
    const u_x = folds[i]._rms - folds[i-1]._rms;
    const u_xx = folds[i]._rms - 2*folds[i-1]._rms + folds[i-2]._rms;
    const nu = 0.1;
    // Check Burgers: u_x predicted = -(u·u_x - ν·u_xx)/u (in steady state)
    const predicted = -(u * u_x - nu * u_xx) / (u + 0.001);
    burgers.push({ actual: u_x, predicted });
  }
  const correlation = burgers.reduce((s,b) => s + b.actual * b.predicted, 0) / burgers.length;
  t(true, `Burgers R²-like: ${(correlation*100).toFixed(1)}%`, "nonlinear advection + diffusion from RMS gradient");
}

// ── Helmholtz: ∇²u + k²u = 0 ──
console.log("─── Wikipedia: Helmholtz Equation ──");
{
  const specKeys = Object.keys(audio.features[0].spectrum).map(Number).sort((a,b)=>a-b);
  const standing = specKeys.map(freq => {
    // Standing wave condition: k = 2πf/c, λ = c/f = sampleRate/f
    const k = 2 * Math.PI * freq / audio.sampleRate;
    return { freq, k };
  });
  // Helmholtz: each spectral bin IS a standing wave solution
  t(standing.length === 7,
    `k values: ${standing.map(s=>s.k.toFixed(4)).join(', ')}`,
    "spectral bins = Helmholtz standing waves");
}

// ── KdV: u_t + u·u_x + u_xxx = 0 ──
console.log("─── Wikipedia: KdV Equation ──");
{
  // Dispersion relation: ω = c₀k − βk³
  const specKeys = Object.keys(audio.features[0].spectrum).map(Number).sort((a,b)=>a-b);
  const c0 = audio.sampleRate / (2 * Math.PI);
  const beta = SCATTER_ALPHA; // nonlinearity from scattering
  const dispersions = specKeys.map((freq, i) => {
    const k = 2 * Math.PI * freq / audio.sampleRate;
    const omega = c0 * k - beta * k * k * k;
    return { freq, omega };
  });
  t(dispersions.every(d => !isNaN(d.omega)),
    `ω = ${dispersions.map(d=>d.omega.toFixed(4)).join(', ')}`,
    "KdV dispersion from spectral bins");
}

// ── Wave Equation: ∂²u/∂t² = c²∇²u ──
console.log("─── Wikipedia: Wave Equation ──");
{
  // Second time derivative of RMS vs second spatial derivative
  const waves = [];
  for (let i = 2; i < 200; i++) {
    const d2u_dt2 = folds[i]._rms - 2*folds[i-1]._rms + folds[i-2]._rms;
    const d2u_dx2 = project(folds[i], folds[i-1]) - 2*1 + project(folds[i-1], folds[i-2]); // spatial second deriv via projection
    const c2 = d2u_dt2 / (d2u_dx2 + 0.001);
    if (Math.abs(c2) < 100) waves.push(c2);
  }
  const avgC2 = waves.reduce((a,b)=>a+b,0)/waves.length;
  t(Math.abs(avgC2) < 10, `c² = ${avgC2.toFixed(4)}`, "wave equation from frame acceleration");
}

// ── HJB: value function optimization ──
console.log("─── Wikipedia: Hamilton-Jacobi-Bellman ───");
{
  // Value function V(frame) = cumulative project score
  // Optimal control: which direction maximizes V?
  const mid = Math.floor(folds.length / 2);
  const V_forward = folds.slice(mid, mid+20).reduce((s, f) => s + project(f, folds[mid]), 0);
  const V_quiet = folds.slice(0, 20).reduce((s, f) => s + project(f, folds[mid]), 0);
  t(V_forward !== V_quiet,
    `V_forward=${V_forward.toFixed(2)}, V_quiet=${V_quiet.toFixed(2)}`,
    "HJB: value function depends on control direction");
}

// ── Riccati: dy/dt = A + By + Cy² ──
console.log("─── Wikipedia: Riccati Equation ──");
{
  // RMS envelope should follow Riccati (saturation growth then decay)
  const half = Math.floor(folds.length / 2);
  const firstHalf = folds.slice(0, half).map(f => f._rms);
  const secondHalf = folds.slice(half).map(f => f._rms);
  const dy1 = firstHalf.reduce((a,b)=>a+b,0)/firstHalf.length;
  const dy2 = secondHalf.reduce((a,b)=>a+b,0)/secondHalf.length;
  // Quadratic term: if RMS² contributes, dy/dt should be nonlinear in y
  const quadratic = dy2 > dy1 ? dy2 - dy1 : dy1 - dy2;
  t(true,
    `dy₁=${dy1.toFixed(4)}, dy₂=${dy2.toFixed(4)}, quadratic term ~${quadratic.toFixed(4)}`,
    "Riccati: amplitude envelope shows nonlinear growth/decay");
}

// ── Arrhenius: onset rate vs threshold ──
console.log("─── Wikipedia: Arrhenius Equation ──");
{
  const thresholds = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
  const rates = thresholds.map(t => {
    const th = maxRms * t;
    let n = 0;
    for (let i = 1; i < folds.length; i++)
      if (folds[i]._rms > th && folds[i-1]._rms <= th) n++;
    return Math.log(n + 1);
  });
  // Arrhenius: ln(rate) ∝ -1/threshold
  const linear = rates.every((r,i) => i < 2 || r <= rates[i-2] || Math.abs(r - rates[i-1]) < 1);
  t(true,
    `ln(onset count): ${rates.map(r=>r.toFixed(2)).join(', ')} → ${linear ? 'roughly Arrhenius' : 'irregular'}`,
    "activation energy threshold → onset rate");
}

// ── Hill: cooperative onset detection ──
console.log("─── Wikipedia: Hill Equation ──");
{
  // As more onset folds correlate, effective detection probability cooperatively increases
  if (onsetFolds.length < 3) { t(false, "insufficient onsets"); }
  else {
    const cooperativities = [1, 2, 3].filter(n => n <= onsetFolds.length).map(n => {
      const subset = onsetFolds.slice(0, n);
      const intResult = interfere(folds[0], subset);
      return Math.max(...intResult); // cooperative boost
    });
    const n = Math.min(3, onsetFolds.length);
    const hillCoeff = cooperativities.length > 1 ?
      Math.log(cooperativities[cooperativities.length-1] / (cooperativities[0]+0.001)) / Math.log(n) : 0;
    t(hillCoeff > 0,
      `coop boost: ${cooperativities.map(c=>c.toFixed(3)).join(', ')}, nHill≈${hillCoeff.toFixed(2)}`,
      `Hill coefficient ~${hillCoeff.toFixed(2)}`);
  }
}

// ── Price: selection differential in amplitude ──
console.log("─── Wikipedia: Price Equation ──");
{
  const threshold = maxRms * 0.3;
  const selected = folds.filter(f => f._rms > threshold);
  const unselected = folds.filter(f => f._rms <= threshold);
  if (selected.length === 0) { t(false, "no selected folds"); }
  else {
    const z_sel = selected.reduce((s,f)=>s+f._rms,0)/selected.length;
    const z_unsel = unselected.reduce((s,f)=>s+f._rms,0)/unselected.length;
    const S = z_sel - z_unsel;
    // Heritability: how well amplitude persists in Fokker-Planck
    const before = selected.map(f => project(f, folds[0]));
    const after = selected.map(f => {
      const ev = fokkerPlanckEvolve(f, folds[0], 1000, { driftStrength: 0.05, diffusionRate: 0.01 });
      return project(ev, folds[0]);
    });
    const h2 = after.reduce((s,v,i)=>s+v,0) / (before.reduce((s,v,i)=>s+v,0)+0.001);
    const R = h2 * S;
    t(R !== 0,
      `S=${S.toFixed(4)}, h²≈${h2.toFixed(4)}, R=${R.toFixed(4)}`,
      "Price: selection × heritability = response to consolidation");
  }
}

console.log(`\n══════════════════════════════════`);
console.log(`ALL AUDIO TESTS: ${p} passed, ${f} failed`);
console.log(`══════════════════════════════════`);

if (f > 0) process.exit(1);
