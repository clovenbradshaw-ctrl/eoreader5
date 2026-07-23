# EOReader5

The pure semantic engine used by an EO Reader application. Not a full-stack
app, not a model router, not a database — see `docs/architecture.md` for the
full boundary and `docs/operator-epoch.md` for the P0 operator vocabulary
decision. `docs/invariants.md`, `docs/priors-boundary.md`,
`docs/compatibility.md`, and `docs/migration.md` define the separate-repo
transfer boundaries for eoreader5, eoprior, and eoreaderapp.

## Packages

- `packages/spec` — canonical JSON Schemas, canonical-JSON/hash rules, and
  the operator epoch declaration. No runtime dependency on anything else.
- `packages/engine` — the pure engine. Depends only on `@eoreader/spec`.
  Gated by the purity tests in `packages/conformance`; also exports the
  holonic `CORE_SUBASSEMBLIES` watchmaker registry so the external app can cite
  EOReader5 instead of legacy eoreader4.2 internals.
- `packages/conformance` — invariant and purity tests. Must pass with
  network disabled.
- `packages/compat-4.2` — pure compatibility import helpers for app-created
  eoreader4.2 transfer envelopes; never launches or imports the legacy app.

## Status

Phase 0/P0 in progress: operator epoch declared, core schemas published,
canonical JSON/hash rules implemented, referent candidate/merge/split laws, a deterministic evidence-only `search(state, QueryRequest) -> QueryReading` surface, and the holonic watchmaker subassembly registry
implemented with provenance-preserving semantics, and a static
forbidden-dependency purity gate is in place for `packages/engine`.

Run everything:

```
npm install
npm test
```
