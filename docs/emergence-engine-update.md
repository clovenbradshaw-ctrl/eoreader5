# Emergence engine update

Status: implementation draft  
Version: 0.1  
Date: 2026-07-23

EOReader5 is the pure, modality-neutral engine that discovers structure in an explicitly supplied observation field. It does not open source files, parse media, fetch priors, call models, store sessions, or render cards. The app supplies normalized observations, resolved observation blocks, a pinned `PriorSnapshot`, and an explicit `RunContext`; the engine returns replayable semantic events, competing hypotheses, accepted readings, abstentions, and neutral projections.

## Repository membrane

| Repository | Owns | Does not own |
| --- | --- | --- |
| `eoreader5` | EO constitution, per-source emergence, evidence, replay, neutral projections | I/O, storage, models, UI, empirical-prior construction |
| `eoreaderapp` | source custody, sense organs, effects, persistence, mobile UI | semantic laws, hidden discovery logic, global prior governance |
| `eoPriors` | governed empirical corpora and immutable `PriorSnapshot` artifacts | current-source readings, app state, engine execution |

Constitutional priors belong in EOReader5: exact anchors, adjacency and containment, recurrence, simplicity, predictive gain, stability, provenance, and abstention. Empirical priors belong in eoPriors as immutable declarative artifacts. Session choices belong in the app.

## Public contracts

The P0 membrane is represented by JSON-Schema-first contracts in `packages/spec/schemas`:

- `ObservationEnvelope@1` describes normalized axes, fields, anchors, decoder identity, source content hash, and block hash without semantic labels.
- `ObservationBlock@1` carries caller-resolved scalar values; the engine never dereferences block URIs.
- `PriorSnapshot@1` is an immutable pinned value supplied by the caller.
- `RunContext@1` carries frame, lenses, horizon, risk policy, compute budget, and requested projections.
- `SemanticEvent@1` is the append-only event envelope for observation admission, discovery, evaluation, acceptance, holding, supersession, retraction, and recursive lift.
- `HypothesisSet@1`, `ReadingSnapshot@1`, and `ProjectionBundle@1` expose competing hypotheses, exact semantic heads, gaps, abstentions, and neutral app-facing projections.

## P0 implementation boundary

The engine exports the reducer surface (`createState`, `applyCommand`, `appendEvents`, `replay`, `read`, `project`, and `evaluate`) and recognizes the command vocabulary required for resumable discovery. P0 discovery is intentionally conservative: when no implemented candidate clears a null, or when budget is exhausted, the ledger records `discovery.abstained` rather than inventing a definitive structure.

The conformance suite enforces that `packages/engine` imports only relative modules or `@eoreader/spec`, and does not touch filesystem, network, ambient time, process environment, browser storage, or ambient randomness.
