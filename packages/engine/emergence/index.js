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
  NATIVE_EQUATIONS,
  EMERGENT_EQUATIONS,
  APPLIED_EQUATIONS,
  MINIMAL_EQUATIONS,
  FULL_OPERATOR_MATRIX,
  LAYER_OPERATOR_PROFILES,
  DERIVATION_CHAINS
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

// Fabrication veto (ported from4.2 tiny-LLM contract + row-veto)
export { veto } from "./veto/index.js";

// Physics equations derived from quantum primitives
// (Fokker-Planck, Michaelis-Menten, Navier-Stokes, Poisson, Boltzmann,
//  Lotka-Volterra, Schrödinger, Black-Scholes, Euler-Lagrange)
export {
  fokkerPlanckEvolve,
  michaelisMentenSaturation,
  michaelisMentenMeasure,
  verifyBlendIsMichaelisMenten,
  navierStokesFlow,
  poissonPriorField,
  applyPriorField,
  boltzmannSurvival,
  boltzmannConsolidate,
  lotkaVolterraTerrain,
  schrodingerEvolve,
  blackScholesValue,
  eulerLagrangeAction,
  eulerLagrangeOptimalK,
  verifyContinuity,
  computeProbabilityCurrent,
  HBAR,
  DECOHERENCE_TAU,
  BOLTZMANN_K,
} from "./physics/index.js";
