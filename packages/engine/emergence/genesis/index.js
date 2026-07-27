// Task genesis: the fold that grows a task tree instead of authoring one.
//
// The hard requirement this module answers to: a short seed ("reddit, but
// dolphin zone") must expand into arbitrarily many holonically-intelligent,
// self-validating tasks WITHOUT a human pre-digesting a plan. No outline is
// ever materialized. What exists instead, at every fold:
//
//   a scored spectrum of candidates  (discovery / organic mutation / CRISPR
//                                      splice — none of which is this
//                                      module's job; see below)
//   ---DEF--->                        which of them, if any, are real
//                                      structure rather than chance
//   ---pencil--->                     a provisional, held commitment
//   ---EVA (validation)--->           does it actually work
//   ---ink--->                        a settled fact, permanent, superseded
//                                      only by REC, never deleted
//
// and, across many folds:
//
//   ---completionDiagnostic--->       is the whole project done, or has
//                                      generation drifted into noise that
//                                      merely fails DEF for the wrong reason
//
// ── What this module deliberately does NOT do ─────────────────────
//
// It does not generate candidates. Discovery (search the ledger for what's
// missing), organic mutation (seeded perturbation of settled content), and
// CRISPR splice (targeted citation of a block from elsewhere) are all
// upstream of this module, and all of them require things the engine is not
// allowed to touch — reading a corpus, calling a model, walking a
// filesystem. This module receives an already-scored spectrum and gates it.
//
// It does not weight candidates by prior or by dependency risk either.
// A coding prior (an eoPriors artifact, same four-part shape as
// emergence/reader-priors) may shape which candidates get PROPOSED to
// collapseCandidates, and dependency risk (how much already depends on a
// node — see dependentsOf) scales how much validation a candidate needs to
// go from pencil to ink. Neither is allowed to touch DEF's own floor,
// which stays exactly as unbiased here as everywhere else DEF is used in
// this engine. The prior may shape what's offered; it must never decide
// what commits. Blur that line and "grown, not authored" quietly becomes
// "authored, with extra steps."
//
// It does not delete or overwrite. Every pencil, every ink, every
// supersession is a distinct, frozen, content-hashed object. A pencil that
// fails validation is returned unchanged, not discarded — "held", the same
// status hypothesis.hold already uses in replay/index.js. This is the
// engine's existing objective-immortality guarantee (the append-only event
// ledger), extended to tasks rather than invented for them.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { DEF, MIN_SAMPLES } from "../nulls/extreme-value.js";
import { deriveNull } from "../nulls/index.js";

const round = (x) => Math.round(x * 1e4) / 1e4;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const std = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

export const TASK_LIFECYCLE = Object.freeze(["pencil", "ink", "held", "superseded"]);

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

// ── Dependency risk: in-degree over the SAME dependency graph shape ──
// calculus.js already produces (`{ from, to, internal }` edges). A node
// many other promoted things already cite is load-bearing; mutating it
// should cost more evidence, not be forbidden outright — the same
// gradient real gene-regulatory and protein-interaction networks show
// (hub nodes evolve under stronger purifying selection than peripheral
// ones — this is measured biology, not an analogy borrowed for texture).
export function dependentsOf(edges, nodeId) {
  let count = 0;
  for (const e of edges ?? []) if (e.to === nodeId) count++;
  return count;
}

// ── Required validation strength scales with dependency risk ─────────
//
// Same Bonferroni-style correction calculus.js already uses for
// cross-vocabulary extensions (`correctedQuantile` in induceExtensions):
// treat each dependent as an independent chance to be wrong, and correct
// the required quantile accordingly. Zero dependents leaves the base
// quantile untouched — a leaf costs nothing extra to explore. Many
// dependents demands proportionally stronger evidence before a mutation
// there is allowed to commit.
export function requiredValidationQuantile(baseQuantile, dependents) {
  const d = Math.max(0, dependents | 0);
  if (d === 0) return baseQuantile;
  return 1 - (1 - baseQuantile) / (d + 1);
}

// ── Collapse: DEF over a caller-scored candidate spectrum ────────────
//
// candidates: [{ id, score }, ...] — score already reflects whatever
// upstream shaping (coding prior × dependency-risk-adjusted proposal
// weight) the caller applied. DEF itself stays exactly as unbiased here
// as in kinds.js/calculus.js: it is never told which candidate is
// "liked", only handed a spectrum and asked whether it has real
// structure. A flat spectrum abstains — not "no candidate is
// conceivable" (one can always be named), but "no candidate clears what
// this spectrum's own chance-level churn would already produce".
export function collapseCandidates(candidates, { alpha = 0.05, maxK = 12, window = 20 } = {}) {
  const items = (candidates ?? []).filter((c) => c && Number.isFinite(c.score));
  if (items.length < 2) {
    return Object.freeze({ collapsed: Object.freeze([]), abstained: true, reason: "insufficient-candidates", def: null });
  }
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const spectrum = sorted.map((c) => c.score);
  const def = DEF(spectrum, { alpha, maxK, window });
  if (def.abstain) {
    return Object.freeze({ collapsed: Object.freeze([]), abstained: true, reason: "flat-spectrum", def });
  }
  return Object.freeze({ collapsed: Object.freeze(sorted.slice(0, def.k)), abstained: false, reason: null, def });
}

// ── Provenance of a prior: required, not optional ─────────────────
//
// "All get preserved, all store provenance, including the priors."
// A candidate that was shaped by a coding prior must cite it — the
// prior's id, the content hash of the prior snapshot actually used (so
// the citation is pinned to a specific version, the same discipline
// prior-boundary already applies to reader priors), and the weight it
// carried in this candidate's score. An empty array is a legitimate
// citation (pure discovery, no prior consulted) — this validates SHAPE,
// not presence.
function validatePriorsCited(priorsCited) {
  if (!Array.isArray(priorsCited)) throw new TypeError("genesis: priorsCited must be an array (use [] for none)");
  for (const p of priorsCited) {
    if (!p || typeof p.prior_id !== "string" || !p.prior_id) throw new TypeError("genesis: every prior citation needs a prior_id");
    if (typeof p.content_hash !== "string" || !p.content_hash) throw new TypeError(`genesis: prior citation ${p.prior_id} needs a pinned content_hash`);
    if (typeof p.weight !== "number" || !Number.isFinite(p.weight)) throw new TypeError(`genesis: prior citation ${p.prior_id} needs a numeric weight`);
  }
  return true;
}

export const SOURCE_KINDS = Object.freeze(["discovery", "mutation", "splice"]);

// ── Pencil: a provisional task, first pass ────────────────────────
//
// Never the answer — a committed CANDIDATE, exactly as tentative as
// hypothesis.hold's "held" status already is in replay/index.js. Nothing
// is thrown away if it never gets inked; the pencil object is the
// permanent record that this was proposed, from this source, citing
// these priors, at this dependency risk.
export function pencilTask(candidate, {
  dependents = 0,
  sourceKind = "discovery",
  sourceRef = null,
  priorsCited = [],
  supersedes = null,
  baseQuantile = 0.95,
} = {}) {
  if (!candidate || typeof candidate.id !== "string" || !candidate.id) {
    throw new TypeError("genesis: candidate needs a stable id");
  }
  if (!SOURCE_KINDS.includes(sourceKind)) {
    throw new TypeError(`genesis: unknown sourceKind "${sourceKind}" (expected one of ${SOURCE_KINDS.join(", ")})`);
  }
  validatePriorsCited(priorsCited);

  const body = {
    schema: "TaskCandidate@1",
    candidate_id: candidate.id,
    description: candidate.description ?? null,
    score: candidate.score ?? null,
    lifecycle: "pencil",
    source: { kind: sourceKind, ref: sourceRef },
    priors_cited: priorsCited,
    dependents,
    required_validation_quantile: round(requiredValidationQuantile(baseQuantile, dependents)),
    supersedes,
    emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op: "EVA", status: "pencil" },
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, id: stableId("task", body), content_hash });
}

// ── Ink: promote a pencil, or hold it — never drop it ─────────────
//
// validation is a NullProtocol@1-shaped result (deriveNull's return
// shape) the CALLER produced by actually running the task's product
// against some test — this module never executes anything, purity
// forbids it. Two independent conditions must both hold:
//
//   1. validation.passed — the evidence itself cleared its own bar
//   2. validation.quantile >= pencil.required_validation_quantile —
//      the bar it was checked against was not weaker than what this
//      task's dependency risk demands. A caller cannot sneak a
//      load-bearing mutation past a lightweight check; under-powered
//      validation is rejected exactly like failed validation.
//
// On failure the pencil is returned VERBATIM alongside a `held` result
// — never mutated, never discarded. The caller decides whether to
// retry, revise (a fresh pencilTask citing this one via `supersedes`),
// or abandon; this module only refuses to pretend nothing happened.
export function inkTask(pencil, validation, {} = {}) {
  if (!pencil || pencil.lifecycle !== "pencil") {
    throw new TypeError("genesis: inkTask requires a pencil-lifecycle task");
  }
  if (!validation || typeof validation.passed !== "boolean" || typeof validation.quantile !== "number") {
    throw new TypeError("genesis: validation must be a NullProtocol@1-shaped result (see deriveNull)");
  }

  const underpowered = validation.quantile < pencil.required_validation_quantile;
  if (!validation.passed || underpowered) {
    return Object.freeze({
      promoted: false,
      task: pencil,
      reason: !validation.passed ? "validation-failed" : "validation-underpowered",
      validation,
    });
  }

  // Revising an already-inked task (pencil.supersedes points at a prior
  // ink) is generation re-entering the system — REC, the same operator
  // hypothesis.supersede already uses. A fresh commit with no prior ink
  // behind it is a first evaluation — EVA, matching hypothesis.accept.
  const op = pencil.supersedes ? "REC" : "EVA";
  const body = {
    schema: "TaskCandidate@1",
    candidate_id: pencil.candidate_id,
    description: pencil.description,
    score: pencil.score,
    lifecycle: "ink",
    source: pencil.source,
    priors_cited: pencil.priors_cited,
    dependents: pencil.dependents,
    required_validation_quantile: pencil.required_validation_quantile,
    supersedes: pencil.supersedes,
    validation,
    pencil_id: pencil.id,
    emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op, status: "ink" },
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ promoted: true, task: Object.freeze({ ...body, id: stableId("task", body), content_hash }), reason: null, validation });
}

// ── Completion: DEF-abstention alone is ambiguous, and says so ───────
//
// Sustained DEF-abstention has two causes that look identical from the
// abstention flag: the project is actually done (nothing left clears
// the floor, AND what's left points steadily at the aim), or generation
// has drifted past the ledger's local neighbourhood into something
// statistically indistinguishable from noise (nothing clears the floor
// because nothing is even trying to). Only a coherence measure — how
// steadily the recent candidates moved toward the aim direction, e.g.
// emergence/trajectory/field-shift.js's fieldCurrentDensity coherence —
// tells the two apart, and it needs a NULL to be trusted, the same way
// computeBoundaryStabilityGate never trusts a raw displacement number
// without a random-boundary null to compare it against.
//
// Without a coherenceNull this function refuses to guess — it reports
// "ambiguous", not a heuristic threshold. That refusal is deliberate:
// this engine's own rule is that no gate compares a statistic to a
// hand-set constant, and "mean coherence > 0.5" would be exactly that.
export function completionDiagnostic(rounds, { window = MIN_SAMPLES, coherenceNull = null, quantile } = {}) {
  const list = Array.isArray(rounds) ? rounds : [];
  if (list.length < window) {
    return Object.freeze({ status: "continue", reason: "insufficient-rounds", evidence: { rounds: list.length, window } });
  }

  const trailing = list.slice(-window);
  const defFlat = trailing.every((r) => r.abstained === true);
  const promotions = trailing.reduce((a, r) => a + (r.promotions ?? 0), 0);
  const recSilent = promotions === 0;

  if (!defFlat) {
    return Object.freeze({ status: "continue", reason: "active-gap", evidence: { defFlat, recSilent, promotions } });
  }
  if (!recSilent) {
    // DEF is flat locally but something is still being promoted —
    // structure keeps entering the vocabulary even though this round's
    // spectrum is quiet. Not done, and not lost either.
    return Object.freeze({ status: "continue", reason: "def-flat-but-rec-active", evidence: { defFlat, recSilent, promotions } });
  }

  const coherenceValues = trailing.map((r) => r.coherence).filter(Number.isFinite);
  if (!coherenceNull || coherenceNull.length < MIN_SAMPLES || coherenceValues.length === 0) {
    return Object.freeze({
      status: "ambiguous",
      reason: "def-flat-and-rec-silent-but-no-coherence-null-supplied",
      evidence: { defFlat, recSilent, promotions, coherenceSamples: coherenceValues.length },
    });
  }

  const meanCoherence = mean(coherenceValues);
  const nullResult = deriveNull({
    nullSamples: coherenceNull,
    observedStatistic: meanCoherence,
    tailDirection: "greater",
    quantile,
    protocol: { name: "coherence-vs-perturbed-discovery", scope: "task-genesis completion diagnostic" },
  });

  return Object.freeze({
    status: nullResult.passed ? "done" : "lost-in-babel",
    reason: nullResult.passed
      ? "no structure left to collapse, and the recent path stayed coherent with the aim"
      : "no structure left to collapse, but the recent path is not distinguishable from a perturbed/undirected one — widen the search toward lower-dependency territory rather than declaring completion",
    evidence: {
      defFlat,
      recSilent,
      promotions,
      meanCoherence: round(meanCoherence),
      stdCoherence: round(std(coherenceValues)),
      nullResult,
    },
  });
}
