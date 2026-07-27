/**
 * Steering — the metacognitive substrate
 *
 * NOT fed to models. This is the thing that knows where we are.
 *
 * The steering substrate integrates:
 *   - Transitions (layer movement)
 *   - Fold compression (context management)
 *   - Born salience (routing decisions)
 *   - Veto (safety checks)
 *
 * Biological parallel:
 *   - Cyclins/CDKs = steering substrate (knows when to do what)
 *   - Chromosomes = the actual work (don't know what phase they're in)
 *   - Layer hops = cell fate transitions (differentiation)
 *   - Capacities = differentiated cell functions
 */

import * as transitions from "../emergence/transitions/index.js";

// ── Layer definitions (from steering.js in proxy) ──

export const LAYERS = {
  quantum:       { name: "quantum",       sequences: ["fold-text"] },
  semantic:      { name: "semantic",      sequences: ["project-entries"] },
  structural:    { name: "structural",    sequences: ["extract-entities"] },
  operational:   { name: "operational",   sequences: ["classify-terrain"] },
  architectural: { name: "architectural", sequences: ["verify-invariants"] },
};

// ── Capacity definitions ──

export const CAPACITIES = {
  folding:     { name: "folding",     layers: ["quantum"] },
  projection:  { name: "projection",  layers: ["semantic"] },
  surprise:    { name: "surprise",    layers: ["structural"] },
  uncertainty: { name: "uncertainty", layers: ["operational"] },
  coherence:   { name: "coherence",   layers: ["architectural"] },
};

/**
 * Create a steering state.
 */
export function createState() {
  return {
    // Active document
    activeDoc: null,

    // Current layer
    layer: null,

    // Current sequence within the layer
    sequence: null,
    stepIndex: 0,

    // Layer history — hops between layers
    layerHistory: [],

    // Capacity state — what's been built
    capacities: {},

    // Ground covered — topics addressed
    groundCovered: [],

    // Token budget (adaptive)
    tokenBudget: 500,

    // Response time tracking
    responseTimes: [],
    targetResponseMs: 5000,
  };
}

/**
 * Enter a layer.
 */
export function enterLayer(state, layerName, reason = "transition", ts = null) {
  if (!LAYERS[layerName]) return state;

  const layer = LAYERS[layerName];
  const sequence = layer.sequences[0] ?? null;

  return {
    ...state,
    layer: layerName,
    sequence,
    stepIndex: 0,
    layerHistory: [
      ...state.layerHistory,
      {
        layer: layerName,
        sequence,
        stepIndex: 0,
        ts,
        reason,
      },
    ],
  };
}

/**
 * Advance within the current sequence.
 */
export function advance(state, reason = "step", ts = null) {
  if (!state.layer) return state;

  const layer = LAYERS[state.layer];
  if (!layer) return state;

  const currentStep = state.stepIndex;
  const maxSteps = layer.sequences.length;

  if (currentStep >= maxSteps - 1) {
    // At end of sequence — mark capacity as built
    const capacityName = Object.keys(CAPACITIES).find(k =>
      CAPACITIES[k].layers.includes(state.layer)
    );

    const capacities = { ...state.capacities };
    if (capacityName) {
      capacities[capacityName] = {
        built: true,
        layer: state.layer,
        ts,
      };
    }

    return {
      ...state,
      capacities,
      stepIndex: currentStep + 1,
    };
  }

  return {
    ...state,
    stepIndex: currentStep + 1,
  };
}

/**
 * Build a capacity (mark as complete).
 */
export function buildCapacity(state, capacityName, ts = null) {
  if (!CAPACITIES[capacityName]) return state;

  return {
    ...state,
    capacities: {
      ...state.capacities,
      [capacityName]: {
        built: true,
        layer: state.layer,
        ts,
      },
    },
  };
}

/**
 * Record a turn (query + response).
 */
export function recordTurn(state, query, response, context = {}) {
  const summary = query.slice(0, 50);

  return {
    ...state,
    groundCovered: [
      ...state.groundCovered,
      {
        summary,
        ts: context.ts ?? null,
        layer: context.layer ?? state.layer,
      },
    ],
  };
}

/**
 * Record response time and adjust token budget.
 */
export function recordResponseTime(state, responseMs) {
  const responseTimes = [...state.responseTimes, responseMs].slice(-5);
  const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

  // Adaptive budget: fast response → increase, slow → decrease
  let tokenBudget = state.tokenBudget;
  if (avg < state.targetResponseMs * 0.5) {
    tokenBudget = Math.min(4000, tokenBudget + 200);
  } else if (avg > state.targetResponseMs * 1.5) {
    tokenBudget = Math.max(500, tokenBudget - 200);
  }

  return {
    ...state,
    responseTimes,
    tokenBudget,
  };
}

/**
 * Get search strategy based on current layer.
 */
export function getSearchStrategy(state, query) {
  const layer = state.layer ?? "quantum";

  const strategies = {
    quantum: { perLayer: 3, tokenBudget: 300, layers: ["verbatims"] },
    semantic: { perLayer: 4, tokenBudget: 400, layers: ["significances", "verbatims"] },
    structural: { perLayer: 5, tokenBudget: 500, layers: ["structures", "significances"] },
    operational: { perLayer: 3, tokenBudget: 400, layers: ["significances", "structures"] },
    architectural: { perLayer: 2, tokenBudget: 300, layers: ["significances"] },
  };

  return strategies[layer] ?? strategies.quantum;
}

/**
 * Build system prompt with layer context.
 */
export function buildSystemPrompt(state, docTitle = null) {
  const layer = state.layer ?? "quantum";
  const sequence = state.sequence ?? "fold-text";
  const covered = state.groundCovered.map(g => g.summary).join(", ");

  let prompt = `Layer: ${layer}. Sequence: ${sequence}.`;
  if (docTitle) prompt += ` Document: ${docTitle}.`;
  if (covered) prompt += ` Previously covered: ${covered}.`;

  return prompt;
}

/**
 * Summarize steering state.
 */
export function summarize(state) {
  const builtCapacities = Object.entries(state.capacities)
    .filter(([, v]) => v.built)
    .map(([k]) => k);

  return {
    layer: state.layer,
    sequence: state.sequence,
    step: state.stepIndex,
    turn: state.groundCovered.length,
    tokenBudget: state.tokenBudget,
    capacities: builtCapacities,
    layerHops: state.layerHistory.length,
  };
}

/**
 * Reset steering state.
 */
export function reset(state, docId = null, docTitle = null, docUri = null) {
  return {
    ...createState(),
    activeDoc: docId ? { id: docId, title: docTitle, uri: docUri } : null,
  };
}
