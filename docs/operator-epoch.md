# Operator epoch decision (P0)

Status: confirmed against eoreader4.2 source (commit `ef9ed90`, branch `main`).

## Decision

`@eoreader/spec` declares one canonical operator epoch, `eo-2026-07` (see
`packages/spec/operators/epoch.js`), consisting of the closed 3x3 vocabulary
already shipped in active eoreader4.2 (`src/core/operators.js`):

| Mode           | Differentiate | Relate | Generate |
|----------------|---------------|--------|----------|
| Existence      | NUL           | SIG    | INS      |
| Structure      | SEG           | CON    | SYN      |
| Interpretation | DEF           | EVA    | REC      |

Source: `eoreader4.2/src/core/operators.js:24-34` (`OPERATORS` map, mode ×
domain grid, matches this table exactly).

## Historical vocabulary

Older architectural material uses additional terms: `DES`, `ALT`, `SUP`. All
three are now confirmed mapped — none remain unmapped.

| Historical term | Status | Maps to | Citation |
|------------------|--------|---------|----------|
| `ALT`            | mapped | `DEF`   | `eoreader4.2/src/core/cube.js:193` — `OPERATOR_ALIASES = { ALT: 'DEF', SUP: 'EVA' }`; also `src/surfer/fold/substrate.js:40-41` and `src/perceiver/classify/centroids.js:13,42` |
| `SUP`            | mapped | `EVA`   | same citations as `ALT` above |
| `DES`            | mapped | `SIG`   | `eoreader4.2/docs/eo-wiki.md:4345` — "The second operator was previously called DES (Designation). It has been renamed to SIG..."; corroborated at `docs/eo-wiki.md:7346-7347` ("Operator table updated to SIG (from DES)"; "Global replace DES → SIG") |

This table lives in code as `LEGACY_OPERATOR_MAP` in
`packages/spec/operators/epoch.js` — that module, not this document, is the
normative source consumed by the engine and compatibility importers.

## Rules

- Every semantic event, reading, prior snapshot, and compatibility import
  MUST carry `operator_epoch`.
- Normalization from a historical term to the current epoch MUST happen only
  at a compatibility/import boundary (`packages/compat-4.2`), never inside
  `packages/engine`.
- Historical records MUST never be silently rewritten in place — a
  normalized record is a new artifact with its own `operator_epoch` and
  provenance pointing at the original.
- All three known historical terms (`ALT`, `SUP`, `DES`) now have confirmed
  1:1 mappings; there is currently no operator vocabulary the engine must
  hold for human review. Any *newly discovered* historical term MUST be
  added to `LEGACY_OPERATOR_MAP` with an explicit `mapped`/`unmapped` status
  before it can appear in an import — absence from the table is a spec bug,
  never silent pass-through.

## Verification

Confirmed directly against eoreader4.2 source at commit `ef9ed90` (main,
2026-07-23 pull):

- `src/core/operators.js` — the nine operators, `MODES`, `DOMAINS`, `GRAINS`.
- `src/core/cube.js:187-193` — `OPERATOR_ALIASES` and the rationale for
  `ALT→DEF` (Differentiate-mode cells) and `SUP→EVA` (Relate-mode cells).
- `src/perceiver/classify/centroids.js` and `src/surfer/fold/substrate.js` —
  runtime alias tables applying `SUP→eo:EVA`, `ALT→eo:DEF` at ingestion.
- `docs/eo-wiki.md` — historical record of the `DES → SIG` rename and the
  "Determination/Superposition" nomenclature history.
