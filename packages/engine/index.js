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

// Trajectory red shift: the cosmological metaphor for character transformation.
// Measures how far a character has moved from their rest frame, determining the
// reader's confidence in their lens assertion.
export {
  redShift,
  restFrameDivergence,
  phaseVolatility,
} from "./emergence/trajectory/index.js";

// Reader priors: the reader's background knowledge that shapes what they can
// assert about a character's lens. Injected by the app/eoPriors layer, never
// computed by the engine.
export {
  createReaderPrior,
  availableAssertions,
  priorConfidenceBoost,
  speakPrior,
} from "./emergence/reader-priors/index.js";

// Character lens assertion: the higher tier where the reader ASSERTS what a
// character's lens is, shaped by their priors and measured by the red shift.
// This is the relativistic construct — different readers assert different lenses,
// and all can be valid.
export {
  assertLens,
  speakLensAssertion,
} from "./emergence/lens-assertion/index.js";

// Omnimodal binary perception: format-sniffing dispatch (WAV/text/binary),
// plus the audio DSP perceiver (PCM -> field vectors). Structure-neutral —
// no segmentation, no onset detection. Emergence finds structure from the
// field vectors the same way for every modality.
// Ported from eoreader4.2: src/organs/in/reading-dispatch.js, src/perceiver/audio/*.
export {
  buildReadingFromBytes,
  buildBinaryReading,
  buildTextReading,
} from "./perceiver/dispatch.js";
export {
  buildAudioReading,
  extractFrameFields,
  frameSignal,
  AUDIO_FIELD_SPEC,
  TARGET_SAMPLE_RATE,
  FRAME_SIZE,
  HOP_SIZE,
} from "./perceiver/audio/reading.js";
export { decodeWav, sniffWav } from "./perceiver/audio/wav.js";
