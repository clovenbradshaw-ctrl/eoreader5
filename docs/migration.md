# Migration sequence from eoreader4.2

Status: P0 execution checklist

This checklist completes the transfer plan while keeping `eoprior` and `eoreaderapp` as separate repositories.

## Phase 0 — freeze contracts

- Keep JSON Schema as the wire contract for all cross-repository artifacts.
- Stamp every event, reading, prior, and compatibility import with `operator_epoch`.
- Reject sibling-checkout and deep-import assumptions in code review.

## Phase 1 — capture legacy fixtures

- In `eoreaderapp`, export representative eoreader4.2 artifacts as `Legacy42Envelope` JSON.
- Include happy-path, ambiguous, withheld, failed, and unmapped-operator examples.
- Store golden fixtures in EOReader5 only after stripping private source payloads or replacing them with stable hashes.

## Phase 2 — normalize only at the boundary

- Run legacy envelopes through `@eoreader/compat-4.2`.
- Mapped historical operators may produce normalized import records.
- Unmapped operators must produce held records for human review.
- The engine must receive only current-epoch semantic events or explicit held-review artifacts.

## Phase 3 — parity gates

- For each transferred capability, compare eoreader4.2 golden output, normalized EOReader5 events, and EOReader5 reading snapshots.
- Retire a legacy route only when parity is measured or a documented product decision accepts divergence.

## Phase 4 — separate-repo integration

- `eoreaderapp` depends on released `@eoreader/spec`, `@eoreader/engine`, and optionally `@eoreader/compat-4.2` packages.
- `eoprior` publishes immutable `PriorSnapshot` artifacts against the same spec version.
- EOReader5 CI remains runnable without either repository checked out.

## Transfer tooling

Use `scripts/transfer-eoreader42.mjs` when the eoreader4.2 source tree is available. The tool walks the legacy tree, hashes every non-excluded file, classifies each file for `eoreader5`, `eoreaderapp`, `eoprior`, or `review`, and can copy classified files into explicitly supplied target repositories.

Plan only:

```sh
npm run transfer:eoreader42:plan -- --source /path/to/eoreader4.2 --out transfer-plan.eoreader4.2.json
```

Apply with explicit targets:

```sh
npm run transfer:eoreader42:plan -- --source /path/to/eoreader4.2 --out transfer-plan.eoreader4.2.json --apply --eoreader5 /path/to/eoreader5 --eoreaderapp /path/to/eoreaderapp --eoprior /path/to/eoprior
```

The tool intentionally has no default sibling-repository paths. Any file classified as `review` remains uncopied until a human assigns ownership.
