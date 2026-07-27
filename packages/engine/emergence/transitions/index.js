/**
 * Transitions — the GTPase cycle
 *
 * Manages state transitions between holonic layers.
 * The ribosome needs to coordinate between subunits;
 * transitions are the GTPase cycle that drives translocation.
 *
 * Biological parallel:
 *   - GTP hydrolysis = transition energy
 *   - Translocation = moving along the mRNA
 *   - Elongation factor = transition rules
 *   - Ribosome subunits = holonic layers
 *
 * The five layers (from steering substrate):
 *   1. quantum      — raw amplitude space
 *   2. semantic     — meaning and interpretation
 *   3. structural   — entities, facts, relationships
 *   4. operational  — actions, decisions, routing
 *   5. architectural — invariants, coherence, global structure
 *
 * Transitions flow upward (quantum → architectural) through
 * increasing levels of abstraction. Each transition consumes
 * "energy" (confidence threshold) and produces "GTP" (progress).
 */

// ── Layer Definitions ──

export const LAYERS = [
  { name: "quantum",       index: 0, sequences: ["fold-text"] },
  { name: "semantic",      index: 1, sequences: ["project-entries"] },
  { name: "structural",    index: 2, sequences: ["extract-entities"] },
  { name: "operational",   index: 3, sequences: ["classify-terrain"] },
  { name: "architectural", index: 4, sequences: ["verify-invariants"] },
];

const LAYER_MAP = new Map(LAYERS.map(l => [l.name, l]));

// ── Transition Rules ──

/**
 * Valid transitions: you can only move one layer at a time.
 * No skipping. The ribosome translocates one codon at a time.
 */
const VALID_TRANSITIONS = new Map([
  ["quantum",      ["semantic"]],
  ["semantic",     ["quantum", "structural"]],
  ["structural",   ["semantic", "operational"]],
  ["operational",  ["structural", "architectural"]],
  ["architectural", ["operational"]],
]);

// ── Transition Energy ──

/**
 * Energy required to transition between layers.
 * Higher energy = harder to transition = more confidence needed.
 */
const TRANSITION_ENERGY = {
  "quantum→semantic": 0.3,       // Folding into meaning: moderate energy
  "semantic→quantum": 0.2,       // Back to raw: easy (entropy increases)
  "semantic→structural": 0.4,    // Extracting entities: requires structure
  "structural→semantic": 0.2,    // Back to meaning: easy
  "structural→operational": 0.5, // Making decisions: high energy
  "operational→structural": 0.3, // Back to structure: moderate
  "operational→architectural": 0.6, // Verifying invariants: highest energy
  "architectural→operational": 0.3, // Back to operations: moderate
};

// ── State ──

/**
 * Create a fresh transitions state.
 */
export function createState() {
  return {
    currentLayer: null,      // Current layer name
    stepIndex: 0,            // Step within current layer's sequence
    history: [],             // Transition history [{ from, to, ts, energy, reason }]
    layerEntryCounts: {},    // How many times each layer was entered
    sequenceProgress: {},    // layerName → stepIndex
  };
}

/**
 * Determine if a transition is valid.
 */
export function canTransition(from, to) {
  const valid = VALID_TRANSITIONS.get(from);
  return valid ? valid.includes(to) : false;
}

/**
 * Compute the energy required for a transition.
 */
export function transitionEnergy(from, to) {
  return TRANSITION_ENERGY[`${from}→${to}`] ?? 0.5;
}

/**
 * Attempt a transition.
 *
 * @param {object} state - Current transitions state
 * @param {string} toLayer - Target layer name
 * @param {object} opts - { confidence, reason }
 * @returns {object} { success, state, energy, reason }
 */
export function transition(state, toLayer, opts = {}) {
  const { confidence = 0, reason = "none", ts = null } = opts;

  const fromLayer = state.currentLayer;

  // First transition: any layer is valid
  if (fromLayer === null) {
    const newState = enterLayer(state, toLayer, reason, ts);
    return { success: true, state: newState, energy: 0, reason: "initial" };
  }

  // Check validity
  if (!canTransition(fromLayer, toLayer)) {
    return {
      success: false,
      state,
      energy: 0,
      reason: `invalid_transition: ${fromLayer} → ${toLayer}`,
    };
  }

  // Check energy
  const required = transitionEnergy(fromLayer, toLayer);
  if (confidence < required) {
    return {
      success: false,
      state,
      energy: required,
      reason: `insufficient_energy: need ${required.toFixed(2)}, have ${confidence.toFixed(2)}`,
    };
  }

  // Transition succeeds
  const newState = enterLayer(state, toLayer, reason, ts);
  return { success: true, state: newState, energy: required, reason };
}

/**
 * Enter a layer (internal helper).
 */
function enterLayer(state, layerName, reason, ts = null) {
  const layer = LAYER_MAP.get(layerName);
  if (!layer) return state;

  const entryCounts = { ...state.layerEntryCounts };
  entryCounts[layerName] = (entryCounts[layerName] || 0) + 1;

  // Reset step index for new layer
  const sequenceProgress = { ...state.sequenceProgress };
  sequenceProgress[layerName] = 0;

  return {
    ...state,
    currentLayer: layerName,
    stepIndex: 0,
    history: [
      ...state.history,
      {
        from: state.currentLayer,
        to: layerName,
        ts,
        reason,
      },
    ],
    layerEntryCounts: entryCounts,
    sequenceProgress,
  };
}

/**
 * Advance within the current layer's sequence.
 *
 * @param {object} state - Current transitions state
 * @param {object} opts - { reason }
 * @returns {object} { state, advanced, atEnd }
 */
export function advanceSequence(state, opts = {}) {
  const { reason = "step" } = opts;

  if (!state.currentLayer) {
    return { state, advanced: false, atEnd: false };
  }

  const layer = LAYER_MAP.get(state.currentLayer);
  if (!layer) return { state, advanced: false, atEnd: false };

  const currentStep = state.sequenceProgress[state.currentLayer] ?? 0;
  const maxSteps = layer.sequences.length;

  if (currentStep >= maxSteps - 1) {
    // At end of sequence — need to transition to next layer
    return { state, advanced: false, atEnd: true };
  }

  // Advance
  const sequenceProgress = { ...state.sequenceProgress };
  sequenceProgress[state.currentLayer] = currentStep + 1;

  return {
    state: {
      ...state,
      stepIndex: currentStep + 1,
      sequenceProgress,
    },
    advanced: true,
    atEnd: false,
  };
}

/**
 * Get the current sequence name for the active layer.
 */
export function currentSequence(state) {
  if (!state.currentLayer) return null;
  const layer = LAYER_MAP.get(state.currentLayer);
  if (!layer) return null;

  const step = state.sequenceProgress[state.currentLayer] ?? 0;
  return layer.sequences[step] ?? null;
}

/**
 * Determine which layer to transition to next based on signal.
 *
 * @param {object} state - Current transitions state
 * @param {object} signal - { surprise, coherence, completeness }
 * @returns {string|null} Recommended layer name
 */
export function recommendTransition(state, signal = {}) {
  const { surprise = 0, coherence = 0, completeness = 0 } = signal;
  const current = state.currentLayer;

  if (!current) return "quantum"; // Start at the bottom

  // High surprise: go deeper (structural → operational)
  if (surprise > 0.7 && canTransition(current, "structural")) {
    return "structural";
  }

  // High coherence: go higher (toward architectural)
  if (coherence > 0.8 && canTransition(current, nextLayer(current))) {
    return nextLayer(current);
  }

  // Low completeness: go back (re-examine)
  if (completeness < 0.3 && canTransition(current, prevLayer(current))) {
    return prevLayer(current);
  }

  // Default: advance within current layer
  return null;
}

/**
 * Get the next layer in the hierarchy.
 */
function nextLayer(current) {
  const idx = LAYERS.findIndex(l => l.name === current);
  if (idx < 0 || idx >= LAYERS.length - 1) return null;
  return LAYERS[idx + 1].name;
}

/**
 * Get the previous layer in the hierarchy.
 */
function prevLayer(current) {
  const idx = LAYERS.findIndex(l => l.name === current);
  if (idx <= 0) return null;
  return LAYERS[idx - 1].name;
}

/**
 * Summarize transitions state.
 */
export function summarize(state) {
  return {
    currentLayer: state.currentLayer,
    stepIndex: state.stepIndex,
    currentSequence: currentSequence(state),
    transitions: state.history.length,
    layerCounts: { ...state.layerEntryCounts },
  };
}
