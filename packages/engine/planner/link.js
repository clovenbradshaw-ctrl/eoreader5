// CON: establish dependency edges between task nodes.
//
// Operator cell: CON = Relate × Structure = Binding.
// Directional edges carry provenance: every edge is validated against
// a null, frozen at creation, and permanently recorded.
//
// Edge shape = calculus.js's `{ from, to, internal }` — the exact same
// dependency graph protocol. A node many already depend on (high
// in-degree) faces a higher bar to mutate (genesis.requiredValidationQuantile).
//
// What CON does NOT do: it does NOT compute the dependency risk itself
// (that's genesis.dependentsOf), and it does NOT decide whether to ink a
// dependent node (that's genesis.inkTask). CON only proposes edges —
// the gate lives in genesis, exactly as designed.
//
// Dependencies are discovered from three natural signals:
//   1. facet-overlap — shared domain facets imply an ordering
//   2. description overlap — text similarity suggests sequential work
//   3. explicit output→input — a subgoal declares what it produces/consumes

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { deriveNull, createSeededRng, seededShuffle } from "../emergence/nulls/index.js";

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const round = (x) => Math.round(x * 1e4) / 1e4;

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

function tokenize(s) {
  if (!s) return new Set();
  return new Set(s.toLowerCase().split(/\W+/).filter(Boolean));
}

function overlapScore(a, b) {
  const sa = tokenize(a ?? "");
  const sb = tokenize(b ?? "");
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

function facetOverlap(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  return inter / new Set([...sa, ...sb]).size;
}

// ── Edge proposal: does a task logically precede another? ──────────

function edgeScore(fromTask, toTask, {
  facetWeight = 0.35,
  descWeight = 0.25,
  ioWeight = 0.40,
} = {}) {
  const facet = facetOverlap(fromTask.facets ?? [], toTask.facets ?? []);
  const desc = overlapScore(fromTask.description ?? "", toTask.description ?? "");
  let io = 0;
  const fromOut = Array.isArray(fromTask.outputs) ? fromTask.outputs : [];
  const toIn = Array.isArray(toTask.inputs) ? toTask.inputs : [];
  if (fromOut.length && toIn.length) {
    io = overlapScore(fromOut.join(" "), toIn.join(" "));
  }
  return round(facetWeight * facet + descWeight * desc + ioWeight * io);
}

// ── CON: establish dependency edges between a set of task nodes ────
//
// @param {object[]} tasks — the task nodes to link. Each: { id, description,
//   facets?, inputs?, outputs?, status? (pencil|ink) }.
// @param {object} [opts]
// @param {number} [opts.minEdgeScore=0.15] — edges below this score
//   are not proposed (pruning the complete graph to edges with signal)
// @param {number} [opts.shuffles=50] — null-perturbation iterations
// @param {number} [opts.maxEdges] — cap on total edges proposed
//
// Returns frozen edge list + null validation. Edges are directional:
// `from` → `to` means `to` depends on `from`.

export function linkTasks(tasks, opts = {}) {
  const {
    minEdgeScore = 0.15,
    shuffles = 50,
    quantile = 0.95,
    maxEdges,
  } = opts;

  if (!Array.isArray(tasks) || tasks.length < 2) {
    return Object.freeze({
      schema: "TaskDependencies@1",
      node_count: tasks?.length ?? 0,
      edges: Object.freeze([]),
      abstained: true,
      reason: "insufficient-nodes",
      evidence: null,
      emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op: "CON" },
    });
  }

  const scored = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = 0; j < tasks.length; j++) {
      if (i === j) continue;
      const score = edgeScore(tasks[i], tasks[j]);
      if (score >= minEdgeScore) {
        scored.push({ from: tasks[i].id, to: tasks[j].id, score, internal: true });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Remove cycles greedily: if adding from→to would close a cycle with
  // already-selected higher-scoring edges, skip it.
  const selected = [];
  const ancestors = new Map();
  for (const edge of scored) {
    if (maxEdges != null && selected.length >= maxEdges) break;
    if (edge.from === edge.to) continue;
    if (selected.some((e) => e.from === edge.from && e.to === edge.to)) continue;
    if (reaches(edge.to, edge.from, selected)) continue;
    selected.push(edge);
    const a = ancestors.get(edge.from) ?? new Set();
    a.add(edge.to);
    ancestors.set(edge.from, a);
  }

  if (selected.length === 0) {
    return Object.freeze({
      schema: "TaskDependencies@1",
      node_count: tasks.length,
      edges: Object.freeze([]),
      abstained: true,
      reason: "no-edges-above-threshold",
      evidence: { minEdgeScore, candidates: scored.length },
      emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op: "CON" },
    });
  }

  // Null: does the observed edge density beat what random pairing
  // (permuted task descriptions) produces?
  const observedScore = mean(selected.map((e) => e.score));
  const seed = canonicalHashSync({ taskIds: tasks.map((t) => t.id).sort(), purpose: "planner-link-null" });
  const rng = createSeededRng(seed);
  const nullSamples = [];

  const taskCopies = tasks.map((t) => ({ ...t }));
  for (let s = 0; s < shuffles; s++) {
    const permuted = seededShuffle(taskCopies, rng).map((t, idx) => ({ ...t, description: taskCopies[idx].description }));
    const pmScored = [];
    for (let i = 0; i < permuted.length; i++) {
      for (let j = 0; j < permuted.length; j++) {
        if (i === j) continue;
        const sc = edgeScore(permuted[i], permuted[j]);
        if (sc >= minEdgeScore) pmScored.push(sc);
      }
    }
    nullSamples.push(pmScored.length > 0 ? mean(pmScored) : 0);
  }

  const nullResult = deriveNull({
    nullSamples,
    observedStatistic: observedScore,
    tailDirection: "greater",
    quantile,
    protocol: { name: "planner-link-vs-random-permutation", shuffles },
  });

  const edges = selected.map(({ from, to, score }) =>
    Object.freeze({ from, to, score, internal: true }));

  const content_hash = canonicalHashSync({
    node_count: tasks.length,
    edges: edges.map((e) => ({ from: e.from, to: e.to })),
  });

  return Object.freeze({
    schema: "TaskDependencies@1",
    node_count: tasks.length,
    edges: Object.freeze(edges),
    abstained: nullResult && !nullResult.passed,
    reason: nullResult && !nullResult.passed ? "no-structure-beyond-random" : null,
    evidence: {
      candidates: scored.length,
      selected: selected.length,
      meanScore: round(observedScore),
      nullResult,
    },
    content_hash,
    emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op: "CON" },
  });
}

// ── Cycle detection (greedy, no allocation heavy) ─────────────────

function reaches(from, target, edges) {
  const visited = new Set();
  const stack = [from];
  while (stack.length) {
    const node = stack.pop();
    if (node === target) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const e of edges) {
      if (e.from === node) stack.push(e.to);
    }
  }
  return false;
}

// ── Compute dependents of each node from an edge list ───────────────
//
// Mirrors genesis.dependentsOf but operates over the planner's edge
// shape. Returns Map<nodeId, count>.

export function computeDependents(edges) {
  const counts = new Map();
  for (const e of edges ?? []) {
    counts.set(e.to, (counts.get(e.to) ?? 0) + 1);
  }
  return counts;
}

// ── Topological layers: which tasks can run in parallel? ────────────
//
// Returns an array of layers. Tasks in layer[0] have no uncompleted
// dependencies; layer[1] depends only on layer[0]; etc.

export function topologicalLayers(tasks, edges, { completedIds } = {}) {
  const done = new Set(completedIds ?? []);
  const inDegree = new Map();
  const outEdges = new Map();

  for (const t of tasks ?? []) { inDegree.set(t.id, 0); outEdges.set(t.id, []); }
  for (const e of edges ?? []) {
    if (done.has(e.from)) continue;
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    (outEdges.get(e.from) ?? []).push(e.to);
  }

  const layers = [];
  let frontier = [...inDegree.entries()].filter(([id, d]) => d === 0 && !done.has(id)).map(([id]) => id);

  while (frontier.length) {
    layers.push([...frontier]);
    const next = [];
    for (const id of frontier) {
      for (const succ of outEdges.get(id) ?? []) {
        const d = (inDegree.get(succ) ?? 1) - 1;
        inDegree.set(succ, d);
        if (d === 0) next.push(succ);
      }
    }
    frontier = next;
  }

  return layers;
}
