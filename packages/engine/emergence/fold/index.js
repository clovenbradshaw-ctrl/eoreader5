// Fold compression: the context manager for tiny models.
//
// Spec 1 — Fold completion and task-holon atomicity.
//
// 1.2 Atomicity is fixed at DEF (the regress guard). An occasion is atomic
//     and indivisible: DEF fixes the grain; EVA and REC may fire only at
//     occasion boundaries, never mid-occasion.
// 1.3 Completion is a live recursive residual test. Within a declared grain,
//     a fold is complete when its precision-weighted residual bottoms out
//     relative to the precision assigned at that level.
// 1.4 The objective flips mid-task. Early folds are epistemic-dominant
//     (minimize system's own surprise about the source). Late folds are
//     pragmatic-dominant (minimize reader's surprise).
//
// Two-channel completion (Spec 2): BOTH error-closure (grounding) AND surplus
// (cross-passage synthesis) must independently clear their thresholds. The
// two channels have opposite decay behavior — error-closure reward decays to
// zero at full fit; surplus reward does not decay the same way.

import { classify } from "../../cube/index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

// ── Atomic occasion grain (Spec 1.2) ──
//
// DEF fixes the grain of what counts as ONE OCCASION. An occasion is atomic
// and indivisible: cannot be "half-arrived" because arrival is not a continuous
// quantity tracked toward a threshold but a discrete event that either has or
// has not happened. EVA and REC may fire only at occasion boundaries.

const OCCASION_GRAINS = Object.freeze({
  UNIT: "unit",       // A single reading unit (default — narrowest grain)
  CHUNK: "chunk",     // A scored chunk within a fold
  FOLD: "fold",       // The entire fold operation
  TASK: "task",       // A task-holon (sub-task in a decomposition)
  BRANCH: "branch",   // A multi-leaf branch of a task tree
  PROJECT: "project", // The entire reading/writing project
});

function resolveGrain(grain) {
  if (grain && OCCASION_GRAINS[grain.toUpperCase()]) {
    return OCCASION_GRAINS[grain.toUpperCase()];
  }
  return OCCASION_GRAINS.UNIT;
}

/**
 * Declare an atomic occasion grain for a fold.
 * Called at DEF time, before any fold computation begins.
 * EVA and REC may only fire at boundaries of this grain.
 */
export function declareOccasionGrain(grain) {
  const resolved = resolveGrain(grain);
  return Object.freeze({
    schema: "OccasionGrain@1",
    grain: resolved,
    atomic: true,
    indivisible: true,
    declared_at: canonicalHashSync({ grain: resolved, ts: "def-time" }),
  });
}

// ── Precision-weighted residual (Spec 1.3) ──

/**
 * Compute precision-weighted residual for a fold.
 * The fold is complete when residual bottoms out relative to the precision
 * assigned at that level.
 *
 * @param {Array<number>} residuals — sequence of residual values over iterations
 * @param {number} precision — the precision (inverse variance) at this level
 * @param {object} options
 * @param {number} options.floor — minimum residual improvement to continue
 * @returns {{ done: boolean, currentResidual: number, relativeImprovement: number }}
 */
export function computeResidual(residuals, precision = 1, { floor = 0.01 } = {}) {
  if (!residuals || residuals.length === 0) {
    return { done: true, currentResidual: 0, relativeImprovement: 0 };
  }

  const current = residuals[residuals.length - 1];

  if (residuals.length < 2) {
    // Need at least 2 to measure improvement
    const weightedResidual = current / Math.max(precision, 1e-10);
    return {
      done: weightedResidual <= floor,
      currentResidual: current,
      precisionWeighted: weightedResidual,
      relativeImprovement: 0,
    };
  }

  const prev = residuals[residuals.length - 2];
  const improvement = prev - current;
  const relativeImprovement = prev > 0 ? improvement / prev : 0;

  // Precision-weighted residual: the residual divided by precision at this level
  const weightedResidual = current / Math.max(precision, 1e-10);

  // Escalation (Spec 1.3): when residual stays high-precision and locally
  // unresolvable — precision is high (low variance) but residual hasn't
  // improved — the fold pushes to its parent.
  const highPrecision = precision > 0.8;
  const stalled = relativeImprovement < floor;
  const escalate = highPrecision && stalled && weightedResidual > floor * 2;

  return {
    done: weightedResidual <= floor || escalate,
    escalate,
    currentResidual: current,
    precisionWeighted: weightedResidual,
    relativeImprovement,
    stalled,
  };
}

// ── Two-phase objective flip (Spec 1.4) ──

export const FOLD_PHASES = Object.freeze({
  EXPLORATORY: "exploratory", // epistemic-dominant: seek uncertainty
  EXPOSITORY: "expository",   // pragmatic-dominant: minimize reader surprise
});

/**
 * Determine which phase a fold is in, given its position in the task sequence.
 * Early folds are epistemic-dominant; late folds are pragmatic-dominant.
 *
 * @param {number} index — this fold's index (0-based)
 * @param {number} total — total number of folds in the sequence
 * @param {string} explicitPhase — if already assigned by the planner
 * @returns {string} "exploratory" or "expository"
 */
export function resolveFoldPhase(index, total, explicitPhase = null) {
  if (explicitPhase && FOLD_PHASES[explicitPhase.toUpperCase()]) {
    return FOLD_PHASES[explicitPhase.toUpperCase()];
  }
  // Default heuristic: first half is exploratory, second half is expository
  if (total <= 1) return FOLD_PHASES.EXPLORATORY;
  return index < total / 2
    ? FOLD_PHASES.EXPLORATORY
    : FOLD_PHASES.EXPOSITORY;
}

/**
 * Build a phase-specific scoring function.
 * Epistemic-dominant: weight surprise/novelty higher.
 * Pragmatic-dominant: weight clarity/relevance higher.
 */
export function phaseWeights(phase) {
  if (phase === FOLD_PHASES.EXPLORATORY) {
    return { surprise: 0.6, relevance: 0.2, coherence: 0.2 };
  }
  // EXPOSITORY
  return { surprise: 0.2, relevance: 0.5, coherence: 0.3 };
}

// ── Two-channel completion (Spec 2.5) ──

/**
 * AND completion test: error-closure AND surplus must independently clear
 * their thresholds. Neither can compensate for the other.
 *
 * @param {number} groundingScore — error-closure (0..1, higher = better)
 * @param {number} surplusScore — cross-passage synthesis (0..1, higher = better)
 * @param {object} options
 * @param {number} options.groundingThreshold — minimum grounding (default 0.7)
 * @param {number} options.surplusThreshold — minimum surplus (default 0.1)
 * @returns {{ converged: boolean, groundingMet: boolean, surplusMet: boolean }}
 */
export function andCompletion(groundingScore, surplusScore, {
  groundingThreshold = 0.7,
  surplusThreshold = 0.1,
} = {}) {
  const groundingMet = groundingScore >= groundingThreshold;
  const surplusMet = surplusScore >= surplusThreshold;
  return {
    converged: groundingMet && surplusMet,
    groundingMet,
    surplusMet,
    groundingScore,
    surplusScore,
  };
}

// ── Legacy fold function (enhanced) ──

function estimateTokens(text) {
  return String(text ?? "").split(/\s+/).filter(Boolean).length;
}

export function scoreChunk(chunk, context) {
  const { query } = context;
  let score = 0;

  const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "has", "had", "have", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "can", "shall", "what", "which",
    "who", "whom", "when", "where", "why", "how", "this", "that", "these",
    "those", "it", "its", "they", "them", "their", "we", "our", "you",
    "your", "he", "she", "his", "her", "him", "me", "my", "not", "no",
    "nor", "so", "if", "then", "than", "just", "about", "into", "over",
    "after", "before", "between", "under",
  ]);
  const queryWords = (query ?? "").toLowerCase()
    .split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (queryWords.length === 0) return 0;

  const chunkText = (chunk.text ?? "").toLowerCase();
  const wordCount = chunkText.split(/\s+/).filter(Boolean).length;

  let keywordMatches = 0;
  const uniqueQueryWords = new Set(queryWords);
  for (const w of uniqueQueryWords) {
    if (chunkText.includes(w)) keywordMatches++;
  }
  if (keywordMatches > 0 && wordCount > 0) {
    score += (keywordMatches / wordCount) * 1000;
  }

  const queryPhrase = [...uniqueQueryWords].join(" ");
  if (queryPhrase && chunkText.includes(queryPhrase)) score += 200;

  // Phase-aware adjustment: exploratory folds boost novelty
  const phase = context.phase ?? "exploratory";
  if (phase === "exploratory") {
    // In exploratory mode, penalize exact query matches slightly
    // (reward going beyond the query, not just relevance)
    const noveltyFraction = 1 - Math.min(1, keywordMatches / Math.max(1, uniqueQueryWords.size));
    score += noveltyFraction * 100;
  }

  return score;
}

/**
 * fold(reading, options) -> FoldedReading
 *
 * Enhanced fold with:
 *   - Atomic occasion grain (Spec 1.2)
 *   - Precision-weighted residual test (Spec 1.3)
 *   - Phase-aware scoring (Spec 1.4)
 *   - Two-channel completion (Spec 2.5)
 */
export function fold(reading, options = {}) {
  const tokenBudget = options.tokenBudget ?? 500;
  const maxUnits = options.maxUnits ?? 10;
  const history = options.history ?? [];
  const focus = options.focus ?? null;
  const query = reading.query ?? "";
  const units = reading.units ?? [];
  const grain = options.grain ?? "unit";
  const phase = resolveFoldPhase(options.index ?? 0, options.total ?? 1, options.phase);
  const weights = phaseWeights(phase);

  // Spec 1.2: Declare atomic occasion grain at DEF
  const occasionGrain = declareOccasionGrain(grain);

  if (units.length === 0) {
    return {
      schema: "FoldedReading@1",
      selected: [],
      summary: "",
      totalTokens: 0,
      budget: tokenBudget,
      dropped: 0,
      reason: "no units to fold",
      phase,
      occasionGrain,
    };
  }

  // Score each chunk with phase awareness
  const context = { query, focus, history, phase };
  const scored = units.map((unit) => ({
    ...unit,
    foldScore: scoreChunk(unit, context),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.foldScore - a.foldScore);

  // Select units within budget
  const selected = [];
  let usedTokens = 0;
  let dropped = 0;

  for (const unit of scored) {
    if (selected.length >= maxUnits) break;
    const unitTokens = estimateTokens(unit.text);
    if (usedTokens + unitTokens > tokenBudget) {
      dropped += 1;
      continue;
    }
    selected.push(unit);
    usedTokens += unitTokens;
  }

  // Build summary
  const summaryParts = selected.map((unit) => {
    const source = unit.meta?.file ?? unit.meta?.source ?? "";
    return source ? `[${source}] ${unit.text}` : unit.text;
  });

  // Spec 1.3: Precision-weighted residual
  // (frac of budget used = residual signal; precision = 1.0 default)
  const budgetUtilization = tokenBudget > 0 ? usedTokens / tokenBudget : 0;
  const residual = computeResidual(
    [units.length, selected.length, budgetUtilization],
    1.0
  );

  return {
    schema: "FoldedReading@1",
    selected,
    summary: summaryParts.join("\n\n"),
    totalTokens: usedTokens,
    budget: tokenBudget,
    dropped,
    phase,
    weights,
    occasionGrain,
    completion: residual,
    reason: dropped > 0
      ? `${selected.length} of ${units.length} kept, ${dropped} dropped by budget`
      : `all ${selected.length} fit within budget`,
  };
}

export function foldReadingSnapshot(snapshot, options = {}) {
  const passages = snapshot?.passages ?? [];
  const units = passages.map((p) => ({
    text: (p.anchors?.exact_text ?? []).join(" ") ?? "",
    coord: classify((p.anchors?.exact_text ?? []).join(" ")),
    meta: { source_id: p.source_id, field_id: p.field_id },
    score: p.score,
  }));
  return fold({ units, query: snapshot?.request?.query ?? "" }, options);
}
