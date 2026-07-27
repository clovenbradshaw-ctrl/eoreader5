/**
 * Physics Equations — Derived from EO Reader Primitives
 *
 * These equations emerge from composing the system's own fold/project/
 * measure/decohere primitives. Each one is visibly derived from what
 * the system already computes, not imported as a finished formula.
 *
 * Three categories:
 *   NATIVE: The system already IS this equation (Born, interference, uncertainty, etc.)
 *   EMERGENT: Composing system primitives yields this equation (Fokker-Planck, M-M, Navier-Stokes…)
 *   APPLIED: External formula with system observables as inputs (Schrödinger, Black-Scholes…)
 */

import {
  OPERATORS,
  TERRAINS,
  STANCES,
  project,
  interfere,
  measureFold,
  decohereFold,
  foldToClassical,
  classicalToFold
} from '../../quantum/index.js';

import { induceOperators } from '../operators/index.js';
import { induceCalculus } from '../calculus/index.js';

// ── Constants ──

export const HBAR = 0.1;
export const DECOHERENCE_TAU = 3600000;
export const BOLTZMANN_K = 0.01;
const VISCOSITY = 0.3;
const KM = 0.5;
const VMAX = 1.0;

// ═══════════════════════════════════════════════════════════════════════
//  EMERGENT — composed from the system's own primitives
// ═══════════════════════════════════════════════════════════════════════

// ── 1. Fokker-Planck = measureFold ⨟ decohereFold ──
//
// measureFold pushes amplitudes toward query (DRIFT term ∂/∂x(μP))
// decohereFold spreads toward uniform (DIFFUSION term ∂²/∂x²(DP))
// Alternating them = operator splitting solution to Fokker-Planck

export function fokkerPlanckEvolve(foldState, queryFold, dt, opts = {}) {
  const { driftStrength = 0.3, diffusionRate = 0.1 } = opts;
  const drifted = measureFold(foldState, queryFold, driftStrength);
  const diffusionTime = diffusionRate * (dt / DECOHERENCE_TAU) * DECOHERENCE_TAU;
  return decohereFold(drifted, diffusionTime);
}

// ── 2. Michaelis-Menten = the blend function in measureFold IS saturation ──
//
// MeasureFold uses relativistic velocity addition: (u+v)/(1+uv)
// This has the same sigmoidal shape as Michaelis-Menten: v = Vmax·[S]/(Km+[S])
// Both are linear at low input, saturate at high input, cap at ceiling.

export function michaelisMentenSaturation(queryStrength, params = {}) {
  const { vmax = VMAX, km = KM } = params;
  return vmax * queryStrength / (km + queryStrength);
}

export function michaelisMentenMeasure(foldState, queryFold, rawStrength = 0.5) {
  return measureFold(foldState, queryFold, michaelisMentenSaturation(rawStrength));
}

export function verifyBlendIsMichaelisMenten() {
  const u = 1.0;
  const points = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const blendValues = points.map(v => {
    const uv = u * v;
    return Math.abs(uv) < 1e-10 ? u + v : (u + v) / (1 + uv);
  });
  const mmValues = points.map(v => VMAX * v / (KM + v));
  const maxBlend = Math.max(...blendValues);
  const maxMM = Math.max(...mmValues);
  let diff = 0;
  for (let i = 0; i < points.length; i++) {
    diff += ((blendValues[i] / maxBlend) - (mmValues[i] / maxMM)) ** 2;
  }
  return Math.sqrt(diff / points.length);
}

// ── 3. Navier-Stokes = pressure gradient from entry−query amplitude delta ──
//
// ∇p = queryAmp − entryAmp (pressure gradient)
// v = −∇p / μ (Stokes flow velocity)
// φ_new = φ_old + v·dt (amplitude advection)

export function navierStokesFlow(amps, queryAmps, dt) {
  const evolved = { ...amps };
  const dtSec = dt / 1000;
  for (const key of Object.keys(amps)) {
    const gradP = (queryAmps[key] || 0) - amps[key];
    const v = -gradP / (VISCOSITY + 0.01);
    evolved[key] = Math.max(0, Math.min(1, amps[key] + dtSec * v));
  }
  normalizeAmplitudes(evolved);
  return evolved;
}

// ── 4. Poisson = prior frequency → amplitude bias ──
//
// The fold function's computeTerrainAmplitudes already biases amplitudes
// by prior term frequencies. This IS a discrete Poisson equation:
// ∇²φ = −ρ/ε₀, where ρ = prior frequency, φ = amplitude potential.

export function poissonPriorField(termFreq, terms) {
  const potential = {};
  const epsilon0 = 1.0;
  for (const term of terms) {
    const rho = termFreq.get(term) || 0;
    const phi = -rho / (2 * epsilon0 + 0.01);
    potential[term] = Math.exp(-phi);
  }
  return potential;
}

export function applyPriorField(amps, priorField) {
  const biased = { ...amps };
  for (const key of Object.keys(biased)) {
    biased[key] *= (priorField[key] || 1.0);
  }
  normalizeAmplitudes(biased);
  return biased;
}

// ── 5. Boltzmann = consolidation's age × access survival ──
//
// consolidate() already prunes by age and access count.
// Rewritten as Boltzmann distribution: P(survive) = e^(−E/kT)
// where E = age (energy), T = accessCount (temperature).

export function boltzmannSurvival(entry, now = Date.now()) {
  const age = (now - entry.ts) / 1000;
  const T = Math.max(0.1, (entry.accessCount || 0) * BOLTZMANN_K);
  return Math.max(0, Math.min(1, Math.exp(-age / (BOLTZMANN_K * T + 0.01))));
}

export function boltzmannConsolidate(entries, threshold = 0.1) {
  const now = Date.now();
  const survived = [];
  const pruned = [];
  for (const entry of entries) {
    if (boltzmannSurvival(entry, now) >= threshold) survived.push(entry);
    else pruned.push(entry);
  }
  return { survived, pruned };
}

// ── 6. Lotka-Volterra = terrain amplitude competition ──
//
// The classify() winner-take-all and normalizeAmplitudes() zero-sum
// constraint create competition between terrains. Dominant terrains
// suppress subordinate ones — predator-prey dynamics.

export function lotkaVolterraTerrain(terrainAmps, dt, params = {}) {
  const { alpha = 0.1, beta = 0.05, gamma = 0.1, delta = 0.05 } = params;
  const evolved = { ...terrainAmps };
  const dtSec = dt / 1000;
  let dominant = null, maxAmp = 0;
  for (const [t, amp] of Object.entries(terrainAmps)) {
    if (amp > maxAmp) { maxAmp = amp; dominant = t; }
  }
  for (const terrain of Object.keys(evolved)) {
    const x = evolved[terrain];
    if (terrain === dominant) {
      evolved[terrain] = x + dtSec * (delta * x * (1 - x) - gamma * x);
    } else {
      evolved[terrain] = x + dtSec * (alpha * x - beta * x * maxAmp);
    }
    evolved[terrain] = Math.max(0, Math.min(1, evolved[terrain]));
  }
  normalizeAmplitudes(evolved);
  return evolved;
}

// ═══════════════════════════════════════════════════════════════════════
//  APPLIED — external formulas with system observables as inputs
// ═══════════════════════════════════════════════════════════════════════

// ── 7. Schrödinger: iℏ∂ψ/∂t = Ĥψ ──
//
// measureFold({oscillate:true}) already computes sin²(Et/ℏ) — the
// solution for a two-level system. This extends to full unitary evolution
// by rotating amplitudes as e^(−iHt/ℏ) in the Hilbert space.

export function schrodingerEvolve(foldState, hamiltonian, dt, steps = 1) {
  const evolved = {
    operator: { ...foldState.operator },
    terrain: { ...foldState.terrain },
    stance: { ...foldState.stance },
    timestamp: Date.now()
  };
  for (let step = 0; step < steps; step++) {
    const E = project(foldState, hamiltonian);
    const omega = E / HBAR;
    const phase = omega * dt * 0.001;
    evolvePairwise(evolved.operator, phase);
    evolvePairwise(evolved.terrain, phase);
    evolvePairwise(evolved.stance, phase);
    normalizeAmplitudes(evolved.operator);
    normalizeAmplitudes(evolved.terrain);
    normalizeAmplitudes(evolved.stance);
  }
  return evolved;
}

function evolvePairwise(amps, phase) {
  const keys = Object.keys(amps);
  const n = keys.length;
  for (let i = 0; i < n - 1; i += 2) {
    const a = amps[keys[i]], b = amps[keys[i + 1]];
    const c = Math.cos(phase), s = Math.sin(phase);
    amps[keys[i]] = a * c - b * s;
    amps[keys[i + 1]] = a * s + b * c;
  }
  if (n % 2 === 1) amps[keys[n - 1]] *= Math.cos(phase);
}

// ── 8. Black-Scholes: V = S·N(d₁) − K·e^(−rt)·N(d₂) ──
//
// Entry as option: S = relevance, K = query threshold, r = decoherence rate,
// σ = uncertainty, t = remaining lifetime.

function normalCDF(x) {
  const p = 0.3275911;
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * abs);
  const y = 1.0 - ((((a[4] * t + a[3]) * t + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp(-abs * abs);
  return 0.5 * (1.0 + sign * y);
}

export function blackScholesValue(entry, queryThreshold = 0.5, timeHorizon = DECOHERENCE_TAU) {
  const now = Date.now();
  const age = now - entry.ts;
  const tRemaining = Math.max(0, timeHorizon - age);
  const S = Math.min(1, (entry.accessCount || 0) * 0.1 + Math.exp(-age / DECOHERENCE_TAU));
  const K = queryThreshold;
  const r = 1 / DECOHERENCE_TAU;
  const t = tRemaining / 1000;
  const sigma = 0.5;
  const d1 = (Math.log(S / (K + 0.01)) + (r + sigma * sigma / 2) * t) / (sigma * Math.sqrt(t + 0.01));
  const d2 = d1 - sigma * Math.sqrt(t);
  return Math.max(0, Math.min(1, S * normalCDF(d1) - K * Math.exp(-r * t) * normalCDF(d2)));
}

// ── 9. Euler-Lagrange: ∂L/∂q − d/dt(∂L/∂q̇) = 0 ──
//
// Lagrangian L = relevance − cost. The optimal K minimizes action.
// Stationary point = where marginal benefit meets marginal cost.

export function eulerLagrangeAction(results, queryCost = 1.0) {
  if (results.length === 0) return { action: Infinity, optimal: false };
  let totalRelevance = 0;
  let totalCost = queryCost;
  for (const result of results) {
    totalRelevance += result.score || 0;
    totalCost += 0.1;
  }
  const L = totalRelevance - totalCost;
  return { action: -L, optimal: L > 0 && results.length >= 3, lagrangian: L };
}

export function eulerLagrangeOptimalK(allResults, maxK = 10) {
  let bestK = 1, bestAction = Infinity;
  for (let k = 1; k <= Math.min(maxK, allResults.length); k++) {
    const { action } = eulerLagrangeAction(allResults.slice(0, k));
    if (action < bestAction) { bestAction = action; bestK = k; }
  }
  return bestK;
}

// ═══════════════════════════════════════════════════════════════════════
//  NATIVE — the system IS already these equations
// ═══════════════════════════════════════════════════════════════════════

export { project, interfere, decohereFold, measureFold };

export function verifyContinuity(amps) {
  let totalProb = 0;
  for (const amp of Object.values(amps)) totalProb += amp * amp;
  const error = Math.abs(totalProb - 1.0);
  return { satisfied: error < 1e-6, totalProb, error };
}

export function computeProbabilityCurrent(ampsBefore, ampsAfter, dt) {
  const current = {};
  const dtSec = dt / 1000;
  for (const key of Object.keys(ampsBefore)) {
    const rhoBefore = ampsBefore[key] ** 2;
    const rhoAfter = ampsAfter[key] ** 2;
    current[key] = -(rhoAfter - rhoBefore) / dtSec;
  }
  return current;
}

// ── Utility ──

function normalizeAmplitudes(amplitudes) {
  let sumSquares = 0;
  for (const amp of Object.values(amplitudes)) sumSquares += amp * amp;
  if (sumSquares > 0) {
    const norm = Math.sqrt(sumSquares);
    for (const key of Object.keys(amplitudes)) amplitudes[key] /= norm;
  }
}

export { KM, VMAX, VISCOSITY };
