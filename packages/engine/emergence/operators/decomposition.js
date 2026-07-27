/**
 * Operator Decomposition — Empirically Testable Equations Only
 *
 * Stripped of pattern-matching. Each entry below is verifiable
 * against the system's actual behavior by running the test engine.
 *
 * Operators:
 *   NUL — negation, decoherence, forgetting, pruning
 *   SEG — segmentation, separation, dimension distinction
 *   DEF — definition, normalization, state declaration
 *   SIG — signal, output, measurement result, relevance score
 *   CON — connection, correlation, entanglement, phase relation
 *   EVA — evaluation, comparison, scoring, ranking
 *   INS — insertion, creation, measurement backaction, ingestion
 *   SYN — synthesis, combination, blending, interference
 *   REC — recording, tracking, memory, priors accumulation
 */

export const OPERATOR_SEMANTICS = {
  NUL: "negation — decoherence e^(−t/τ), uncertainty collapse, pruning",
  SEG: "segmentation — chunking text, separating terrain/stance dimensions",
  DEF: "definition — normalization Σ|ψ|²=1, state declaration, threshold setting",
  SIG: "signaling — Born rule output, relevance score, measurement result",
  CON: "connection — inner product ⟨ψ|φ⟩, phase relation, entanglement edge",
  EVA: "evaluation — scoring, ranking, uncertainty computation, verification",
  INS: "insertion — measurement backaction push, new entry creation, prior bias",
  SYN: "synthesis — interference I₁+I₂+2√(I₁I₂)cosδ, relativistic blend",
  REC: "recording — access log, prior frequency accumulation, measurement history"
};

// Only the equations that are either NATIVE to the system or
// verifiably EMERGENT from composing its primitives.

export const EQUATIONS = [
  // ═══ NATIVE — the system IS this equation ═══

  {
    name: "Born Rule",
    formula: "P = |⟨ψ|φ⟩|²",
    category: "NATIVE",
    chain: "EVA → CON → SYN → SIG",
    inSystem: "project(foldA, foldB) in quantum/index.js",
    testable: "measure P for 1000 random fold pairs, verify 0 ≤ P ≤ 1 and monotonic with inner product",
    operators: { SIG:30, CON:25, EVA:20, SYN:20, DEF:5 }
  },

  {
    name: "Two-Source Interference",
    formula: "I₁+I₂+2√(I₁I₂)cosδ",
    category: "NATIVE",
    chain: "CON → SEG → EVA → SYN → SIG",
    inSystem: "interfere(queryFold, folds) in quantum/index.js",
    testable: "measure interference boost for correlated vs uncorrelated fold pairs, verify cosδ term",
    operators: { CON:25, SYN:25, EVA:20, SEG:15, SIG:15 }
  },

  {
    name: "Heat / Decoherence",
    formula: "e^(−t/τ)",
    category: "NATIVE",
    chain: "NUL → SYN → DEF",
    inSystem: "decohereFold(fold, timeMs) in quantum/index.js",
    testable: "measure amplitude entropy vs time, verify exponential approach to uniform",
    operators: { NUL:45, SYN:30, DEF:25 }
  },

  {
    name: "Uncertainty Principle",
    formula: "Δterrain·Δstance ≥ ℏ",
    category: "NATIVE",
    chain: "EVA → CON → EVA → SIG",
    inSystem: "satisfiesUncertaintyPrinciple(fold) in quantum/index.js",
    testable: "compute entropy product for 1000 folds, verify >0.1 for all superposed states",
    operators: { EVA:50, CON:25, SIG:25 }
  },

  {
    name: "Continuity Equation",
    formula: "Σ|amp|² = 1",
    category: "NATIVE",
    chain: "EVA → SYN → DEF",
    inSystem: "normalizeAmplitudes() in quantum/index.js",
    testable: "verify |ψ|²=1 after every fold/modify/evolve operation",
    operators: { SYN:40, DEF:35, EVA:25 }
  },

  {
    name: "Gaussian Kernel",
    formula: "e^(−(θ/σ)²/2)/(√(2π)·σ)",
    category: "NATIVE",
    chain: "EVA → SYN → SIG",
    inSystem: "gaussianKernel(x, y, σ) in quantum/index.js",
    testable: "verify kernel output ∈ [0,1], peaks at x=y, falls with distance",
    operators: { EVA:40, SYN:40, SIG:20 }
  },

  {
    name: "Relativistic Velocity Addition",
    formula: "(u+v)/(1+uv/c²)",
    category: "NATIVE",
    chain: "CON → SYN → DEF",
    inSystem: "blend(u,v) in measureFold() in quantum/index.js",
    testable: "verify blend(0.5,0.5) < 1.0, blend(0.99,0.99) → 1.0, blend(x,0)=x",
    operators: { SYN:50, CON:30, DEF:20 }
  },

  {
    name: "Law of Cosines (Phase)",
    formula: "√(a²+b²−2ab·cosΔθ)",
    category: "NATIVE",
    chain: "CON → SEG → EVA → SYN",
    inSystem: "computePhase(foldA, foldB) in quantum/index.js",
    testable: "verify phase ∈ [0,π], maximal when folds are orthogonal",
    operators: { CON:30, EVA:30, SYN:25, SEG:15 }
  },

  // ═══ EMERGENT — compose primitives → this equation ═══

  {
    name: "Fokker-Planck",
    formula: "∂P/∂t = −∇·(μP) + ∇²(DP)",
    category: "EMERGENT",
    chain: "INS → CON → NUL → SYN → DEF",
    derivation: "measureFold(drift) ⨟ decohereFold(diffusion) alternated",
    inSystem: "fokkerPlanckEvolve() in physics/index.js",
    testable: "evolve a fold 100 steps under constant query, verify amplitude trajectory matches drift+diffusion prediction",
    operators: { INS:25, NUL:25, CON:20, SYN:20, DEF:10 }
  },

  {
    name: "Michaelis-Menten Saturation",
    formula: "v = Vmax·[S]/(Km+[S])",
    category: "EMERGENT",
    chain: "CON → SYN → DEF → SIG",
    derivation: "relativistic blend (u+v)/(1+uv) has same sigmoidal shape as M-M",
    inSystem: "equivalent to blend() in measureFold()",
    testable: "measure measurement effect at 10 query strengths, fit M-M curve, verify R² > 0.9",
    operators: { SYN:40, CON:25, DEF:20, SIG:15 }
  },

  {
    name: "Navier-Stokes Flow",
    formula: "v ∝ −∇p/μ",
    category: "EMERGENT",
    chain: "EVA → CON → INS → NUL → SYN",
    derivation: "pressure gradient ∇p = queryAmp − entryAmp drives flow with viscosity μ=decoherence resistance",
    inSystem: "navierStokesFlow() in physics/index.js",
    testable: "measure amplitude change rate vs query-entry difference, verify linear proportionality",
    operators: { EVA:25, CON:25, INS:20, NUL:15, SYN:15 }
  },

  {
    name: "Poisson Prior Field",
    formula: "∇²φ = −ρ/ε₀",
    category: "EMERGENT",
    chain: "REC → CON → SYN → DEF",
    derivation: "prior term frequency ρ is charge density; fold amplitude φ is potential",
    inSystem: "computeTerrainAmplitudes(priors) in quantum/index.js fold()",
    testable: "measure correlation between term prior frequency and amplitude bias, verify monotonic",
    operators: { REC:30, CON:30, SYN:25, DEF:15 }
  },

  {
    name: "Boltzmann Distribution",
    formula: "P(survive) = e^(−E/kT)",
    category: "EMERGENT",
    chain: "REC → EVA → NUL → SIG",
    derivation: "consolidation already prunes by age(E) and access(T)",
    inSystem: "boltzmannSurvival() in physics/index.js",
    testable: "sort entries by age per access, verify survival probability follows exponential decay",
    operators: { NUL:35, REC:25, EVA:25, SIG:15 }
  },

  {
    name: "Lotka-Volterra Competition",
    formula: "dx/dt = αx − βxy",
    category: "EMERGENT",
    chain: "SEG → EVA → CON → INS → NUL",
    derivation: "classify() winner-take-all + normalizeAmplitudes() zero-sum = terrain competition",
    inSystem: "lotkaVolterraTerrain() in physics/index.js",
    testable: "ingest entity-heavy text, measure terrain amplitude trajectory, verify dominant terrain suppresses others",
    operators: { SEG:25, CON:25, EVA:20, INS:15, NUL:15 }
  },

  {
    name: "Schrödinger Evolution",
    formula: "iℏ∂ψ/∂t = Ĥψ",
    category: "EMERGENT",
    chain: "DEF → CON → SYN → EVA → SIG",
    derivation: "measureFold({oscillate:true}) already computes sin²(Et/ℏ) — extend to unitary rotation",
    inSystem: "schrodingerEvolve() in physics/index.js",
    testable: "evolve fold under fixed query, verify amplitude oscillates at frequency E/ℏ",
    operators: { SYN:30, CON:25, DEF:20, EVA:15, SIG:10 }
  },

  {
    name: "Euler-Lagrange Optimal K",
    formula: "argmin_K(−(relevance − cost))",
    category: "EMERGENT",
    chain: "DEF → EVA → SYN → EVA → SIG",
    derivation: "search path through semantic space has Lagrangian L = relevance − cost",
    inSystem: "eulerLagrangeOptimalK() in physics/index.js",
    testable: "run search with increasing K, measure action, verify optimal K at stationary point where marginal benefit=marginal cost",
    operators: { EVA:40, DEF:20, SYN:20, SIG:20 }
  },

  {
    name: "N-Slit Interference",
    formula: "I₀·sin²(nθ/2)/sin²(θ/2)",
    category: "EMERGENT",
    chain: "SEG → CON → EVA → SYN → SIG",
    derivation: "interfere() with N folds = N-source interference pattern",
    inSystem: "interfere(query, [fold₁...fold_n]) in quantum/index.js",
    testable: "measure interference boost for 2,3,5,10 correlated folds, verify pattern sharpens with N",
    operators: { CON:25, SYN:25, SEG:20, EVA:20, SIG:10 }
  }
];

// Derivation chains from three-layer ontology

export const DERIVATION_CHAINS = {
  arithmetic: {
    name: "Layer 1 → Statistical Mechanics",
    from: "fold(text, priors) — counting, frequency, amplitudes",
    chain: "REC(wordFreq) → EVA(amplitude) → DEF(normalize) → SIG(probability)",
    produces: ["Born Rule", "Gaussian Kernel", "Continuity", "Boltzmann", "Uncertainty"]
  },
  geometry: {
    name: "Layer 2 → Wave Phenomena & Field Theory",
    from: "classify() + correlate() — entity/relation positions, phase",
    chain: "SEG(terrain/stance) → CON(correlate) → SYN(interfere) → SIG(pattern)",
    produces: ["Interference", "Law of Cosines", "Poisson", "Lotka-Volterra", "N-Slit"]
  },
  calculus: {
    name: "Layer 3 → Dynamics & Evolution",
    from: "evaluateSurprise() + consolidate() — rates, backaction, pruning",
    chain: "NUL(decohere) → INS(measure) → SYN(evolve) → SIG(surprise)",
    produces: ["Fokker-Planck", "Navier-Stokes", "Schrödinger", "Michaelis-Menten", "Euler-Lagrange"]
  }
};
