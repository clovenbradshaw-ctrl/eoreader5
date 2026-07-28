// The self-seeding loop: genesis outputs become genesis inputs.
//
// genesis/index.js is the gate and seeding.js is the generator; neither
// closes the circuit. This module closes it, and the closure is the whole
// point of "grown, not authored":
//
//   settled(0) = seed
//   settled(r+1) = settled(r) + { every ink promoted in round r }
//   pool(r) = seedPool(settled(r))          <- reads the FULL settled set
//
// A candidate in round 7 can only exist because something in round 3 was
// validated and inked. That is the property an outline structurally cannot
// have ("it makes every part causally inert with respect to the others,
// since nothing discovered while filling slot 3 can revise what slot 7
// even is" — docs/genesis-fold-design.md). Here slot 7 is not a slot; it
// is a position reachable only from where the history actually ended up.
//
// ── Where the model is allowed to stand ───────────────────────────
//
// Exactly one place: `shapePool`. It receives the generated pool and may
// return new SCORES for candidates already in it. It cannot add a
// candidate, cannot alter a candidate's vector or provenance, and cannot
// promote anything — applyShaping rebuilds every candidate body from the
// pool by id and throws on an id the pool never produced. Everything
// downstream (DEF in collapseCandidates, the validation quantile in
// inkTask) is untouched by it.
//
// That is the line genesis/index.js:39-43 draws — "the prior may shape
// what's offered; it must never decide what commits" — made mechanical
// rather than aspirational. A model that wants a candidate to win can
// raise its score; DEF will still abstain if the resulting spectrum is
// flat, and inkTask will still refuse it without validation that cleared
// its own dependency-risk-corrected bar.
//
// ── The one thing this module cannot compute ──────────────────────
//
// `validate`. Running a task's product against a test is I/O, and
// packages/engine may not do I/O. So the loop takes it as a callback and
// awaits whatever it returns; a NullProtocol@1-shaped result comes back,
// inkTask gates it, and the loop never inspects it beyond that. Awaiting a
// caller's callback keeps this module pure in the sense the purity gate
// means (it names no forbidden module and reads no ambient state) while
// letting a host run a real build.
//
// ── Coherence, and its null ───────────────────────────────────────
//
// completionDiagnostic refuses to call a project done without a coherence
// null, and refuses to invent one. This loop can supply both honestly
// because it has the geometry:
//
//   observed   the running centroid of the settled set, sampled once per
//              round, run through fieldCurrentDensity — net displacement
//              over path length, "the fraction of the path that was
//              progress" (trajectory/field-shift.js)
//   null       the SAME settled positions, discovered in a seeded-shuffled
//              order, re-segmented into the same per-round group sizes.
//              Same content, undirected sequence — which is precisely the
//              "perturbed/undirected discovery" background the diagnostic's
//              own docstring asks for.
//
// A directed search accumulates displacement faster than its own content
// in a scrambled order does. One that has wandered off does not, and the
// diagnostic reads "lost-in-babel" rather than "done".

import { MIN_SAMPLES } from "../nulls/extreme-value.js";
import { createSeededRng, seededShuffle } from "../nulls/index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { fieldCurrentDensity } from "../trajectory/field-shift.js";
import { collapseCandidates, completionDiagnostic, dependentsOf, inkTask, pencilTask } from "./index.js";
import { centroid, seedPool } from "./seeding.js";

const round4 = (x) => Math.round(x * 1e4) / 1e4;

/**
 * Rebuild a shaped spectrum from the pool it claims to be shaping.
 *
 * The model (or a coding prior, or any upstream weighting) hands back
 * `[{ id, score }]`. Only the score survives; the vector, sourceKind,
 * sourceRef and every other field come from the pool's own candidate. An
 * id the pool never produced is a TypeError, not a silent drop — a
 * shaper that invents a candidate is trying to author, and the failure
 * should be loud.
 */
export function applyShaping(pool, shaped) {
  if (!Array.isArray(shaped)) throw new TypeError("genesis/loop: shapePool must return an array of { id, score }");
  const byId = new Map(pool.map((c) => [c.id, c]));
  const out = [];
  for (const s of shaped) {
    if (!s || typeof s.id !== "string") throw new TypeError("genesis/loop: every shaped entry needs an id");
    const original = byId.get(s.id);
    if (!original) throw new TypeError(`genesis/loop: shapePool returned candidate "${s.id}", which this round's pool never generated — a shaper may reweight what was offered, never add to it`);
    if (typeof s.score !== "number" || !Number.isFinite(s.score)) throw new TypeError(`genesis/loop: shaped candidate ${s.id} needs a finite score`);
    out.push(Object.freeze({ ...original, score: s.score, shaped_from: original.score }));
  }
  return out;
}

// Centroid of the settled set after each group of arrivals. Groups are
// per-round: [seed, round-0 promotions, round-1 promotions, ...]. A round
// that promoted nothing contributes a zero-length step, which is correct —
// a round that settled nothing moved the project nowhere.
function runningCentroids(vectors, groupSizes) {
  const out = [];
  const acc = [];
  let i = 0;
  for (const size of groupSizes) {
    for (let k = 0; k < size && i < vectors.length; k += 1) acc.push(vectors[i++]);
    if (acc.length) out.push(centroid(acc));
  }
  return out;
}

function pathCoherence(vectors, groupSizes, spec) {
  const path = runningCentroids(vectors, groupSizes);
  return fieldCurrentDensity(path, spec).coherence;
}

/**
 * The perturbed-discovery background: the same settled positions arriving
 * in a scrambled order, re-segmented into the same per-round groups.
 * Seeded from the content, so the null is replayable — nulls/index.js's
 * rule is that a threshold must come from an explicit perturbation of the
 * actual data, and this is that perturbation.
 */
export function perturbedCoherenceSamples(vectors, groupSizes, { spec = null, shuffles, salt = 0 } = {}) {
  const n = shuffles ?? Math.max(2 * MIN_SAMPLES, vectors.length);
  const rng = createSeededRng(canonicalHashSync({ vectors, groupSizes, salt, purpose: "genesis-coherence-null" }));
  const samples = [];
  for (let i = 0; i < n; i += 1) {
    samples.push(pathCoherence(seededShuffle(vectors, rng), groupSizes, spec));
  }
  return samples;
}

/**
 * Grow a task tree from a seed, feeding every ink back into the next
 * round's candidate pool.
 *
 * @param {object} args
 * @param {Array<{id: string, vector: number[]}>} args.seed - at least two
 *   settled positions. Two, not one, for the reason seeding.js documents:
 *   a one-point history has no spread, and every magnitude in this system
 *   is taken from the data rather than written into it.
 * @param {(pencil: object, candidate: object) => object|Promise<object>}
 *   args.validate - host-side. Runs the task's product against some test
 *   and returns a NullProtocol@1-shaped result (deriveNull's shape). The
 *   loop never executes anything itself.
 * @param {number[]} [args.aim] - aim direction; defaults to the seed's
 *   centroid.
 * @param {object} [args.spec] - field spec. Enables splice, makes the
 *   distances metric, and makes coherence read as a bounded fraction.
 * @param {(candidates: object[]) => Array<{id: string, score: number}>}
 *   [args.shapePool] - the model's ONLY entry point. Reweights; cannot add.
 * @param {number} [args.maxRounds]
 * @param {number} [args.completionWindow] - trailing rounds
 *   completionDiagnostic reads. Defaults to MIN_SAMPLES.
 * @param {number} [args.baseQuantile]
 * @param {Array<{prior_id: string, content_hash: string, weight: number}>}
 *   [args.priorsCited] - pinned prior citations carried onto every pencil.
 * @param {number} [args.perMode] - candidates per generative mode.
 * @returns {Promise<object>} frozen { rounds, inks, held, settled, edges,
 *   diagnostic, stoppedBy }
 */
export async function growTaskTree({
  seed,
  validate,
  aim = null,
  spec = null,
  shapePool = null,
  maxRounds,
  completionWindow = MIN_SAMPLES,
  baseQuantile = 0.95,
  priorsCited = [],
  perMode,
  alpha,
  maxK,
  window,
} = {}) {
  if (!Array.isArray(seed) || seed.length < 2) {
    throw new TypeError("genesis/loop: growTaskTree needs at least two seed positions (see seeding.js — a one-point history has no spread to take a magnitude from)");
  }
  if (typeof validate !== "function") {
    throw new TypeError("genesis/loop: validate is required — running a task's product is host-side, this module never executes anything");
  }

  const resolvedMaxRounds = maxRounds ?? Math.max(2 * completionWindow, 2 * MIN_SAMPLES);
  const settled = seed.map((s) => ({ id: s.id, vector: Array.from(s.vector, Number) }));
  const aimVec = aim ? Array.from(aim, Number) : centroid(settled.map((s) => s.vector));

  const inks = [];
  const held = [];
  const edges = [];
  const rounds = [];
  const groupSizes = [settled.length];

  let diagnostic = null;
  let stoppedBy = "max-rounds";

  for (let r = 0; r < resolvedMaxRounds; r += 1) {
    const pool = seedPool({ settled, aim: aimVec, spec, perMode, salt: r });

    const spectrum = shapePool ? applyShaping(pool.candidates, await shapePool(pool.candidates, { round: r })) : pool.candidates;
    const collapse = collapseCandidates(spectrum, { alpha, maxK, window });

    let promotions = 0;
    const roundHeld = [];
    for (const candidate of collapse.collapsed) {
      // Dependency risk is the in-degree of what this candidate is built
      // FROM — the load-bearing-ness of the node being mutated or spliced,
      // exactly the quantity requiredValidationQuantile corrects for.
      const parents = candidate.sourceRef?.depends_on ?? [];
      const dependents = Math.max(0, ...parents.map((p) => dependentsOf(edges, p)), 0);

      const pencil = pencilTask(candidate, {
        dependents,
        sourceKind: candidate.sourceKind,
        sourceRef: candidate.sourceRef,
        priorsCited,
        baseQuantile,
      });

      const validation = await validate(pencil, candidate);
      const result = inkTask(pencil, validation);

      if (result.promoted) {
        inks.push(result.task);
        settled.push({ id: result.task.id, vector: candidate.vector });
        for (const parent of parents) edges.push({ from: result.task.id, to: parent, internal: true });
        promotions += 1;
      } else {
        // Held, never dropped — the pencil comes back verbatim and is
        // kept as the permanent record that this was proposed and did not
        // clear its bar. The next round still sees its PARENT settled, so
        // the neighbourhood stays reachable.
        held.push(result);
        roundHeld.push(result.reason);
      }
    }

    groupSizes.push(promotions);
    const coherence = pathCoherence(settled.map((s) => s.vector), groupSizes, spec);

    rounds.push(Object.freeze({
      round: r,
      abstained: collapse.abstained,
      reason: collapse.reason,
      candidates: pool.candidates.length,
      collapsed: collapse.collapsed.length,
      promotions,
      held: Object.freeze(roundHeld),
      coherence: round4(coherence),
      gaps: pool.gaps,
      generated: pool.generated,
    }));

    // A null with no variation is not a null. When the settled set has not
    // moved — nothing promoted for the whole window — every scrambled order
    // produces the identical (zero) coherence, the observed value ties the
    // threshold, and completionDiagnostic would read "done" off a
    // comparison that carried no information. Withholding the degenerate
    // null makes it report "ambiguous" instead, which is the true state:
    // a project that settled nothing has not demonstrated completion, it
    // has demonstrated nothing.
    const samples = perturbedCoherenceSamples(settled.map((s) => s.vector), groupSizes, { spec, salt: r });
    const degenerate = samples.every((x) => Math.abs(x - samples[0]) < 1e-12);
    diagnostic = completionDiagnostic(rounds, {
      window: completionWindow,
      coherenceNull: degenerate ? null : samples,
    });
    if (diagnostic.status === "done" || diagnostic.status === "lost-in-babel") {
      stoppedBy = "diagnostic";
      break;
    }
  }

  return Object.freeze({
    rounds: Object.freeze(rounds),
    inks: Object.freeze(inks),
    held: Object.freeze(held),
    settled: Object.freeze(settled),
    edges: Object.freeze(edges),
    diagnostic,
    stoppedBy,
  });
}
