# EOReader5 invariants

Status: canonical P0 guardrail

These invariants are the transfer contract from eoreader4.2 into EOReader5. They are written so `eoreader5`, `eoprior`, and `eoreaderapp` can evolve as separate repositories without hidden runtime coupling.

## Repository membrane

- `eoreader5` MUST expose only serializable specs and pure engine functions.
- `eoreaderapp` MUST own source acquisition, sense organs, effect execution, UI, persistence, workflow state, legacy launch, and context transfer.
- `eoprior` MUST publish immutable `PriorSnapshot` artifacts; it MUST NOT be imported by the engine at runtime.
- No package may assume sibling checkouts such as `../eoprior` or `../eoreaderapp`.

## Engine purity

The engine MUST NOT read ambient time, randomness, files, network, browser storage, process environment, or mutable registries. All authority, provenance, prior, horizon, frame, and effect results must enter as explicit input values.

The conformance suite enforces the first import and ambient-global guard in `packages/conformance/invariants/forbidden-dependencies.test.js`.

## Artifact rule

Cross-repository exchange happens through content-addressed artifacts:

1. `ObservationEnvelope` from app sense organs into EOReader5.
2. `PriorSnapshot` from eoprior into EOReader5.
3. `ReadingSnapshot`, `EnactmentDecision`, and `EffectRequest` from EOReader5 back to the app.
4. `EffectResult` from app execution back into EOReader5 as explicit input.
5. `Legacy42Envelope` from app-owned 4.2 transfer routes into compatibility importers.

## Migration ratchet

Compatibility code may be temporary. The engine boundary is permanent. A migration is incomplete until any legacy behavior has either a golden fixture, a parity result, or an explicit retirement decision.

## Holonic subassembly rule

EOReader5 is assembled like a watch: each subassembly has explicit serializable input ports, output ports, ownership, dependency edges, and invariant tags. A subassembly may be nested inside a larger assembly, but it may not acquire ambient authority or bypass the repository membrane. The app should cite EOReader5 through the public packages and artifacts (`@eoreader/spec`, `@eoreader/engine`, `ReadingSnapshot`, `EnactmentDecision`, and `EffectRequest`) instead of citing eoreader4.2 internals.

The canonical machine-readable assembly is `CORE_SUBASSEMBLIES` in `packages/engine/subassemblies/index.js`; conformance treats that registry as the engine-side watchmaker checklist.
