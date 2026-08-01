# Mereotopology discipline: grounded_by vs part_of

Status: schema in place, wiring in progress
Code: `packages/engine/referents/individuation.js` (carries both fields),
`packages/spec/schemas/individuation-result.schema.json` (both in schema).

## §1. The category error

Earlier framing treated cross-referent comparison as a parthood question:
if referent A and referent B both appear in the same scene, what is their
mereological relation? The question is misposed. Two referents individuated
under the same lens share a grounding relation to the operator algebra —
both inherit their generic character from the same generative capacity.
Their individuating specifics (specific character) are genuinely peer,
non-relational, incommensurable. They were never in a parthood relation
with each other in the first place.

The clean resolution (via Shani, Aurobindo, and the paper's treatment of
mutual containment): split every relation into a **generic character**, inherited
from a common ground and never mutual, and a **specific character**, which
"neither grounds any other perspective, nor [is] grounded by any." This is
not a hedge — it is a denial that the puzzle is a parthood question at all.

## §2. The two relation types

### `groundedBy` — asymmetric, instance→kernel

What the nine operators supply to every fold. Every referent carries a
pointer to the operator that produced it:

```
referent → operator (NUL|SIG|SEG|CON|SYN|DEF|EVA|REC|INS)
```

Properties:
- **Asymmetric.** The operator grounds the instance; the instance is grounded
  by the operator. This is never mutual.
- **Shared.** Two referents grounded by the same operator (e.g. both carry
  `SIG`) share a generic character — both inherit from the same operator
  algebra. This is not a parthood relation between them. They are siblings
  under the same parent, not parts of each other.
- **Stored in SemanticEvent provenance.** The `SemanticEvent@1` that produces
  a referent carries `op`, `operator_epoch`, and `prior_id`. The
  `grounded_by` field on the individuation result resolves this to an
  explicit pointer at gate time.
- **Never used for cross-referent containment.** "A part-of B" is never
  inferred from "A and B share an operator." The operator algebra is the
  generic character; their specific characters are peer.

### `partOf` — only within one instance's specific character

A sub-span within one referent's own region:

```
sub_region → referent (same referent_id, internal only)
```

Properties:
- **Internal.** A sub-region within this referent's extent — e.g. a scene
  within a character's narrative arc, or a sentence span within a
  paragraph-level referent.
- **Validated by boundary stability.** The same `computeBoundaryStabilityGate`
  that verifies the outer wall of exclusion applies to internal regions:
  a part must stay put under re-segmentation just as the whole must.
- **Never cross-referent.** Referent A is never `part_of` referent B.
  Cross-referent comparison uses the paradigm gate's cross-lens agreement
  machinery (`packages/engine/emergence/paradigm/index.js`), not parthood.

## §3. Why the old framing was wrong (and what Indra's net actually means)

The Indra's-net image — "A part-of B and B part-of A" — describes mutual
containment of perspectives, not mereological containment of objects.
Shani's paper, with Chalmers, Kastrup, and Leidenhag pushing him to be
more precise, resolves this:

- The **generic character** is what all perspectives inherit from the common
  ground — the operator algebra, the read's generative capacity. This is
  what `groundedBy` points to. It is asymmetric (the ground grounds the
  instance, never vice versa) and never mutual.
- The **specific character** is what makes a perspective *this* one and not
  that one — the individuating specifics that are genuinely peer and
  incommensurable. This is what `partOf` operates within. It never crosses
  referent boundaries.

Indra's net describes the resonance between specific characters through
their shared grounding, not a literal parthood of A in B. The paradigm
gate's correlated-error check and Blackwell-Dubins continuity check are
the correct machinery for detecting that resonance — they measure whether
independently walled-off lenses (genuine specific characters) converge on
the same candidate through their shared generic character, without either
being part of the other.

## §4. The real-wall constraint

Aurobindo's exclusive concentration (Tapas) adds a direct engineering
constraint: individuation requires a REAL wall, not theatrical separation.
"It may be aware of the rest all the time, yet act as if it were not aware
of it; that would not be a state or act of Ignorance."

This means:
- **A lens's computation must be genuinely walled off** from other lenses'
  state during a read. No quiet cross-lens leakage papered over with
  lens-labels.
- **`capture_provenance` is now required** on every `ObservationEnvelope@1`
  (formerly optional). Each step carries `step_id`, `holon_id`, and `lens_id`
  — two reads under different lenses produce genuinely separate
  observation-blocks with distinct capture chains.
- **The paradigm gate detects theatrical walls.** The correlated-error check
  will expose same-family leakage (multiple lenses from one architectural
  family that claim independence but share correlated error). The Zollman
  delay requires each lens to accumulate independent evidence before
  convergence is accepted.

## §5. Relation to the paradigm gate

The paradigm gate (`packages/engine/emergence/paradigm/index.js`) is the
cross-lens ananda detector: it identifies when genuinely separate,
independently walled-off lenses (each with real walls, distinct
capture_provenance) converge on the same candidate. This is not parthood —
it is unforced resonance through shared ground. Three sub-gates:

1. **Correlated-error** — architectural family diversity. Lenses from the
   same family share correlated error; the gate measures whether supporting
   lenses span enough families to lower correlated-error variance below
   chance.
2. **Blackwell-Dubins** — mutual absolute continuity. Incompatible lenses
   (those that rule out what others allow) cannot converge in principle.
3. **Zollman delay** — minimum independent-evidence window per lens. Fast
   convergence is the danger sign; each lens must accumulate its own
   evidence before cross-lens propagation.

All three are gated by `deriveNull`. The ordering (continuity first to
prune, then correlation, then Zollman) means incompatible or theatrical
lenses are removed before they can contaminate the agreement quorum.

## §6. Schema fields

`IndividuationResult@1` (`packages/spec/schemas/individuation-result.schema.json`):

- `grounded_by`: `null | { operator, operator_epoch, event_id?, lens_id? }`
  — the operator that supplied this referent's generic character. Asymmetric.
  Set at event time.
- `part_of`: `null | { referent_id, sub_region? }` — only within this
  referent's own specific character. Cross-referent parthood is never
  asserted here.
