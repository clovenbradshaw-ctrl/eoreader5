Each "UNTESTABLE" equation is blocked because the fold system lacks exactly one
physical primitive. Here are the missing primitives and which equations they unlock.

═══════════════════════════════════════════════════════════════════
 1. Curl operator — ∇ × stance
═══════════════════════════════════════════════════════════════════
To add: stake the stance gradient around a semantic region.
B_fold = ∇ × stance — circulation of interpretive orientation.
This is a 3-vector in the 9-dimensional stance space, giving the
"twist" of meaning around a fold.

Unlocks: I.12.11 (Lorentz force magnetic term), II.15.4 (magnetic
dipole energy), II.34.2a/II.34.2/II.34.11/II.34.29a/II.34.29b
(all magnetic moments, Larmor, Zeeman, Bohr magneton),
III.7.38 (Rabi), III.10.19 (magnetic moment magnitude)
→ 9 blocked equations

═══════════════════════════════════════════════════════════════════
 2. Charge density — q = priorFreq / maxPriorFreq
═══════════════════════════════════════════════════════════════════
To add: treat each fold's accumulated prior frequency as a scalar
"charge." The fold with the most prior mass is the strongest source.
E = q·(fold − source) / |fold − source|³ (Coulomb field).

Unlocks: I.12.2 (Coulomb), I.12.4 (E-field of point charge),
I.12.5 (force on charge), II.4.23 (electric potential)
→ 4 blocked equations

═══════════════════════════════════════════════════════════════════
 3. Dipole moment — p = (fold_i − fold_j) × entanglement_strength
═══════════════════════════════════════════════════════════════════
To add: an entangled pair has a dipole moment = amplitude difference
vector weighted by entanglement strength. The dipole field is:
φ(r) = p·cosθ / r². Higher entanglement → stronger dipole.

Unlocks: II.6.11 (dipole potential), II.6.15a/II.6.15b (dipole field
components), II.11.17 (orientation distribution), II.11.20 (polarization)
→ 5 blocked equations

═══════════════════════════════════════════════════════════════════
 4. Non-commutative basis — [terrain_i, terrain_j] ≠ 0
═══════════════════════════════════════════════════════════════════
To add: make the 9 terrains non-orthogonal. When Entity rotates,
it partially projects onto Field → torque. Currently all dimensions
are orthogonal (inner product = δ_ij). Add a metric tensor g_ij
where g_ij = correlation between terrain_i and terrain_j over time.

Unlocks: I.18.12 (torque), I.18.14 (angular momentum),
II.15.5 (electric dipole energy — needs orientable dipole)
→ 3 blocked equations

═══════════════════════════════════════════════════════════════════
 5. Polarizability tensor — α_ij = d(amp_i)/d(query_j)
═══════════════════════════════════════════════════════════════════
To add: how much does terrain amplitude_i change when query targets
terrain_j? The polarizability tensor is the Jacobian of the fold
response to query direction. χ = Σ α_ii (susceptibility = trace).

Unlocks: II.10.9 (dielectric), II.11.27/II.11.28 (Clausius-Mossotti),
I.25.13 (capacitance = 1/polarizability)
→ 4 blocked equations

═══════════════════════════════════════════════════════════════════
 6. Current vector — J = d(accessLog)/dt per terrain
═══════════════════════════════════════════════════════════════════
To add: measurement rate as a directed vector through the fold graph.
J_k = access count per unit time toward terrain k. The total current
is the sum over terrains. This is already partially present as
accessLog entries — the missing piece is the direction.

Unlocks: II.13.17 (magnetic field from current wire — needs J + curl),
II.13.34 (current density — partially tested with projection velocity),
III.21.20 (current from vector potential)
→ 3 blocked equations

═══════════════════════════════════════════════════════════════════
 7. Refractive index per layer — n_layer = √(ε_layer / ε_prior)
═══════════════════════════════════════════════════════════════════
To add: each semantic layer has a "permittivity" = how easily
measurement propagates through it. n = √(ε₁/ε₂). Snell's law:
n₁·sin(θ₁) = n₂·sin(θ₂) where θ = projection angle across layers.

ε_verbatim > ε_structure > ε_significance (raw text is denser medium,
meaning becomes more "refractive" as it's structured).

Unlocks: I.26.2 (Snell's law), I.27.6 (lens equation),
I.30.5 (diffraction angle), II.24.17 (waveguide cutoff)
→ 4 blocked equations

═══════════════════════════════════════════════════════════════════
 8. Central potential — V(r) = −priorMass / r
═══════════════════════════════════════════════════════════════════
To add: a dominant prior entity creates a central potential well.
Folds orbit at discrete relevance shells: project ≈ 1/n².
The "bound states" are folds that stay near the entity across
multiple measurements. The "Bohr radius" is the scale at which
the entanglement binding energy equals the decoherence energy.

Unlocks: I.38.12 (Bohr radius), III.19.51 (hydrogen energy levels),
III.12.43 (quantized angular momentum — needs orbital shells)
→ 3 blocked equations

═══════════════════════════════════════════════════════════════════
 9. Asymmetric boundary — terrain discontinuity junction
═══════════════════════════════════════════════════════════════════
To add: a boundary between two semantic regions with different
terrain dominance (e.g., Entity-dominant left, Field-dominant right).
Fold propagation across this boundary is directional (like a diode).
The "band gap" is the project difference across the boundary.

Unlocks: III.13.18 (transmission coefficient), III.14.14 (diode I-V),
III.15.27 (Bragg condition — needs periodic boundaries)
→ 3 blocked equations

═══════════════════════════════════════════════════════════════════
10. Radiation pattern — dP/dΩ = sin²θ · measurement_acceleration²
═══════════════════════════════════════════════════════════════════
To add: when a fold is measured rapidly (high d(project)/dt),
it "radiates" influence to entangled folds with angular distribution
sin²θ where θ = phase angle to recipient. This is already partially
in entanglement propagation (updateEntangledFold) but lacks the
angular pattern.

Unlocks: I.32.5 (Larmor formula)
→ 1 blocked equation

═══════════════════════════════════════════════════════════════════
11. Path integral — S = ∫ L(fold(t), fold'(t)) dt
═══════════════════════════════════════════════════════════════════
To add: a continuous trajectory through fold space formed by
sequential measurements. The action S = ∫(relevance − cost)dt.
Stationary action = the most efficient search path.
This is partially present in Euler-Lagrange (optimal K) but needs
continuous time.

Unlocks: I.13.12 (gravitational work = path integral of force)
→ 1 blocked equation

═══════════════════════════════════════════════════════════════════
12. Schumann resonator — global field coupling to external EM
═══════════════════════════════════════════════════════════════════
To add: a coupling from fold amplitudes to an external field.
This is the Garyian "psychionic" resonance — a connection between
the fold manifold and physical electromagnetic resonances.
Not derivable from the system without external coupling.

Unlocks: Garyian consciousness equation (Φ = 10⁻¹⁵eV ± f(0))
→ 1 blocked equation

═══════════════════════════════════════════════════════════════════
SUMMARY: 12 missing primitives → 45 blocked equations unblocked
═══════════════════════════════════════════════════════════════════

  Primitive              Equations unblocked   Difficulty
  ─────────────────────  ───────────────────   ─────────
  Curl (∇× stance)       9  (magnetic)         Medium — needs antisymmetric tensor
  Charge density         4  (electrostatic)    Easy — prior frequency already exists
  Dipole (entanglement)  5  (dipole fields)    Easy — entanglement graph exists
  Non-comm basis         3  (torque/rotation)  Hard — breaks orthogonal design
  Polarizability         4  (dielectric)       Medium — needs Jacobian of fold→query
  Current vector         3  (current/flow)     Easy — accessLog direction exists
  Refractive index       4  (optics)           Easy — layer boundaries exist
  Central potential      3  (atomic)           Medium — dominant entities exist
  Asymmetric boundary    3  (semiconductor)    Medium — terrain boundaries exist
  Radiation pattern      1  (Larmor)           Easy — entanglement propagation exists
  Path integral          1  (grav. work)       Medium — discrete search path exists
  Schumann resonator     1  (Garyian)          Impossible — requires external physics

Of these 12, 8 are "easy/medium" — the system already has the underlying
data structure and just needs one additional operator to compute the
derived quantity. Only the non-commutative basis (torque) and Schumann
resonator are genuinely hard to add.
