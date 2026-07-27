export {
  projectReferents,
  surfacesIndicateSameReferent,
  INDIVIDUATION_TYPES,
  classifyIndividuationType,
  individuateReferent,
  applyNameBind,
} from "./referents/index.js";
export { CORE_SUBASSEMBLIES, assembleWatchmaker, defineSubassembly } from "./subassemblies/index.js";
export { createState, applyCommand, appendEvents, replay, read } from "./replay/index.js";
export { project, readingSnapshot } from "./projection/index.js";
export { evaluate } from "./emergence/evaluate/index.js";
export { deriveNull, createSeededRng, seededShuffle } from "./emergence/nulls/index.js";
export { jaccardDistance, computeBoundaryStabilityGate } from "./emergence/boundaries/index.js";
export { induceParameters, parameterProfiles, profileJaccard } from "./emergence/parameters/index.js";
export { induceEntityKinds, buildKindVocabulary, pluralize } from "./emergence/entity-kinds/index.js";

export { search } from "./search/index.js";
export { detectMotifs } from "./motif/index.js";

// Predictive-competency substrate (spec "EO Emergent Mathematics for
// Predictive Competency", Phase 0 / Section 29): proper scoring, minimum
// baselines, leakage-safe prediction commitments, walk-forward tasks, and the
// prequential competency ledger.
export {
  score,
  logLoss,
  brierScore,
  crps,
  pinballLoss,
  squaredError,
  absoluteError,
  SCORING_RULES,
} from "./prediction/scoring/index.js";
export {
  lastValue,
  randomWalk,
  globalMean,
  movingMean,
  seasonalPersistence,
  defaultNumericBaselines,
} from "./prediction/baselines/index.js";
export { commitPrediction, revealAndScore } from "./prediction/commitments/index.js";
export { createPredictionTask, walkForward } from "./prediction/tasks/index.js";
export {
  createLedger,
  recordStep,
  competencyGain,
  finalizeCompetency,
} from "./competency/ledger/index.js";

export { createEOReaderEngine } from "./runner.js";
export { verifyObservationBundle, materializeObservationIndex, blockContentHash } from "./observation-index.js";

// Cube coordinate: terrain/stance/operator classification + focus bias.
// Ported from4.2: src/wiki/terrains.js, src/turn/meta-route.js.
export {
  classify,
  classifyTerrain,
  classifyStance,
  classifyOperator,
  scoreCoordinate,
  focusBias,
  TERRAINS,
  STANCES,
  DIAGONAL_CELLS,
  isDiagonal,
  coherence,
} from "./cube/index.js";

// Surprise measure: KL divergence, felt surprise, forward score, novelty reserve.
// Ported from4.2: src/core/surprise.js.
export {
  klDivergence,
  wordFrequencies,
  surpriseAt,
  feltSurprise,
  forwardScore,
  noveltyReserve,
  informationContent,
} from "./emergence/surprise/index.js";

// Fold compression: token-budget fold, chunk scoring, selection.
// Ported from4.2: fold/foldReading stages + proxy fold_summary.
export {
  fold,
  foldReadingSnapshot,
  scoreChunk,
} from "./emergence/fold/index.js";

// Born salience: exemplar scoring, relax settling, route decision.
// Ported from4.2: src/weave/chorus/born.js, src/weave/longgen/relax.js.
export {
  scoreAgainstBasis,
  bornSalience,
  relax,
  routeDecision,
} from "./emergence/salience/index.js";

// Fabrication veto: model-output constraint checks.
// Ported from4.2: tiny-LLM contract + row-veto battery.
export {
  veto,
} from "./emergence/veto/index.js";
