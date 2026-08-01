export const HOLONIC_SCHEMA_VERSION = "eoreader5.holonic-subassembly.v1";

export const SUBASSEMBLY_KINDS = Object.freeze([
  "operator-epoch",
  "canonical-json",
  "referent-laws",
  "individuation-gate",
  "observation-intake",
  "prior-boundary",
  "semantic-ledger",
  "reading-snapshot",
  "enactment-boundary",
  "compatibility-import",
  "cube-coordinate",
  "surprise-measure",
  "fold-compression",
  "born-salience",
  "fabrication-veto",
  "paradigm-promotion",
]);

export const REQUIRED_PORTS = Object.freeze({
  "operator-epoch": Object.freeze({ inputs: [], outputs: ["operator-catalog"] }),
  "canonical-json": Object.freeze({ inputs: ["serializable-artifact"], outputs: ["canonical-bytes", "content-hash"] }),
  "referent-laws": Object.freeze({ inputs: ["referent-events"], outputs: ["referent-projection"] }),
  "individuation-gate": Object.freeze({ inputs: ["referent-projection", "null-protocol"], outputs: ["individuation-result"] }),
  "observation-intake": Object.freeze({ inputs: ["observation-envelope"], outputs: ["semantic-event-candidates"] }),
  "prior-boundary": Object.freeze({ inputs: ["prior-snapshot"], outputs: ["pinned-prior-context"] }),
  "semantic-ledger": Object.freeze({ inputs: ["semantic-events"], outputs: ["semantic-head"] }),
  "reading-snapshot": Object.freeze({ inputs: ["semantic-head", "frame", "lens", "prior-snapshot"], outputs: ["reading-snapshot"] }),
  "enactment-boundary": Object.freeze({ inputs: ["candidate-surface", "reading-snapshot"], outputs: ["enactment-decision", "effect-request"] }),
  "compatibility-import": Object.freeze({ inputs: ["legacy42-envelope"], outputs: ["observation-envelope", "held-review"] }),
  "cube-coordinate": Object.freeze({ inputs: ["semantic-event"], outputs: ["cube-cell"] }),
  "surprise-measure": Object.freeze({ inputs: ["semantic-event", "observation-history"], outputs: ["surprise-score", "novelty-reserve"] }),
  "fold-compression": Object.freeze({ inputs: ["reading-snapshot", "token-budget"], outputs: ["folded-reading"] }),
  "born-salience": Object.freeze({ inputs: ["content-score", "exemplar-basis"], outputs: ["salience-score", "route-decision"] }),
  "fabrication-veto": Object.freeze({ inputs: ["candidate-output", "grounding-propositions"], outputs: ["veto-decision"] }),
  "paradigm-promotion": Object.freeze({ inputs: ["lens-registry", "candidate-kind", "null-protocol"], outputs: ["paradigm-gate-result"] }),
});

export function isSubassemblyKind(kind) {
  return SUBASSEMBLY_KINDS.includes(kind);
}
