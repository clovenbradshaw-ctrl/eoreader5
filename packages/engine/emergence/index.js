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
  isSeriesNode,
} from "./expressions/index.js";
export { searchCompetentPrograms, evaluateProgramCompetency } from "./programs/index.js";
export { induceOperators, behavioralFingerprint } from "./operators/index.js";
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

// Fabrication veto (ported from4.2 tiny-LLM contract + row-veto)
export { veto } from "./veto/index.js";
