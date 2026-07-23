# Operator epoch decision (P0)

Status: draft — recommendation adopted pending confirmation against eoreader4.2/eoPriors source.

## Decision

`@eoreader/spec` declares one canonical operator epoch, `eo-2026-07` (see
`packages/spec/operators/epoch.js`), consisting of the closed 3x3 vocabulary
already shared by active eoreader4.2 and eoPriors code:

| Mode           | Differentiate | Relate | Generate |
|----------------|---------------|--------|----------|
| Existence      | NUL           | SIG    | INS      |
| Structure      | SEG           | CON    | SYN      |
| Interpretation | DEF           | EVA    | REC      |

## Historical vocabulary

Older architectural material uses additional terms: `DES`, `ALT`, `SUP`.
eoPriors centroid metadata provides two of the three mappings:

| Historical term | Status   | Maps to | Notes |
|------------------|----------|---------|-------|
| `ALT`            | mapped   | `DEF`   | confirmed by eoPriors centroid metadata |
| `SUP`            | mapped   | `EVA`   | confirmed by eoPriors centroid metadata |
| `DES`            | unmapped | —       | no safe automatic replacement known; records carrying `DES` MUST be held for human review at import, never silently coerced |

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
- `DES` MUST remain unmapped until a documented decision supersedes this
  file and `LEGACY_OPERATOR_MAP`.

## Open verification item

This decision was drafted from the planning document's own description of
eoPriors centroid metadata (`ALT -> DEF`, `SUP -> EVA`). A follow-up pass
should confirm these mappings and the absence of a safe `DES` mapping
directly against eoreader4.2 `core/operators` and eoPriors source, and record
file/line citations here once confirmed.
