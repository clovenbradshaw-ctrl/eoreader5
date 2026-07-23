# Row-stance templates: the fabrication firewall

**Status: contract landed, generation engine not built.** Retirement gate
item 2 (hard blocker per `docs/eoreader5-parity-checklist.md` §5 /
§"Retirement gate": "§5 stance-templates + row-veto ported before any
generated prose ships"). Ported from
`eoreader4.2:docs/generate-row-stance-templates.md` +
`src/weave/generate-row/{stance,tokenize}.js` +
`src/enactor/ground/row-veto.js`.

## Why this exists before any surface needs it

No generated-prose surface exists anywhere in the new stack yet -- eoreader5
is model-free by architecture (`docs/architecture.md`), and eoreaderapp has
not built a gloss/blurb/caption feature. That is exactly why this lands now:
the contract must exist **before** eoreaderapp's first such feature, not be
retrofitted onto one after the fact once fabrication has already shipped
once. This mirrors 4.2's own §16 release invariants, which are guardrails a
generation engine must satisfy, not features it earns after the fact.

## What landed, and what didn't

`packages/spec/row-shapes/index.js` ports the parts of
`generate-row-stance-templates.md` that are genuinely closed rules,
independent of any generation engine or real proposition data:

- **`SHAPES`** -- the four row shapes (§2): `readout`, `cultivating`,
  `making`, `composing`.
- **`DESERT_CELL` / `isDesertCell`** -- the one forbidden shipped address,
  `SYN(Field, Cultivating)` (§3.1). Structure-domain Cultivating never
  ships; a row-stance chooser's own Cultivating cell is the
  Significance-domain `REC(Atmosphere, Cultivating)` -- a different address
  on the same Ground-grain row.
- **`LEGAL_CELLS` / `legalCellFor`** -- the four concrete cells each shape
  actually resolves to (§2's table). Hardcoded, not derived: see "What's
  deferred" below.
- **`tokenize` / `tokenCount`** -- the one shared word/punctuation splitter
  (§8) a future renderer and this firewall's veto must agree on, or trace
  coverage would be an artifact of two tokenizers disagreeing.
- **`KNOWN_CONNECTIVE_IDS`** -- the closed non-proposition lexicon (§6):
  `is`/`is-not`/`disagree`/`not-established`/`because`/`first`/`then`. A
  rendered row may cite one of these ids, never an invented word.
- **`checkTraceCoverage`** -- exactly-1 token-trace coverage (§8): every
  token in a row's `renderedText` maps to exactly one `TraceRef`, not zero
  (fabrication) and not more than one (two templates concatenated without
  resolving ownership). A strict bijection: `trace.length === tokenCount`
  and every span is exactly one token wide and contiguous.
- **`bidirectionallyEntails`** -- the two-directional entailment check (§7),
  ported from 4.2's own as-built divergence (its "As built" note #3): there
  is no NLI model in this codebase, nor should there be, so this checks the
  row's own trace rather than bare text. Forward: every declared proposition
  is traced somewhere. Backward: every traced proposition-token points at a
  declared proposition, and every other token points at a registered
  `KNOWN_CONNECTIVE_IDS` entry.
- **`ROW_VETOES` / `runRowVetoes`** -- the two-veto battery (§7) in the
  `{id, test, refuses, message}` shape 4.2's veto battery uses:
  `row-entailment-mismatch` and `row-fabrication`.

Conformance-pinned in `packages/conformance/invariants/stance-templates.test.js`:
the desert cell is unreachable from any shape; the entailment veto catches a
dropped counter-reading and an invented hedge word; the fabrication veto
catches a zero-coverage token and a double-counted token; a correctly traced
worked example of each shape passes both vetoes with no false positive.

### What's deferred, and why

`stanceLegality` -- the actual spectral shape chooser that reads a row's
own evidence field (`buildDensity`/`eigenLenses` over propositions'
significance activations, §3) and decides which of the four shapes a given
proposition set legally clears -- is **not** ported. Two real prerequisites
are missing:

1. The terrain and stance enums plus the diagonal-coherence validator
   (`docs/eoreader5-parity-checklist.md` §3, "fold-grid axes" --
   `DIAGONAL_CELLS`/`coherence()`/`isDiagonal()` from
   `eoreader4.2:core/cube.js`). `legalCellFor` here hardcodes the four
   concrete cells 4.2's own implementation actually ever produces (its file
   header: "this caller only ever fires REC ... or CON ... it structurally
   cannot reach SYN-Field-Cultivating regardless of the hint") specifically
   *because* the general cell-resolution machinery (`cellForGrain`,
   `core/stance-face.js`) isn't ported yet -- porting a spectral chooser on
   top of a cube that doesn't exist would be unverifiable scaffolding.
2. Real proposition data: eoreader5's engine does not yet populate
   `PropositionGroup`-shaped records (subject/predicate/value/verdict/
   originWeight) anywhere -- that is downstream of the individuation gate
   and the modelless reading path (surprise/coref), both still open per the
   parity checklist.

`proposeJoin`/`join.js` (§5, grounding a `RelationSlot`/`OrderSlot`),
`slots.js`'s `SLOT_PALETTES`/`legalSlots` (§4), `plan.js`'s `PLANS`/
`planTemplate` (§11's eight composed plans), and `render.js`'s
`realizeSlot`/`prosify` (§9) are likewise not ported -- all of them either
depend on `stanceLegality` or are pure rendering/orchestration with nothing
yet to render. When eoreaderapp adds its first generated-prose surface,
build these against real proposition data at that point, wiring them
through `packages/spec/row-shapes`'s vetoes rather than re-deriving the
fabrication firewall from scratch.

## Where it lives

- `packages/spec/row-shapes/index.js` -- the contract.
- `packages/spec/row-shapes/index.test.js` -- unit tests.
- `packages/conformance/invariants/stance-templates.test.js` -- the
  retirement-gate pin.
- Exported from `@eoreader/spec` (`SHAPES`, `DESERT_CELL`, `isDesertCell`,
  `LEGAL_CELLS`, `legalCellFor`, `tokenize`, `tokenCount`,
  `checkTraceCoverage`, `bidirectionallyEntails`, `KNOWN_CONNECTIVE_IDS`,
  `ROW_VETOES`, `runRowVetoes`) and via `@eoreader/spec/row-shapes`.
