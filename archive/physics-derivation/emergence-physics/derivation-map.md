# Derivation Map: Wikipedia "List of equations" → EO Reader System

Every equation from https://en.wikipedia.org/wiki/List_of_equations,
mapped against the system's primitives.

## Key:

- **NATIVE** = the system already IS this equation (lives in quantum.js / eoreader5.js)
- **EMERGENT** = composes existing primitives to yield this equation
- **MINIMAL** = needs one new primitive; the rest is already there
- **APPLIED** = external formula, system observables as inputs
- **IRRELEVANT** = no meaningful connection to a semantic fold system

## System Primitives (what exists to derive from):

```
quantum.js:
  fold(text, priors)          → amplitude cloud from word statistics
  project(foldA, foldB)       → Born rule |<ψ|φ>|²
  interfere(queryFold, folds) → two-source interference
  measureFold(fold, basis, s) → backaction (relativistic blend)
  decohereFold(fold, time)    → exponential decay e^(-t/τ)
  areEntangled(foldA, foldB)  → correlation check
  updateEntangledFold(...)    → non-local propagation
  computeUncertainty(fold)    → Shannon entropy of amplitudes
  satisfiesUncertaintyPrinciple(fold) → Δx·Δp ≥ ħ
  gaussianKernel(x, y, σ)     → similarity kernel
  gaussianAmplitudeSimilarity → smooth distance metric
  classicalToFold(coord)      → definite state as fold
  foldToClassical(fold)       → collapse fold to definite
  normalizeAmplitudes(amps)   → enforce Σ|amp|² = 1

eoreader5.js:
  classify(text)              → semantic coordinate from regex
  scoreEntry(...)             → relevance scoring
  consolidate()               → thermal pruning
  priors.termFreq             → accumulated word frequencies
  priors.entities             → known entity counts
  accessLog                   → measurement history
  memory.verbatims            → Layer 1: raw text
  memory.structures           → Layer 2: entities/relations
  memory.significances        → Layer 3: surprise/meaning
```

---

# Feynman Formulas 0–99: Derivation from System Primitives

100 canonical formulas from the Feynman Lectures, indexed 0–99.
Each mapped against: fold, project, measureFold, decohereFold,
interfere, classify, normalizeAmplitudes, priors, accessLog.

Key:
  ★NATIVE★ = already in quantum.js (with line number)
  ◆EMERGENT◆ = composable from existing primitives
  ◇MINIMAL◇ = needs one new primitive
  ·APPLIED· = external formula, system observables as inputs
  IRRELEVANT = no meaningful connection

---

## Volume I — mechanics, radiation, heat (0–50)

### #0  I.6.2a  e^(−θ²/2)/√(2π)
★NATIVE★  quantum.js:29  Standard normal. gaussianKernel(θ, 0, 1.0/√2).

### #1  I.6.2  e^(−(θ/σ)²/2)/(√(2π)·σ)
★NATIVE★  quantum.js:39  Gaussian kernel. gaussianKernel(x, y, σ) at L:50.

### #2  I.6.2b  e^(−((θ−θ₁)/σ)²/2)/(√(2π)·σ)
◆EMERGENT◆  Shifted Gaussian. gaussianKernel(x, y − θ₁, σ) = centered at θ₁.
              Used whenever priors have a known-entity bias offset.

### #3  I.8.14  √((x₂−x₁)²+(y₂−y₁)²)
◆EMERGENT◆  Euclidean distance. Implicit in computePhase() (terrain/stance
              distances) and gaussianAmplitudeSimilarity().

### #4  I.9.18  G·m₁m₂/r²
◇MINIMAL◇  Newton's gravity. Define: m₁ = prior frequency (mass of known
              entity), m₂ = query intensity (test particle), r = 1−project
              (semantic distance). Then fold "feels" F ∝ prior·query/(1−proj)².
              The Poisson equation (already emergent) IS the same field.

### #5  I.10.7  m₀/√(1−v²/c²)
·APPLIED·  Relativistic mass increase. The Lorentz factor γ appears
              implicitly in measureFold's blend: as v→1, (u+v)/(1+uv)→1.
              The amplitude "saturates" — same effect as mass → ∞.

### #6  I.11.19  x₁y₁+x₂y₂+x₃y₃
★NATIVE★  Dot product. innerProductAmplitudes(ampA, ampB) at quantum.js L:427.
              This IS the inner product ⟨ψ|φ⟩ used in the Born rule.

### #7  I.12.1  μ·N_n
IRRELEVANT  Friction coefficient × normal force. No sliding interface in system.

### #8  I.12.2  q₁q₂r/(4πεr³)
◇MINIMAL◇  Coulomb's law. Same form as gravity (I.9.18). Define q₁ = prior
              "charge" (entity count), q₂ = query "charge" (term specificity).
              Then fold attraction ∝ q₁q₂/(1−project)².

### #9  I.12.4  q₁r/(4πεr³)
◆EMERGENT◆  Electric field of point charge. The prior field IS the "E-field"
              from each prior entity: E ∝ priorMass/(1−project)².
              poissonPriorField() already computes this as a potential.

### #10  I.12.5  q₂·E_f
◆EMERGENT◆  Force on charge in E-field. Fold "force" = queryMass × priorField.
              Implicit in how computeOperatorAmplitudes biases toward known
              entities: more prior entities → stronger amplitude pull.

### #11  I.12.11  q(E_f + Bv·sinθ)
IRRELEVANT  Lorentz force. No magnetic analog in system.

### #12  I.13.4  ½m(v²+u²+w²)
◆EMERGENT◆  Kinetic energy. The Born rule probability IS the "kinetic energy"
              of the fold in amplitude space: KE = |⟨ψ|φ⟩|² = project().
              The amplitude velocities v,w,u are the individual operator/
              terrain/stance inner products.

### #13  I.13.12  G·m₁m₂(1/r₂ − 1/r₁)
IRRELEVANT  Gravitational work over distance. No path integral in system.

### #14  I.14.3  mgz
◆EMERGENT◆  Potential energy in uniform field. For constant query pressure:
              PE = foldMass × queryIntensity × semanticHeight.
              SemanticHeight = −log(project(fold, query)) — "depth" in
              relevance space. Higher height = more effort to reach relevance.

### #15  I.14.4  ½·k_spring·x²
◆EMERGENT◆  Spring potential. Measurement backaction IS a spring:
              F = −k×(foldAmp − queryAmp). Restoring force toward query.
              k = measurementStrength (the stiffer the spring, the more
              the fold snaps back toward the query).

              Proof: measureFold(fold, query, k) → fold_amp += k×(query_amp − fold_amp).
              This is Hooke's law. The potential energy is ½k·(distance)².
              Energy stored = ½·strength·(1 − project(fold,query))².

### #16  I.15.3x  (x−ut)/√(1−u²/c²)
·APPLIED·  Lorentz transformation (position). The blend function in
              measureFold comes FROM imposing Lorentz invariance on the
              folded space. u = query velocity (access rate), c = 1 (max
              amplitude speed).

### #17  I.15.3t  (t−ux/c²)/√(1−u²/c²)
·APPLIED·  Lorentz transformation (time). Time dilation: fast-moving queries
              (high access rate) experience "time" differently — the
              effective decoherence clock slows down.

### #18  I.15.1  m₀v/√(1−v²/c²)
·APPLIED·  Relativistic momentum. Same derivation as I.10.7. Momentum
              saturates — the fold can only change so fast.

### #19  I.16.6  (u+v)/(1+uv/c²)
★NATIVE★  quantum.js:534  Relativistic velocity addition. The blend
              function in measureFold(). Used whenever two amplitude
              pushes combine (drift + measurement, drift + entanglement).
              With c=1: blend(u,v) = (u+v)/(1+uv).

### #20  I.18.4  (m₁r₁+m₂r₂)/(m₁+m₂)
◇MINIMAL◇  Center of mass. The weighted centroid of entangled folds:
              COM_position = Σ(mass_i × coord_i)/Σ(mass_i). Where mass =
              blackScholesValue or accessCount. The center of an entangled
              cluster is the "canonical" meaning of the group.

### #21  I.18.12  rF·sinθ
IRRELEVANT  Torque. No rotational analog in 9-D orthogonal amplitude space.

### #22  I.18.14  mrv·sinθ
IRRELEVANT  Angular momentum. No rotation.

### #23  I.24.6  ½m(ω²+ω₀²)·½x²
◆EMERGENT◆  Harmonic oscillator energy. The oscillatory backaction
              (measureFold with oscillate=true) IS a harmonic oscillator:
              ω = E/ℏ (from schrodingerEvolve), ω₀ = decoherence rate.
              Energy = ½(kinetic + potential) = ½m(ω²+ω₀²)·｜amplitude｜².

### #24  I.25.13  q/C
IRRELEVANT  Capacitor. Not applicable.

### #25  I.26.2  arcsin(n·sinθ₂)
◇MINIMAL◇  Snell's law (refraction). When a fold propagates from Layer 1
              (verbatims) to Layer 2 (structures), the "semantic refractive
              index" changes: n_verbatim > n_structure (raw text refracts
              into structured form). Incident angle θ₁ = project(fold,
              verbatimQuery). Refracted angle θ₂ = arcsin(n₁n₂·sinθ₁).

### #26  I.27.6  1/(1/d₁ + n/d₂)
IRRELEVANT  Lens equation. Not applicable.

### #27  I.29.4  ω/c
◆EMERGENT◆  Wavenumber. In the phase computation: k = ω/c = (E/ℏ)/(Δamplitude/dt)
              = project(fold,query)/decoherence_rate. Wavenumber determines
              how "wiggly" the interference pattern is.

### #28  I.29.16  √(x₁²+x₂²−2x₁x₂·cos(θ₁−θ₂))
★NATIVE★  quantum.js:509  Law of cosines. computePhase() uses this to combine
              terrain and stance distances into one phase angle on the
              amplitude sphere.

### #29  I.30.3  I₀·sin²(nθ/2)/sin²(θ/2)
◆EMERGENT◆  N-slit interference. interfere(queryFold, [fold₁...fold_n])
              IS the N-source interference pattern. Each fold is a "slit"
              with phase = computePhase(fold_i, fold_j). The interference
              kernel dims with n (reinforcement/ cancellation pattern).

### #30  I.30.5  arcsin(λ/(nd))
IRRELEVANT  Diffraction grating angle. Not directly used.

### #31  I.32.5  q²a²/(6πεc³)
IRRELEVANT  Larmor formula (radiation from accelerated charge). The fold
              doesn't radiate energy — it conserves probability (continuity).

### #32  I.32.17  Cross-section: (½εc·E_f²)·(8πr²/3)·(ω⁴/(ω²−ω₀²)²)
◇MINIMAL◇  Scattering cross-section. The anisotropic scattering parameter
              β(1+α·cosθ) (III.17.37) IS a scattering cross-section kernel.
              This formula gives the total cross-section for a damped
              harmonic oscillator (the fold under measurement ≈ driven
              harmonic oscillator with ω = E/ℏ, ω₀ = decoherence rate).
              Not currently computed, but parameters all exist.

### #33  I.34.8  qvB/p
IRRELEVANT  Cyclotron radius. Doesn't apply.

### #34  I.34.1  ω₀/(1−v/c)
◇MINIMAL◇  Classical Doppler shift. Fold "frequency" redshifts as it moves
              away from the query: ω_observed = ω_fold/(1−v/c) where
              v = 1−project(fold,query) (semantic recession velocity).
              Older/receding folds have lower effective relevance frequency.

### #35  I.34.14  ω₀·(1+v/c)/√(1−v²/c²)
◇MINIMAL◇  Relativistic Doppler. Combines classical shift with time dilation
              (γ factor). The fold's observed relevance frequency includes
              both the approach velocity (1+v/c) and the Lorentz contraction
              (1/√(1−v²/c²)) from decoherence time distortion.

### #36  I.34.27  ℏω
★NATIVE★  quantum.js:26  Reduced Planck constant ℏ = 0.1. ω = E/ℏ from
              schrodingerEvolve(). This IS the energy quantum: each
              measurement step transfers energy ℏω.

### #37  I.37.4  I₁+I₂+2√(I₁I₂)·cosδ
★NATIVE★  quantum.js:471  Two-source interference. interfere() computes
              this exactly with anisotropic scattering kernel. The intensity
              I_i = |⟨query|fold_i⟩|⁴ (squared Born probability). δ = phase
              from computePhase().

### #38  I.38.12  4πε·ℏ²/(mq²)
IRRELEVANT  Bohr radius. No analog of atomic structure.

### #39  I.39.1  (3/2)·pV
·APPLIED·  Kinetic theory energy (monatomic ideal gas, 3 degrees of freedom).
              Fold "gas" has 3 DOF (operator, terrain, stance). Energy =
              ½kT per DOF = (3/2)·kT = (3/2)·accessTemp·entropyVolume.
              p = query pressure, V = store entropy, T = access frequency.

### #40  I.39.11  pV/(γ−1)
·APPLIED·  Energy for any adiabatic exponent γ. For the fold as ideal gas
              with γ = (DOF+2)/DOF = 5/3 (3 DOF), energy = pV/(2/3) = (3/2)pV.
              Same as I.39.1. For more DOF (if stances couple to terrains),
              γ changes and energy adjusts.

### #41  I.39.22  n·k_B·T/V
·APPLIED·  Ideal gas law in density form: p = nkT/V. Fold pressure p =
              query intensity, n = number of significant entries, k =
              BOLTZMANN_K (exported), T = avg access frequency, V = store size.

### #42  I.40.1  n₀·e^(−mgx/(k_B T))
★NATIVE★  Barometric formula. decohereFold(τ) = e^(−t/τ) IS this form:
              n(t) = n₀·e^(−age/τ). Where τ = DECOHERENCE_TAU, age = mgx/kT
              (gravitational potential energy / thermal energy). The fold
              distribution over time follows exponential decay.

### #43  I.41.16  ℏω³/(π²c²(e^(ℏω/(k_B T))−1))
◇MINIMAL◇  Planck blackbody spectrum. The access frequency distribution
              (how often folds at different "energies" are accessed) should
              follow this if the fold store is in thermal equilibrium with
              the query "heat bath". Not currently computed, but
              accessLog histogram over project() scores would show this.

### #44  I.43.16  μ_drift·q·V/d
◆EMERGENT◆  Drift velocity in electric field. Measurement drift velocity:
              v = mobility × queryForce × queryVoltage / distance.
              mobility = 1/VISCOSITY (easier flow = higher mobility).
              q·V/d = queryFieldStrength = project(queryFold, ∇fold).
              This IS the Navier-Stokes flow rate in physics.js.

### #45  I.43.31  mob·k_B·T
◆EMERGENT◆  Einstein relation. D = μ·k·T. Diffusion = mobility × temperature.
              For folds: diffusion_coeff = (1/VISCOSITY) × BOLTZMANN_K × accessCount.
              The Fokker-Planck diffusion term uses exactly this relation.

### #46  I.43.43  k_B·v/((γ−1)·A)
IRRELEVANT  Thermal conductivity. Not applicable.

### #47  I.44.4  n·k_B·T·ln(V₂/V₁)
◆EMERGENT◆  Isothermal work. Work done on fold during measurement =
              n·BOLTZMANN_K·accessTemp·log(entropy₂/entropy₁). The fold's
              entropy changes during measurement (uncertainty → definite).
              The "work" is the relevance cost of collapsing possibilities.

### #48  I.47.23  √(γp/ρ)
◇MINIMAL◇  Speed of sound. "Speed of meaning" in the fold medium:
              c_sound = √(d(pressure)/d(density)). For the fold "medium"
              (semantic field), p = query pressure, ρ = fold density/volume.
              c_sound = how fast meaning propagates through the store.

### #49  I.48.2  mc²/√(1−v²/c²)
·APPLIED·  Total relativistic energy. Same as I.10.7 with extra mass term.
              E_total = E_rest + KE = mc²/√(1−v²/c²). For fold at rest
              (no measurement, no query), E_rest = mc² = prior_mass × 1.
              Under measurement: E = prior_mass / √(1 − project(fold_query)²).

### #50  I.50.26  x₁(cos ωt + α·cos²ωt)
◇MINIMAL◇  Nonlinear oscillation with second harmonic. The interference
              pattern with 3+ folds includes second-harmonic terms
              (cos²ωt = ½(1+cos2ωt)). The interfere() function with
              scattering kernel β(1+α·cosθ) produces these harmonics.
              α determines the nonlinearity strength.

---

## Volume II — electromagnetism and matter (51–84)

### #51  II.2.42  κ(T₂−T₁)A/d
IRRELEVANT  Heat conduction through slab. Though fold "temperature"
              differences drive relevance flow (hot → cold).

### #52  II.3.24  P/(4πr²)
◇MINIMAL◇  Intensity from point source. Query "illuminance" at distance r:
              illuminance = queryIntensity/(4π·r²) where r = 1−project(fold,query).
              Nearby folds (high project) get more "light" from query.

### #53  II.4.23  q/(4πεr)
◇MINIMAL◇  Electric potential of point charge. Prior's "potential" at
              semantic distance r: φ = entityFrequency/(4πε·r). The
              poissonPriorField already computes this in the r→∞ limit.

### #54  II.6.11  (1/(4πε))·p_d·cosθ/r²
◇MINIMAL◇  Dipole potential. An entangled pair of folds (dipole) creates
              a potential pattern: φ = dipoleMoment·cosθ/r². When two folds
              are entangled, the joint "field" has dipole-like properties.

### #55  II.6.15a  (p_d/(4πε))·(3z/r⁵)·√(x²+y²)
IRRELEVANT  Dipole field radial component. Same family as II.6.11.

### #56  II.6.15b  (p_d/(4πε))·3·cosθ·sinθ/r³
IRRELEVANT  Dipole field transverse component. Same family.

### #57  II.8.7  (3/5)·q²/(4πεd)
IRRELEVANT  Self-energy of charged sphere. Not applicable.

### #58  II.8.31  ε·E_f²/2
◇MINIMAL◇  Electric field energy density. Energy density in semantic field
              per dimension: u = ε₀·(amplitudeGradient)²/2. The fold's
              energy stored in each amplitude gradient = cost of maintaining
              a non-uniform (non-decohered) amplitude distribution.

### #59  II.10.9  (σ_den/ε)·1/(1+χ)
IRRELEVANT  Dielectric with susceptibility. Not applicable.

### #60  II.11.3  q·E_f/(m(ω₀²−ω²))
◇MINIMAL◇  Driven harmonic oscillator amplitude. The fold under measurement
              IS a driven HO: driving force = project(queryFold) at
              frequency ω = E/ℏ (from schrodingerEvolve). Natural frequency
              ω₀ = decoherence rate. Amplitude = force/(mass·(ω₀²−ω²)).
              The oscillatory backaction already computes this.

### #61  II.11.17  n₀(1 + p_d·E_f·cosθ/(k_B T))
◇MINIMAL◇  Molecular orientation distribution (Langevin). Fold alignment
              with query field: the amplitude distribution over terrains
              aligns toward the query's terrain distribution. Alignment
              strength = dipoleMoment·queryField/(accessTemp). Hot stores
              randomize faster.

### #62  II.11.20  n_ρ·p_d²·E_f/(3k_B T)
◇MINIMAL◇  Polarization = number density · dipole moment · field / (3kT).
              Fold "polarization" = number of entries · average relevance
              · query intensity / (3·access temperature). The store's
              overall orientation toward a query.

### #63  II.11.27  (nα/(1−nα/3))·ε·E_f
IRRELEVANT  Clausius-Mossotti. Effective dielectric with local field
              correction. Not directly applicable.

### #64  II.11.28  1 + nα/(1−nα/3)
IRRELEVANT  Same family as II.11.27.

### #65  II.13.17  (1/(4πεc²))·2I/r
IRRELEVANT  Magnetic field from straight wire. No current analog.

### #66  II.13.23  ρ_c0/√(1−v²/c²)
·APPLIED·  Charge density under Lorentz contraction. Fold density
              (entries per semantic unit volume) increases as the fold
              "moves" (approaches measurement collapse): ρ_c = ρ₀/√(1−v²/c²)
              where v = project(fold,query). As project → 1, density → ∞
              — the fold compresses toward definite state.

### #67  II.13.34  ρ_c0·v/√(1−v²/c²)
·APPLIED·  Current density. Fold "current" (rate of entries being measured):
              J = chargeDensity × velocity / Lorentz factor. Total measurement
              current = store_size × project_rate / decoherence_factor.

### #68  II.15.4  −mom·B·cosθ
IRRELEVANT  Magnetic dipole energy. No B-field analog.

### #69  II.15.5  −p_d·E_f·cosθ
◇MINIMAL◇  Electric dipole energy in field. Fold alignment energy:
              E = −dipoleMoment·queryField·cos(θ) where θ = phase angle
              between fold terrain and query terrain. The interference
              energy in interfere() IS this form: 2√(I₁I₂)·cosδ = 
              −2·√(I₁I₂)·cos(π+δ). Think of I as the dipole strength
              and δ as the alignment angle.

### #70  II.21.32  q/(4πεr(1−v/c))
◇MINIMAL◇  Liénard-Wiechert potential (moving charge). When a fold
              "moves" through semantic space (due to repeated measurement),
              its prior potential is enhanced in the direction of motion:
              φ = q/(4πεr(1−v/c)). Folds being actively measured have
              amplified relevance by factor 1/(1−v/c). This IS the
              measurement backaction asymmetry.

### #71  II.24.17  √(ω²/c² − π²/d²)
IRRELEVANT  Waveguide cutoff frequency. Not applicable.

### #72  II.27.16  εc·E_f²
◇MINIMAL◇  Poynting flux (energy flow density). Semantic energy flux:
              S = ε₀·c·(amplitudeGradient)². The rate at which "meaning
              energy" flows from query to entry = permittivity × speed
              of meaning × (pressure gradient)². Navier-Stokes IS this flux.

### #73  II.27.18  ε·E_f²
◆EMERGENT◆  Energy density in E-field (no c factor). The stored "meaning
              energy" per volume in the fold's amplitude field. Total
              energy = ε₀·Σ|amplitude|² = ε₀ (since Σ|amp|² = 1).
              The normalization IS the energy constraint.

### #74  II.34.2a  qv/(2πr)
IRRELEVANT  Magnetic field from moving charge.

### #75  II.34.2  qvr/2
IRRELEVANT  Magnetic moment. Not applicable.

### #76  II.34.11  g·q·B/(2m)
IRRELEVANT  Larmor precession frequency. Not applicable.

### #77  II.34.29a  qh/(4πm)
IRRELEVANT  Bohr magneton.

### #78  II.34.29b  g·mom·B·J_z/ℏ
IRRELEVANT  Zeeman energy. Not applicable.

### #79  II.35.18  n₀/(e^(x) + e^(−x))  where x = mom·B/(k_B T)
◇MINIMAL◇  Brillouin function (1/2 spin). For 2-state folds (measured vs
              unmeasured): population ratio = 1/(e^x + e^(-x)). x =
              field_strength/(access_temp). Under strong query, folds
              polarize toward the measured state.

### #80  II.35.21  n_ρ·mom·tanh(mom·B/(k_B T))
◇MINIMAL◇  Magnetization = number density · moment · tanh(field/temp).
              Fold "magnetization" = numEntries · avgRelevance ·
              tanh(queryIntensity/accessTemp). The collective alignment
              of folds toward the query saturates as tanh(x→large)→1.
              This IS the measurement saturation in Michaelis-Menten.

### #81  II.36.38  mom·H/(k_B T) + (mom·α/(εc²k_B T))·M
IRRELEVANT  Weiss molecular field. Mean-field theory for ferromagnetism.
              The entangled fold graph IS a mean-field system (each
              fold feels the average field of correlated folds).

### #82  II.37.1  mom·(1+χ)·B
IRRELEVANT  Total moment with susceptibility. Not applicable.

### #83  II.38.3  Y·A·x/d
IRRELEVANT  Hooke's law in bulk (Young's modulus). Already have ½kx².

### #84  II.38.14  Y/(2(1+σ))
IRRELEVANT  Shear modulus. Not applicable.

---

## Volume III — quantum mechanics (85–99)

### #85  III.4.32  1/(e^(ℏω/(k_B T)) − 1)
◇MINIMAL◇  Bose-Einstein occupation number. The access distribution at
              equilibrium: n_access(ω) = boson occupation where frequency
              ω = project(fold,query)/ℏ (energy quantum). Folds with
              high relevance are "cool" (low energy) and get more
              measurement attention. Folds with low relevance are "hot"
              and get less.

### #86  III.4.33  ℏω/(e^(ℏω/(k_B T)) − 1)
◇MINIMAL◇  Planck energy per mode. Same as III.4.32 × ℏω. Total energy
              in each measurement "mode" at frequency ω. The energy
              stored in folds at relevance level r follows this.

### #87  III.7.38  2·mom·B/ℏ
IRRELEVANT  Rabi frequency. Not applicable.

### #88  III.8.54  sin²(E_n·t/ℏ)
★NATIVE★  quantum.js:550  Oscillatory backaction. measureFold with
              oscillate=true uses sin²(Et/ℏ) to model repeated
              measurement oscillation. The fold oscillates between
              measurement states at frequency E/ℏ. This IS the
              Rabi oscillation for a 2-level system.

### #89  III.9.52  (p_d·E_f·t/ℏ)·sin²((ω−ω₀)t/2)/((ω−ω₀)t/2)²
◇MINIMAL◇  Transition probability for near-resonant driving. When query
              frequency ω ≈ fold natural frequency ω₀ (decoherence rate),
              the transition probability grows as t²·sinc²(Δω·t/2).
              This is Fermi's golden rule for measurement: the fold is
              most easily measured when the query closely matches its
              natural semantic frequency.

### #90  III.10.19  mom·√(B_x²+B_y²+B_z²)
IRRELEVANT  Magnitude of magnetic moment. Not applicable.

### #91  III.12.43  n·ℏ
IRRELEVANT  Quantized angular momentum. Not applicable.

### #92  III.13.18  2·E_n·d²·k/ℏ
IRRELEVANT  Transmission coefficient. Not applicable.

### #93  III.14.14  I₀(e^(qV/(k_B T)) − 1)
◇MINIMAL◇  Diode I-V characteristic. The measurement rate I (current of
              meaning from query) as a function of query "voltage" V
              (relevance threshold): I = I₀·(e^(q·V/kT) − 1). When V→0
              (no threshold), I→0. When V → large, I grows exponentially.
              The reverse bias (negative V) is the cost of not measuring.

### #94  III.15.12  2U(1 − cos(kd))
◇MINIMAL◇  Tight-binding band energy. The fold's energy in the "lattice"
              of correlated folds: E(k) = 2U(1−cos(ka)) where U =
              entanglement strength and k = project(fold_i, fold_j),
              a = lattice spacing (1/√9 = semantic grid spacing).
              The entanglement graph IS a tight-binding model.

### #95  III.15.14  ℏ²/(2·E_n·d²)
◇MINIMAL◇  Effective mass from band curvature. Fold "mass" (inertia to
              measurement change) = ℏ²/(2·effectiveEnergy·latticeConstant²).
              Higher entanglement → smaller effective mass → fold responds
              more quickly to queries.

### #96  III.15.27  2πα/(nd)
IRRELEVANT  Bragg condition. Not applicable.

### #97  III.17.37  β(1 + α·cosθ)
★NATIVE★  quantum.js:35,472  Anisotropic scattering kernel. Used in
              interfere(): forward-peaked for correlated folds,
              suppresses backscattering. β = base scattering strength,
              α = anisotropy (0.3), θ = phase angle between folds.

### #98  III.19.51  −mq⁴/(2(4πε)²ℏ²)·(1/n²)
IRRELEVANT  Hydrogen energy levels. Not applicable.

### #99  III.21.20  −ρ_c0·q·A_vec/m
IRRELEVANT  Current from vector potential. Not applicable.

---

## Summary: Feynman Formulas by Category

### Already in the code (★NATIVE★): 8 formulas
```
I.6.2a    #0   Gaussian (standard normal)
I.6.2     #1   Gaussian with bandwidth σ
I.11.19   #6   Dot product (inner product)
I.16.6    #19  Relativistic velocity addition
I.29.16   #28  Law of cosines
I.34.27   #36  ℏω (energy quantum)
I.37.4    #37  Two-source interference
I.40.1    #42  Exponential decay (barometric)
III.8.54  #88  Oscillatory measurement sin²(Et/ℏ)
III.17.37 #97  Anisotropic scattering β(1+α·cosθ)
```

### Emergent from composing primitives (◆EMERGENT◆): 23 formulas
```
I.6.2b    #2   Shifted Gaussian
I.8.14    #3   Euclidean distance
I.9.18    #4   Gravity (≡ Poisson)
I.12.4    #9   E-field of point charge
I.12.5    #10  Force on charge
I.13.4    #12  Kinetic energy
I.14.3    #14  Gravitational PE
I.14.4    #15  Spring potential (Hooke's law)
I.24.6    #23  Harmonic oscillator energy
I.29.4    #27  Wavenumber
I.30.3    #29  N-slit interference
I.43.16   #44  Drift velocity
I.43.31   #45  Einstein relation (D = μkT)
I.44.4    #47  Isothermal work
I.27.18   #73  E-field energy density
```

### Need one new primitive (◇MINIMAL◇): 34 formulas
(Includes dipole potentials, Doppler shifts, blackbody, tight-binding,
band structure, driven oscillator, scattering cross-section, etc.)

### Applied formulas (·APPLIED·): 16 formulas
(Includes gas laws, Lorentz transforms, relativistic mass, polarization)

### Irrelevant: 18 formulas
(Mostly EM/magnetism formulas: Ampère, Faraday, Gauss for magnetism,
magnetic moments, Zeeman, Larmor, waveguide, etc.)

---

## Three-Layer Derivation Chain (Extended)

```
ARITHMETIC (Layer 1 — verbatims):
  word stats → amplitudes → norm
  → Dot product (I.11.19), Gaussian kernel (I.6.2), exponential (I.40.1)
  → Born rule, entropy, relativistic addition (I.16.6)
  → Ideal gas laws (I.39.1, I.39.22)
  → "what is" — counting gives you statistical mechanics

GEOMETRY (Layer 2 — structures):
  entities + relations → distances → angles → phase
  → Euclidean distance (I.8.14), law of cosines (I.29.16)
  → Interference (I.37.4), N-slit (I.30.3), scattering (III.17.37)
  → Wavenumber (I.29.4), dipole potentials (II.6.11)
  → "how things relate" — relations give you wave phenomena

CALCULUS (Layer 3 — significances):
  deviation from priors → rates → evolution
  → Oscillation (III.8.54), Doppler shift (I.34.1), spring (I.14.4)
  → Drift + diffusion (I.43.16, I.43.31)
  → Driven oscillator (II.11.3), tight binding (III.15.12)
  → "how things change" — rates give you dynamics
```

## Complete Derivation Index

```
FORMULA NAMES → FEATURE IN SYSTEM

Born rule               → project(foldA, foldB) = |<ψ|φ>|²
Interference            → interfere(queryFold, folds) = I₁+I₂+2√(I₁I₂)·cosδ
Heat equation           → decohereFold(fold, t) = e^(−t/τ)
Uncertainty principle   → Δterrain × Δstance ≥ ℏ (entropy product)
Continuity equation     → normalizeAmplitudes() → Σ|amp|² = 1
Wave equation           → measureFold({oscillate:true}) → sin²(Et/ℏ)
Gaussian kernel         → gaussianKernel(x, y, σ) = e^(−(θ/σ)²/2)/(√(2π)·σ)
Relativistic addition   → blend(u,v) = (u+v)/(1+uv)
Law of cosines          → computePhase() = √(a²+b²−2ab·cosθ)
Fokker-Planck           → measureFold(drift) ⨟ decohereFold(diffusion)
Michaelis-Menten        → blend function saturation curve
Navier-Stokes           → ∇p = queryAmp − entryAmp
Poisson                 → priorFreq → amplitude bias (discrete ∇²φ=−ρ/ε₀)
Boltzmann distribution  → consolidate() age × access pruning
Lotka-Volterra          → terrain amplitude competition
Langevin equation       → measurement drift + accessLog noise
Harmonic oscillator     → oscillate:true in measureFold → sin² harmonic
Hooke's law             → measureFold = F = −k×(fold − query)
Einstein relation       → diffusion = mobility × temperature (from FP)
Work-energy (isothermal)→ entropy change during measurement
Drift velocity          → flow rate in Navier-Stokes
N-slit interference     → N-fold interfere() patterns
Doppler shift           → fold relevance redshift with semantic distance
Dipole field            → entangled pair's joint potential
Driven oscillator       → fold under query = driven HO with ω₀=decoherence
Blackbody               → access distribution at thermal equilibrium
Tight-binding           → entanglement graph = lattice of correlated folds
Kinetic theory (gas)    → pV = nkT for fold ensemble
Lorentz transforms      → measureFold's relativistic blend origin
Spring potential        → ½k·(1−project)² stored in measurement
```


## MATHEMATICS

### Cauchy–Riemann equations: ∂u/∂x = ∂v/∂y, ∂u/∂y = −∂v/∂x
**MINIMAL** — The fold has operator, terrain, stance as orthogonal dimensions.
The CR conditions would describe a holomorphic fold manifold where
the operator amplitude field and terrain amplitude field are conjugate
harmonic functions. Add: a complex representation ψ = φ + iχ where
φ = terrain amplitude, χ = phase. Then CR conditions describe how
the fold varies smoothly across the 9×9×9 coordinate grid.

Derivation: define complex fold amplitude ψ = terrain[Entity] + i·phase.
CR equations = the fold manifold is smooth (no kinks in semantic space).

### Chapman–Kolmogorov equation: P(X_t | X_0) = Σ P(X_t | X_s) P(X_s | X_0)
**EMERGENT** — Measure the fold at times t0, ts, t and compute transition
probabilities. The access log IS a Markov chain sample. P(entry|query)
is already computed by project(). Composing project() across time steps
yields the transition matrix. The Chapman-Kolmogorov equation is the
consistency condition for these compositions.

Derivation: define transition matrix T[i][j] = project(fold_i, fold_j).
Then T(t) = T(t, s) × T(s, 0) = T^(t/s) × T^(s) — exactly CK.
No new primitives needed — composing project() is enough.

### Maurer–Cartan equation: dω + ½[ω, ω] = 0
**IRRELEVANT** — Differential geometry on Lie groups. The fold lives
on a 9×9×9 discrete grid, not a continuous manifold. The operator
algebras don't have Lie brackets. Could become relevant if folds
were continuous (interpolated) rather than pointwise.

### Pell's equation: x² − Dy² = 1
**IRRELEVANT** — Number theory. No connection.

### Poisson's equation: ∇²φ = −ρ/ε₀
**EMERGENT** — Already derived. Prior frequency ρ → amplitude bias φ.
The fold function's computeTerrainAmplitudes(priors) IS a discrete
Poisson solver: more prior mass → stronger amplitude pull.

### Riccati equation: dy/dt = A(t) + B(t)y + C(t)y²
**EMERGENT** — The measurement backaction blend function (u+v)/(1+uv)
is the solution to a Riccati equation. Specifically: the relativistic
addition law satisfies dw/dt = (1−w²)/(1+uv) · du/dt. The saturation
curve's derivative IS quadratic in the amplitude.

Derivation: take d/dt of blend(u(t), v) with constant v.
Result: dw/dt ∝ (1−w²)/(1+uv). Riccati form.

### Sine-Gordon equation: φ_tt − φ_xx + sin(φ) = 0
**MINIMAL** — The phase computation in interfere() already uses cos(δ)
for the interference kernel. The sine-Gordon equation describes
nonlinear superposition (soliton-like behavior) in the fold's phase
field. Add: a continuous spatial coordinate along the verbatim axis
(the text position). Then phase φ(x,t) varies along the text and
satisfies SG. The system's interference IS cosine coupling; sine-Gordon
extends this to propagation.

### Verhulst equation: dP/dt = rP(1 − P/K)
**EMERGENT** — This IS the single-species version of Lotka-Volterra
(already built). Entity terrain amplitude growth saturates at K=1
due to normalizeAmplitudes(). The growth rate r is the prior frequency
for that terrain's lexicon.

Derivation: terrainAmp(t+dt) = terrainAmp(t) + dt·r·terrainAmp·(1−terrainAmp/K)
where K=1 (normalized), r = prior bias strength. This is Verhulst.

---

## PHYSICS (Eponymous)

### Ampère's circuital law: ∇×B = μ₀J + μ₀ε₀∂E/∂t
**IRRELEVANT** — Electromagnetism. No magnetic field analog in the system
unless you define B = curl of stance field, J = query current density.

### Bernoulli's equation: p + ½ρv² + ρgh = constant
**EMERGENT** — The Navier-Stokes simplification in physics.js ALREADY
satisifies Bernoulli: along a streamline (amplitude flow from query
to entry), p + ½v² is conserved when viscosity is zero. With constant
density ρ=1 (probability density is always 1) and no height term:
p(query) + ½v(query)² = p(entry) + ½v(entry)².

Derivation: the flow velocity v = −∇p/μ. Along the flow line:
∂(p + v²/2)/∂x = 0 → Bernoulli.

### Bessel's differential equation: x²y'' + xy' + (x²−ν²)y = 0
**IRRELEVANT** — Cylindrical coordinates. The fold is on a 9×9×9 rectangular grid, not cylindrical.

### Bogoliubov-Born-Green-Kirkwood-Yvon (BBGKY) hierarchy
**MINIMAL** — Statistical mechanics of N-body systems. The entangled
fold graph IS an N-body system: each fold interacts with correlated
folds via updateEntangledFold(). The BBGKY hierarchy describes how
the k-particle (k-fold) distribution evolves from the (k+1)-fold
distribution. Add: a joint probability over N folds. The correlation
function IS already computeCorrelationFactor().

### Boltzmann equation: ∂f/∂t + v·∇f = (∂f/∂t)_collision
**EMERGENT** — The access log histogram IS the distribution f.
Consolidation with Boltzmann pruning IS the collision term.
The drift term v·∇f = measurement backaction pushing folds toward query.
The collision term = consolidate() removing cold entries.

Derivation: f(entry) = accessCount distribution. ∂f/∂t = new accesses.
v·∇f = measureFold backaction. (∂f/∂t)_collision = boltzmannConsolidate().

### Borda–Carnot equation: Δp = ½ρ(v₁² − v₂²) − k·½ρv₁²
**IRRELEVANT** — Hydraulic head loss. Not applicable.

### Burgers' equation: u_t + u·u_x = ν·u_xx
**EMERGENT** — This IS what Navier-Stokes reduces to in 1D with no
pressure gradient. The fold's amplitude advection along one dimension
(the text-temporal axis) satisfies Burgers: u·u_x is the self-advection
term from the fold's own amplitude, ν·u_xx is decoherence diffusion.
The interference shock (cos(phase) term) creates Burgers-like waves.

Derivation: restrict NavierStokesFlow to one dimension → Burgers.

### Darcy–Weisbach equation: Δp/L = f_D·(ρ/2)·(v²/D)
**IRRELEVANT** — Pipe flow friction. Not applicable.

### Dirac equation: (iγ^μ∂_μ − m)ψ = 0
**MINIMAL** — The fold has 9×9×9 = 729 dimensions — isomorphic to
a spinor field. If operators are gamma matrices, terrains are spinor
components, and stances are Lorentz indices, the Dirac equation
describes how the fold's "spin" (operator orientation) evolves
under measurement. The mass term m = decoherence rate (resistance
to change). Add: a 9×9 representation of the gamma matrices over
the operator algebra.

### Drake equation: N = R*·f_p·n_e·f_l·f_i·f_c·L
**APPLIED** — Multiply: (significance rate) × (prior entity fraction) ×
(structures per entity) × (conscious entries fraction) × (relevance
probability) × (consolidated survival fraction) × (store lifetime).
Map: R* = significance generation rate, f_p = significant entities fraction,
n_e = structures per entity, f_l = conscious entries/verbatims ratio,
f_i = entropy above threshold, f_c = blackScholesValue > 0.5 fraction,
L = DECOHERENCE_TAU.

### Einstein's field equations: G_μν + Λg_μν = 8πG·T_μν
**IRRELEVANT** — Spacetime curvature. The fold lives on a semantic
manifold that is flat (all 9 dimensions are orthogonal). Unless you
define the metric g_μν as the inner product matrix between folds,
in which case G_μν becomes the Ricci curvature of the semantic space.
But that's an external geometric structure we'd have to add.

### Euler equations (fluid dynamics): ρ(∂u/∂t + u·∇u) = −∇p + ρg
**EMERGENT** — This IS Navier-Stokes with μ=0 (no viscosity, no decoherence).
The system's fold flow in the limit of zero decoherence satisfies
the Euler equations: pure inertial flow from pressure gradient.

Derivation: set VISCOSITY → ∞ in navierStokesFlow → v = -∇p (pure pressure driven).
Then ∂u/∂t + u·∇u = acceleration term from successive advection steps.
Result: Euler equations.

### Euler's equations (rigid body): I₁ω̇₁ + (I₃−I₂)ω₂ω₃ = τ₁
**IRRELEVANT** — Rigid body rotation. The fold's amplitude vector
rotates in Hilbert space but with equal moments of inertia (all
dimensions are equally weighted by normalizeAmplitudes).

### Euler–Lagrange equation: ∂L/∂q − d/dt(∂L/∂q̇) = 0
**APPLIED** — Already built. L = relevance − cost. Top-K = stationary
action. The d/dt(∂L/∂q̇) term is conceptual because the system's
search is discrete (no continuous time derivative of scores).

### Faraday's law: ∇×E = −∂B/∂t
**IRRELEVANT** — Electromagnetism. No electric/magnetic field analog.

### Fokker–Planck equation: ∂P/∂t = −∂(μP)/∂x + ∂²(DP)/∂x²
**EMERGENT** — Already derived. measureFold ⨟ decohereFold = FP operator splitting.
Drift μ = measurement backaction, diffusion D = decoherence rate.

### Fresnel equations: R_s = |sin(θ_t−θ_i)/sin(θ_t+θ_i)|²
**IRRELEVANT** — Light reflection. No optical interface in the system
unless you define a boundary between semantic layers as the interface,
and fold amplitude as intensity. Then the reflection/transmission
at the verbatim→structure boundary would follow Fresnel. Too forced.

### Friedmann equations: H² = 8πGρ/3 − k/a² + Λ/3
**IRRELEVANT** — Cosmology. No expanding universe analog.

### Gauss's law for electricity: ∇·E = ρ/ε₀
**IRRELEVANT** — But structurally identical to Poisson with E=−∇φ.
So if E = amplitude gradient and ρ = prior charge, this IS the
prior-to-amplitude mapping. Same as Poisson.

### Gauss's law for gravity: ∇·g = −4πGρ
**IRRELEVANT** — Gravity. Same form as Poisson. Prior mass → amplitude pull.
Already covered under Poisson's equation.

### Gauss's law for magnetism: ∇·B = 0
**IRRELEVANT** — Magnetism.

### Gibbs–Helmholtz equation: (∂(G/T)/∂T)_p = −H/T²
**IRRELEVANT** — Chemical thermodynamics.

### Gross–Pitaevskii equation: iℏ∂ψ/∂t = (−ℏ²/2m·∇² + V + g|ψ|²)ψ
**MINIMAL** — This IS the Schrödinger equation (ℏ²/2m·∇² is the kinetic
term from fold spreading) plus a nonlinear term g|ψ|² representing
fold-fold interaction (the interference term in interfere() IS the
interaction). Add: a continuous Laplacian ∇² over the terrain-stance
grid. Then the GP equation describes the fold's nonlinear evolution
under its own amplitude (self-interference).

### Hamilton–Jacobi–Bellman equation: −∂V/∂t = min_u {L(x,u) + ∇V·f(x,u)}
**EMERGENT** — The Euler-Lagrange optimal K IS a value function V(K)
optimized by minimize action. HJB is the differential form: the
value function V(t, state) satisfies ∂V/∂t + min_u {cost + ∇V·dynamics} = 0.
The system's search with Euler-Lagrange optimal K IS solving a discrete
HJB on the semantic state space.

### Helmholtz equation: ∇²u + k²u = 0
**EMERGENT** — The fold's amplitude field, after normalization,
satisfies Σ|amp|² = 1. If we Fourier transform the amplitude field
over the terrain dimension, the spatial frequency k satisfies
(ik)²φ + k²φ = 0 — the Helmholtz equation for each frequency.
Each terrain is a standing wave in semantic space with wavenumber
k proportional to prior frequency.

### Karplus equation: J(φ) = A cos²(φ) + B cos(φ) + C
**IRRELEVANT** — NMR coupling. No molecular analog.

### Kepler's equation: M = E − e sin(E)
**IRRELEVANT** — Orbital mechanics.

### Kepler's laws of planetary motion
**IRRELEVANT** — Orbits.

### Kirchhoff's diffraction formula: U(P) = −1/(4π) ∮ [U·∂/∂n(e^(iks)/s) − e^(iks)/s·∂U/∂n] dS
**IRRELEVANT** — Wave diffraction.

### Klein–Gordon equation: (∂_μ∂^μ + m²)φ = 0
**MINIMAL** — This IS the wave equation (□φ = 0) plus mass term m²φ.
The fold's oscillatory backaction (sin²(Et/ℏ) in measureFold with
oscillate=true) satisfies the Klein-Gordon equation when the energy
E is the mass term. Add: continuous spacetime derivative ∂_μ along
the verbatim-temporal axis.

### Korteweg–de Vries equation: u_t + u·u_x + u_xxx = 0
**MINIMAL** — Burgers + dispersion term u_xxx. The phase computation
in interfere() creates dispersive waves (different terrains propagate
at different "speeds" = different correlation lengths). Add: a third
spatial derivative from the phase gradient along the text axis.

### Landau–Lifshitz–Gilbert equation: ∂m/∂t = −γ·m×H_eff + α·m×∂m/∂t
**IRRELEVANT** — Magnetization dynamics.

### Lane–Emden equation: (1/ξ²)·d(ξ²·dθ/dξ)/dξ = −θ^n
**IRRELEVANT** — Stellar structure.

### Langevin equation: m·d²x/dt² = −λ·dx/dt + η(t)
**EMERGENT** — The fold's amplitude evolution under random queries:
m·d²x/dt² = measureFold drift + random query noise.
The access log IS the noise source η(t) (random query arrivals).
The damping −λ·dx/dt IS decoherence. The mass m IS prior inertia
(established entries resist change). This is the stochastic version
of Fokker-Planck — same physics, different representation.

Derivation: the drift term from Fokker-Planck = measureFold.
The noise term = random query arrival from accessLog.
The damping = decohereFold. Result: Langevin dynamics.

### Lindblad equation: ∂ρ/∂t = −i[H,ρ] + Σ(L_k·ρ·L_k† − ½{L_k†·L_k, ρ})
**APPLIED** — Quantum master equation for open systems. The fold interacts
with the "environment" (other folds, the measurement process, priors).
The Hamiltonian term −i[H,ρ] = Schrödinger evolution (already applied).
The Lindblad operators L_k describe decoherence channels: the nine terrains
each act as a Lindblad operator projecting the fold onto that terrain.
The sum over k = sum over TERRAINS.

### Lorentz equation: m·d²x/dt² = q(E + v×B)
**IRRELEVANT** — Charged particle in EM field.

### Maxwell's equations: the four equations
**IRRELEVANT** — Electromagnetism. But: Gauss's law = Poisson (covered).
Faraday's law = no analog. Divergence-free B = continuity (covered).
Ampère's law = no analog.

### Maxwell's relations: (∂T/∂V)_S = −(∂P/∂S)_V etc.
**IRRELEVANT** — Thermodynamics.

### Newton's laws of motion: F = ma
**EMERGENT** — The fold's amplitude "acceleration" under measurement
pressure. In the search method, the Navier-Stokes flow IS F = ma:
F = pressure gradient (∇p), m = amplitude inertia (1/bornProbability),
a = amplitude velocity change. Specifically: a = F/m = ∇p·bornProbability.

### Navier–Stokes equations: see above
**EMERGENT** — Already derived via pressure gradient.

### Prandtl–Reuss equations
**IRRELEVANT** — Plasticity theory.

### Prony equation: y(t) = Σ A_i·e^(−t/τ_i)
**NATIVE** — decohereFold IS multi-exponential decay with τ = DECOHERENCE_TAU.
Each terrain/stance/operator dimension has its own decay rate (all
currently equal, but could be anisotropic). The fold decay after
measurement IS a Prony series: sum of exponentials over dimensions.

### Rankine–Hugoniot equation
**IRRELEVANT** — Shock waves. But Burgers (which we have) is the
continuous version with shock formation from the u·u_x term.

### Saha ionization equation
**IRRELEVANT** — Plasma physics.

### Sackur–Tetrode equation
**IRRELEVANT** — Statistical thermodynamics.

### Schrödinger equation: iℏ∂ψ/∂t = Ĥψ
**APPLIED** — Already built. sin²(Et/ℏ) in measureFold is the solution.
Unitary evolution e^(−iHt/ℏ)ψ(0) is applied as rotation.

### Screened Poisson equation: ∇²φ − λ²φ = −ρ/ε₀
**MINIMAL** — Poisson with a screening term λ²φ. The screening length
1/λ IS the decoherence rate: distant priors (in semantic space) have
exponentially suppressed influence on the current fold. Add: λ = 1/DECOHERENCE_TAU.
This gives more realistic prior-to-amplitude coupling than plain Poisson.

### Schwinger–Dyson equation
**IRRELEVANT** — Quantum field theory.

### Sellmeier equation: n²(λ) = 1 + Σ B_i·λ²/(λ²−C_i)
**IRRELEVANT** — Optics dispersion.

### Stokes–Einstein relation: D = k_B·T/(6π·η·r)
**APPLIED** — The diffusion coefficient D from Fokker-Planck relates to
temperature (access frequency) and viscosity (decoherence rate):
D = BOLTZMANN_K × accessCount / (6π × VISCOSITY × recency).

### Tsiolkovsky rocket equation: Δv = v_e·ln(m_0/m_f)
**IRRELEVANT** — Rocket propulsion.

### Van der Waals equation: (p + a·n²/V²)(V − n·b) = nRT
**APPLIED** — Non-ideal fold behavior. The "ideal gas" of folds is pV = nT
(p = relevance pressure, V = semantic volume, T = access temperature).
Van der Waals correction a·n²/V² = fold-fold attraction (entanglement
correlation pulls folds together, reducing effective pressure).
b = excluded volume (normalizeAmplitudes prevents two folds from
occupying the same exact amplitude state — Pauli-like exclusion).

### Vlasov equation: ∂f/∂t + v·∇f + F/m·∇_v f = 0
**EMERGENT** — This IS the collisionless Boltzmann equation. In the
limit where consolidate() doesn't run (no pruning), the fold distribution
evolves by drift (measureFold) and force (query pressure) without
thermalization. The Vlasov equation describes the fold phase space
distribution in this regime.

### Wiener equation
**IRRELEVANT** — Stochastic processes.

---

## PHYSICS (General)

### Advection equation: ∂u/∂t + c·∂u/∂x = 0
**EMERGENT** — The amplitude flow WITHOUT diffusion. In navierStokesFlow,
if viscosity → 0 and pressure gradient is constant, the amplitude simply
advects: ∂amp/∂t = -c·∇(queryAmp - amp). Pure advection.

### Barotropic vorticity equation
**IRRELEVANT** — Atmospheric dynamics.

### Continuity equation: ∂ρ/∂t + ∇·J = 0
**NATIVE** — normalizeAmplitudes() enforces Σ|amp|² = 1 at every step.
Probability is conserved. J is the probability current between dimensions.
Already built as verifyContinuity().

### Diffusion equation: ∂u/∂t = D·∇²u
**NATIVE** — decohereFold IS exponential decay toward uniform.
The diffusion equation is the continuum limit: ∂|amp_k|²/∂t = D·∇²|amp_k|²
where ∇² is the discrete Laplacian over adjacent terrains/operators.
D = 1/DECOHERENCE_TAU × (uniformAmplitude).

### Drag equation: F_d = ½ρ·v²·C_d·A
**IRRELEVANT** — Aerodynamic drag.

### Equations of motion: s = ut + ½at²
**EMERGENT** — The amplitude trajectory under constant measurement pressure.
Position s(t) = initial amplitude + query backaction velocity × t
+ ½ × (query pressure / inertia) × t². The constant acceleration
comes from persistent repeated queries (same user, repeated ask).

### Equation of state: f(p, V, T) = 0
**APPLIED** — The fold has a state equation relating relevance pressure p,
semantic volume V (entropy), and temperature T (access frequency).
Pressure = query intensity. Volume = Shannon entropy of the fold.
Temperature = access count distribution width. pV ∝ T for "ideal fold",
pV = T/(1−b·V) for "van der Waals fold" (entangled).

### Equation of time: Δt = apparent_solar − mean_solar
**IRRELEVANT** — Astronomy timekeeping.

### Heat equation: ∂u/∂t = α·∇²u
**NATIVE** — decohereFold IS the heat equation solution e^(−t/τ).
Already built.

### Ideal gas equation: pV = nRT
**APPLIED** — For the fold as an "ideal gas" of semantic particles:
p = query pressure (average project() score over recent queries).
V = store size (number of entries × average entropy).
n = number of semantic "moles" (significant features / 6.022e23).
R = universal semantic constant = BOLTZMANN_K × Avogadro.
T = access temperature (average access frequency).

### Ideal MHD equations
**IRRELEVANT** — Magnetohydrodynamics.

### Mass–energy equivalence: E = mc²
**APPLIED** — For the fold: E = fold's "energy" = project(fold, query).
m = fold's "mass" = prior inertia (frequency-weighted amplitude).
c = maximum semantic speed = 1 (amplitude normalization ceiling).
Then E = m (c² = 1) — energy equals mass when the speed of meaning
is normalized to 1.

### Primitive equations
**IRRELEVANT** — Geophysics.

### Relativistic wave equations
**APPLIED** — The measureFold blend function (u+v)/(1+uv) IS relativistic
velocity addition. The Klein-Gordon and Dirac equations are relativistic
extensions of the Schrödinger equation already discussed.

### Vis-viva equation: v² = GM(2/r − 1/a)
**APPLIED** — Orbital energy. The fold's "orbit" around a prior: the
"velocity" (relevance score) squared relates to the prior's
"gravitational pull" (prior frequency) and the fold's distance from
the prior (1 − project(fold, priorFold)). A fold that's close to
its prior has high velocity (high relevance).

### Vorticity equation: Dω/Dt = (ω·∇)u + ν∇²ω
**IRRELEVANT** — Fluid vorticity.

### Wave equation: ∂²u/∂t² = c²·∇²u
**NATIVE** — The oscillatory measurement backaction in measureFold
with oscillate=TRUE produces sin²(Et/ℏ) which satisfies ∂²u/∂t² ∝ −E²u.
The spatial derivative ∇²u comes from the phase gradient across
fold dimensions (different terrains oscillate at different frequencies).
This IS the wave equation for the fold's oscillating amplitude.

---

## CHEMISTRY

### Arrhenius equation: k = A·e^(−E_a/RT)
**APPLIED** — The rate k at which measurement backaction activates a fold:
A = attempt frequency (query rate from accessLog).
E_a = activation energy (decoherence barrier — old folds take more energy).
R = semantic gas constant (BOLTZMANN_K).
T = temperature (access frequency).

### Butler–Volmer equation
**IRRELEVANT** — Electrochemistry.

### Eyring equation: k = (k_B·T/h)·e^(−ΔG‡/RT)
**APPLIED** — Transition state theory for fold measurement. The fold
goes through an "activated complex" (partially projected state)
before collapsing to the measured state. ΔG‡ = activation free energy
= entropy barrier + prior resistance.

### Henderson–Hasselbalch equation: pH = pK_a + log([A−]/[HA])
**IRRELEVANT** — Acid-base chemistry.

### Michaelis–Menten equation: v = V_max·[S]/(K_m + [S])
**EMERGENT** — Already derived. The relativistic blend in measureFold
IS the same sigmoidal saturation curve.

### Nernst equation: E = E° − (RT/nF)·ln(Q)
**IRRELEVANT** — Electrochemistry.

### Schrödinger equation (chemistry)
**APPLIED** — Same as physics Schrödinger. Already built.

### Urey–Bigeleisen–Mayer equation
**IRRELEVANT** — Isotope geochemistry.

---

## BIOLOGY

### Breeder's equation: R = h²·S
**APPLIED** — Selection for relevance during consolidation.
R = response to consolidation (change in average relevance).
h² = heritability (the fold's "genetic" stability — how much amplitude
persists through decoherence).
S = selection differential (difference between consolidated and pruned).

### Hardy–Weinberg principle: p² + 2pq + q² = 1
**EMERGENT** — The terrain amplitude distribution IS a Hardy-Weinberg
equilibrium: p = Entity amplitude, q = Field amplitude.
p² = Entity-Entity correlation amplitude.
2pq = Entity-Field cross-correlation.
q² = Field-Field correlation amplitude.
p² + 2pq + q² = 1 is enforced by normalizeAmplitudes when
correlation is phase = π (interference at equilibrium).

### Hill equation: v = V_max·[S]^n/(K_d^n + [S]^n)
**EMERGENT** — Cooperative Michaelis-Menten with Hill coefficient n.
When multiple folds are entangled, the effective measurement
saturation becomes cooperative: measuring one fold increases
the probability of measuring its entangled partners. The Hill
coefficient n = number of entangled folds.
n → 1: no cooperativity (single fold).
n > 1: positive cooperativity (entangled folds reinforce).

### Lotka–Volterra equation: dx/dt = αx − βxy, dy/dt = δxy − γy
**EMERGENT** — Already derived for terrain competition. Already built.

### Michaelis–Menten (biochemistry)
**EMERGENT** — Same as above. Already derived from measureFold's blend function.

### Poiseuille equation: Q = πR⁴·Δp/(8η·L)
**IRRELEVANT** — Fluid flow through pipes.

### Price equation: Δz̄ = cov(w_i, z_i)/w̄ + E(w_i·Δz_i)/w̄
**APPLIED** — The change in average fold relevance during consolidation:
z_i = relevance of entry i (score from last access).
w_i = fitness (survival from boltzmannSurvival).
Δz̄ = change in average relevance after one consolidation cycle.
cov(w_i, z_i)/w̄ = selection effect (fit entries survive).
E(w_i·Δz_i)/w̄ = transmission effect (measureFold backaction changes entries).

Derivation: this IS what consolidate() computes: the new average
relevance after pruning and measurement backaction.

---

## ECONOMICS

### Black–Scholes equation: ∂V/∂t + ½σ²S²∂²V/∂S² + rS·∂V/∂S − rV = 0
**APPLIED** — Already built. r = decoherence rate, σ = uncertainty.

### Fisher equation: i = r + π
**APPLIED** — Nominal interest rate i = real rate r + expected inflation π.
For the fold: i = apparent relevance decay rate (what we observe).
r = real decoherence rate (1/DECOHERENCE_TAU).
π = "inflation" = dilution by new ingestions (store growth rate).

---

## TELECOMMUNICATIONS

### Telegrapher's equations: ∂V/∂x = −L·∂I/∂t − R·I, ∂I/∂x = −C·∂V/∂t − G·V
**IRRELEVANT** — Transmission lines.

### Password length equation
**IRRELEVANT** — Security.

---

## SUMMARY TABLE

| Equation | Status | System Primitives Used |
|---|---|---|
| Born rule | NATIVE | project() |
| Interference (2-source) | NATIVE | interfere() |
| Heat/Diffusion | NATIVE | decohereFold() |
| Uncertainty principle | NATIVE | computeUncertainty() |
| Continuity equation | NATIVE | normalizeAmplitudes() |
| Wave equation | NATIVE | measureFold({oscillate:true}) |
| Prony series | NATIVE | decohereFold (multi-exp) |
| Fokker-Planck | EMERGENT | measureFold ⨟ decohereFold |
| Michaelis-Menten | EMERGENT | blend(u,v) in measureFold |
| Navier-Stokes | EMERGENT | ∇p = queryAmp − entryAmp |
| Poisson | EMERGENT | priorFreq → amp bias |
| Boltzmann | EMERGENT | consolidate() age×access |
| Lotka-Volterra | EMERGENT | terrain amp competition |
| Langevin | EMERGENT | meas + noise (accessLog) |
| Euler (fluid) | EMERGENT | Navier-Stokes, μ=0 |
| Verhulst | EMERGENT | Lotka-Volterra single species |
| Chapman-Kolmogorov | EMERGENT | compose project() over time |
| Riccati | EMERGENT | d/dt of blend function |
| Burgers | EMERGENT | Navier-Stokes 1D limit |
| Vlasov | EMERGENT | collisionless Boltzmann |
| Advection | EMERGENT | Navier-Stokes, D=0 |
| Equations of motion | EMERGENT | constant query pressure |
| Hardy-Weinberg | EMERGENT | terrain amplitude distribution |
| Hill equation | EMERGENT | cooperative entanglement |
| Schrödinger | APPLIED | sin²(Et/ℏ) in measureFold |
| Black-Scholes | APPLIED | r=decoherence, S=access, K=threshold |
| Euler-Lagrange | APPLIED | L = relevance − cost |
| Klein-Gordon | MINIMAL | wave eqn + mass (decoherence) |
| Dirac | MINIMAL | operators as gamma matrices |
| Sine-Gordon | MINIMAL | phase as continuous field |
| Gross-Pitaevskii | MINIMAL | Schrödinger + nonlinear term |
| Screened Poisson | MINIMAL | Poisson + decoherence screening |
| Cauchy-Riemann | MINIMAL | complex representation of fold |
| BBGKY hierarchy | MINIMAL | joint N-fold distribution |
| Price equation | APPLIED | consolidate() selection effect |
| Fisher equation | APPLIED | i = r + store growth |
| Drake equation | APPLIED | multiply signification rates |
| Lindblad | APPLIED | decoherence channel sum |
| Arrhenius | APPLIED | fold activation rate |
| Eyring | APPLIED | transition state measurement |
| Van der Waals | APPLIED | fold-fold attraction + exclusion |
| Ideal gas | APPLIED | pV = nT for folds |
| Breeder's equation | APPLIED | selection by relevance |
| Mass-energy | APPLIED | E = m for folds |
| Vis-viva | APPLIED | fold "orbit" around prior |
