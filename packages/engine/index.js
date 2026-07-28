export {
  projectReferents,
  surfacesIndicateSameReferent,
  INDIVIDUATION_TYPES,
  classifyIndividuationType,
  individuateReferent,
  applyNameBind,
} from "./referents/index.js";
export { CORE_SUBASSEMBLIES, assembleWatchmaker, defineSubassembly } from "./subassemblies/index.js";
export { createState, applyCommand, appendEvents, replay, read, readTasks } from "./replay/index.js";
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
  advisoryClassifyTerrain,
  advisoryClassifyStance,
  advisoryClassifyOperator,
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
// plus perceivers for each modality. Structure-neutral — no segmentation,
// no onset/cut detection. Emergence finds structure from the field vectors
// the same way for every modality.
// Ported from eoreader4.2: src/organs/in/reading-dispatch.js, src/perceiver/*.
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
export {
  buildVideoReading,
  VIDEO_FIELD_SPEC,
  FRAME_WIDTH,
  FRAME_HEIGHT,
  TARGET_FPS,
  BLOCK_SIZE,
} from "./perceiver/video/reading.js";

// Video motion primitives: block-matching optical flow, scene
// classification, intertitle detection. Deterministic, no training data.
// blockFlow's (dx, dy) are MOTION vectors (+y is down the frame) and it
// marks border blocks in `vectors.valid`, whose search window is
// truncated and therefore biased inward.
export {
  blockFlow,
  motionSignature,
  classifyScene,
  detectIntertitle,
} from "./perceiver/video/flow.js";

// Physics analogs over the optical-flow field: curl, divergence,
// current density, Laplacian, gradient. Every reduction is NaN-safe,
// interior-only, and reports the sample count behind it.
export {
  curlField,
  divergenceField,
  currentDensity,
  laplacianField,
  gradientMagnitude,
  vorticity,
  potentialEnergy,
  findDipoles,
  analyzeFlowPhysics,
  physicsSeries,
  PHYSICS_OBSERVABLES,
} from "./perceiver/video/physics.js";

// Holon self-teaching: patterns found at one level become templates
// lower levels use to recognise the same shape elsewhere — and the
// cross-modal bridge, since the same centroid-trajectory matching runs
// over film cut intervals, musical inter-onset intervals and text
// section lengths.
export {
  AccelTemplate,
  StructuralVocabulary,
  findAccelerationPattern,
  detectNarrativeArc,
} from "./perceiver/video/holontutor.js";

// The modality-blind field-spec interface. Audio, video and text each
// declare channels and widths; this makes the declaration executable,
// so cross-modal formulas slice by name instead of hardcoded offsets.
export {
  defineFieldSpec,
  normalizeFieldSpec,
  fieldSpecDims,
  channelNames,
  getChannel,
  validateFieldVector,
  sliceChannel,
  splitChannels,
  cosineDistance,
  angularDistance,
  euclideanDistance,
  channelDistance,
  fieldDistance,
  isTrueMetric,
  specIsMetric,
  eotFieldSpec,
  eotFieldVectors,
  EOT_OPERATORS,
} from "./perceiver/field-spec.js";
export { TEXT_FIELD_SPEC, buildTextFieldText } from "./perceiver/text/text-signal.js";

// Trajectory red shift and physics current density, unified: both are a
// cosine comparison against a reference accumulated along an axis, so
// they are one implementation over any field-spec sequence. The
// Map-based redShift in emergence/trajectory keeps its interface;
// field-shift.test.js pins the two to agree exactly.
export {
  fieldRedShift,
  fieldRestFrameDivergence,
  fieldPhaseVolatility,
  fieldCurrentDensity,
  fieldTrajectory,
  trajectoryToVectors,
  signatureToVector,
  signatureBasis,
} from "./emergence/trajectory/field-shift.js";
export { relationSignature } from "./emergence/trajectory/index.js";

// Chapter detection: DEF over any physics time series. The Potemkin
// boundary pipeline as a reusable, testable module — modality-blind,
// abstaining when the series holds no structure.
export {
  changeSeries,
  detectBoundaries,
  detectChapters,
  segmentChapters,
  consensusBoundaries,
} from "./emergence/chapters/index.js";

// Task genesis: the fold that grows a task tree instead of authoring one.
// DEF over a caller-scored candidate spectrum decides what collapses;
// pencilTask/inkTask carry it through a provisional-then-settled
// lifecycle (never deleting, never mutating — see replay's task.pencil/
// task.ink/task.hold commands and readTasks for the ledger side);
// completionDiagnostic tells whole-project completion apart from
// generation having drifted into noise that merely fails DEF for the
// wrong reason. Priors and dependency-risk shape what gets PROPOSED to
// collapseCandidates; they never touch DEF's own floor.
export {
  TASK_LIFECYCLE,
  SOURCE_KINDS,
  dependentsOf,
  requiredValidationQuantile,
  collapseCandidates,
  pencilTask,
  inkTask,
  completionDiagnostic,
} from "./emergence/genesis/index.js";

// ── The invariant layer ──
// The four constraints that define the system's legal state space.
// These CHECK rather than clamp: quantum/project() and interfere()
// both end in Math.max(0, Math.min(1, x)), which satisfies the bound at
// the output while destroying the evidence it was ever violated.
export {
  checkProbability,
  checkProbabilities,
  checkContinuity,
  checkFoldContinuity,
  checkEntropyMonotone,
  checkPhaseBound,
  scatteringKernelBound,
  amplitudeEntropy,
  foldEntropy,
  checkInvariants,
  guard,
  INVARIANT_IDS,
  DEFAULT_TOLERANCE,
} from "./invariants/index.js";

// ── The cycle layer ──
// The three closed loops in which violating one invariant triggers
// another to correct it: the oscillator, the heat engine, and Byzantine
// cross-modal fault tolerance.
export {
  bornContinuityCycle,
  entropyPhaseCycle,
  crossModalConsensus,
  crossModalRepair,
  runCycles,
} from "./invariants/cycles.js";
