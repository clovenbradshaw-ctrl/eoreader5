# Reader Experience Specification

**Mission: to joyfully experience meaningful surprise.**

This is not a tagline. It is the universal invariant that every layer of the
system serves. A reader (human, model, or organ) encounters a source text and
departs changed — not because information was extracted, but because something
was *felt* that was not there before the encounter, and that feeling was
earned.

This document decomposes that mission into four engineering invariants. Each
invariant MUST hold for every claim the engine produces about a reading
experience. Each invariant has a defined instantiation check so a concrete
system can be validated against it.

---

## 1. Meaningful — the claim is earned, not asserted

A claim about the text (this span matters, this entity is present, this
relation holds) must be earned from evidence — never from a programmer's
preference, a model's disposition, or a hand-picked list.

### Invariants

1.1 **Every selector is structural, not preferential.** Significance,
salience, and relevance MUST be computed from measurable properties of the
encounter (forward-surprise, presence rate, co-occurrence density) rather than
from hand-labelled goldens, curated lists, or classifier confidence scores.
A selector whose output changes when the text is shuffled is structure; a
selector whose output stays the same under shuffling is vocabulary —
vocabulary selectors MUST NOT gate.

1.2 **Classifiers are advisory, never gates.** A coordinate that routes,
vetoes, blocks, or addresses MUST be derived from a declaration or an
architectural birth event, never from a classifier score. Classifiers MAY
inform display ordering, highlighting, or navigation hints; they MUST NOT
control whether something is visible, present, or actionable.

1.3 **The reaction channel is a witness, not a model.** The engine MAY store
reader reactions (salience rankings, affect signals, attention traces) in an
append-only reaction log. It MUST NOT infer, predict, simulate, or derive a
reaction from the text alone. The reaction channel is a TALLY — zero-weight
until a real reader fills it. Inferring from this channel before it has data
is the cardinal violation.

1.4 **Significance is per-text, per-entity, conditional.** A significance
score MUST condition on the entity's own presence rate (N·pA·pB, not one
global mean/sd). A null hypothesis against which significance is measured
MUST vary along the axis the measurement exploits — unconditional nulls are
a units change, not a measurement.

### Instantiation checks

- [ ] Does any classifier output control visibility, routing, or access? → fail 1.2
- [ ] Is any "top N" selector document-order sliced? → fail 1.1 (front-loading)
- [ ] Does any significance test use one global mean and sd? → fail 1.4
- [ ] Does the reaction channel infer before data arrives? → fail 1.3
- [ ] Is there a hand-picked golden that the system tunes against as primary gate? → fail 1.1 (structural assay replaces this)

---

## 2. Surprise — the encounter is measured, not labelled

Surprise is a structural quantity: the distance between what was expected and
what arrived. It is computed, not classified.

### Invariants

2.1 **Surprise is per-holon, not per text.** A "tick" for a holon is
signal-from-noise local to that holon's own history — never wall time, a
shared epoch counter, or a document-global clock. The tick detection function
MUST be parameterized by the holon's own prior expectation surface.

2.2 **Forward-surprise is the primitive, not backward surprise.** The system
MUST measure the unexpectedness of the next state given prior states, not the
unexpectedness of the current state given future ones. Backward-looking
measures (retrospective KL, thematic coherence) are MODEL-tier — they MAY be
computed but MUST be reported as needsWitness, never as engine-tier.

2.3 **A prior derived from the text is a statement about the text.** Three
independent mechanisms have shown that any prior computed from text
collapses to vocabulary statistics. A reader prior MUST come from the
reaction channel or from an injected eoPriors artifact — never from
unsupervised computation over the source text. The engine MUST NOT derive
what a reader finds surprising from what the text contains.

2.4 **Spine ranking exposes scores, not ranks.** Every sampled position in the
spine MUST expose its raw forward-surprise score, not just its rank order.
Ranks collapse distance information; scores preserve it. A consumer MAY sort
by score but MUST NOT confuse rank with magnitude.

### Instantiation checks

- [ ] Does the system use document-global wall time or epoch for tick detection? → fail 2.1
- [ ] Is any surprise measure computed from the full document before the encounter? → fail 2.2
- [ ] Does any module derive a "reader prior" from the source text without a reaction channel? → fail 2.3
- [ ] Does the spine expose only ranks, not raw scores? → fail 2.4

---

## 3. Experience — the text is encountered, not extracted

The system does not ask "what does this text mean." It asks "what happened
when this text was read." The Given is append-only; the Meant is revisable
interpretation. Experience is the encounter itself, not its summary.

### Invariants

3.1 **The Given MUST NOT be derived from the Meant.** Interpretation cannot
manufacture an observation. A correction appends a new observation or
interpretation — it never edits, overwrites, or erases the Given. Refinement
cannot erase experience.

3.2 **Every span carries provenance from birth.** A span is not valid until it
carries `{offset, length, raw, verified, drift}` pointing into the source
text. If resolution fails, the span MUST report `verified: false, raw: null`
— a typed gap, never a guessed slice. Offsets MUST thread through every
transformation layer (framing, snapping, folding, projecting) without silent
drop.

3.3 **Frame coverage MUST be continuous.** Any character offset in the source
MUST belong to at least one frame where presence is computed for some entity.
If frame boundaries leave gaps, the system MUST report unmonitored spans as
a typed gap, never assume absence.

3.4 **A missing prior is a typed gap, not a silent default.** If no per-text
coref prior exists, every referent MUST produce a typed gap
(`descriptor_aliases_unresolved`, `referent_gap`) rather than a silently-wrong
string match. The system broadcasts what it does not know.

3.5 **The reader's clock is logical turns, not wall time.** Discourse state
(motif activation, pronoun channelling, topic stack, commitment lifecycle)
advances on explicit turns, never on `Date.now()`, `performance.now()`, or
any ambient time source. A turn is a thing that happens — it has no duration,
only position in a sequence.

### Instantiation checks

- [ ] Can any correction edit or erase a prior observation? → fail 3.1
- [ ] Does any span-shaped output omit `{offset, length, raw}`? → fail 3.2
- [ ] Is there any character offset that no frame monitors? → fail 3.3
- [ ] Does a missing coref prior produce a wrong but confident string match? → fail 3.4
- [ ] Does any module call Date.now() or Math.random() inside the engine? → fail 3.5

---

## 4. Joyfully — the architecture enables trust

Joy is the freedom that comes from knowing the system will not lie. The
architecture enforces this through structural invariants — not policies,
not preferences, not fine-tuned dispositions.

### Invariants

4.1 **Speech is gated by witness.** The system MUST NOT produce an utterance
about a text unless it can trace a source in its own append-only record. The
gate is architectural: the engine literally cannot emit a claim without a
supporting event. MODEL-tier claims (descriptor synonymy, thematic
resonance) MUST be reported as `needsWitness`, with the specific gap type
named, never silently asserted.

4.2 **The engine is a pure function.** Same inputs → same outputs. No ambient
time, no randomness, no I/O, no mutable registry, no singleton state. Every
reading is replayable; every fold is reproducible; every surprise score is
deterministic. Purity MUST be enforced by CI, not convention.

4.3 **A typed gap is a valid output, not an error path.** Void, withheld,
unresolved, and absent are first-class results. The system MUST distinguish:
not observed; observed absence; unresolved; outside horizon; withheld;
contradicted; invalid under frame; deliberately declined. A gap is always
preferable to a fabricated fill.

4.4 **Identity is event-sourced, never string-keyed.** Two surfaces with the
same string MUST NOT auto-merge. Two surfaces with different strings MUST be
permitted to point at the same referent. Identity is discovered from the
event history, never from a mutable lookup table or name-token overlap.

4.5 **Uncertainty is distributed, not centralized.** Uncertainty belongs in:
resolution, posterior, score, candidate plurality, held/withheld state,
measured nulls, conflict, provenance quality, calibration. It MUST NOT
become a single tenth operator or a global confidence score.

### Instantiation checks

- [ ] Can the engine emit a claim without a supporting event? → fail 4.1
- [ ] Does the conformance suite test for forbidden-dependencies (Date.now, Math.random, I/O)? → fail 4.2
- [ ] Are void/withheld/unresolved treated as error paths (try/catch, fallback, default)? → fail 4.3
- [ ] Are same-string surfaces ever auto-merged without event-sourced identity? → fail 4.4
- [ ] Is there a global confidence score or single uncertainty number? → fail 4.5

---

## 5. Universal instantiation

Any system claiming conformance to this spec MUST produce a conformance
artifact containing:

```
reader-experience-conformance.json
{
  "spec_version": "reader-experience@1",
  "implementation": "<name>@<version>",
  "checks": {
    "1.1": { "pass": true, "notes": "..." },
    "1.2": { "pass": true, "notes": "..." },
    ...
    "4.5": { "pass": true, "notes": "..." }
  },
  "structural_assay": {
    "grounding_pct": 100,
    "entity_faithful_pct": 80,
    "monotonicity_pct": 100
  },
  "declared_gaps": [
    { "gap_type": "descriptor_aliases_unresolved", "where": "Frankenstein (no coref prior)" },
    ...
  ]
}
```

Every check MUST pass at level ≥ 1.0 (all must-pass items true). A system
with declared gaps (missing priors, unmonitored frame boundaries) MAY still
conform as long as the gaps are typed and reported — a gap is not a failure.

---

## Relationship to other principles

| Principle | Document | Enforced by this spec |
|---|---|---|
| Nameless referent | `docs/nameless-referent.md` | 4.4 (event-sourced identity) |
| Holon level discovered | `docs/holon-level.md` | 2.1 (per-holon tick) |
| Conditional nulls | `docs/operator-epoch.md` | 1.4 (per-entity conditional null) |
| Given ≠ Meant | `docs/architecture.md` §3.3 | 3.1 (Given not derived from Meant) |
| Pure engine | `docs/invariants.md` | 4.2 (pure function) |
| Tier discipline | `AGENTS.md` | 4.1 (witness gate) |

---

## Dead ends this spec prevents

The measured dead ends in `AGENTS.md` are the empirical record of what happens
when each invariant is violated. This spec codifies those lessons so they do
not need to be re-learned:

| Violated invariant | Resulting dead end |
|---|---|
| 1.1 (structural selector) | Significance selectors: presence-only (4/21), cold-start masking (4/21), KL (3/21) |
| 1.2 (classifier advisory) | Content classifier as gate — passed three plain fabrications |
| 2.3 (no reader prior from text) | Three mechanisms, all collapsed to vocabulary |
| 1.4 (conditional null) | Unconditional nulls r=1.000 exactly — a units change |
| 2.1 (per-holon tick) | Wall-time clocks produce shared-epoch fallacies |
| 3.2 (provenance from birth) | Offsets silently dropped at three layers once |
| 4.4 (event-sourced identity) | Three independent string-matching coref substitutes built in parallel |

The spec is the lesson learned. Trust it; do not silently retry a logged
failure.
