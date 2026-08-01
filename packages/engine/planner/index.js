// Planner: assemble plan tree from goal + collapsed candidates.
//
// The planner organ sits between genesis (which gates) and steering
// (which knows where we are). It drives a multi-operator loop:
//
//   SEG — decompose current focus into subgoals
//   DEF — collapse candidate spectrum → pencil
//   CON — link dependency edges between nodes
//   EVA — validate pencil → ink or hold
//   SYN — compose inked results upward
//   REC — replan from held results
//
// Every node in the plan tree is content-hashed, gated by genesis's
// pencil/ink lifecycle, and permanently recorded. The steering layer
// tracks which layer/capacity we're in; the planner is a structural-
// layer sequence in that state machine.
//
// The plan tree IS the new structure (SYN·Figure = Making). But
// planning is inherently multi-operator: you can't plan without
// decomposing (SEG), linking (CON), checking (EVA), and revising (REC).
//
// Concurrency model: genesis's completionDiagnostic already
// distinguishes "done" from "lost in noise." The planner loops over it,
// feeding candidates to genesis for gating.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import {
  collapseCandidates,
  pencilTask,
  inkTask,
  dependentsOf,
  requiredValidationQuantile,
  completionDiagnostic,
} from "../emergence/genesis/index.js";
import { decomposeGoal, decomposeNode } from "./decompose.js";
import { linkTasks, computeDependents, topologicalLayers } from "./link.js";
import { synthesize, composeChildren } from "./synthesize.js";

const round = (x) => Math.round(x * 1e4) / 1e4;

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

// ── Plan tree node shape ────────────────────────────────────────────
//
// A node in the plan tree holds its genesis task (pencil/ink), its
// decomposition (children), its synthesis (composed child results), and
// its dependency edges (both to siblings and to parent).

const NODE_STATUS = Object.freeze(["pending", "penciled", "inked", "held", "composed"]);

function createNode(description, { parentId = null, depth = 0, facets = [], nodeOpts = {} } = {}) {
  const nodeId = nodeOpts.id ?? stableId("plan-node", { description, parentId, depth });
  return {
    id: nodeId,
    description,
    parent_id: parentId,
    children: Object.freeze([]),
    facets: Object.freeze([...facets]),
    status: "pending",
    depth,
    task: null,
    result: null,
    synthesis: null,
    dependencies: Object.freeze([]),
    coverage: 0,
    emergence: Object.freeze({ operator_epoch: CURRENT_OPERATOR_EPOCH, op: "SYN" }),
  };
}

// ── Plan tree shape ─────────────────────────────────────────────────

export function createPlan(goal, opts = {}) {
  if (!goal || typeof goal.description !== "string" || !goal.description) {
    throw new TypeError("planner: goal requires a non-empty description");
  }

  const root = createNode(goal.description, {
    facets: (goal.facets ?? []).map((_, i) => i),
    depth: 0,
  });

  const plan = {
    schema: "PlanTree@1",
    plan_id: stableId("plan", { goal: goal.description, ts: CURRENT_OPERATOR_EPOCH }),
    goal_description: goal.description,
    goal_facets: Object.freeze((goal.facets ?? []).map((f, i) => ({ ...f, _idx: i }))),
    root_id: root.id,
    nodes: new Map([[root.id, root]]),
    edges: [],
    rounds: [],
    completion: null,
    emergence: Object.freeze({ operator_epoch: CURRENT_OPERATOR_EPOCH, op: "SYN" }),
  };

  // Initial decomposition
  const decomposition = decomposeGoal(
    { description: goal.description, facets: goal.facets ?? [] },
    { ...opts, maxSubgoals: opts.maxSubgoals ?? 8 },
  );

  const roundRecord = {
    round: 1,
    phase: "decompose",
    decomposition,
    collapsed: null,
    penciled: [],
    linked: null,
    inked: [],
    composed: null,
    coherence: decomposition.abstained ? 0 : decomposition.evidence?.cohesion ?? 0,
    abstained: decomposition.abstained,
    promotions: 0,
  };

  if (!decomposition.abstained && decomposition.subgoals.length > 0) {
    // DEF: collapse subgoal candidates
    const candidates = decomposition.subgoals.map((sg) => ({
      id: sg.id,
      score: sg.score,
      description: sg.description,
      facets: sg.facets,
    }));

    const collapse = collapseCandidates(candidates, { alpha: 0.05, maxK: candidates.length, window: Math.max(4, candidates.length) });
    roundRecord.collapsed = collapse;

    if (!collapse.abstained && collapse.collapsed.length > 0) {
      // Pencil each collapsed candidate
      for (const candidate of collapse.collapsed) {
        const pencil = pencilTask(candidate, {
          sourceKind: "discovery",
          priorsCited: [],
          dependents: 0,
        });
        const child = createNode(candidate.description, {
          parentId: root.id,
          depth: root.depth + 1,
          facets: candidate.facets ?? [],
          nodeOpts: { id: candidate.id },
        });
        child.status = "penciled";
        child.task = pencil;
        plan.nodes.set(child.id, child);
        root.children = Object.freeze([...root.children, child.id]);
        roundRecord.penciled.push(child.id);
      }

      // Link siblings
      const siblings = roundRecord.penciled.map((id) => plan.nodes.get(id)).filter(Boolean);
      const deps = linkTasks(siblings);
      roundRecord.linked = deps;

      if (!deps.abstained && deps.edges.length > 0) {
        for (const edge of deps.edges) {
          plan.edges.push({ ...edge, round: 1 });
          const toNode = plan.nodes.get(edge.to);
          if (toNode) {
            toNode.dependencies = Object.freeze([...toNode.dependencies, edge.from]);
          }
        }
      }
    }
  }

  plan.rounds.push(roundRecord);
  return Object.freeze({ ...plan, nodes: plan.nodes, edges: Object.freeze(plan.edges), rounds: Object.freeze(plan.rounds) });
}

// ── Plan step phases ────────────────────────────────────────────────

export const PHASES = Object.freeze([
  "decompose",   // SEG: find subgoals for current focus
  "link",        // CON: discover dependency edges for new nodes
  "validate",    // EVA: ink or hold (caller supplies result + validation)
  "synthesize",  // SYN: compose inked children upward
  "replan",      // REC: replan from held results
]);

// ── Find the next focus node ────────────────────────────────────────
//
// The next node to decompose is the first un-decomposed leaf in
// topological order. Leaves with no children and status='inked' are
// terminal — they hold results waiting for upward composition.

export function nextFocus(plan) {
  const nodes = [...plan.nodes.values()];
  // Pending nodes first (need decomposition)
  const pending = nodes.filter((n) => n.status === "pending");
  if (pending.length > 0) return pending[0];

  // Penciled nodes have been decomposed but not yet validated
  const penciled = nodes.filter((n) => n.status === "penciled" && (n.children.length === 0 || n.children.every((cid) => {
    const c = plan.nodes.get(cid);
    return c && (c.status === "inked" || c.status === "held" || c.status === "composed");
  })));
  if (penciled.length > 0) return penciled[0];

  // Held nodes could be retried
  const held = nodes.filter((n) => n.status === "held");
  if (held.length > 0) return held[0];

  // No more work — all nodes are terminal
  return null;
}

// ── Advance plan one step ───────────────────────────────────────────
//
// Each call advances the plan through ONE phase of the loop, returning
// the updated plan and what the caller should do next.
//
// The model/work executor is outside the engine. The planner says what
// needs validation; the caller supplies the result + null-protocol
// validation object and calls advancePlan again.
//
// Returns { plan, phase, next, done }

export function advancePlan(plan, step = {}) {
  const { phase = "decompose", result = null, validation = null } = step;

  // Frozen copy for reading; we'll build updated nodes/edges/rounds
  const currentNodes = new Map(plan.nodes);
  const currentEdges = [...plan.edges];
  const currentRounds = [...plan.rounds];
  const lastRound = currentRounds[currentRounds.length - 1] ?? {
    round: 0, phase: "init", penciled: [], inked: [], coherence: 0, abstained: false, promotions: 0,
  };
  const roundNum = lastRound.round + 1;
  const roundRecord = {
    round: roundNum,
    phase,
    decomposition: null,
    collapsed: null,
    penciled: [],
    linked: null,
    inked: [],
    composed: null,
    coherence: 0,
    abstained: false,
    promotions: 0,
  };

  switch (phase) {
    case "decompose": {
      const focus = nextFocus({ ...plan, nodes: currentNodes, edges: currentEdges, rounds: currentRounds });
      if (!focus) {
        roundRecord.abstained = true;
        roundRecord.phase = "idle";
        currentRounds.push(roundRecord);
        return buildPlanResult({ ...plan, nodes: currentNodes, edges: currentEdges, rounds: currentRounds }, "done");
      }

      // Find the goal facets for this node
      const parentGoalFacets = plan.goal_facets ?? [];
      const nodeFacets = (focus.facets ?? []).map((fi) => parentGoalFacets[fi]).filter(Boolean);

      const decomposition = decomposeGoal(
        { description: focus.description, facets: nodeFacets },
        { maxSubgoals: 8, minFacets: 2 },
      );
      roundRecord.decomposition = decomposition;
      roundRecord.coherence = decomposition.abstained ? 0 : decomposition.evidence?.cohesion ?? 0;
      roundRecord.abstained = decomposition.abstained;

      if (!decomposition.abstained && decomposition.subgoals.length > 0) {
        const candidates = decomposition.subgoals.map((sg) => ({
          id: sg.id,
          score: sg.score,
          description: sg.description,
          facets: sg.facets,
        }));

        const collapse = collapseCandidates(candidates, { alpha: 0.05, maxK: candidates.length, window: Math.max(4, candidates.length) });
        roundRecord.collapsed = collapse;

        if (!collapse.abstained && collapse.collapsed.length > 0) {
          for (const candidate of collapse.collapsed) {
            const pencil = pencilTask(candidate, {
              sourceKind: "discovery",
              priorsCited: focus.task?.priors_cited ?? [],
              dependents: 0,
            });
            const child = createNode(candidate.description, {
              parentId: focus.id,
              depth: focus.depth + 1,
              facets: candidate.facets ?? [],
              nodeOpts: { id: candidate.id },
            });
            child.status = "penciled";
            child.task = pencil;
            currentNodes.set(child.id, child);
            focus.children = Object.freeze([...focus.children, child.id]);
            roundRecord.penciled.push(child.id);
            roundRecord.promotions++;
          }

          // Link new siblings
          const siblings = roundRecord.penciled.map((id) => currentNodes.get(id)).filter(Boolean);
          const deps = linkTasks(siblings);
          roundRecord.linked = deps;

          if (!deps.abstained && deps.edges.length > 0) {
            for (const edge of deps.edges) {
              currentEdges.push({ ...edge, round: roundNum });
              const toNode = currentNodes.get(edge.to);
              if (toNode) {
                toNode.dependencies = Object.freeze([...toNode.dependencies, edge.from]);
              }
            }
          }
        }
      }

      currentNodes.set(focus.id, { ...focus });
      break;
    }

    case "validate": {
      if (!result || !result.task_id || !validation) {
        throw new TypeError("planner: validate phase requires result.task_id and validation");
      }
      const node = currentNodes.get(result.task_id);
      if (!node) throw new TypeError(`planner: no node with id ${result.task_id}`);
      if (node.status !== "penciled") throw new TypeError(`planner: node ${result.task_id} is ${node.status}, expected penciled`);

      const inked = inkTask(node.task, validation);
      if (inked.promoted) {
        node.status = "inked";
        node.task = inked.task;
        node.result = result.result ?? null;
        node.emergence = Object.freeze({ ...node.emergence, op: "EVA" });
        roundRecord.inked.push(node.id);
        roundRecord.promotions++;
      } else {
        node.status = "held";
        node.emergence = Object.freeze({ ...node.emergence, op: "EVA" });
      }
      currentNodes.set(node.id, { ...node });
      break;
    }

    case "synthesize": {
      // Find nodes whose children are all inked and compose upward
      const composable = [...currentNodes.values()].filter((n) =>
        n.status === "inked" &&
        n.children.length > 0 &&
        n.children.every((cid) => {
          const c = currentNodes.get(cid);
          return c && (c.status === "inked" || c.status === "composed");
        }),
      );

      if (composable.length === 0) {
        roundRecord.abstained = true;
        currentRounds.push(roundRecord);
        return buildPlanResult({ ...plan, nodes: currentNodes, edges: currentEdges, rounds: currentRounds }, "continue", "no-composable-nodes");
      }

      const node = composable[0];
      const childResults = node.children
        .map((cid) => currentNodes.get(cid))
        .filter(Boolean)
        .map((c) => ({ task_id: c.id, result: c.result ?? c.synthesis?.composite ?? null, score: c.task?.score ?? 0 }));

      const synthesis = synthesize(childResults, { goalDescription: node.description, edges: currentEdges });
      roundRecord.composed = synthesis;

      if (!synthesis.abstained && synthesis.composite) {
        node.synthesis = synthesis;
        node.status = "composed";
        node.coverage = synthesis.coverage;
        node.emergence = Object.freeze({ ...node.emergence, op: "SYN" });
        roundRecord.promotions++;
      }

      currentNodes.set(node.id, { ...node });
      break;
    }

    case "replan": {
      // Find held nodes and attempt re-decomposition with adjusted parameters
      const heldNodes = [...currentNodes.values()].filter((n) => n.status === "held");
      if (heldNodes.length === 0) {
        roundRecord.abstained = true;
        currentRounds.push(roundRecord);
        return buildPlanResult({ ...plan, nodes: currentNodes, edges: currentEdges, rounds: currentRounds }, "continue", "no-held-nodes");
      }

      const node = heldNodes[0];
      // Re-decompose with a wider search (higher alpha = more permissive DEF)
      const parentGoalFacets = plan.goal_facets ?? [];
      const nodeFacets = (node.facets ?? []).map((fi) => parentGoalFacets[fi]).filter(Boolean);

      const decomposition = decomposeGoal(
        { description: node.description, facets: nodeFacets },
        { maxSubgoals: 12, minFacets: 1 },
      );
      roundRecord.decomposition = decomposition;
      roundRecord.coherence = decomposition.abstained ? 0 : decomposition.evidence?.cohesion ?? 0;

      if (!decomposition.abstained && decomposition.subgoals.length > 0) {
        const candidates = decomposition.subgoals.map((sg) => ({
          id: sg.id,
          score: sg.score,
          description: sg.description,
          facets: sg.facets,
        }));

        const collapse = collapseCandidates(candidates, { alpha: 0.1, maxK: candidates.length, window: Math.max(4, candidates.length) });
        roundRecord.collapsed = collapse;

        if (!collapse.abstained && collapse.collapsed.length > 0) {
          for (const candidate of collapse.collapsed) {
            const pencil = pencilTask(candidate, {
              sourceKind: "mutation",
              sourceRef: node.task ? { pencil_id: node.task.id } : null,
              priorsCited: node.task?.priors_cited ?? [],
              dependents: 0,
              supersedes: node.task?.id ?? null,
            });
            const revision = createNode(candidate.description, {
              parentId: node.parent_id,
              depth: node.depth,
              facets: candidate.facets ?? [],
              nodeOpts: { id: candidate.id },
            });
            revision.status = "penciled";
            revision.task = pencil;
            revision.emergence = Object.freeze({ operator_epoch: CURRENT_OPERATOR_EPOCH, op: "REC" });
            currentNodes.set(revision.id, revision);
            roundRecord.penciled.push(revision.id);
            roundRecord.promotions++;
          }
        }
      }

      // Mark original as superseded in the tree
      node.emergence = Object.freeze({ ...node.emergence, op: "REC", status: "superseded" });
      currentNodes.set(node.id, { ...node });
      break;
    }

    default:
      throw new TypeError(`planner: unknown phase ${phase}`);
  }

  currentRounds.push(roundRecord);

  // Run completion diagnostic
  const completionDiag = completionDiagnostic(currentRounds, {
    window: Math.max(4, Math.min(currentRounds.length, 10)),
  });
  const planCompletion = currentRounds.length >= 4 ? completionDiag : { status: "continue", reason: "insufficient-rounds" };

  let nextPhase = "decompose";
  if (planCompletion.status === "done" || planCompletion.status === "lost-in-babel") {
    nextPhase = planCompletion.status;
  }

  return buildPlanResult(
    { ...plan, nodes: currentNodes, edges: Object.freeze(currentEdges), rounds: Object.freeze(currentRounds), completion: planCompletion },
    planCompletion.status === "done" || planCompletion.status === "lost-in-babel" ? planCompletion.status : "continue",
    null,
    nextPhase,
  );
}

function buildPlanResult(plan, status, stateMessage, nextPhase) {
  return Object.freeze({
    plan,
    status,
    state: stateMessage,
    nextPhase: nextPhase ?? null,
    nodeCount: plan.nodes.size,
    inkedCount: [...plan.nodes.values()].filter((n) => n.status === "inked" || n.status === "composed").length,
    heldCount: [...plan.nodes.values()].filter((n) => n.status === "held").length,
    pendingCount: [...plan.nodes.values()].filter((n) => n.status === "pending" || n.status === "penciled").length,
    edgeCount: plan.edges.length,
    roundCount: plan.rounds.length,
  });
}

// ── Walk the plan tree: get nodes in topological execution order ───

export function executionOrder(plan) {
  const layers = topologicalLayers(
    [...plan.nodes.values()],
    plan.edges,
    { completedIds: [] },
  );
  return layers;
}

// ── Get the final composite from the root ──────────────────────────

export function rootResult(plan) {
  const root = plan.nodes.get(plan.root_id);
  if (!root) return null;
  if (root.synthesis?.composite) return root.synthesis.composite;
  if (root.result) return root.result;
  return null;
}

// ── Plan tree snapshot (for serialization/replay) ──────────────────

export function snapshot(plan) {
  const nodes = [...plan.nodes.values()].map((n) => ({
    id: n.id,
    description: n.description,
    status: n.status,
    parent_id: n.parent_id,
    children: [...n.children],
    depth: n.depth,
    coverage: n.coverage,
    has_task: n.task != null,
    has_synthesis: n.synthesis != null,
    emergence: n.emergence,
  }));
  return Object.freeze({
    plan_id: plan.plan_id,
    goal_description: plan.goal_description,
    goals_facets: plan.goal_facets.length,
    root_id: plan.root_id,
    nodes,
    edges: [...plan.edges],
    round_count: plan.rounds.length,
    completion: plan.completion,
  });
}
