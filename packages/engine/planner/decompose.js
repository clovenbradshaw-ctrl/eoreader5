// SEG: split goal into subgoals — segmentation over domain space.
//
// Same physics as discourse topic stack collapse: find natural fault
// lines in a continuous domain rather than naming arbitrary partitions.
// The goal domain is a flat list of facets (requirements, constraints,
// concerns) and SEG discovers where the domain breaks into subdomains.
//
// Operator cell: SEG = Differentiate × Structure = Dissecting.
// The floor is always the domain's own gap structure — no hand-set
// k, no "split into 3 things." DEF finds how many groups the sorted
// pairwise-distance spectrum actually holds, or abstains.
//
// A decomposition that finds no real structure (flat spectrum) returns
// an empty subgoal list and abstains — "this goal is atomic given the
// evidence" is the correct answer, not a forced split.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { DEF } from "../emergence/nulls/extreme-value.js";
import { deriveNull, createSeededRng, seededShuffle } from "../emergence/nulls/index.js";

const round = (x) => Math.round(x * 1e4) / 1e4;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

function jaccardIndex(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  const intersection = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : intersection / union;
}

function overlapScore(a, b) {
  if (typeof a === "string" && typeof b === "string") {
    const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
    const wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
    return jaccardIndex(wa, wb);
  }
  if (Array.isArray(a) && Array.isArray(b)) return jaccardIndex(a, b);
  return 0;
}

// ── Paired-domain distance: how far apart two facets sit in the goal
// domain. This is the raw metric SEG operates over — low distance means
// the facets belong to the same subdomain, high distance means they're
// on opposite sides of a natural fault line.

function facetDistance(fa, fb, { detailWeight = 0.5, keywordWeight = 0.5 } = {}) {
  const descSim = overlapScore(fa.description ?? "", fb.description ?? "");
  const tagSim = overlapScore(fa.tags ?? [], fb.tags ?? []);
  const detail = fa.detail_level === fb.detail_level ? 1 : 0;
  const sim = keywordWeight * descSim + (1 - keywordWeight - detailWeight) * tagSim + detailWeight * detail;
  return 1 - sim;
}

// ── Domain adjacency matrix: every facet against every other ────────

function adjacencyMatrix(facets, distanceFn) {
  const n = facets.length;
  if (n < 2) return { facets, distances: [] };
  const distances = new Array((n * (n - 1)) / 2);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      distances[idx++] = 1 - distanceFn(facets[i], facets[j]);
    }
  }
  return { facets, distances };
}

// ── Sibling-to-all distance: the natural clustering signal ──────────
//
// For each facet, compute its mean affinity to every other facet
// (the sibling signal). Sorted descending, this is the spectrum DEF
// reads to find the real number of clusters. A facet that's close to
// many others will cluster with them; a facet that's distant from
// everything is its own separate concern.

function siblingAffinitySpectrum(matrix) {
  const n = matrix.facets.length;
  if (n < 2) return [];
  const affinities = [];
  for (let i = 0; i < n; i++) {
    let sum = 0, count = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const di = Math.min(i, j);
      const dj = Math.max(i, j);
      const idx = di * (n - 1) - (di * (di - 1)) / 2 + (dj - di - 1);
      sum += matrix.distances[idx];
      count++;
    }
    affinities.push({ facetIdx: i, score: count > 0 ? sum / count : 0 });
  }
  return affinities.sort((a, b) => b.score - a.score);
}

// ── Group facets into clusters from the affinity spectrum ──────────

function clusterByAffinity(matrix, k) {
  const n = matrix.facets.length;
  if (k <= 1 || n <= k) {
    return [{ facets: matrix.facets.map((_, i) => i), cohesion: 1 }];
  }
  const spectrum = siblingAffinitySpectrum(matrix);
  const seeds = spectrum.slice(0, k).map((s) => s.facetIdx);
  const kClusters = seeds.map(() => []);
  const seen = new Set();
  for (const seed of seeds) { kClusters[seeds.indexOf(seed)].push(seed); seen.add(seed); }
  for (let i = 0; i < n; i++) {
    if (seen.has(i)) continue;
    let bestSeed = 0, bestSim = -1;
    for (let s = 0; s < seeds.length; s++) {
      const si = Math.min(i, seeds[s]);
      const sj = Math.max(i, seeds[s]);
      const idx = si * (n - 1) - (si * (si - 1)) / 2 + (sj - si - 1);
      if (matrix.distances[idx] > bestSim) { bestSim = matrix.distances[idx]; bestSeed = s; }
    }
    kClusters[bestSeed].push(i);
    seen.add(i);
  }
  return kClusters.map((cluster) => ({
    facets: cluster.sort((a, b) => a - b),
    cohesion: cluster.length > 1
      ? mean(cluster.flatMap((i) => cluster.filter((j) => j > i).map((j) => {
          const di = Math.min(i, j), dj = Math.max(i, j);
          return matrix.distances[di * (n - 1) - (di * (di - 1)) / 2 + (dj - di - 1)];
        })))
      : 1,
  }));
}

// ── Null: does the found clustering structure beat random grouping? ──

function clusteringNull(matrix, foundClusters, { shuffles = 50, quantile = 0.95 } = {}) {
  const n = matrix.facets.length;
  if (n < 4 || foundClusters.length <= 1) return null;

  const observedCohesion = mean(foundClusters.map((c) => c.cohesion));
  const seed = canonicalHashSync({ facets: matrix.facets.map((f) => f.description ?? ""), purpose: "planner-decompose-null" });
  const rng = createSeededRng(seed);
  const nullSamples = [];

  for (let s = 0; s < shuffles; s++) {
    const shuffledIndices = seededShuffle(matrix.facets.map((_, i) => i), rng);
    const fakeMatrix = { facets: matrix.facets, distances: [] };
    const distIdx = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const si = Math.min(shuffledIndices[i], shuffledIndices[j]);
        const sj = Math.max(shuffledIndices[i], shuffledIndices[j]);
        distIdx.push(si * (n - 1) - (si * (si - 1)) / 2 + (sj - si - 1));
      }
    }
    fakeMatrix.distances = distIdx.map((idx) => matrix.distances[idx]);
    const fakeClusters = clusterByAffinity(fakeMatrix, foundClusters.length);
    nullSamples.push(mean(fakeClusters.map((c) => c.cohesion)));
  }

  return deriveNull({
    nullSamples,
    observedStatistic: observedCohesion,
    tailDirection: "greater",
    quantile,
    protocol: { name: "planner-decompose-clustering-vs-random-permutation", shuffles },
  });
}

// ── SEG: decomposeGoal ─────────────────────────────────────────────
//
// Takes a goal structure and returns scored subgoal candidates, each
// backed by a natural fault line the domain itself produced. The return
// is a spectrum ready for genesis.collapseCandidates to gate.
//
// @param {object} goal
// @param {string} goal.description — the overarching aim
// @param {object[]} [goal.facets] — the domain facets (requirements,
//   constraints, concerns). Each facet: { description, tags?, detail_level? }.
// @param {object} [opts]
// @param {number} [opts.maxSubgoals=8] — upper bound on how many
//   subgoals SEG will attempt to find (DEF may still say fewer)
// @param {number} [opts.minFacets=2] — goals with fewer facets than
//   this are declared atomic (SEG abstains)
// @param {number} [opts.shuffles=50] — null-perturbation iterations

export function decomposeGoal(goal, opts = {}) {
  const {
    maxSubgoals = 8,
    minFacets = 2,
    shuffles = 50,
    quantile = 0.95,
  } = opts;

  if (!goal || typeof goal.description !== "string" || !goal.description) {
    throw new TypeError("planner/decompose: goal requires a non-empty description");
  }

  const facets = Array.isArray(goal.facets) ? goal.facets : [];

  const baseBody = {
    schema: "GoalDecomposition@1",
    goal_id: stableId("goal", { description: goal.description }),
    goal_description: goal.description,
    emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, op: "SEG" },
  };

  if (facets.length < minFacets) {
    return Object.freeze({
      ...baseBody,
      subgoals: Object.freeze([]),
      abstained: true,
      reason: "atomic-goal",
      evidence: { facets: facets.length, minFacets },
      content_hash: canonicalHashSync({ ...baseBody, reason: "atomic-goal" }),
    });
  }

  const matrix = adjacencyMatrix(facets, facetDistance);
  if (matrix.distances.length < 2) {
    return Object.freeze({
      ...baseBody,
      subgoals: Object.freeze([]),
      abstained: true,
      reason: "insufficient-distances",
      evidence: { facets: facets.length, distances: matrix.distances.length },
      content_hash: canonicalHashSync({ ...baseBody, reason: "insufficient-distances" }),
    });
  }

  const affinities = siblingAffinitySpectrum(matrix);
  const affinityScores = affinities.map((a) => a.score);
  const def = DEF(affinityScores, { alpha: 0.05, maxK: Math.min(maxSubgoals, facets.length - 1), window: facets.length });
  const k = def.abstain ? 1 : def.k;

  const clusters = clusterByAffinity(matrix, k);
  const nullResult = clusteringNull(matrix, clusters, { shuffles, quantile });

  if (nullResult && !nullResult.passed) {
    return Object.freeze({
      ...baseBody,
      subgoals: Object.freeze([]),
      abstained: true,
      reason: "no-structure-beyond-random",
      evidence: { facets: facets.length, k, nullResult },
      content_hash: canonicalHashSync({ ...baseBody, reason: "no-structure-beyond-random", k }),
    });
  }

  if (k <= 1 || clusters.every((c) => c.facets.length <= 1 && facets.length > 1)) {
    return Object.freeze({
      ...baseBody,
      subgoals: Object.freeze([]),
      abstained: true,
      reason: "flat-spectrum",
      evidence: { facets: facets.length, k, def },
      content_hash: canonicalHashSync({ ...baseBody, reason: "flat-spectrum", k }),
    });
  }

  const subgoals = clusters.map((cluster, i) => {
    const clusterFacets = cluster.facets.map((fi) => facets[fi]);
    const descriptions = clusterFacets.map((f) => f.description ?? "").filter(Boolean);
    const summary = descriptions.length > 0
      ? clusterFacets.map((f) => f.description ?? "").join("; ")
      : `subgoal-${i + 1}`;
    return {
      id: stableId("subgoal", { goal_id: goal.description, cluster: i, facets: cluster.facets }),
      description: `${goal.description} — ${summary}`,
      facets: cluster.facets,
      score: round(cluster.cohesion),
      cohesion: round(cluster.cohesion),
      parent_goal_id: stableId("goal", { description: goal.description }),
    };
  }).sort((a, b) => b.score - a.score);

  const content_hash = canonicalHashSync({ goal_description: goal.description, subgoals: subgoals.map((s) => s.id) });

  return Object.freeze({
    ...baseBody,
    subgoals: Object.freeze(subgoals),
    abstained: false,
    reason: null,
    evidence: { facets: facets.length, k, def, nullResult, cohesion: round(mean(clusters.map((c) => c.cohesion))) },
    content_hash,
  });
}

// ── SEG: decompose an already-penciled subgoal recursively ──────────
//
// Same physics but takes a task node (from the plan tree) whose .facets
// carry the remaining unallocated domain — the recursive decomposition
// step in the planner loop.

export function decomposeNode(node, parentGoal, opts = {}) {
  if (!node || !node.description) {
    throw new TypeError("planner/decompose: decomposeNode requires a node with description");
  }
  const facets = (Array.isArray(node.facets) ? node.facets : []).map((fi) => {
    const facet = parentGoal?.facets?.[fi];
    return facet ?? { description: node.description, tags: node.tags ?? [] };
  });
  return decomposeGoal({ description: node.description, facets, ...(parentGoal ? { parent_goal_id: parentGoal.goal_id } : {}) }, opts);
}
