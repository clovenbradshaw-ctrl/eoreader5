# EOReader5

The pure semantic engine used by an EO Reader application. Not a full-stack
app, not a model router, not a database — see `docs/architecture.md` for the
full boundary and `docs/operator-epoch.md` for the P0 operator vocabulary
decision.

## Packages

- `packages/spec` — canonical JSON Schemas, canonical-JSON/hash rules, and
  the operator epoch declaration. No runtime dependency on anything else.
- `packages/engine` — the pure engine. Depends only on `@eoreader/spec`.
  Gated by the purity tests in `packages/conformance`.
- `packages/conformance` — invariant and purity tests. Must pass with
  network disabled.

## Status

Phase 0/P0 in progress: operator epoch declared, core schemas published,
canonical JSON/hash rules implemented, referent candidate/merge/split laws
implemented with provenance-preserving semantics, and a static
forbidden-dependency purity gate is in place for `packages/engine`.

Run everything:

```
npm install
npm test
```
