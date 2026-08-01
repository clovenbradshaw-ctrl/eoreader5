// Paradigm promotion gate (the fourth gate).
//
// A paradigm is a corpus prior or Kind (pattern) that graduates from
// pocket-local — known only to one lens or one architectural family — to
// widely accepted across independent lenses. This gate controls when that
// graduation is justified.
//
// Three sub-gates, each gated by deriveNull — same discipline as the
// individuation gate (referents/individuation.js) and the Figure→Pattern
// transfer+exchangeability gate (kinds/index.js):
//
//   1. CORRELATED-ERROR CHECK (§1): How architecturally independent are the
//      lenses that agree on this candidate? The asymptotic floor of Var(mean)
//      under correlated error is ρσ², not 0 — so adding more lenses from the
//      same family doesn't lower uncertainty. The gate measures whether
//      supporting lenses span multiple architectural families. A paradigm
//      endorsed by four EO-algebra lenses is one data point, not four.
//
//   2. BLACKWELL-DUBINS PRECONDITION (§2): Mutual absolute continuity — the
//      precondition for convergence. If lens A's prior assigns zero
//      probability to anything lens B allows, no amount of shared data can
//      merge them. The gate checks structural compatibility before treating
//      cross-lens disagreement as ordinary uncertainty. Incompatible lenses
//      must not contribute to the agreement quorum.
//
//   3. ZOLLMAN DELAY (§3): Fast convergence is the danger sign, not the
//      goal — an early lucky signal dominates before independent lenses get
//      their own shot. The gate requires a minimum independent-evidence
//      window per lens before cross-lens propagation is allowed. Each
//      supporting lens must have accumulated sufficient evidence on its own.
//
// Every threshold is a Born null from deriveNull (emergence/nulls/index.js),
// never a hand-set constant. The gate result is the same shape as
// IndividuationResult@1: { admitted, status, reason } — plus the three
// sub-gate result objects for audit.

import { deriveNull, createSeededRng, seededShuffle } from "../nulls/index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

// ── Lens model (minimal, for the gate's purposes) ────────────────────────────────
//
// A lens for this gate is a structured object. The gate does not build lenses;
// it consumes them. What matters for each sub-gate:
//
//   id: string                    — stable lens identifier
//   architectural_family: string  — "eo-algebra", "indigenous-oral", "folk-wisdom", …
//   prior_support: Set<string>    — candidate IDs this lens's prior assigns
//                                    non-zero probability to (Blackwell-Dubins)
//   evidence: object[]            — evidence log entries, one per observed step
//   claims: string[]              — candidate IDs this lens currently claims
//
// The gate is deliberately thin on lens structure. As the lens registry matures,
// lenses will carry richer priors; the gate only uses the three fields it needs.

// ── Gate 1: Correlated-error floor ─────────────────────────────────────────────
//
// Var(mean of n correlated estimates) → ρσ² as n → ∞.
// The measurable proxy: architectural family diversity among agreeing lenses.
// A lens declares its architectural_family at registration. The gate measures
// whether the supporting lenses span enough families to lower ρ below chance.
//
// Observed: fraction of supporting lenses from families with >1 representative
//   (a single lens from a novel family is anecdotal; two from the same novel
//    family suggest genuine independence)
//
// Null: randomly sample |supporting_lenses| lenses from all_lenses, compute
//   the same diversity score. If the observed diversity is not significantly
//   higher than random, the agreement is architectural noise.

function computeFamilyDiversity(supporting, allLenses) {
  const familyCounts = new Map();
  for (const lens of supporting) {
    const family = lens.architectural_family ?? "unknown";
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }
  // Score: number of families that contribute at least 2 lenses.
  // A single-lens family means one observer from that tradition — valuable
  // but not yet replicated within that tradition. Two+ means the family's
  // conclusion is internally reproducible.
  const replicatedFamilies = [...familyCounts.entries()]
    .filter(([, count]) => count >= 2)
    .length;
  const totalFamilies = familyCounts.size;

  // Composite: replicated families weighted by total spread.
  // A paradigm with 2 families × 2 lenses each (replicated=2) is stronger
  // than 1 family × 4 lenses (replicated=0).
  return {
    score: replicatedFamilies * Math.log(1 + totalFamilies),
    replicatedFamilies,
    totalFamilies,
    familyCounts: Object.fromEntries(familyCounts),
  };
}

export function checkCorrelationGap({
  candidate_id,
  supporting_lenses,
  all_lenses,
  quantile,
  permutations = 200,
}) {
  if (!supporting_lenses.length) {
    return { passed: false, reason: "no supporting lenses", score: 0, null_result: null };
  }

  // If every lens in the pool is from the same architectural family, the
  // null distribution collapses to the observed value and cannot distinguish
  // signal from noise. The honest answer: you can't verify architectural
  // independence when you only have one family's lenses.
  const poolFamilies = new Set(all_lenses.map((l) => l.architectural_family ?? "unknown"));
  if (poolFamilies.size <= 1) {
    return {
      passed: false,
      reason: `all ${all_lenses.length} lenses in the pool are from one architectural family ("${[...poolFamilies][0]}") — cannot measure cross-family correlation. Add lenses from other architectural traditions.`,
      score: 0,
      replicated_families: 0,
      total_families: poolFamilies.size,
      family_counts: {},
      all_same_family: true,
      null_result: null,
    };
  }

  const observed = computeFamilyDiversity(supporting_lenses, all_lenses);
  const n = supporting_lenses.length;

  const rng = createSeededRng(
    canonicalHashSync({ candidate_id, purpose: "correlation-gap-null" })
  );
  const nullScores = [];
  for (let i = 0; i < permutations; i++) {
    const shuffled = seededShuffle(all_lenses, rng);
    const sample = shuffled.slice(0, n);
    const div = computeFamilyDiversity(sample, all_lenses);
    nullScores.push(div.score);
  }

  const nullResult = deriveNull({
    nullSamples: nullScores,
    observedStatistic: observed.score,
    tailDirection: "greater",
    quantile,
    protocol: {
      name: "correlation-gap-family-diversity",
      iterations: permutations,
      statistic: "replicated-families * log(1 + total-families)",
      scope: `lens family diversity among ${n} supporting lenses for candidate ${candidate_id}`,
    },
  });

  const passed = nullResult.passed;

  // Even if the null passes, surface whether all lenses are from one family.
  // A passed null with one family is a warning: the gate admits (the lenses
  // do span families), but the paradigm should carry a caveat.
  const allSameFamily = observed.totalFamilies === 1;
  let reason;
  if (!passed) {
    reason = `architectural family diversity (${observed.replicatedFamilies} replicated of ${observed.totalFamilies} total) does not clear its Born-null threshold — supporting lenses may share correlated error`;
  } else if (allSameFamily) {
    reason = `null passed but all ${n} supporting lenses are from one architectural family ("${[...new Set(supporting_lenses.map((l) => l.architectural_family))][0]}") — paradigm carries single-family caveat`;
  } else {
    reason = `${observed.replicatedFamilies} replicated families out of ${observed.totalFamilies} total among ${n} supporting lenses — architectural diversity clears the correlation gap`;
  }

  return {
    passed,
    reason,
    score: observed.score,
    replicated_families: observed.replicatedFamilies,
    total_families: observed.totalFamilies,
    family_counts: observed.familyCounts,
    all_same_family: allSameFamily,
    null_result: nullResult,
  };
}

// ── Gate 2: Blackwell-Dubins mutual absolute continuity ─────────────────────────
//
// Two lenses are mutually continuous if each assigns non-zero prior probability
// to everything the other allows. The operationalized check: for each pair of
// supporting lenses (A, B), compute the overlap fraction of their prior supports.
//
//   continuity_A_to_B = |support(A) ∩ support(B)| / |support(B)|
//   continuity_B_to_A = |support(B) ∩ support(A)| / |support(A)|
//
// Both must exceed the threshold for the pair to be "continuous." A pair where
// even one direction fails is structurally incompatible — they are not
// convergible in principle, and the disagreement is not ordinary uncertainty.
//
// If `support` is not set on a lens (null/undefined), the lens is treated as
// having unbounded support (it rules nothing out a priori) — it is continuous
// with everything. This is the default for lenses that don't yet carry a
// formalized prior.

export function checkContinuityFloor({
  supporting_lenses,
  continuity_threshold,
}) {
  const n = supporting_lenses.length;
  if (n < 2) {
    return {
      passed: true,
      reason: n === 0 ? "no lenses to check" : "single lens — no continuity check needed",
      compatible_lenses: [...supporting_lenses.map((l) => l.id)],
      incompatible_pairs: [],
      mean_continuity: 1,
    };
  }

  // Blackwell-Dubins requires mutual absolute continuity: neither lens
  // can rule out what the other allows. Even a single shared candidate
  // satisfies the mathematical precondition. The default threshold is 0
  // (any overlap passes). Callers may override with a stricter threshold
  // to require a minimum overlap fraction (e.g. 0.1 = at least 10%
  // overlap). For auditing, the derived threshold is reported as 0 when
  // using the default.
  const threshold = continuity_threshold ?? 0;

  const incompatiblePairs = [];
  const pairwiseContinuity = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = supporting_lenses[i];
      const b = supporting_lenses[j];

      const supportA = a.prior_support;
      const supportB = b.prior_support;

      // Null/undefined support = unbounded (rules nothing out).
      if (!supportA || !supportB) {
        pairwiseContinuity.push({ from: a.id, to: b.id, value: 1 });
        pairwiseContinuity.push({ from: b.id, to: a.id, value: 1 });
        continue;
      }

      const intersection = [...supportA].filter((x) => supportB.has(x));
      const ratioAToB = supportB.size > 0 ? intersection.length / supportB.size : 1;
      const ratioBToA = supportA.size > 0 ? intersection.length / supportA.size : 1;

      pairwiseContinuity.push({ from: a.id, to: b.id, value: ratioAToB });
      pairwiseContinuity.push({ from: b.id, to: a.id, value: ratioBToA });

      if (ratioAToB <= threshold) {
        incompatiblePairs.push({
          lens_a: a.id,
          lens_b: b.id,
          direction: "a_to_b",
          value: ratioAToB,
          threshold,
          detail: `lens ${a.id} rules out ${Math.round((1 - ratioAToB) * 100)}% of ${b.id}'s prior support`,
        });
      }
      if (ratioBToA <= threshold) {
        incompatiblePairs.push({
          lens_a: b.id,
          lens_b: a.id,
          direction: "b_to_a",
          value: ratioBToA,
          threshold,
          detail: `lens ${b.id} rules out ${Math.round((1 - ratioBToA) * 100)}% of ${a.id}'s prior support`,
        });
      }
    }
  }

  const compatibleLenses = [...new Set(
    supporting_lenses
      .map((l) => l.id)
      .filter((id) => !incompatiblePairs.some((p) => p.lens_a === id))
  )];

  const meanContinuity = pairwiseContinuity.length
    ? pairwiseContinuity.reduce((s, p) => s + p.value, 0) / pairwiseContinuity.length
    : 1;

  const passed = incompatiblePairs.length === 0;

  let reason;
  if (passed) {
    reason = threshold === 0
      ? `all lens pairs are mutually continuous (any overlap, threshold=0, mean=${meanContinuity.toFixed(3)})`
      : `all lens pairs are mutually continuous at threshold ${threshold.toFixed(3)} (mean=${meanContinuity.toFixed(3)})`;
  } else {
    const byDetails = incompatiblePairs.map((p) => p.detail).join("; ");
    reason = `${incompatiblePairs.length} lens pairs are structurally incompatible at threshold ${threshold.toFixed(3)}: ${byDetails}`;
  }

  return {
    passed,
    reason,
    compatible_lenses: compatibleLenses,
    incompatible_pairs: incompatiblePairs,
    mean_continuity: +meanContinuity.toFixed(4),
    threshold,
    pairwise: pairwiseContinuity,
  };
}

// ── Gate 3: Zollman delay ───────────────────────────────────────────────────────
//
// Fast convergence is the danger sign: an early lucky signal dominates before
// independent lenses got their own shot. The gate requires that each
// supporting lens has accumulated at least `min_window` steps of independent
// evidence on this candidate.
//
// Observed: the minimum evidence step count across all supporting lenses.
//
// Null: draw |supporting_lenses| random samples from all_lenses' evidence
//   step counts, record the minimum each time. The observed minimum must
//   NOT be significantly lower than the null distribution's upper quantile
//   (a low minimum = fast convergence = danger). So tailDirection is "greater"
//   — the observed minimum must clear the null's lower quantile (be high
//   enough that premature convergence is ruled out).
//
// If a lens carries no evidence count, it's treated as 0 — a lens with no
// evidence cannot contribute to a paradigm, and its presence pulls the min
// down, causing the gate to fail. This is by design: a lens that happened
// to agree by chance (without evidence) should not accelerate promotion.

export function checkZollmanDelay({
  supporting_lenses,
  all_lenses,
  quantile,
  permutations = 200,
}) {
  if (!supporting_lenses.length) {
    return {
      passed: false,
      reason: "no supporting lenses — cannot check evidence window",
      min_window: 0,
      evidence_counts: {},
      null_result: null,
    };
  }

  const evidenceCounts = Object.fromEntries(
    supporting_lenses.map((l) => [l.id, l.evidence?.length ?? 0])
  );
  const observedMin = Math.min(...Object.values(evidenceCounts));

  // Build null distribution: what minimum evidence count would we see by
  // chance if evidence were assigned randomly across lenses?
  const allCounts = all_lenses.map((l) => l.evidence?.length ?? 0);
  const n = supporting_lenses.length;

  const rng = createSeededRng(
    canonicalHashSync({
      candidate_id: supporting_lenses.map((l) => l.id).join(","),
      purpose: "zollman-delay-null",
    })
  );

  const nullMins = [];
  for (let i = 0; i < permutations; i++) {
    const shuffled = seededShuffle(allCounts, rng);
    const sample = shuffled.slice(0, n);
    nullMins.push(Math.min(...sample));
  }

  const nullResult = deriveNull({
    nullSamples: nullMins,
    observedStatistic: observedMin,
    tailDirection: "greater",
    quantile,
    protocol: {
      name: "zollman-delay-minimum-evidence",
      iterations: permutations,
      statistic: "minimum evidence-step count among supporting lenses",
      scope: `${n} supporting lenses out of ${all_lenses.length} total`,
    },
  });

  const passed = nullResult.passed;

  let reason;
  if (passed) {
    reason = `minimum evidence window (${observedMin} steps) clears the Born-null threshold — lenses have accumulated enough independent evidence before converging`;
  } else {
    const failing = Object.entries(evidenceCounts)
      .filter(([, count]) => count < nullResult.threshold)
      .map(([id, count]) => `${id} (${count} steps)`)
      .join(", ");
    reason = `minimum evidence window (${observedMin} steps) does not clear the Born-null threshold (${nullResult.threshold.toFixed(1)}) — convergence may be premature. Lenses below threshold: ${failing}`;
    if (passed) {
      reason += ` — gate may admit with Zollman caveat`;
    }
  }

  return {
    passed,
    reason,
    min_window: observedMin,
    threshold: nullResult.threshold,
    evidence_counts: evidenceCounts,
    null_result: nullResult,
  };
}

// ── Combined gate: promoteParadigm ──────────────────────────────────────────────
//
// A paradigm is a corpus prior or Kind that has accumulated enough cross-lens
// support to graduate from pocket-local to widely accepted. The promotion gate
// requires ALL THREE sub-gates to pass:
//
//   1. The supporting lenses span architecturally independent families (ρ < ε)
//   2. Every pair of supporting lenses is mutually absolutely continuous
//   3. Each supporting lens has accumulated sufficient independent evidence
//
// Failure on any gate results in `admitted: false`. The gates are run in
// dependency order: continuity first (prunes the lens set), then correlation
// (measures what remains), then Zollman (checks the clock). This ordering
// means a lens pair that fails continuity doesn't wastefully contribute to
// the correlation check or the evidence window.

export function promoteParadigm({
  candidate_id,
  supporting_lenses,
  all_lenses,
  quantile,
  continuity_threshold,
  zollman_quantile,
  permutations = 200,
}) {
  if (typeof candidate_id !== "string" || !candidate_id) {
    throw new TypeError("promoteParadigm: candidate_id must be a non-empty string");
  }
  if (!Array.isArray(supporting_lenses)) {
    throw new TypeError("promoteParadigm: supporting_lenses must be an array");
  }
  if (!Array.isArray(all_lenses) || all_lenses.length === 0) {
    throw new TypeError("promoteParadigm: all_lenses must be a non-empty array");
  }

  // ── 1. Blackwell-Dubins: prune incompatible lenses ──
  const continuity = checkContinuityFloor({
    supporting_lenses,
    continuity_threshold,
  });

  // Lenses marked as structurally incompatible with others are removed
  // from the quorum before correlation and Zollman checks. They can still
  // individually endorse the paradigm, but they don't contribute to the
  // "multiple independent lenses agree" claim.
  const compatibleIds = new Set(continuity.compatible_lenses);
  const compatibleLenses = supporting_lenses.filter((l) => compatibleIds.has(l.id));
  const removedByContinuity = supporting_lenses.length - compatibleLenses.length;

  // ── 2. Correlated-error: check architectural independence ──
  const correlation = checkCorrelationGap({
    candidate_id,
    supporting_lenses: compatibleLenses,
    all_lenses,
    quantile,
    permutations,
  });

  // ── 3. Zollman: check evidence window ──
  const zollman = checkZollmanDelay({
    supporting_lenses: compatibleLenses,
    all_lenses,
    quantile: zollman_quantile ?? quantile,
    permutations,
  });

  // ── Combine ──
  const allPassed = continuity.passed && correlation.passed && zollman.passed;

  let status;
  let reason;
  const failures = [];

  if (!continuity.passed) {
    failures.push("continuity");
  }
  if (!correlation.passed) {
    failures.push("correlation");
  }
  if (!zollman.passed) {
    failures.push("zollman");
  }

  if (allPassed) {
    const familyNote = correlation.all_same_family
      ? " — single-family caveat applies"
      : "";
    status = "active";
    reason = `paradigm ${candidate_id} promoted: ${compatibleLenses.length} mutually-continuous lenses from ${correlation.replicated_families} replicated families, minimum ${zollman.min_window} evidence steps${familyNote}`;
  } else {
    status = failures.length === 3 ? "field" : "pending";
    // "field" when all three fail: the paradigm hasn't individuated out of
    // pocket-local at all. "pending" when some pass: a subset of gates
    // cleared, but promotion is premature.
    if (status === "field") {
      reason = `paradigm ${candidate_id} not promoted — all three gates failed: continuity (${continuity.passed}), correlation (${correlation.passed}), zollman (${zollman.passed})`;
    } else {
      const failuresList = failures.join(", ");
      reason = `paradigm ${candidate_id} not promoted — ${failuresList} gate(s) failed`;
    }
  }

  return deepFreeze({
    schema: "ParadigmGateResult@1",
    candidate_id,
    gate_result: Object.freeze({
      admitted: allPassed,
      status,
      reason,
    }),
    continuity: Object.freeze(continuity),
    correlation: Object.freeze(correlation),
    zollman: Object.freeze(zollman),
    // Lens accounting
    total_supporting: supporting_lenses.length,
    compatible_after_continuity: compatibleLenses.length,
    removed_by_continuity: removedByContinuity,
  });
}

// ── Convenience: bulk evaluation ────────────────────────────────────────────────
//
// Given a lens registry and a set of candidate paradigms, evaluate all of them.
// Returns a map of candidate_id -> ParadigmGateResult@1, plus a summary.

export function evaluateCandidates({
  candidates,
  all_lenses,
  quantile,
  continuity_threshold,
  zollman_quantile,
  permutations = 200,
}) {
  if (!Array.isArray(candidates)) {
    throw new TypeError("evaluateCandidates: candidates must be an array");
  }

  const results = {};
  for (const candidate of candidates) {
    const supporting = all_lenses.filter(
      (l) => l.claims?.includes?.(candidate.id ?? candidate)
    );
    const candidateId = candidate.id ?? candidate;
    results[candidateId] = promoteParadigm({
      candidate_id: candidateId,
      supporting_lenses: supporting,
      all_lenses,
      quantile,
      continuity_threshold,
      zollman_quantile,
      permutations,
    });
  }

  const admitted = Object.values(results).filter((r) => r.gate_result.admitted);
  const pending = Object.values(results).filter(
    (r) => !r.gate_result.admitted && r.gate_result.status === "pending"
  );
  const field = Object.values(results).filter(
    (r) => !r.gate_result.admitted && r.gate_result.status === "field"
  );

  return {
    results,
    summary: {
      total: Object.keys(results).length,
      admitted: admitted.length,
      pending: pending.length,
      field: field.length,
    },
  };
}

// ── Utilities ───────────────────────────────────────────────────────────────────

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export { computeFamilyDiversity };
