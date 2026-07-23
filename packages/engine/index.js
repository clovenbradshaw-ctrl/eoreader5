export { projectReferents, surfacesIndicateSameReferent } from "./referents/index.js";
export { CORE_SUBASSEMBLIES, assembleWatchmaker, defineSubassembly } from "./subassemblies/index.js";
export { createState, applyCommand, appendEvents, replay, read } from "./replay/index.js";
export { project, readingSnapshot } from "./projection/index.js";
export { evaluate } from "./emergence/evaluate/index.js";

export { search } from "./search/index.js";

export { createEOReaderEngine } from "./runner.js";
export { verifyObservationBundle, materializeObservationIndex, blockContentHash } from "./observation-index.js";
