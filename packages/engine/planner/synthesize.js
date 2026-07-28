// SYN: compose subtask answers → coherent final response.
//
// Operator cell: SYN = Generate × Structure = Making.
// The composite IS a new structure — not just a concatenation of parts
// but a synthesis that can be independently validated, cited, and
// re-entered into the planning loop (REC) if evaluation finds it
// insufficient.
//
// Each synthesis step is gated: does the composite add something that
// a trivial concatenation or random grouping would not? The null is a
// shuffled grouping of the same partial results — if the real composite
// compresses the parts no better than random, SYN abstains.
//
// The dependency graph (from link.js) orders composition: results
// from layer N cannot be composed until all layer N-1 results feeding
// into them are themselves composed.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { deriveNull, createSeededRng, seededShuffle } from "../emergence/nulls/index.js";

const round = (x) => Math.round(x * 1e4) / 1e4;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

function tokenize(s) {
  if (!s) return new Set();
  return new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
}

// ── Part-to-composite gain: how much does a partial result compress
// toward the goal description? ─────────────────────────────────────

function coverageScore(partResult, goalDescription) {
  if (!partResult || !goalDescription) return 0;
  const pTokens = tokenize(String(partResult));
  const gTokens = tokenize(goalDescription);
  const inter = [...pTokens].filter((t) => gTokens.has(t)).length;
  return gTokens.size === 0 ? 0 : inter / gTokens.size;
}

// ── Redundancy: two partial results covering the same ground ──────

function redundancyScore(a, b) {
  if (!a || !b) return 0;
  const ta = tokenize(String(a));
  const tb = tokenize(String(b));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : inter / union;
}

// ── Novel contribution: what does this result add beyond already-composed? ──

function novelGain(partResult, composedSoFar) {
  if (!partResult) return 0;
  const pt = tokenize(String(partResult));
  const ct = tokenize(String(composedSoFar ?? ""));
  const novel = [...pt].filter((t) => !ct.has(t)).length;
  return pt.size === 0 ? 0 : novel / pt.size;
}

// ── SYN: synthesize partial results into a composite ───────────────
//
// @param {object} params
// @param {string} params.goalDescription — the original goal
// @param {object[]} params.taskResults — the inked task results to
//   compose. Each: { task_id, result (string|object), score? }.
// @param {object[]} [params.edges] — dependency edges (from link.js)
//   used for topological ordering of composition.
// @param {object} [opts]
// @param {number} [opts.minNovelGain=0.05] — results with less novel
//   contribution than this are included but marked redundant
// @param {number} [opts.shuffles=50] — null-perturbation iterations
// @param {number} [opts.quantile=0.95]
//
// Returns a frozen synthesis object with the composite result,
// provenance citations, and null validation.

export function synthesize(taskResults, opts = {}) {
  const {
    goalDescription = "",
    edges = [],
    minNovelGain = 0.05,
    shuffles = 50,
    quantile = 0.95,
  } = opts;

  if (!Array.isArray(taskResults) || taskResults.length === 0) {
    return Object.freeze({
      schema: "TaskSynthesis@1",
      composite: null,
      abstained: true,
      reason: "no-task-results",
      evidence: null,
      emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op: "SYN" },
    });
  }

  const valid = taskResults.filter((r) => r && r.result != null);
  if (valid.length === 0) {
    return Object.freeze({
      schema: "TaskSynthesis@1",
      composite: null,
      abstained: true,
      reason: "no-valid-results",
      evidence: { total: taskResults.length },
      emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op: "SYN" },
    });
  }

  // Score each result: coverage toward goal + novelty relative to others.
  const scored = valid.map((r) => ({
    ...r,
    coverage: round(coverageScore(r.result, goalDescription)),
  }));

  // Topological order if edges are provided: build a simple ordering
  // from the dependency graph.
  let ordered = [...scored];
  if (edges.length > 0) {
    const inDegree = new Map();
    ordered.forEach((r) => inDegree.set(r.task_id, 0));
    const outMap = new Map();
    ordered.forEach((r) => outMap.set(r.task_id, []));
    for (const e of edges) {
      if (inDegree.has(e.to) && outMap.has(e.from)) {
        inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
        (outMap.get(e.from) ?? []).push(e.to);
      }
    }
    const sorted = [];
    let frontier = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    while (frontier.length > 0) {
      for (const id of frontier) {
        const r = ordered.find((r) => r.task_id === id);
        if (r) sorted.push(r);
      }
      const next = [];
      for (const id of frontier) {
        for (const succ of outMap.get(id) ?? []) {
          const d = (inDegree.get(succ) ?? 1) - 1;
          inDegree.set(succ, d);
          if (d === 0) next.push(succ);
        }
      }
      frontier = next;
    }
    // Append any remaining not in graph.
    for (const r of ordered) {
      if (!sorted.some((s) => s.task_id === r.task_id)) sorted.push(r);
    }
    ordered = sorted;
  } else {
    // Fallback: order by coverage descending (highest coverage first).
    ordered.sort((a, b) => b.coverage - a.coverage);
  }

  // Build the composite incrementally, tracking novel contribution.
  const parts = [];
  let composedText = "";
  let totalCoverage = 0;
  const citedTaskIds = [];

  for (const r of ordered) {
    const novel = novelGain(r.result, composedText);
    const resultStr = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
    const contribution = novel >= minNovelGain ? resultStr : null;
    let partText = "";
    if (contribution) {
      partText = (composedText ? "\n\n" : "") + contribution;
      composedText += partText;
      totalCoverage += r.coverage;
    }
    parts.push({
      task_id: r.task_id,
      contributed: contribution !== null,
      novel_gain: round(novel),
      coverage: r.coverage,
      redundant: novel < minNovelGain,
    });
    citedTaskIds.push(r.task_id);
  }

  if (!composedText) {
    return Object.freeze({
      schema: "TaskSynthesis@1",
      composite: null,
      abstained: true,
      reason: "no-novel-contribution",
      evidence: { parts },
      emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op: "SYN" },
    });
  }

  // Null: does the observed composite compress the parts (shorter
  // length per unit of unique tokens covered) better than random
  // ordering of the same task results?
  const observedCompression = composedText.length / Math.max(1, new Set(tokenize(composedText)).size);
  const seed = canonicalHashSync({ taskIds: citedTaskIds.sort(), goalDescription, purpose: "planner-synthesize-null" });
  const rng = createSeededRng(seed);
  const nullSamples = [];

  for (let s = 0; s < shuffles; s++) {
    const permuted = seededShuffle([...valid], rng);
    let nullText = "";
    for (const r of permuted) {
      const nr = novelGain(r.result, nullText);
      if (nr >= minNovelGain) {
        nullText += (nullText ? "\n\n" : "") + (typeof r.result === "string" ? r.result : JSON.stringify(r.result));
      }
    }
    const nullComp = nullText.length / Math.max(1, new Set(tokenize(nullText)).size);
    nullSamples.push(nullComp);
  }

  const nullResult = deriveNull({
    nullSamples,
    observedStatistic: observedCompression,
    tailDirection: "less",
    quantile,
    protocol: { name: "planner-synthesize-compression-vs-random-ordering", shuffles },
  });

  const body = {
    goal_description: goalDescription,
    composite: composedText,
    cited_task_ids: Object.freeze([...citedTaskIds]),
    parts: Object.freeze(parts),
    coverage: round(totalCoverage),
    compression_ratio: round(observedCompression),
  };

  const content_hash = canonicalHashSync(body);

  return Object.freeze({
    ...body,
    schema: "TaskSynthesis@1",
    abstained: nullResult && !nullResult.passed,
    reason: nullResult && !nullResult.passed ? "compression-indistinguishable-from-random" : null,
    evidence: {
      partCount: parts.length,
      contributedCount: parts.filter((p) => p.contributed).length,
      nullResult,
    },
    content_hash,
    emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op: "SYN" },
  });
}

// ── SYN: compose results for a single tree node (the upward pass) ──
//
// In the planner loop, the upward pass takes the children of a node
// that have been inked and composes them into the parent's result.
// Returns a synthesis object suitable for attaching to the parent node.

export function composeChildren(parentNode, childResults, opts = {}) {
  if (!parentNode || !parentNode.description) {
    throw new TypeError("planner/synthesize: composeChildren requires a parent node with description");
  }
  return synthesize(childResults, {
    goalDescription: parentNode.description,
    edges: opts.edges ?? [],
    minNovelGain: opts.minNovelGain ?? 0.05,
    shuffles: opts.shuffles ?? 50,
    quantile: opts.quantile ?? 0.95,
  });
}
