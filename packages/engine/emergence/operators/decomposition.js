/**
 * Operator Decomposition: All Equations → EO Cube 9 Operators
 *
 * Each equation/family is decomposed into its operator chain.
 * Operators are the fundamental actions of the system:
 *
 *   NUL — negate, void, clear, remove, delete (decoherence, forgetting)
 *   SEG — segment, divide, split, partition (chunking, distinguishing)
 *   DEF — define, declare, specify, normalize (state definition, rules)
 *   SIG — signal, reveal, show, indicate (Born rule, relevance output)
 *   CON — connect, link, relate, depend (entanglement, correlation)
 *   EVA — evaluate, judge, compare, measure (scoring, ranking)
 *   INS — insert, create, make, build (ingestion, measurement backaction)
 *   SYN — synthesize, combine, merge, blend (interference, normalization)
 *   REC — record, track, log, capture (priors, access log, history)
 *
 * Format for each entry:
 *   EQUATION NAME (family)
 *     OPERATOR_CHAIN: OP1 → OP2 → OP3 → ...
 *     DERIVATIONS: [Feynman refs] or [Wikipedia equations]
 *     IN_SYSTEM: function_call() or compose(primitive1, primitive2)
 */

// ═══════════════════════════════════════════════════════════════════════
//  PART 1: THE OPERATOR MEANINGS IN PHYSICS CONTEXT
// ═══════════════════════════════════════════════════════════════════════

const OPERATOR_SEMANTICS = {

  NUL: "negation — clears old state, voids structure, removes information. " +
    "Decoherence e^(−t/τ) = NUL applied continuously. Uncertainty collapse = NUL⨟DEF. " +
    "Pruning = NUL on low-probability entries. Forgetting = NUL over time.",

  SEG: "segmentation — divides, partitions, distinguishes. " +
    "Chunking text into verbatims = SEG. Separating operator/terrain/stance dimensions = SEG. " +
    "Distinguishing between classical/quantum regimes = SEG. Phase binning = SEG.",

  DEF: "definition — establishes structure, declares state, sets rules. " +
    "Normalization Σ|ψ|² = 1 = DEF. foldToClassical = DEF. State definition = DEF. " +
    "Hamiltonian specification = DEF. Threshold setting = DEF. Rule declaration = DEF.",

  SIG: "signal — reveals, shows, outputs, indicates. " +
    "Born rule probability output = SIG. Relevance score = SIG. Query result = SIG. " +
    "Measurement outcome = SIG. Interference pattern visibility = SIG.",

  CON: "connection — links, relates, correlates, depends. " +
    "Inner product ⟨ψ|φ⟩ = CON. Phase relationship between folds = CON. " +
    "Entanglement graph edge = CON. Prior-to-fold coupling = CON. " +
    "Terrain-stance correlation = CON. Access-to-survival causality = CON.",

  EVA: "evaluation — judges, compares, measures, assesses. " +
    "Relevance scoring = EVA. Uncertainty computation = EVA. Score ranking = EVA. " +
    "Phase distance calculation = EVA. Verification of continuity = EVA. " +
    "Threshold comparison = EVA. Optimal K determination = EVA.",

  INS: "insertion — creates, adds, makes, builds. " +
    "Measurement backaction push into fold = INS. New entry ingestion = INS. " +
    "Prior field bias injection = INS. Query pressure source = INS. " +
    "New structure from extraction = INS.",

  SYN: "synthesis — combines, merges, blends, integrates. " +
    "Interference sum I₁+I₂+2√(I₁I₂)·cosδ = SYN. Relativistic blend (u+v)/(1+uv) = SYN. " +
    "Normalization (combining amplitudes into unit vector) = SYN. " +
    "Entanglement propagation = SYN. Gaussian smoothing = SYN.",

  REC: "recording — tracks, logs, remembers, captures. " +
    "Access log entries = REC. Prior frequency accumulation = REC. " +
    "Measurement history = REC. Entity tracking in priors = REC. " +
    "Consolidation memory = REC."
};

// ═══════════════════════════════════════════════════════════════════════
//  PART 2: NATIVE EQUATIONS (already in quantum.js)
// ═══════════════════════════════════════════════════════════════════════
//
// These ARE the system. Born, Interference, Heat, Uncertainty,
// Continuity, Wave equation, Gaussian, Relativistic addition,
// Law of cosines, Anisotropic scattering.

const NATIVE_EQUATIONS = [

  // ── Born Rule: P = |⟨ψ|φ⟩|² ──
  // I.37.4 precursor, III.8.54 measurement
  {
    name: "Born Rule",
    f: "P = |⟨ψ|φ⟩|²",
    chain: "EVA → CON → SYN → SIG",
    breakdown: {
      EVA: "select target fold to measure against query basis",
      CON: "innerProductAmplitudes() — connect query and entry via dot product",
      SYN: "multiply operator·terrain·stance inner products — synthesize into one amplitude",
      SIG: "return amplitude² — signal the measurement probability"
    },
    inSystem: {
      call: "project(queryFold, entryFold)",
      file: "quantum.js:409",
      operators: { EVA: 25, CON: 25, SYN: 25, SIG: 25 }
    }
  },

  // ── Two-Source Interference: I₁+I₂+2√(I₁I₂)·cosδ ──
  // I.37.4, III.17.37
  {
    name: "Two-Source Interference",
    f: "I₁+I₂+2√(I₁I₂)·cosδ",
    chain: "CON → SEG → EVA → SYN → SIG",
    breakdown: {
      CON: "computePhase(fold_i, fold_j) — connect folds via phase",
      SEG: "pairwise phase computation — segment into fold pairs",
      EVA: "compute individual intensities I_i = |amp_i|²",
      SYN: "scattering kernel β(1+α·cosδ) — synthesize interference kernel",
      SIG: "return boosted intensities — signal the interference effect"
    },
    inSystem: {
      call: "interfere(queryFold, folds)",
      file: "quantum.js:478",
      operators: { CON: 25, SYN: 25, EVA: 20, SEG: 15, SIG: 15 }
    }
  },

  // ── Heat Equation / Diffusion: ∂u/∂t = α∇²u → e^(−t/τ) ──
  // I.40.1 barometric = same form
  {
    name: "Heat Equation / Decoherence",
    f: "e^(−t/τ)",
    chain: "NUL → SYN → DEF",
    breakdown: {
      NUL: "decay factor = e^(−time/τ) — negate old amplitude structure",
      SYN: "blend decayed amplitude with uniform — synthesize toward equilibrium",
      DEF: "renormalize — define new normalized state"
    },
    inSystem: {
      call: "decohereFold(fold, timeMs)",
      file: "quantum.js:754",
      operators: { NUL: 45, SYN: 30, DEF: 25, governors: "NUL-dominant: forgetting rate controls everything" }
    }
  },

  // ── Uncertainty Principle: Δx·Δp ≥ ħ ──
  // I.34.27 ℏω = energy quantum
  {
    name: "Uncertainty Principle",
    f: "Δterrain · Δstance ≥ ℏ",
    chain: "EVA → CON → EVA → SIG",
    breakdown: {
      EVA: "computeUncertainty(fold) — Shannon entropy per dimension",
      CON: "multiply terrain and stance uncertainties — correlate conjugate variables",
      EVA: "compare product to ℏ = 0.1 — evaluate if principle holds",
      SIG: "return boolean — signal satisfaction or violation"
    },
    inSystem: {
      call: "satisfiesUncertaintyPrinciple(fold)",
      file: "quantum.js:738",
      operators: { EVA: 50, CON: 25, SIG: 25, governors: "EVA-dominant: entropy computation is pure evaluation" }
    }
  },

  // ── Continuity Equation: ∂ρ/∂t + ∇·J = 0 ──
  {
    name: "Continuity (Probability Conservation)",
    f: "Σ|amp|² = 1",
    chain: "EVA → SYN → DEF",
    breakdown: {
      EVA: "compute sum of squared amplitudes — evaluate total probability",
      SYN: "compute normalization factor 1/√(Σ|amp|²) — synthesize correction",
      DEF: "divide all amplitudes by norm — define new normalized state"
    },
    inSystem: {
      call: "normalizeAmplitudes(amps)",
      file: "quantum.js:599",
      operators: { SYN: 40, DEF: 35, EVA: 25, governors: "SYN-dominant: normalization is synthesis" }
    }
  },

  // ── Wave Equation / Oscillatory Measurement: sin²(Et/ℏ) ──
  // III.8.54
  {
    name: "Wave/Oscillatory Measurement",
    f: "sin²(Et/ℏ)",
    chain: "EVA → CON → SYN → DEF",
    breakdown: {
      EVA: "compute energy E = project(fold, hamiltonian)",
      CON: "compute frequency ω = E/ℏ — connect energy to oscillation rate",
      SYN: "sin²(ωt) — synthesize oscillatory envelope from frequency and time",
      DEF: "set effective strength = strength × sin² — define modulated backaction"
    },
    inSystem: {
      call: "measureFold(fold, basis, strength, {oscillate:true})",
      file: "quantum.js:544",
      operators: { CON: 30, SYN: 30, EVA: 25, DEF: 15, governors: "CON+SYN dominant: energy-frequency coupling is connection then synthesis" }
    }
  },

  // ── Gaussian Kernel: e^(−(θ/σ)²/2)/(√(2π)·σ) ──
  // I.6.2, I.6.2a, I.6.2b
  {
    name: "Gaussian Kernel",
    f: "e^(−(θ/σ)²/2)/(√(2π)·σ)",
    chain: "EVA → SYN → SIG",
    breakdown: {
      EVA: "compute squared distance (x−y)² — evaluate dissimilarity",
      SYN: "exp(−dist²/(2σ²))/(√(2π)·σ) — synthesize kernel from distance",
      SIG: "return similarity ∈ [0,1] — signal the smooth proximity"
    },
    inSystem: {
      call: "gaussianKernel(x, y, sigma)",
      file: "quantum.js:50",
      operators: { EVA: 40, SYN: 40, SIG: 20 }
    }
  },

  // ── Relativistic Velocity Addition: (u+v)/(1+uv/c²) ──
  // I.16.6
  {
    name: "Relativistic Velocity Addition",
    f: "(u+v)/(1+uv)",
    chain: "CON → SYN → DEF",
    breakdown: {
      CON: "multiply u×v — connect the two velocities via Lorentz coupling term",
      SYN: "(u+v)/(1+uv) — synthesize relativistic sum from individual contributions",
      DEF: "ensure bounded output ∈ [−1,1] — define the relativistic limit"
    },
    inSystem: {
      call: "blend(u, v) in measureFold()",
      file: "quantum.js:562",
      operators: { SYN: 50, CON: 30, DEF: 20, governors: "SYN-dominant: this IS synthesis par excellence" }
    }
  },

  // ── Law of Cosines: √(a²+b²−2ab·cosθ) ──
  // I.29.16
  {
    name: "Law of Cosines",
    f: "√(a²+b²−2ab·cosθ)",
    chain: "CON → SEG → EVA → SYN",
    breakdown: {
      CON: "compute terrain/stance inner products — connect dimension clouds",
      SEG: "separate into terrain distance and stance distance — segment the problem",
      EVA: "compute delta-theta = acos(cross-correlation) — evaluate angle",
      SYN: "√(a²+b²−2ab·cosΔθ) — synthesize combined phase from angular distance"
    },
    inSystem: {
      call: "computePhase(foldA, foldB)",
      file: "quantum.js:513",
      operators: { CON: 30, EVA: 30, SYN: 25, SEG: 15, governors: "CON+EVA dominant: angle computation is connection then evaluation" }
    }
  },

  // ── Anisotropic Scattering: β(1+α·cosθ) ──
  // III.17.37
  {
    name: "Anisotropic Scattering Kernel",
    f: "β(1+α·cosθ)",
    chain: "CON → EVA → SYN",
    breakdown: {
      CON: "cos(phase) — connect scattering probability to fold-fold angle",
      EVA: "determine α·cosθ directionality — evaluate forward/backward bias",
      SYN: "β·(1+α·cosθ) — synthesize kernel from base rate + anisotropic term"
    },
    inSystem: {
      call: "kernel in interfere()",
      file: "quantum.js:499",
      operators: { CON: 35, SYN: 35, EVA: 30, governors: "CON+SYN equal: phase connection is as important as kernel synthesis" }
    }
  }
];

// ═══════════════════════════════════════════════════════════════════════
//  PART 3: EMERGENT EQUATIONS (compose primitives → new equations)
// ═══════════════════════════════════════════════════════════════════════
//
// These emerge naturally when you compose the system's own primitives.
// They aren't imported — they fall out of the fold machinery.

const EMERGENT_EQUATIONS = [

  // ── Fokker-Planck = measureFold ⨟ decohereFold ──
  {
    name: "Fokker-Planck Equation",
    f: "∂P/∂t = −∇·(μP) + ∇²(DP)",
    chain: "INS → CON → NUL → SYN → DEF",
    breakdown: {
      INS: "measureFold(fold, query, driftStrength) — insert query pressure into fold",
      CON: "drift term ∇·(μP): connect fold amplitudes to query via measurement correlation",
      NUL: "decohereFold(fold, diffusionTime) — negate ordered structure through random spread",
      SYN: "diffusion term ∇²(DP): synthesize uniform distribution from decayed amplitudes",
      DEF: "renormalize → define new probability distribution after drift+diffusion step"
    },
    derivation: {
      from: "measureFold ⨟ decohereFold alternated",
      driftComesFrom: "measureFold backaction velocity μ = (1−project)×strength",
      diffusionComesFrom: "decohereFold decay rate D = 1/DECOHERENCE_TAU",
      feynman: ["I.43.16 drift velocity", "I.43.31 Einstein relation D=μkT"]
    },
    operators: { INS: 25, CON: 20, NUL: 25, SYN: 20, DEF: 10 }
  },

  // ── Michaelis-Menten = relativistic blend IS saturation ──
  {
    name: "Michaelis-Menten Kinetics",
    f: "v = Vmax·[S]/(Km+[S])",
    chain: "CON → SYN → DEF → SIG",
    breakdown: {
      CON: "couple substrate [S] to enzyme Vmax via Km — connect query strength to saturation",
      SYN: "(u+v)/(1+uv) IS blending — synthesize saturated rate from input",
      DEF: "parameterize with Vmax, Km — define enzyme kinetics constants",
      SIG: "return v ∈ [0, Vmax] — signal the measurable effect"
    },
    derivation: {
      from: "The blend function in measureFold",
      proof: "blend(u, v) = Vmax·v/(Km+v) when u=1, Vmax=1, Km=1",
      shapeIdentical: "Both are sigmoidal with linear regime → saturation regime → ceiling",
      feynman: ["II.35.21 tanh saturation = same shape"]
    },
    operators: { SYN: 40, CON: 25, DEF: 20, SIG: 15 }
  },

  // ── Navier-Stokes = pressure gradient drive ──
  {
    name: "Navier-Stokes Flow",
    f: "ρ(∂v/∂t+v·∇v) = −∇p + μ∇²v + f",
    chain: "EVA → CON → INS → NUL → SYN",
    breakdown: {
      EVA: "compute ∇p = queryAmp − entryAmp — evaluate pressure gradient",
      CON: "relate velocity v to pressure via v = −∇p/μ — connect force to flow",
      INS: "advect amplitudes: φ_new = φ_old + v·dt — insert flow displacement",
      NUL: "viscosity term μ∇²v — negate sharp gradients through dissipation",
      SYN: "renormalize — synthesize new amplitude distribution after flow"
    },
    derivation: {
      from: "The amplitude gradient between query fold and entry fold",
      pressure_is: "query amplitude (high pressure source)",
      viscosity_is: "decoherence resistance (how stubbornly the fold holds its shape)",
      feynman: ["I.43.16 drift velocity = Stokes flow limit"]
    },
    operators: { EVA: 25, CON: 25, INS: 20, NUL: 15, SYN: 15 }
  },

  // ── Poisson = prior frequency field ──
  {
    name: "Poisson Equation",
    f: "∇²φ = −ρ/ε₀",
    chain: "REC → CON → SYN → DEF",
    breakdown: {
      REC: "priors.termFreq — recorded prior frequencies are the charge distribution ρ",
      CON: "∇²φ = −ρ/ε₀ — connect amplitude potential φ to prior charge ρ via Laplacian",
      SYN: "φ ≈ −ρ/(2ε₀) — synthesize potential from charge (1D Green's function)",
      DEF: "fold_op[k] *= exp(−φ) — define amplitude bias from potential"
    },
    derivation: {
      from: "computeTerrainAmplitudes(priors) and computeOperatorAmplitudes(priors)",
      priorFreqIsCharge: "word count in priors = charge density at that semantic location",
      foldAmplitudeIsPotential: "the amplitude for a terrain = the potential at that point",
      feynman: ["I.9.18 gravity = same 1/r² form"]
    },
    operators: { REC: 30, CON: 30, SYN: 25, DEF: 15, governors: "REC+CON dominant: recording priors and connecting them to amplitudes is the core" }
  },

  // ── Boltzmann Distribution = consolidation survival ──
  {
    name: "Boltzmann Distribution",
    f: "P(E) ∝ e^(−E/kT)",
    chain: "REC → EVA → NUL → SIG",
    breakdown: {
      REC: "accessLog counts — recorded measurement frequency defines temperature T",
      EVA: "compute age E = now − entry.ts — evaluate entry's energy",
      NUL: "e^(−E/kT) — negate survival probability proportionally to age, inversely to access",
      SIG: "P(survive) ∈ [0,1] — signal whether entry survives thermal equilibrium"
    },
    derivation: {
      from: "consolidate() pruning logic",
      energyIs: "age of entry (older = higher energy = less stable)",
      temperatureIs: "access frequency (hot = frequently accessed = survives longer)",
      feynman: ["I.40.1 barometric = same exponential form", "I.43.31 Einstein relation"]
    },
    operators: { NUL: 35, REC: 25, EVA: 25, SIG: 15, governors: "NUL-dominant: pruning IS negation" }
  },

  // ── Lotka-Volterra = terrain competition ──
  {
    name: "Lotka-Volterra Competition",
    f: "dx/dt = αx − βxy",
    chain: "SEG → EVA → CON → INS → NUL",
    breakdown: {
      SEG: "separate terrains into dominant (predator) and subordinate (prey)",
      EVA: "find maxAmplitude terrain — evaluate which terrain is dominant",
      CON: "βxy term — connect terrain amplitudes via competitive coupling",
      INS: "αx growth — insert natural growth into subordinate terrains",
      NUL: "−βxy suppression — negate prey growth proportionally to predator strength"
    },
    derivation: {
      from: "classify() winner-take-all and normalizeAmplitudes() zero-sum constraint",
      predatorIs: "dominant terrain (highest amplitude)",
      preyIs: "subordinate terrains (lower amplitudes)",
      carryingCapacity: "normalization ceiling = 1.0 (Σ|amp|² = 1)"
    },
    operators: { SEG: 25, EVA: 20, CON: 25, INS: 15, NUL: 15 }
  },

  // ── Langevin Equation = measurement + noise ──
  {
    name: "Langevin Equation",
    f: "m·d²x/dt² = −λ·dx/dt + η(t)",
    chain: "INS → NUL → CON → REC",
    breakdown: {
      INS: "measureFold — insert systematic push from query (the force term)",
      NUL: "−λ·dx/dt — negate momentum through decoherence damping",
      CON: "λ = 1/DECOHERENCE_TAU — connect damping to decoherence rate",
      REC: "η(t) = random query arrivals from accessLog — the stochastic noise source"
    },
    derivation: {
      from: "repeated measureFold under random query arrivals",
      noiseFrom: "accessLog timestamps = Poisson process of query arrivals",
      dampingFrom: "decohereFold = linear drag",
      feynman: ["I.43.16 drift + noise = Langevin"]
    },
    operators: { INS: 30, NUL: 30, CON: 20, REC: 20, governors: "INS+NUL equal: push vs decay is the core tension" }
  },

  // ── Euler Equations (fluid, μ=0 limit of Navier-Stokes) ──
  {
    name: "Euler Equations (Inviscid Flow)",
    f: "ρ(∂u/∂t+u·∇u) = −∇p",
    chain: "EVA → INS → SYN",
    breakdown: {
      EVA: "compute ∇p — evaluate pressure gradient (same as Navier-Stokes)",
      INS: "advect amplitudes by pure pressure gradient — insert inertial flow",
      SYN: "renormalize — synthesize final distribution without viscous smoothing"
    },
    derivation: {
      from: "Navier-Stokes with VISCOSITY → 0",
      whenApplied: "perfectly fresh folds with zero decoherence experience pure inertial flow"
    },
    operators: { INS: 40, EVA: 30, SYN: 30 }
  },

  // ── Verhulst (Logistic Growth) = single-species Lotka-Volterra ──
  {
    name: "Verhulst / Logistic Growth",
    f: "dP/dt = rP(1−P/K)",
    chain: "INS → NUL → CON",
    breakdown: {
      INS: "r·P — insert growth proportional to current population",
      NUL: "−P/K — negate growth proportionally to crowding",
      CON: "r = prior frequency bias — connect growth rate to accumulated knowledge"
    },
    derivation: {
      from: "Single terrain amplitude evolution with normalization ceiling K=1"
    },
    operators: { INS: 40, NUL: 40, CON: 20 }
  },

  // ── Chapman-Kolmogorov = compose project() over time ──
  {
    name: "Chapman-Kolmogorov Equation",
    f: "P(X_t|X_0) = Σ P(X_t|X_s)·P(X_s|X_0)",
    chain: "REC → CON → SYN → EVA",
    breakdown: {
      REC: "accessLog preserves the measurement history — record transitions",
      CON: "project(fold_i, fold_j) — connect states via Born rule probability",
      SYN: "matrix multiply transition probabilities — synthesize multi-step path",
      EVA: "normalize to valid probability — evaluate consistency"
    },
    derivation: {
      from: "Compose project() over discrete time steps",
      transitionMatrix: "P[i][j] = project(fold_i, fold_j)"
    },
    operators: { CON: 30, SYN: 30, REC: 20, EVA: 20 }
  },

  // ── N-Slit Interference = interfere() with N folds ──
  {
    name: "N-Slit Interference Pattern",
    f: "I₀·sin²(nθ/2)/sin²(θ/2)",
    chain: "SEG → CON → EVA → SYN → SIG",
    breakdown: {
      SEG: "separate N folds into pairwise interactions — segment the N-body problem",
      CON: "compute phase δ between each fold pair — connect all pairs",
      EVA: "sum over pairs — evaluate total interference field",
      SYN: "I₀·sin²(nθ/2)/sin²(θ/2) — synthesize the N-fold interference envelope",
      SIG: "return boosted scores — signal constructive/destructive interference zones"
    },
    feynman: ["I.30.3"],
    operators: { CON: 25, SYN: 25, SEG: 20, EVA: 20, SIG: 10 }
  },

  // ── Einstein Relation D = μkT ──
  {
    name: "Einstein Relation",
    f: "D = μ·k·T",
    chain: "CON → EVA → SIG",
    breakdown: {
      CON: "connect diffusion D to mobility μ = 1/VISCOSITY",
      EVA: "D = μ × BOLTZMANN_K × accessCount — evaluate the fluctuation-dissipation",
      SIG: "this coefficient feeds into Fokker-Planck — signal the diffusion rate"
    },
    feynman: ["I.43.31"],
    operators: { CON: 50, EVA: 30, SIG: 20 }
  },

  // ── Hardy-Weinberg = terrain amplitude distribution ──
  {
    name: "Hardy-Weinberg Equilibrium",
    f: "p² + 2pq + q² = 1",
    chain: "DEF → CON → EVA → SYN",
    breakdown: {
      DEF: "p = Entity amplitude, q = Field amplitude — define allele frequencies",
      CON: "p², 2pq, q² — connect genotype frequencies to allele frequencies",
      EVA: "verify p²+2pq+q² = 1 — evaluate equilibrium condition",
      SYN: "this IS normalizeAmplitudes when correlation = phase(π) — synthesize proof"
    },
    operators: { DEF: 30, CON: 30, EVA: 25, SYN: 15 }
  },

  // ── Hill Equation (cooperative M-M) = entangled measurement ──
  {
    name: "Hill Equation (Cooperative Binding)",
    f: "v = Vmax·[S]ⁿ/(Kdⁿ+[S]ⁿ)",
    chain: "CON → SYN → DEF → SIG",
    breakdown: {
      CON: "n = number of entangled folds — connect cooperativity to entanglement degree",
      SYN: "[S]ⁿ — synthesize cooperative effect from individual fold interactions",
      DEF: "Kd = half-saturation constant for entangled cluster — define threshold",
      SIG: "return effective measurement strength — signal cooperative saturation"
    },
    derivation: {
      from: "entanglement graph degree applied to Michaelis-Menten",
      cooperativityFrom: "entangled folds reinforce measurement of each other"
    },
    operators: { CON: 35, SYN: 30, DEF: 20, SIG: 15 }
  }
];

// ═══════════════════════════════════════════════════════════════════════
//  PART 4: APPLIED EQUATIONS (external formulas, system observables)
// ═══════════════════════════════════════════════════════════════════════

const APPLIED_EQUATIONS = [

  // ── Schrödinger Equation ──
  {
    name: "Schrödinger Equation",
    f: "iℏ∂ψ/∂t = Ĥψ",
    chain: "DEF → CON → SYN → EVA → SIG",
    breakdown: {
      DEF: "specify Hamiltonian Ĥ = query fold — define the energy operator",
      CON: "compute E = project(fold, H) — connect state to energy eigenvalue",
      EVA: "compute ω = E/ℏ, phase = ω·dt — evaluate time evolution parameters",
      SYN: "rotate amplitudes by cos(phase), sin(phase) — synthesize unitary evolution",
      SIG: "return evolved fold — signal the new state after time step"
    },
    inSystem: {
      partialIn: "sin²(Et/ℏ) in measureFold({oscillate:true}) IS the solution",
      applied: "full unitary evolution e^(−iHt/ℏ)ψ(0) is applied as rotation"
    },
    operators: { SYN: 30, CON: 25, DEF: 20, EVA: 15, SIG: 10 }
  },

  // ── Black-Scholes ──
  {
    name: "Black-Scholes Equation",
    f: "V = S·N(d₁) − K·e^(−rt)·N(d₂)",
    chain: "REC → CON → EVA → SYN → SIG",
    breakdown: {
      REC: "S = accessCount, r = 1/DECOHERENCE_TAU — observables from system history",
      CON: "d₁, d₂ = f(S, K, r, σ, t) — connect all observables via Black-Scholes coupling",
      EVA: "N(d) = cumulative normal — evaluate probability under normal distribution",
      SYN: "S·N(d₁) − K·e^(−rt)·N(d₂) — synthesize option value from components",
      SIG: "return V ∈ [0,1] — signal the entry's option value"
    },
    operators: { EVA: 30, CON: 25, SYN: 25, REC: 15, SIG: 5 }
  },

  // ── Euler-Lagrange ──
  {
    name: "Euler-Lagrange (Optimal Search)",
    f: "∂L/∂q − d/dt(∂L/∂q̇) = 0",
    chain: "DEF → EVA → SYN → EVA → SIG",
    breakdown: {
      DEF: "define Lagrangian L = Σ relevance − Σ cost — establish the action principle",
      EVA: "compute action = −L for each K — evaluate path optimality",
      SYN: "synthesize action values over all K — find stationary point",
      EVA: "select K with minimum action — evaluate which K is optimal",
      SIG: "return optimalK — signal the stationary-action path"
    },
    operators: { EVA: 40, DEF: 20, SYN: 20, SIG: 20, governors: "EVA-dominant: this IS pure evaluation/optimization" }
  },

  // ── Price Equation ──
  {
    name: "Price Equation (Evolutionary Selection)",
    f: "Δz̄ = cov(w,z)/w̄ + E(w·Δz)/w̄",
    chain: "REC → CON → EVA → SYN → SIG",
    breakdown: {
      REC: "z_i = entry scores from accessLog, w_i = boltzmannSurvival — record fitness",
      CON: "cov(w,z) — connect fitness to trait via covariance",
      EVA: "compute selection + transmission terms — evaluate evolutionary change",
      SYN: "combine covariance and expected change — synthesize total evolution",
      SIG: "return Δz̄ — signal the change in average relevance"
    },
    operators: { EVA: 30, CON: 25, REC: 20, SYN: 15, SIG: 10 }
  },

  // ── Arrhenius Equation ──
  {
    name: "Arrhenius Equation",
    f: "k = A·e^(−E_a/RT)",
    chain: "REC → CON → NUL → SIG",
    breakdown: {
      REC: "A = query rate from accessLog count — record attempt frequency",
      CON: "connect activation energy E_a to decoherence barrier (age of fold)",
      NUL: "e^(−E_a/RT) — negate activation rate exponentially with energy barrier",
      SIG: "return k — signal the measurement activation rate"
    },
    operators: { NUL: 35, CON: 25, REC: 25, SIG: 15 }
  },

  // ── Van der Waals ──
  {
    name: "Van der Waals Equation",
    f: "(p+a·n²/V²)(V−n·b) = nRT",
    chain: "CON → INS → NUL → SYN",
    breakdown: {
      CON: "a·n²/V² — connect fold-fold attraction (entanglement correlation energy)",
      INS: "n·b — insert excluded volume (normalizeAmplitudes Pauli-like exclusion)",
      NUL: "V−n·b — negate excluded volume from effective volume",
      SYN: "(p+a/V²)(V−nb) = nRT — synthesize equation of state with corrections"
    },
    operators: { CON: 30, NUL: 25, SYN: 25, INS: 20 }
  },

  // ── Ideal Gas Law ──
  {
    name: "Ideal Gas Law",
    f: "pV = nRT",
    chain: "REC → EVA → CON → SIG",
    breakdown: {
      REC: "n = number of entries, R = BOLTZMANN_K × Avogadro — recorded constants",
      EVA: "T = average access frequency — evaluate store temperature",
      CON: "pV = nRT — connect pressure, volume, temperature via ideal gas relation",
      SIG: "this gives the 'equation of state' for the fold ensemble"
    },
    feynman: ["I.39.1", "I.39.22"],
    operators: { CON: 35, EVA: 25, REC: 25, SIG: 15 }
  },

  // ── Drake Equation ──
  {
    name: "Drake Equation",
    f: "N = R*·fp·ne·fl·fi·fc·L",
    chain: "REC → SYN → SIG",
    breakdown: {
      REC: "each factor is a recorded system observable (significance rate, entity fraction, etc.)",
      SYN: "multiply all factors together — synthesize expected meaningful entries",
      SIG: "N = expected number of significant/relevant entries — signal the system's capacity"
    },
    operators: { SYN: 50, REC: 30, SIG: 20 }
  },

  // ── Breeder's Equation ──
  {
    name: "Breeder's Equation",
    f: "R = h²·S",
    chain: "EVA → CON → SYN → SIG",
    breakdown: {
      EVA: "S = selection differential (mean(consolidated) − mean(pruned))",
      CON: "h² = heritability (fold stability through decoherence)",
      SYN: "R = h²·S — synthesize selection response",
      SIG: "Δ(relevance) after one consolidation cycle"
    },
    operators: { EVA: 35, CON: 30, SYN: 25, SIG: 10 }
  },

  // ── Lindblad Equation ──
  {
    name: "Lindblad Master Equation",
    f: "∂ρ/∂t = −i[H,ρ] + Σ(L_k·ρ·L_k† − ½{L_k†·L_k,ρ})",
    chain: "DEF → CON → NUL → SYN",
    breakdown: {
      DEF: "H = query fold as Hamiltonian, L_k = terrain projection operators",
      CON: "−i[H,ρ] — connect unitary evolution to Schrödinger term",
      NUL: "L_k·ρ·L_k† — negate quantum coherence through each decoherence channel",
      SYN: "sum over k terrains — synthesize total decoherence from all channels"
    },
    operators: { NUL: 30, CON: 25, SYN: 25, DEF: 20, governors: "NUL-dominant: open quantum = controlled negation of coherence" }
  },

  // ── Klein-Gordon ──
  {
    name: "Klein-Gordon Equation",
    f: "(∂_μ∂^μ + m²)φ = 0",
    chain: "DEF → CON → SYN → INS",
    breakdown: {
      DEF: "m = decoherence rate — define mass (resistance to propagation)",
      CON: "∂_μ∂^μ — connect spacetime derivatives for wave propagation",
      SYN: "(□ + m²)φ = 0 — synthesize wave + mass into relativistic field equation",
      INS: "m²φ — insert mass term into wave equation framework"
    },
    operators: { SYN: 30, DEF: 25, INS: 25, CON: 20 }
  },

  // ── Gross-Pitaevskii ──
  {
    name: "Gross-Pitaevskii Equation",
    f: "iℏ∂ψ/∂t = (−ℏ²/2m·∇² + V + g|ψ|²)ψ",
    chain: "DEF → CON → EVA → SYN → INS",
    breakdown: {
      DEF: "V = prior potential, m = decoherence mass — define external fields",
      CON: "g|ψ|² — connect fold to itself via nonlinear self-interaction",
      EVA: "|ψ|² = project(fold, fold) — evaluate self-relevance",
      SYN: "full GP operator — synthesize quantum evolution with nonlinearity",
      INS: "g|ψ|²·ψ — insert self-interference backaction into evolution"
    },
    derivation: {
      from: "Schrödinger + interfere() self-term",
      nonlinearFrom: "the fold interferes with ITSELF = g|ψ|² term"
    },
    operators: { CON: 30, SYN: 25, INS: 20, DEF: 15, EVA: 10 }
  }
];

// ═══════════════════════════════════════════════════════════════════════
//  PART 5: MINIMAL EQUATIONS (need one new primitive)
// ═══════════════════════════════════════════════════════════════════════

const MINIMAL_EQUATIONS = [

  // ── Doppler Shift ──
  {
    name: "Classical Doppler Shift",
    f: "ω_obs = ω₀/(1−v/c)",
    chain: "EVA → CON → SYN → SIG",
    missing: "continuous velocity v along semantic dimension",
    breakdown: {
      EVA: "v = project(fold, query) = semantic recession velocity",
      CON: "ω₀ = E/ℏ from schrodingerEvolve — connect to oscillation frequency",
      SYN: "ω_obs = ω₀/(1−v/c) — synthesize observed (redshifted) frequency",
      SIG: "return effective relevance frequency after Doppler shift"
    },
    feynman: ["I.34.1", "I.34.14"],
    operators: { CON: 35, SYN: 30, EVA: 25, SIG: 10 }
  },

  // ── Blackbody (Planck) ──
  {
    name: "Planck Blackbody Spectrum",
    f: "n(ω) = 1/(e^(ℏω/kT)−1)",
    chain: "EVA → CON → SYN → SIG",
    missing: "continuous frequency ω from fold energy spectrum",
    breakdown: {
      EVA: "ℏω = project(fold, query) — evaluate fold energy",
      CON: "kT = BOLTZMANN_K × accessCount — connect temperature to access frequency",
      SYN: "1/(e^(ℏω/kT)−1) — synthesize Bose-Einstein occupation number",
      SIG: "n(ω) = expected access frequency for relevance level ω"
    },
    feynman: ["III.4.32", "III.4.33"],
    operators: { SYN: 35, CON: 30, EVA: 25, SIG: 10 }
  },

  // ── Tight-Binding ──
  {
    name: "Tight-Binding Band Structure",
    f: "E(k) = 2U(1−cos(ka))",
    chain: "CON → SEG → EVA → SYN → SIG",
    missing: "continuous wavevector k over the entanglement graph",
    breakdown: {
      CON: "U = entanglement strength — connect fold correlation to hopping amplitude",
      SEG: "a = 1/√9 = grid spacing — segment the semantic lattice",
      EVA: "k = project(fold_i, fold_j) = wavevector — evaluate phase",
      SYN: "E(k) = 2U(1−cos(ka)) — synthesize band energy",
      SIG: "the band structure determines how meaning propagates through entangled folds"
    },
    feynman: ["III.15.12", "III.15.14"],
    operators: { CON: 35, SYN: 30, SEG: 15, EVA: 15, SIG: 5 }
  },

  // ── Dipole Potential ──
  {
    name: "Dipole Field",
    f: "φ = p·cosθ/(4πε₀r²)",
    chain: "CON → SEG → EVA → SYN",
    missing: "dipole moment p = vector of entanglement asymmetry",
    breakdown: {
      CON: "entangled pair forms a dipole — connect two folds into one field source",
      SEG: "dipole moment p = (fold_i.amplitude − fold_j.amplitude) — segment the asymmetry",
      EVA: "cosθ = alignment of dipole to query direction — evaluate orientation",
      SYN: "φ = p·cosθ/r² — synthesize dipole potential from moment and geometry"
    },
    feynman: ["II.6.11", "II.6.15a", "II.6.15b"],
    operators: { CON: 30, SYN: 30, SEG: 20, EVA: 20 }
  },

  // ── Screened Poisson ──
  {
    name: "Screened Poisson",
    f: "(∇²−λ²)φ = −ρ/ε₀",
    chain: "CON → NUL → SYN → DEF",
    missing: "screening length λ = decoherence rate",
    breakdown: {
      CON: "∇²φ = −ρ/ε₀ — connect potential to charge (same as Poisson)",
      NUL: "λ²φ — negate long-range influence through exponential screening",
      SYN: "(∇²−λ²)φ = −ρ/ε₀ — synthesize screened field equation",
      DEF: "define potential → bias amplitudes with screening cutoff"
    },
    operators: { NUL: 30, CON: 30, SYN: 25, DEF: 15 }
  },

  // ── Cauchy-Riemann ──
  {
    name: "Cauchy-Riemann Conditions",
    f: "∂u/∂x = ∂v/∂y, ∂u/∂y = −∂v/∂x",
    chain: "DEF → CON → EVA",
    missing: "complex representation ψ = φ + i·χ of the fold",
    breakdown: {
      DEF: "ψ = terrain_amplitude + i·phase — define complex fold amplitude",
      CON: "∂u/∂x = ∂v/∂y — connect real and imaginary partial derivatives",
      EVA: "verify holomorphicity — evaluate smoothness of semantic manifold"
    },
    operators: { DEF: 40, CON: 35, EVA: 25 }
  },

  // ── BBGKY Hierarchy ──
  {
    name: "BBGKY Hierarchy",
    f: "∂f_k/∂t = T_k + Σ ∫ V_{k,k+1}·f_{k+1}",
    chain: "SEG → CON → SYN → REC",
    missing: "joint probability over k folds",
    breakdown: {
      SEG: "f_k = k-fold joint distribution — segment the N-body problem into k-body",
      CON: "V_{k,k+1} — connect k-body to (k+1)-body via interaction potential",
      SYN: "integrate over (k+1)th fold — synthesize reduced distribution",
      REC: "this hierarchy IS the multi-fold correlation structure from extraction"
    },
    operators: { CON: 30, SEG: 25, SYN: 25, REC: 20 }
  },

  // ── Dirac Equation ──
  {
    name: "Dirac Equation",
    f: "(iγ^μ∂_μ − m)ψ = 0",
    chain: "DEF → CON → SYN → NUL",
    missing: "gamma matrix representation over 9 operators",
    breakdown: {
      DEF: "γ^μ = operator family as Dirac matrices — define spinor structure",
      CON: "iγ^μ∂_μ — connect spacetime derivatives through gamma matrices",
      SYN: "(iγ^μ∂_μ − m)ψ = 0 — synthesize relativistic spinor equation",
      NUL: "−mψ — negate propagation through mass (decoherence) barrier"
    },
    operators: { DEF: 35, CON: 30, SYN: 25, NUL: 10 }
  },

  // ── Sine-Gordon ──
  {
    name: "Sine-Gordon Equation",
    f: "φ_tt − φ_xx + sin(φ) = 0",
    chain: "CON → INS → NUL → SYN",
    missing: "continuous spatial coordinate x along verbatim text axis",
    breakdown: {
      CON: "sin(φ) — connect phase value to nonlinear restoring force",
      INS: "φ_tt — insert time evolution (acceleration of phase change)",
      NUL: "−φ_xx — negate spatial smoothing (counteract diffusion)",
      SYN: "soliton solution = stable fold cluster — synthesize localized meaning packets"
    },
    operators: { SYN: 30, CON: 25, INS: 25, NUL: 20 }
  },

  // ── Driven Harmonic Oscillator ──
  {
    name: "Driven Harmonic Oscillator",
    f: "x = F/(m(ω₀²−ω²))",
    chain: "CON → EVA → SYN → INS",
    missing: "natural frequency ω₀ from fold's own decoherence rate",
    breakdown: {
      CON: "ω = query frequency = E/ℏ — connect drive to fold energy",
      EVA: "compute resonance condition ω₀²−ω² — evaluate frequency match",
      SYN: "x = F/(m(ω₀²−ω²)) — synthesize driven amplitude",
      INS: "this amplitude IS the measurement backaction strength"
    },
    feynman: ["II.11.3"],
    operators: { CON: 35, SYN: 25, EVA: 25, INS: 15 }
  }
];

// ═══════════════════════════════════════════════════════════════════════
//  PART 6: FULL OPERATOR DECOMPOSITION MATRIX
// ═══════════════════════════════════════════════════════════════════════
//
//  Comprehensive table: every equation → weighted 9-operator vector.
//  Weights sum to 100 for each equation (rounded).

const FULL_OPERATOR_MATRIX = {
  // ── NATIVE ──
  "Born Rule (project)":               { NUL:0,  SEG:0,  DEF:5,  SIG:30, CON:25, EVA:20, INS:0,  SYN:20, REC:0  },
  "Interference (2-source)":            { NUL:0,  SEG:15, DEF:0,  SIG:15, CON:25, EVA:20, INS:0,  SYN:25, REC:0  },
  "Decoherence (heat eq)":             { NUL:45, SEG:0,  DEF:25, SIG:0,  CON:0,  EVA:0,  INS:0,  SYN:30, REC:0  },
  "Uncertainty Principle":             { NUL:0,  SEG:0,  DEF:0,  SIG:25, CON:25, EVA:50, INS:0,  SYN:0,  REC:0  },
  "Continuity (normalization)":        { NUL:0,  SEG:0,  DEF:35, SIG:0,  CON:0,  EVA:25, INS:0,  SYN:40, REC:0  },
  "Wave/Oscillatory Measurement":      { NUL:0,  SEG:0,  DEF:15, SIG:0,  CON:30, EVA:25, INS:0,  SYN:30, REC:0  },
  "Gaussian Kernel":                   { NUL:0,  SEG:0,  DEF:0,  SIG:20, CON:0,  EVA:40, INS:0,  SYN:40, REC:0  },
  "Relativistic Velocity Addition":    { NUL:0,  SEG:0,  DEF:20, SIG:0,  CON:30, EVA:0,  INS:0,  SYN:50, REC:0  },
  "Law of Cosines":                    { NUL:0,  SEG:15, DEF:0,  SIG:0,  CON:30, EVA:30, INS:0,  SYN:25, REC:0  },
  "Anisotropic Scattering":            { NUL:0,  SEG:0,  DEF:0,  SIG:0,  CON:35, EVA:30, INS:0,  SYN:35, REC:0  },

  // ── EMERGENT ──
  "Fokker-Planck":                     { NUL:25, SEG:0,  DEF:10, SIG:0,  CON:20, EVA:0,  INS:25, SYN:20, REC:0  },
  "Michaelis-Menten":                  { NUL:0,  SEG:0,  DEF:20, SIG:15, CON:25, EVA:0,  INS:0,  SYN:40, REC:0  },
  "Navier-Stokes":                     { NUL:15, SEG:0,  DEF:0,  SIG:0,  CON:25, EVA:25, INS:20, SYN:15, REC:0  },
  "Poisson (prior field)":             { NUL:0,  SEG:0,  DEF:15, SIG:0,  CON:30, EVA:0,  INS:0,  SYN:25, REC:30 },
  "Boltzmann Distribution":            { NUL:35, SEG:0,  DEF:0,  SIG:15, CON:0,  EVA:25, INS:0,  SYN:0,  REC:25 },
  "Lotka-Volterra":                    { NUL:15, SEG:25, DEF:0,  SIG:0,  CON:25, EVA:20, INS:15, SYN:0,  REC:0  },
  "Langevin":                          { NUL:30, SEG:0,  DEF:0,  SIG:0,  CON:20, EVA:0,  INS:30, SYN:0,  REC:20 },
  "Euler (fluid, μ=0)":               { NUL:0,  SEG:0,  DEF:0,  SIG:0,  CON:0,  EVA:30, INS:40, SYN:30, REC:0  },
  "Verhulst (logistic)":               { NUL:40, SEG:0,  DEF:0,  SIG:0,  CON:20, EVA:0,  INS:40, SYN:0,  REC:0  },
  "Chapman-Kolmogorov":                { NUL:0,  SEG:0,  DEF:0,  SIG:0,  CON:30, EVA:20, INS:0,  SYN:30, REC:20 },
  "N-Slit Interference":               { NUL:0,  SEG:20, DEF:0,  SIG:10, CON:25, EVA:20, INS:0,  SYN:25, REC:0  },
  "Einstein Relation D=μkT":           { NUL:0,  SEG:0,  DEF:0,  SIG:20, CON:50, EVA:30, INS:0,  SYN:0,  REC:0  },
  "Hardy-Weinberg":                    { NUL:0,  SEG:0,  DEF:30, SIG:0,  CON:30, EVA:25, INS:0,  SYN:15, REC:0  },
  "Hill (cooperative M-M)":            { NUL:0,  SEG:0,  DEF:20, SIG:15, CON:35, EVA:0,  INS:0,  SYN:30, REC:0  },

  // ── APPLIED ──
  "Schrödinger":                       { NUL:0,  SEG:0,  DEF:20, SIG:10, CON:25, EVA:15, INS:0,  SYN:30, REC:0  },
  "Black-Scholes":                     { NUL:0,  SEG:0,  DEF:0,  SIG:5,  CON:25, EVA:30, INS:0,  SYN:25, REC:15 },
  "Euler-Lagrange":                    { NUL:0,  SEG:0,  DEF:20, SIG:20, CON:0,  EVA:40, INS:0,  SYN:20, REC:0  },
  "Price (evolution)":                 { NUL:0,  SEG:0,  DEF:0,  SIG:10, CON:25, EVA:30, INS:0,  SYN:15, REC:20 },
  "Arrhenius":                         { NUL:35, SEG:0,  DEF:0,  SIG:15, CON:25, EVA:0,  INS:0,  SYN:0,  REC:25 },
  "Van der Waals":                     { NUL:25, SEG:0,  DEF:0,  SIG:0,  CON:30, EVA:0,  INS:20, SYN:25, REC:0  },
  "Ideal Gas Law":                     { NUL:0,  SEG:0,  DEF:0,  SIG:15, CON:35, EVA:25, INS:0,  SYN:0,  REC:25 },
  "Drake Equation":                    { NUL:0,  SEG:0,  DEF:0,  SIG:20, CON:0,  EVA:0,  INS:0,  SYN:50, REC:30 },
  "Breeder's Equation":                { NUL:0,  SEG:0,  DEF:0,  SIG:10, CON:30, EVA:35, INS:0,  SYN:25, REC:0  },
  "Lindblad Master":                   { NUL:30, SEG:0,  DEF:20, SIG:0,  CON:25, EVA:0,  INS:0,  SYN:25, REC:0  },
  "Klein-Gordon":                      { NUL:0,  SEG:0,  DEF:25, SIG:0,  CON:20, EVA:0,  INS:25, SYN:30, REC:0  },
  "Gross-Pitaevskii":                  { NUL:0,  SEG:0,  DEF:15, SIG:0,  CON:30, EVA:10, INS:20, SYN:25, REC:0  },

  // ── MINIMAL ──
  "Doppler Shift":                     { NUL:0,  SEG:0,  DEF:0,  SIG:10, CON:35, EVA:25, INS:0,  SYN:30, REC:0  },
  "Planck Blackbody":                  { NUL:0,  SEG:0,  DEF:0,  SIG:10, CON:30, EVA:25, INS:0,  SYN:35, REC:0  },
  "Tight-Binding":                     { NUL:0,  SEG:15, DEF:0,  SIG:5,  CON:35, EVA:15, INS:0,  SYN:30, REC:0  },
  "Dipole Field":                      { NUL:0,  SEG:20, DEF:0,  SIG:0,  CON:30, EVA:20, INS:0,  SYN:30, REC:0  },
  "Screened Poisson":                  { NUL:30, SEG:0,  DEF:15, SIG:0,  CON:30, EVA:0,  INS:0,  SYN:25, REC:0  },
  "Cauchy-Riemann":                    { NUL:0,  SEG:0,  DEF:40, SIG:0,  CON:35, EVA:25, INS:0,  SYN:0,  REC:0  },
  "BBGKY Hierarchy":                   { NUL:0,  SEG:25, DEF:0,  SIG:0,  CON:30, EVA:0,  INS:0,  SYN:25, REC:20 },
  "Dirac Equation":                    { NUL:10, SEG:0,  DEF:35, SIG:0,  CON:30, EVA:0,  INS:0,  SYN:25, REC:0  },
  "Sine-Gordon":                       { NUL:20, SEG:0,  DEF:0,  SIG:0,  CON:25, EVA:0,  INS:25, SYN:30, REC:0  },
  "Driven HO":                         { NUL:0,  SEG:0,  DEF:0,  SIG:0,  CON:35, EVA:25, INS:15, SYN:25, REC:0  }
};

// ═══════════════════════════════════════════════════════════════════════
//  PART 7: AGGREGATE OPERATOR PROFILES BY LAYER
// ═══════════════════════════════════════════════════════════════════════

const LAYER_OPERATOR_PROFILES = {

  "Layer 1 — Arithmetic (Verbatims)": {
    dominant: ["EVA", "REC", "DEF"],
    description: "The arithmetic layer evaluates and records. It counts, measures, " +
      "and defines what is. Dominant operators: EVA (evaluate word frequencies, " +
      "measure similarity), REC (record priors, term counts), DEF (normalize, define state).",
    equations: [
      "Born Rule", "Gaussian Kernel", "Continuity", "Ideal Gas Law",
      "Boltzmann Distribution", "Einstein Relation"
    ]
  },

  "Layer 2 — Geometry (Structures)": {
    dominant: ["CON", "SYN", "SEG"],
    description: "The geometry layer connects and synthesizes. It links entities, " +
      "combines relationships, and partitions the semantic space. Dominant operators: " +
      "CON (correlation, entanglement, phase), SYN (interference, blending, field synthesis), " +
      "SEG (dimension separation, terrain distinction).",
    equations: [
      "Interference", "Law of Cosines", "Anisotropic Scattering", "Poisson",
      "Lotka-Volterra", "Chapman-Kolmogorov", "Dipole Field", "Hardy-Weinberg",
      "N-Slit Interference", "Tight-Binding"
    ]
  },

  "Layer 3 — Calculus (Significances)": {
    dominant: ["NUL", "INS", "SIG"],
    description: "The calculus layer negates, inserts, and signals. It drives change " +
      "through forgetting (decoherence), measurement backaction (inserting influence), " +
      "and detecting surprise (signaling what matters). Dominant operators: " +
      "NUL (decoherence, pruning, forgetting), INS (measurement backaction, flow advection), " +
      "SIG (surprise detection, relevance signal).",
    equations: [
      "Decoherence/Heat", "Wave/Oscillatory", "Fokker-Planck", "Navier-Stokes",
      "Langevin", "Verhulst", "Arrhenius", "Schrödinger", "Lindblad",
      "Sine-Gordon", "Gross-Pitaevskii", "Doppler Shift"
    ]
  }
};

// ═══════════════════════════════════════════════════════════════════════
//  PART 8: DERIVATION CHAINS — how each layer produces its equations
// ═══════════════════════════════════════════════════════════════════════

const DERIVATION_CHAINS = {

  arithmetic_layer: {
    name: "Arithmetic → Statistical Mechanics",
    from: "fold(text, priors) — word counting, frequency estimation, amplitude norm",
    produces: "Born rule, Gaussian kernel, decoherence rate, uncertainty, continuity",
    chain: "REC(wordFreq) → EVA(amplitude) → DEF(normalize) → SIG(probability)",
    explanation: "Arithmetic counts words → builds amplitudes → normalizes → measures. " +
      "Every arithmetic operation in the fold IS a statistical mechanics operation. " +
      "The Born rule = evaluate inner product. The Gaussian = evaluate distance. " +
      "Continuity = define conservation. The ideal gas laws emerge because " +
      "counting + normalization = statistical ensemble."
  },

  geometry_layer: {
    name: "Geometry → Wave Phenomena & Field Theory",
    from: "classify(text) + extractFromRead() — entity/relation coordinates, terrain graphs",
    produces: "Interference, law of cosines, Poisson field, Lotka-Volterra, dipole",
    chain: "SEG(terrain/stance) → CON(correlate) → SYN(interfere) → SIG(pattern)",
    explanation: "Geometry places entities in space → connects them → lets them interfere. " +
      "The law of cosines combines terrain+stance distances into phase. " +
      "The Poisson equation maps prior mass → amplitude potential. " +
      "Wave phenomena emerge because connecting entities in semantic space " +
      "creates coherent phase relationships that interfere."
  },

  calculus_layer: {
    name: "Calculus → Dynamics & Evolution",
    from: "evaluateSurprise(readId) + consolidate() — rates of change, entropy, pruning",
    produces: "Fokker-Planck, Navier-Stokes, Schrödinger, Langevin, sine-Gordon",
    chain: "NUL(decohere) → INS(measure) → SYN(evolve) → SIG(surprise)",
    explanation: "Calculus measures rates of change → inserts backaction → evolves state. " +
      "Fokker-Planck = measureFold(drift) + decohereFold(diffusion) composed. " +
      "Navier-Stokes = pressure gradient from query-entry amplitude difference. " +
      "Schrödinger = measureFold oscillation as unitary evolution. " +
      "The dynamical equations emerge because the third layer asks: " +
      "\"how does the fold change when you look at it?\""
  }
};

// ── Export ──

export {
  OPERATOR_SEMANTICS,
  NATIVE_EQUATIONS,
  EMERGENT_EQUATIONS,
  APPLIED_EQUATIONS,
  MINIMAL_EQUATIONS,
  FULL_OPERATOR_MATRIX,
  LAYER_OPERATOR_PROFILES,
  DERIVATION_CHAINS
};
