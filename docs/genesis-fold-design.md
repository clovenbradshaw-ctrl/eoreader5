# Task genesis: growing a task tree instead of authoring one

**Module:** `packages/engine/emergence/genesis/` (pure) + `task.pencil`/
`task.ink`/`task.hold` commands in `packages/engine/replay/index.js` (ledger).
**Status:** first pass, engine-side kernel only. eoAI's orchestration loop
(discovery, organic mutation, CRISPR splice, actual build execution) is
named throughout but deliberately not implemented here — see "What this
is not" at the end.

## The hard requirement

A short seed ("reddit, but dolphin zone") must expand into arbitrarily many
holonically-intelligent, self-validating tasks *without* a human
pre-digesting a plan and handing it over. The plan must be grown, not
authored. "Have the model build an outline, have a small model fill in the
parts" fails this requirement structurally, not just in spirit: an outline
presupposes a subject who already knows the shape of the whole before any
part exists. That's compression of a pre-known structure into a delivery
format, not generation — and it makes every part causally inert with
respect to the others, since nothing discovered while filling slot 3 can
revise what slot 7 even is.

The alternative, grounded in Whitehead's concrescence, Deleuze's fold/
rhizome, and Bohm's implicate order rather than AI planning literature: at
every fold, a scored spectrum of candidates is evaluated against the
entire settled history (not a summary of it), one or more collapse into a
provisional commitment, and structure is discovered afterward by reading
what was committed — never imposed beforehand.

## The fold, concretely

```
scored candidate spectrum        (discovery / mutation / splice — upstream,
   |                              not this module's job)
   v
collapseCandidates()  -- DEF --  is there real structure, or is this flat?
   |
   v
pencilTask()                     provisional commitment, permanent record
   |
   v
   ... caller executes/tests the task's product (host-side) ...
   |
   v
inkTask(pencil, validation)      EVA-gated promotion, or held (never dropped)
   |
   v
   ... many folds later ...
   |
   v
completionDiagnostic(rounds)     DONE, LOST-IN-BABEL, or CONTINUE
```

Every arrow already existed as a pattern somewhere in this engine before
this module was written; genesis mostly assembles precedent rather than
inventing mechanism. Where it does add something new, that's called out
below.

## DEF/EVA/REC resolve the Zeno's-paradox concern

The open question: how does the fold recognize task-completion vs.
whole-project-completion, given you can always name one more small task
(polish a hover state, tweak a margin) — an apparent infinite regress.

**DEF was never asking "is there a describable next thing"** (which never
terminates). It asks "does the current spectrum of candidates contain a
gap that beats what a chance process would already produce" — a
statistic with a derived floor (`extremeValueNull` in
`emergence/nulls/extreme-value.js`). Zeno's own paradox resolves the same
way: a convergent series of shrinking terms crosses any fixed ε in
finitely many steps, even though it never runs out of terms. DEF's floor
*is* that ε. A sequence of ever-smaller candidate tasks doesn't need to
hit zero — it needs to fall under the floor, and it will, in finite folds.

Three operators, two granularities of the same test:

- **DEF — task-completion, local.** At each fold, the candidate spectrum
  for *this* task's next sub-actions is run through `collapseCandidates`.
  Abstain → this task is locally done, not because a slot was filled but
  because nothing left clears the bar.
- **EVA — self-validation, orthogonal to DEF.** "Is there a next thing"
  and "did the last thing work" are different claims and must stay
  different operators — a task reading as done because nothing more was
  *proposed* is not the same as a task being done because its *output
  validated*. `inkTask` enforces this: it requires a caller-supplied
  `validation` (a `NullProtocol@1`-shaped result — the actual test/build
  check is host-side, never executed by this module) and refuses to
  promote without it.
- **REC — whole-project completion, global.** Project-done isn't "DEF
  abstained this round" (a single abstention could be that round's
  discovery being unlucky). It's DEF-abstention *and* nothing being
  promoted (`REC`) *and* the recent path staying coherent with the aim —
  three independent signals, not a vibe. See `completionDiagnostic`.

### The signal DEF-abstention alone can't give you

Sustained DEF-abstention has two causes that look identical from the flag
alone: the project is actually done, or generation has drifted past the
ledger's local neighbourhood into something statistically
indistinguishable from noise (the "lost in Babel" case below).
`completionDiagnostic` refuses to guess between them without a
`coherenceNull` — a caller-supplied background of coherence-under-
perturbation, the same discipline `computeBoundaryStabilityGate` already
applies to boundary displacement in `emergence/boundaries/index.js`.
Without one, the function returns `status: 'ambiguous'`, not a heuristic
threshold — this engine's own rule is that no gate compares a statistic
to a hand-set constant, and `meanCoherence > 0.5` would be exactly that.

## CRISPR and organic generation are the same primitive, two roles

Biology uses both mechanisms constantly (horizontal gene transfer is
directed splicing, point mutation is undirected) — neither is "the real
approach" with the other as a hack.

**CRISPR (targeted splice) is addressed, not loaded.** The requirement
"steer to the precise bits without loading it all into context" is
already the shape of the ledger: `replay/index.js`'s `blockStore` is a
content-addressed `Map`, and every observation is independently
verifiable (`verifyObservationBundle`, `blockContentHash`). A splice is
locate-by-coordinate (search/project over field vectors, never raw
context), fetch-by-hash (only that block), graft-as-citation (a new
event whose `provenance.depends_on` points at the source's `event_id` —
exactly how `calculus.js`'s `induceExtensions` already cites two prior
vocabulary members). "Omnimodal" splicing is `sliceChannel` from
`perceiver/field-spec.js`: a gene is a channel slice at a coordinate, and
because field-spec is modality-blind, extracting a chroma progression and
extracting a component subtree are the same function call.

**Organic generation reuses `createSeededRng`/`seededShuffle`** — already
pure, already engine-legal, already used in `induceKind`/`induceCalculus`
for exactly one purpose: building a *null* to check a candidate against.
Mutation is the same operation used as the *candidate generator* instead.
Mutation and null-generation aren't two mechanisms; one function, two
roles.

## Why not just Library-of-Babel it

Legitimate as a limit case (given infinite budget, undirected generation
plus a correct selection function converges — this is the actual claim
behind novelty search and, less formally, natural selection), wrong as a
literal strategy: the coherent subset of "all possible content" shrinks
combinatorially against the noise as length grows, so uniform search over
it has useless expected wait time at any real budget. Borges' own
librarians despair over exactly this — finding a book, not the book's
existence, is what's intractable, and the story's hinted resolution
(narrowing search regions methodically) is structured local search, not
literal wandering.

The tractable version is already implicit in "prehends the entire
ledger": conditioning every candidate spectrum on the full settled
history is what collapses "all possible next things" down to "the
reachable neighbourhood of what's relevant given everything that
happened." A fold that regenerated fresh each round with no history
conditioning *would* be Babel-ing; one tightly conditioned on the ledger
isn't, even though both are "random generation" in the loose sense.

## Sampling shaped by coding priors and dependency-ordered holonic gating

Two axes compose to keep the candidate *proposal* distribution
well-specified without ever touching DEF's floor:

**Coding priors** reuse `emergence/reader-priors`'s exact four-part shape
(familiarity, interpretive frames, experiential, structural) against a
code corpus instead of a literary one, injected from eoPriors — never
computed by the engine, preserving the same purity boundary reader-priors
already draws. Familiarity/experiential can be self-derived from this
project's own accumulating ledger (an emergent house style); interpretive
frames/structural get externally supplied.

**Dependency-ordered holonic gating** uses `dependentsOf` — in-degree
over the same `dependency_graph.edges` shape `calculus.js` already
produces (`{ from, to, internal }`). A node many promoted things already
cite is load-bearing; `requiredValidationQuantile` scales the evidence
`inkTask` demands before promoting there, using the *exact* Bonferroni
correction `induceExtensions` already applies for cross-vocabulary
candidates (`1 - (1 - quantile) / (dependents + 1)`). Zero dependents
costs nothing extra. This mirrors a measured finding in network biology,
not just a borrowed metaphor: highly-connected ("hub") proteins evolve
slower than peripheral ones because purifying selection scales with
connectivity.

**The line that must hold:** a prior may shape what gets *proposed*; it
must never shape what *commits*. `reader-priors` already draws this
boundary for itself — "the prior doesn't determine WHAT the lens is, it
determines what assertions are AVAILABLE" — `priorConfidenceBoost` only
ever biases an assertion DEF/EVA would otherwise independently gate. A
coding prior weighting a candidate spectrum is fine; a coding prior
deciding a candidate collapses without clearing DEF's floor and EVA's
validation is a human plan wearing a statistical costume. `genesis`
enforces this by construction: `collapseCandidates` takes plain
`{ id, score }` pairs and runs DEF unbiased, exactly as in
`kinds.js`/`calculus.js`; prior weight and dependency risk never enter
its floor, only the caller-side score that produced the spectrum and
(separately) `requiredValidationQuantile`'s post-collapse evidence bar.

## Pencil, then ink — provenance for everything, including the priors

"First pass in pencil, the model goes back in to ink it, fix if needed.
All get preserved, all store provenance, including the priors." This
lifecycle reuses the engine's existing objective-immortality guarantee
(the append-only event ledger) rather than inventing a parallel one:

- `pencilTask(candidate, opts)` — a provisional commitment, exactly as
  tentative as `hypothesis.hold`'s "held" status. Requires
  `priorsCited: [{ prior_id, content_hash, weight }]` (an empty array is
  a legitimate citation — pure discovery, no prior consulted — but the
  shape is validated, not optional). Requires `sourceKind` ∈
  `{discovery, mutation, splice}`, recording which of the three
  generative modes produced it.
- `inkTask(pencil, validation)` — promotes iff the validation both
  passed *and* was checked at no weaker than `requiredValidationQuantile`
  (an under-powered check on a load-bearing node is rejected exactly
  like a failed one — a caller cannot sneak a risky mutation past a
  lightweight test). On failure the pencil is returned **verbatim**,
  never mutated or discarded.
- Revision is not a separate code path: a fresh `pencilTask` with
  `supersedes` set to the prior ink's id, promoted through the same
  `inkTask`. Its operator is `REC` (matching `hypothesis.supersede`)
  rather than `EVA` (a first commit) — genesis computes this, the ledger
  reads it rather than hardcoding it.
- `replay/index.js`'s `task.pencil`/`task.ink`/`task.hold` commands
  append these to the SemanticEvent ledger exactly as
  `hypothesis.accept`/`hold`/`supersede` already do. `state.tasks`
  tracks each `candidate_id`'s *current* status; `state.taskHistory`
  (exposed via the new `readTasks(state)`, mirroring `read(state)`)
  keeps every pencil/ink/hold event for that `candidate_id` in order —
  nothing is ever dropped, only superseded.

## What this is not

This is the engine-side statistical kernel only. It does not:

- generate candidates (discovery, mutation, splice are all host/eoPriors
  concerns — reading a corpus, calling a model, walking a filesystem are
  all forbidden inside `packages/engine`'s purity boundary);
- execute or test a task's product (the `validation` `inkTask` requires
  is caller-supplied, never computed here);
- extract a coding prior from a corpus (that's eoPriors' job, the same
  relationship it already has with literary reader priors);
- name or design eoAI's own orchestration loop, which is the thing that
  would actually call these functions in sequence against opencode and a
  local model.

Those are the next layer, once this kernel is exercised against something
real.
