// Candidate generation: the half of the fold genesis/index.js declined.
//
// genesis/index.js gates an already-scored spectrum and says so in its
// header: "It does not generate candidates. Discovery, organic mutation,
// and CRISPR splice are all upstream of this module, and all of them
// require things the engine is not allowed to touch — reading a corpus,
// calling a model, walking a filesystem."
//
// That was true of ONE reading of those three words, the reading where a
// candidate is a sentence someone writes. It is not true of the reading
// docs/genesis-fold-design.md actually specifies, where a candidate is a
// POSITION — a field vector at a coordinate — and the three generative
// modes are operations on positions:
//
//   discovery  frontier extrapolation: step past the settled hull, in the
//              direction the settled set is already spread
//   mutation   single-locus perturbation of a settled position, at the
//              settled set's OWN per-dimension spread (no hand-set sigma)
//   splice     graft one settled position's channel slice onto another —
//              "a gene is a channel slice at a coordinate, and because
//              field-spec is modality-blind, extracting a chroma
//              progression and extracting a component subtree are the same
//              function call" (genesis-fold-design.md)
//
// None of those reads a corpus, calls a model, or walks a filesystem. All
// three are pure functions of the settled history plus a seeded rng, which
// is exactly what createSeededRng already provides for null construction
// ("Mutation is the same operation used as the candidate generator instead.
// Mutation and null-generation aren't two mechanisms; one function, two
// roles.").
//
// ── Why vectors and not descriptions ──────────────────────────────
//
// The omnimodal test from CLAUDE.md: an organ must make sense for a
// nameless leitmotif in a symphony. A generator that mutates task
// DESCRIPTIONS fails it immediately — it can only ever produce text, and
// it decides what a task IS by string surgery. A generator that moves
// through a field space passes it: the same call proposes the next
// component subtree, the next chord voicing, or the next experiment,
// depending only on what the caller's channels mean. Descriptions are a
// projection of a candidate, never its identity — the same rule
// docs/nameless-referent.md sets for referents.
//
// ── The scale problem, and the honest answer to it ────────────────
//
// Every generator here needs a magnitude: how far past the hull, how big a
// perturbation. Any number written into this file would be a hand-set
// constant in a system whose whole rule is that no gate compares a
// statistic to one (nulls/index.js header). So no generator here has a
// magnitude of its own. Each takes its magnitude from the settled set's
// own geometry — the hull radius for discovery, the per-dimension spread
// for mutation, an existing donor slice for splice — which means the
// seeder is silent, not arbitrary, when the settled set is too small to
// have a geometry.
//
// That silence has the same threshold as collapseCandidates' own:
// FEWER THAN TWO SETTLED NODES AND THE SEEDER REFUSES. DEF abstains below
// two candidates because a one-point spectrum has no gap to measure; the
// seeder abstains below two settled nodes because a one-point history has
// no spread to measure. Same reason, same floor, reported as a typed gap
// rather than a fabricated default.
//
// ── MEASURED: this generator does not sustain multi-round growth ──
//
// Do not silently retry the variants below; all three were built and
// measured, and the finding is about the OBSERVABLE, not about tuning.
//
// The loop (loop.js) is wired correctly: inks join the settled set, and
// the next round's pool is demonstrably generated from the enlarged set
// (candidate counts rise as inks arrive; loop.test.js pins this). But
// across every geometry tried — a symmetric 4-point seed, a clustered
// 5-point seed with a deliberate outlier, 16-dimensional seeds of 5/8/16/24
// nodes, aim inside the hull and aim outside it — the loop promotes in
// round 0 (or not at all) and then abstains every subsequent round. No
// promoted task has ever been built from another promoted task.
//
// Three spectrum shapes, same outcome:
//
//   1. SAMPLED generators (random anchor, random step). Failed because a
//      random step size adds noise at the same magnitude as the signal,
//      converting the settled set's real isolation structure into a smooth
//      continuum. DEF is a gap detector; it abstained on a spectrum that
//      had structure before the generator smeared it.
//   2. FULL ENUMERATION — what ships. Sustains no depth either: splice
//      alone enumerates |settled|^2 x |channels| (3000 candidates from a
//      24-node seed) while DEF weighs only the leading `window` (20)
//      sorted values, which past a handful of nodes are all near-duplicate
//      grafts differing in the fourth decimal. But it does at least
//      promote in round 0 across most geometries tried, which (3) does not.
//   3. ANCHOR-REDUCED — best candidate per (mode, anchor), an O(n)
//      spectrum of distinct loci rather than O(n^2) spellings of the same
//      move. Semantically the nicer object and far cheaper, and it was
//      briefly the shipped default on those grounds. Reverted after
//      measurement: an O(n) spectrum is too THIN for DEF's extreme-value
//      correction to fit a background at all, so small seeds abstain in
//      every round including the first (the clustered 5-node seed went
//      from 8 promotions to 0). Cheaper and cleaner lost to measurably
//      worse, which is the correct order of those considerations.
//
// The diagnosis is not "DEF is too strict". It is that a candidate score
// built only out of GEOMETRY is isotropic: once a frontier has been pushed
// out, every direction along it is about as novel and about as aligned as
// every other, so there is genuinely no standout next move for DEF to
// find. DEF abstaining on an isotropic frontier is DEF being right.
//
// This is the same shape as the engine's other standing open problem
// (AGENTS.md: span-golden recall capped by the lexical channel, the
// missing piece being a NON-LEXICAL observable). Here the missing piece is
// a NON-GEOMETRIC one: which candidates actually VALIDATED, and how
// strongly. That signal already exists in the loop — every ink carries its
// NullProtocol@1 result, and a run therefore produces a competency series
// — and emergence/operators/induceOperators is the organ that mines a
// numeric series for structure. Feeding realized validation strength back
// into the score, rather than position alone, is the next thing to try;
// measure it against a frozen golden before tuning anything here.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { createSeededRng, seededShuffle } from "../nulls/index.js";
import {
  cosineDistance,
  fieldDistance,
  getChannel,
  normalizeFieldSpec,
  validateFieldVector,
} from "../../perceiver/field-spec.js";

const round4 = (x) => Math.round(x * 1e4) / 1e4;

// The three generative modes are exactly genesis/index.js's SOURCE_KINDS.
// They are not a parallel vocabulary; a candidate's `sourceKind` is handed
// straight to pencilTask, which validates it against that same list.
export const SEED_MODES = Object.freeze(["discovery", "mutation", "splice"]);

/** Plain, finite, copied — Float64Array and Array both come out the same. */
function toVec(v) {
  const out = Array.from(v ?? [], Number);
  for (const x of out) if (!Number.isFinite(x)) throw new TypeError("genesis/seeding: vectors must be finite");
  return out;
}

export function centroid(vectors) {
  if (!vectors.length) return [];
  const dims = vectors[0].length;
  const acc = new Array(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i += 1) acc[i] += v[i];
  return acc.map((x) => x / vectors.length);
}

// Per-dimension population standard deviation of the settled set. This is
// the ONLY magnitude mutation is allowed to use, and it is a property of
// the history, not of this file. Distinct from referents/dispersion.js's
// couplingDispersion (entropy of incident coupling weights) — different
// quantity, different organ; named `spread` so the two never get confused.
export function spread(vectors) {
  if (vectors.length < 2) return null;
  const c = centroid(vectors);
  const dims = c.length;
  const acc = new Array(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i += 1) acc[i] += (v[i] - c[i]) ** 2;
  return acc.map((x) => Math.sqrt(x / vectors.length));
}

function distance(a, b, spec) {
  return spec ? fieldDistance(a, b, spec).distance : cosineDistance(a, b);
}

// ── Scoring: alignment × novelty, both measured, neither tuned ────
//
// novelty   = distance to the NEAREST settled node. Not distance to the
//             centroid: a candidate sitting on top of an existing node is
//             already-explored territory even if the centroid is far away.
// alignment = 1 - distance to the aim. The aim is the seed's direction —
//             the thing that makes this structured local search rather
//             than Library-of-Babel wandering ("conditioning every
//             candidate spectrum on the full settled history is what
//             collapses 'all possible next things' down to 'the reachable
//             neighbourhood'", genesis-fold-design.md).
//
// The product is the same shape as the best-scoring significance selector
// in this engine (forward-surprise × presence, entity-fold.js): two
// independent measured channels multiplied, so a candidate must be both
// new AND pointed the right way. Neither factor is weighted; a weight
// would be the hand-set constant this engine forbids.
//
// Under a spec whose channels are all true metrics (angular, euclidean)
// both factors are bounded and the product reads as a fraction. Under
// plain cosine, alignment can go negative for an anti-aligned candidate —
// which is correct, not a bug: a novel candidate pointing away from the
// aim sorts BELOW an unremarkable one, and DEF sees a spectrum either way.
export function scoreCandidate(vector, { settled, aim, spec }) {
  const novelty = settled.length ? Math.min(...settled.map((s) => distance(vector, s.vector, spec))) : 0;
  const alignment = aim ? 1 - distance(vector, aim, spec) : 1;
  return { score: alignment * novelty, novelty, alignment };
}

function mintCandidate(vector, sourceKind, sourceRef, scoring) {
  const body = {
    schema: "TaskCandidateSeed@1",
    vector,
    sourceKind,
    sourceRef,
  };
  return Object.freeze({
    ...body,
    id: `cand:${canonicalHashSync(body)}`,
    score: scoring.score,
    novelty: round4(scoring.novelty),
    alignment: round4(scoring.alignment),
    // description stays null on purpose. The engine never authors prose;
    // a host may attach one downstream (pencilTask carries it), but the
    // candidate's identity is its position, never a string.
    description: null,
  });
}

// ── Why these generators ENUMERATE instead of sampling ────────────
//
// The first version of this module sampled: pick a random anchor, take a
// random step, repeat N times. It ran, it was deterministic, and it was
// wrong in a way worth recording, because the failure is instructive
// rather than a bug.
//
// DEF is a GAP detector. It asks whether a spectrum contains a break
// bigger than that spectrum's own chance-level churn would produce. A
// sampled generator with a random step size converts whatever structure
// the settled set has — this node is isolated, that cluster is dense —
// into a smooth continuum of scores, because the step noise is added on
// top of the signal at the same magnitude as the signal. DEF then
// abstains, correctly, on a continuum that HAD structure before the
// generator smeared it. Measured: with sampled steps the loop promoted
// twice, then abstained every remaining round and terminated at "done"
// with a two-node tree — a project declared finished because its own
// candidate generator was too noisy to propose anything distinguishable.
//
// Enumerating fixes it at the source. One candidate per anchor (discovery),
// per locus and sign (mutation), per ordered pair and channel (splice)
// means every score difference in the spectrum is a difference in the
// SETTLED SET, not in the rng. Isolated nodes now produce visibly
// higher-novelty candidates than clustered ones, and that is exactly the
// gap DEF exists to find. It also matches how this engine already searches
// elsewhere: searchCompetentPrograms enumerates programs by description
// length rather than sampling them.
//
// The rng survives for one job only — subsampling an enumeration that is
// larger than the caller's budget (see seedPool's `perMode`) — and that
// subsample is uniform, never top-N, so it thins the spectrum without
// reshaping it.

// ── Discovery: reflect the centroid through each settled node ─────
//
// "Search the ledger for what's missing" without a corpus to search: the
// missing region is the one just outside the settled hull. Reflecting the
// centroid through a settled node lands one hull-radius beyond that node,
// in a direction the history itself established. One candidate per settled
// node, so the resulting scores read directly as "how much unexplored
// space is out past this node" — the isolation structure of the settled
// set, undistorted.
export function discoveryCandidates({ settled, aim, spec }) {
  const c = centroid(settled.map((s) => s.vector));
  const out = [];
  for (const anchor of settled) {
    const vector = anchor.vector.map((x, d) => 2 * x - c[d]);
    out.push(mintCandidate(vector, "discovery", {
      mode: "frontier-extrapolation",
      depends_on: [anchor.id],
    }, scoreCandidate(vector, { settled, aim, spec })));
  }
  return out;
}

// ── Mutation: single-locus, at the settled set's own spread ───────
//
// Point mutation, the undirected mechanism of the pair — one locus, one
// step of exactly one standard deviation, in each direction. sigma_d is
// the settled set's own per-dimension spread, so the magnitude is a
// property of the history rather than of this file. A dimension the
// history has never varied has sigma_d = 0 and is therefore unmutatable:
// the seeder does not invent variation in a channel that has never shown
// any.
export function mutationCandidates({ settled, aim, spec }) {
  const sigma = spread(settled.map((s) => s.vector));
  if (!sigma) return [];
  const out = [];
  for (const anchor of settled) {
    for (let locus = 0; locus < anchor.vector.length; locus += 1) {
      if (sigma[locus] === 0) continue;
      for (const sign of [1, -1]) {
        const delta = sign * sigma[locus];
        const vector = anchor.vector.slice();
        vector[locus] += delta;
        out.push(mintCandidate(vector, "mutation", {
          mode: "point-mutation",
          depends_on: [anchor.id],
          locus,
          delta: round4(delta),
        }, scoreCandidate(vector, { settled, aim, spec })));
      }
    }
  }
  return out;
}

// ── Splice: a gene is a channel slice at a coordinate ─────────────
//
// The CRISPR half. Locate by coordinate (which channel), fetch the donor's
// slice, graft it onto the acceptor, and cite BOTH — the same two-parent
// citation induceExtensions already writes for a cross-vocabulary
// extension. Directed, not random: unlike mutation it moves material that
// has already survived validation somewhere else. Enumerated over every
// ordered (acceptor, donor) pair and every channel, so the spectrum shows
// which grafts actually reach new territory and which merely restate the
// acceptor.
//
// Requires a field spec with at least two channels, because "which
// channel" IS the coordinate being spliced at. With no spec, or a
// single-channel spec, there is no coordinate system to splice in and the
// seeder reports a typed gap rather than degrading into a random crossover
// point — which would be a different, undeclared operation wearing this
// one's name.
export function spliceCandidates({ settled, aim, spec }) {
  if (!spec) return [];
  const s = normalizeFieldSpec(spec);
  if (s.channels.length < 2 || settled.length < 2) return [];
  const out = [];
  for (const acceptor of settled) {
    for (const donor of settled) {
      if (donor.id === acceptor.id) continue;
      for (const channel of s.channels) {
        const ch = getChannel(s, channel.name);
        const vector = acceptor.vector.slice();
        for (let d = 0; d < ch.dims; d += 1) vector[ch.offset + d] = donor.vector[ch.offset + d];
        out.push(mintCandidate(vector, "splice", {
          mode: "channel-graft",
          depends_on: [acceptor.id, donor.id],
          channel: channel.name,
        }, scoreCandidate(vector, { settled, aim, spec })));
      }
    }
  }
  return out;
}

const GENERATORS = Object.freeze({
  discovery: discoveryCandidates,
  mutation: mutationCandidates,
  splice: spliceCandidates,
});

/**
 * Generate one round's candidate spectrum from the settled history.
 *
 * `settled` is the self-seeding input: on round 0 it is the seed, and on
 * every round after that it is the seed PLUS every ink promoted so far.
 * Nothing else is consulted — no corpus, no model, no filesystem.
 *
 * @param {object} args
 * @param {Array<{id: string, vector: number[]}>} args.settled - the settled
 *   history. Fewer than two nodes yields no candidates and a typed gap.
 * @param {number[]} [args.aim] - the aim direction. Defaults to the seed's
 *   own centroid, which is what makes round 0 directed at all.
 * @param {object} [args.spec] - a field spec. Required for splice; also
 *   makes the distances metric so the scores read as fractions.
 * @param {number} [args.perMode] - OPTIONAL cap on candidates per
 *   generative mode. Omitted, each mode enumerates in full, which is the
 *   default because a full enumeration is the only pool whose score
 *   differences are all differences in the settled set. Supplied, the
 *   excess is dropped by uniform seeded subsampling — never top-N, which
 *   would reshape the spectrum before DEF ever sees it — and both the
 *   enumerated and the retained counts are reported in `generated` so a
 *   cap is never a silent truncation.
 * @param {string|number} [args.salt] - mixed into the subsampling seed.
 *   Uncapped pools do not consult it: with a full enumeration the pool is
 *   a pure function of the settled set, so a round that settled nothing
 *   proposes nothing new — which is a true statement about the history,
 *   not a stall.
 * @returns {{candidates: object[], gaps: object[], generated: object}}
 */
export function seedPool({ settled, aim = null, spec = null, perMode, salt = 0 } = {}) {
  const nodes = (settled ?? []).map((s) => {
    if (!s || typeof s.id !== "string" || !s.id) throw new TypeError("genesis/seeding: every settled node needs a stable id");
    return { id: s.id, vector: toVec(s.vector) };
  });

  const gaps = [];
  if (nodes.length < 2) {
    return Object.freeze({
      candidates: Object.freeze([]),
      gaps: Object.freeze([Object.freeze({
        kind: "insufficient-settled",
        detail: "the settled set has no spread to take a magnitude from; the same two-point floor collapseCandidates applies to a spectrum",
        settled: nodes.length,
      })]),
      generated: Object.freeze(Object.fromEntries(
        SEED_MODES.map((m) => [m, Object.freeze({ enumerated: 0, retained: 0 })]),
      )),
    });
  }

  const dims = nodes[0].vector.length;
  for (const n of nodes) {
    if (n.vector.length !== dims) throw new TypeError(`genesis/seeding: settled node ${n.id} has ${n.vector.length} dims, expected ${dims}`);
    if (spec) {
      const check = validateFieldVector(n.vector, spec, { label: n.id });
      if (!check.valid) throw new TypeError(`genesis/seeding: settled node ${n.id} does not match the field spec (${check.reason})`);
    }
  }

  const aimVec = aim ? toVec(aim) : centroid(nodes.map((n) => n.vector));
  const rng = createSeededRng(canonicalHashSync({ nodes, aim: aimVec, salt, purpose: "genesis-seed-pool" }));

  const generated = {};
  const all = [];
  for (const mode of SEED_MODES) {
    const enumerated = GENERATORS[mode]({ settled: nodes, aim: aimVec, spec });
    const produced = perMode != null && enumerated.length > perMode
      ? seededShuffle(enumerated, rng).slice(0, perMode)
      : enumerated;
    generated[mode] = Object.freeze({ enumerated: enumerated.length, retained: produced.length });
    all.push(...produced);
    if (produced.length === 0) {
      gaps.push(Object.freeze({
        kind: `${mode}-unavailable`,
        detail: mode === "splice"
          ? "splice needs a field spec with at least two channels — the channel IS the coordinate being spliced at"
          : "the settled set has zero spread in every dimension; there is no variation to perturb",
      }));
    }
  }

  // Drop candidates that landed exactly on an already-settled position
  // (zero novelty is not a proposal, it is a restatement) and collapse
  // duplicate positions produced by different modes to their first
  // occurrence, so the spectrum DEF sees has one entry per position.
  const settledKeys = new Set(nodes.map((n) => canonicalHashSync(n.vector)));
  const seen = new Set();
  const enumerated = [];
  for (const c of all) {
    const key = canonicalHashSync(c.vector);
    if (settledKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    enumerated.push(c);
  }

  const candidates = [...enumerated].sort((a, b) => b.score - a.score);

  return Object.freeze({
    candidates: Object.freeze(candidates),
    gaps: Object.freeze(gaps),
    generated: Object.freeze(generated),
  });
}

