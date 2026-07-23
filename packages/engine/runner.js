import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { applyCommand, createState, read } from "./replay/index.js";
import { project, readingSnapshot } from "./projection/index.js";
import { search } from "./search/index.js";

export function createEOReaderEngine(defaults = {}) {
  const engineVersion = defaults.engineVersion ?? "0.1.0";
  return {
    async *read(request) {
      if (!request || request.schema !== "RunRequest@1") throw new TypeError("RunRequest@1 required");
      const context = request.context;
      const priorSnapshot = request.prior?.snapshot ?? request.priorSnapshot ?? request.prior_snapshot;
      let state = createState({ engineVersion, operatorEpoch: context?.operator_epoch ?? priorSnapshot.operator_epoch ?? CURRENT_OPERATOR_EPOCH, priorSnapshot });
      yield { schema: "EngineEvent@1", type: "progress", phase: "started", semantic_head: state.semanticHead };
      for (const observation of request.observations ?? []) {
        state = applyCommand(state, { type: "observation.admit", payload: { envelope: observation.envelope ?? observation, blocks: observation.blocks ?? [] } });
        yield { schema: "EngineEvent@1", type: "semantic", event: state.events.at(-1), semantic_head: state.semanticHead };
      }
      state = applyCommand(state, { type: "discovery.advance", budget: context?.compute_budget ?? request.budget ?? {} });
      for (const event of state.events.slice((request.observations ?? []).length)) yield { schema: "EngineEvent@1", type: "semantic", event, semantic_head: state.semanticHead };
      const frame = context?.frame_id ?? "frame:default";
      const lens = context?.lens_ids?.[0] ?? "lens:neutral";
      const snapshot = readingSnapshot(state, { frame, lens, source_id: request.observations?.[0]?.envelope?.source_id ?? request.observations?.[0]?.source_id });
      yield { schema: "EngineEvent@1", type: "snapshot", snapshot, semantic_head: state.semanticHead };
      yield { schema: "EngineEvent@1", type: "projection", projection: project(state, { frame, lens }), semantic_head: state.semanticHead };
      for (const query of request.queries ?? []) yield { schema: "EngineEvent@1", type: "query", reading: search(state, query), semantic_head: state.semanticHead };
      yield { schema: "EngineEvent@1", type: "complete", reading: read(state), semantic_head: state.semanticHead };
    },
  };
}
