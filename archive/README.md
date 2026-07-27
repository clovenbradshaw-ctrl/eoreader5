# Archive

Material moved out of the live build during the "stop overclaiming" pass.
Nothing here is imported by the engine. Kept for reference, not deleted.

- `physics-derivation/emergence-physics/` — the former `packages/engine/emergence/physics/`.
  Composed retrieval primitives into physics equation *forms* (Fokker-Planck,
  Navier-Stokes, Michaelis-Menten, Schrödinger, Black-Scholes, …). Recovering a
  functional form is not deriving the physics; these are shared functional shapes
  (normalize, saturate, drift+diffuse, add vectors), not physical content. Removed
  from the build so the engine no longer claims to derive physics.
- `essays/` — the fold essays that framed the above as discovery.

The working retrieval engine (fold/project/interfere scoring in
`packages/engine/quantum` and `packages/engine/search`) is unchanged and still
tested. See `packages/engine/quantum/index.js` header for the honest description
of what those operations actually compute.
