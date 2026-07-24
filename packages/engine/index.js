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
