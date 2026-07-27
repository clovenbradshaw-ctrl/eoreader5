export { evaluate } from "./evaluate/index.js";
export { deriveNull, createSeededRng, seededShuffle } from "./nulls/index.js";
export { jaccardDistance, computeBoundaryStabilityGate } from "./boundaries/index.js";
export {
  evalNode,
  evaluateProgram,
  predictWith,
  descriptionLength,
  canonicalKey,
  enumeratePrograms,
  mutatePrograms,
  isSeriesNode,
} from "./expressions/index.js";
export { searchCompetentPrograms, evaluateProgramCompetency } from "./programs/index.js";
export { induceOperators, behavioralFingerprint } from "./operators/index.js";
export {
  OPERATOR_SEMANTICS,
  EQUATIONS,
  DERIVATION_CHAINS,
} from "./operators/decomposition.js";
export { induceKind } from "./kinds/index.js";
export { induceParameters, parameterProfiles, profileJaccard } from "./parameters/index.js";
export { induceEntityKinds, buildKindVocabulary, pluralize } from "./entity-kinds/index.js";
export { induceCalculus, induceExtensions } from "./calculus/index.js";

// Surprise measure (portedsurprise/index.js from4.2 src/core/surprise.js)
export {
  klDivergence,
  wordFrequencies,
  surpriseAt,
  feltSurprise,
  forwardScore,
  noveltyReserve,
  informationContent,
} from "./surprise/index.js";

// Fold compression (ported from4.2 fold/foldReading stages)
export {
  fold,
  foldReadingSnapshot,
  scoreChunk,
} from "./fold/index.js";

// Born salience (ported from4.2 src/weave/chorus/born.js)
export {
  scoreAgainstBasis,
  bornSalience,
  relax,
  routeDecision,
} from "./salience/index.js";

// Summary engine (portable fold → summary packet with connection strengthening)
export {
  projectSummary,
  selectContent,
  rankContent,
  groupContent,
  buildPacket,
  computeSurpriseProfile,
  createConnectionMap,
  updateConnectionMap,
  connectionStrength,
} from "./summary/index.js";

// Entity fold pipeline: perceiver surfaces → signal boundaries → typed
// events → figures → entity-focused EOT packet. The orchestrator wires the
// text organ to the modality-agnostic kernel.
export { entityFold } from "./summary/entity-fold.js";
export {
  buildKeyMomentsFromEvents,
  orderChronologically,
  buildEntityPacket,
} from "./summary/kernel.js";
export { significanceSpine, buildSceneMoments } from "./summary/spine.js";
export { buildGraph, detectFigures } from "./summary/graph.js";
export {
  frameText,
  detectBoundaries,
  discoverEntities,
  extractEvents,
  TURNING_EVENT_TYPES,
} from "./summary/text-organ.js";

// Fabrication veto (ported from4.2 tiny-LLM contract + row-veto)
export { veto } from "./veto/index.js";

// The former physics-derivation re-exports (fokkerPlanckEvolve, navierStokesFlow,
// michaelisMentenSaturation, schrodingerEvolve, …) were removed here. That module
// recovered the functional *forms* of physics equations from the retrieval
// primitives, which is not the same as deriving the physics, so it was moved to
// archive/physics-derivation/ and is no longer part of the build. The working
// scoring primitives it composed still live in ../quantum/index.js.
