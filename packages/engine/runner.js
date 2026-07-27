/**
 * EO Reader Engine Runner
 *
 * The assembled ribosome.
 *
 * Pipeline:
 *   1. Admit observations (replay)
 *   2. Lift into fold space (quantum mechanics)
 *   3. Advance discovery (emergence engine)
 *   4. Born salience routing (decision layer)
 *   5. Take snapshot (reading state)
 *   6. Project (cube coordinates)
 *   7. Apply interference (quantum mechanics)
 *   8. Search with Born rule projection (search)
 *   9. Fold compression (context management)
 *   10. Veto (fabrication safety)
 *   11. Character lens assertion (the higher tier)
 *   12. Complete
 */

import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { applyCommand, createState, read } from "./replay/index.js";
import { project as projectState, readingSnapshot } from "./projection/index.js";
import { search as searchState } from "./search/index.js";
import { fold, foldToClassical, project, interfere, measureFold, computeUncertainty, satisfiesUncertaintyPrinciple } from "./quantum/index.js";
import { liftObservation, liftSnapshot } from "./emergence/lift/index.js";
import { bornSalience, routeDecision } from "./emergence/salience/index.js";
import { fold as foldReading, foldReadingSnapshot } from "./emergence/fold/index.js";
import { veto } from "./emergence/veto/index.js";
import * as transitions from "./emergence/transitions/index.js";
import { redShift, restFrameDivergence, phaseVolatility } from "./emergence/trajectory/index.js";
import { assertLens, speakLensAssertion } from "./emergence/lens-assertion/index.js";

export function createEOReaderEngine(defaults = {}) {
  const engineVersion = defaults.engineVersion ?? "0.1.0";

  // Shared state: priors for quantum mechanics
  const priors = defaults.priors ?? null;

  // Routing history (for relax settling)
  const routingHistory = [];

  // Entanglement graph: maps entry IDs to folds
  const entanglementGraph = new Map();

  return {
    async *read(request) {
      if (!request || request.schema !== "RunRequest@1") throw new TypeError("RunRequest@1 required");

      const context = request.context;
      const priorSnapshot = request.prior?.snapshot ?? request.priorSnapshot ?? request.prior_snapshot;

      let state = createState({
        engineVersion,
        operatorEpoch: context?.operator_epoch ?? priorSnapshot?.operator_epoch ?? CURRENT_OPERATOR_EPOCH,
        priorSnapshot,
      });

      // Initialize transitions
      let transState = transitions.createState();

      yield { schema: "EngineEvent@1", type: "progress", phase: "started", semantic_head: state.semanticHead };

      // ── Phase 1: Admit observations ──
      const observations = request.observations ?? [];
      const liftedObservations = [];

      for (const observation of observations) {
        state = applyCommand(state, {
          type: "observation.admit",
          payload: { envelope: observation.envelope ?? observation, blocks: observation.blocks ?? [] },
        });

        // ── Phase 2: Lift into fold space ──
        const lifted = liftObservation(observation.envelope ?? observation, { priors });
        liftedObservations.push(lifted);

        // Attach fold to state for interference
        if (lifted._compositeFold) {
          const entryId = observation.envelope?.source_id ?? observation.source_id ?? `obs:${liftedObservations.length}`;
          entanglementGraph.set(entryId, lifted._compositeFold);
        }

        yield { schema: "EngineEvent@1", type: "semantic", event: state.events.at(-1), semantic_head: state.semanticHead };
      }

      // ── Phase 3: Advance discovery ──
      state = applyCommand(state, {
        type: "discovery.advance",
        budget: context?.compute_budget ?? request.budget ?? {},
      });

      for (const event of state.events.slice(observations.length)) {
        yield { schema: "EngineEvent@1", type: "semantic", event, semantic_head: state.semanticHead };
      }

      // ── Phase 4: Born salience routing ──
      const bases = request.bases ?? [];
      const content = liftedObservations.map(o => o._text ?? "").join(" ");
      let routeResult = null;

      if (bases.length > 0 && content.length > 0) {
        routeResult = bornSalience(content, bases);
        const decision = routeDecision(routeResult, context?.fold_budget ?? 500, routingHistory);
        routingHistory.push(decision);

        // Enter appropriate layer based on routing
        if (decision.action === "proceed") {
          const entered = transitions.transition(transState, "semantic", { confidence: routeResult.score, reason: "salience-proceed" });
          if (entered.success) transState = entered.state;
        } else if (decision.action === "drill") {
          const entered = transitions.transition(transState, "structural", { confidence: 0.5, reason: "salience-drill" });
          if (entered.success) transState = entered.state;
        }
      }

      // ── Phase 5: Snapshot ──
      const frame = context?.frame_id ?? "frame:default";
      const lens = context?.lens_ids?.[0] ?? "lens:neutral";
      const snapshot = readingSnapshot(state, {
        frame,
        lens,
        source_id: observations[0]?.envelope?.source_id ?? observations[0]?.source_id,
      });

      // Lift snapshot passages
      const liftedSnapshot = liftSnapshot(snapshot, { priors });

      yield { schema: "EngineEvent@1", type: "snapshot", snapshot: liftedSnapshot, semantic_head: state.semanticHead };

      // ── Phase 6: Project (cube coordinates) ──
      const projection = projectState(state, { frame, lens });
      yield { schema: "EngineEvent@1", type: "projection", projection, semantic_head: state.semanticHead };

      // ── Phase 7: Interference ──
      // Apply interference between lifted observations
      if (liftedObservations.length > 1) {
        const folds = liftedObservations
          .map(o => o._compositeFold)
          .filter(Boolean);

        if (folds.length > 1) {
          const queryFold = fold(request.queries?.[0]?.query ?? "", priors);
          const interfered = interfere(queryFold, folds);

          yield {
            schema: "EngineEvent@1",
            type: "interference",
            interfered,
            semantic_head: state.semanticHead,
          };
        }
      }

      // ── Phase 8: Search ──
      const queryResults = [];
      for (const query of request.queries ?? []) {
        let searchResult = searchState(state, query);

        // Apply Born rule projection if we have folds
        if (liftedSnapshot._liftedPassages?.length > 0) {
          const queryFold = fold(query.query ?? "", priors);
          const passages = searchResult.passages ?? [];

          // Score each passage by fold projection
          const scoredPassages = passages.map(p => {
            const passage = liftedSnapshot._liftedPassages.find(
              lp => lp.passageId === p.passage_id
            );

            if (passage?.fold) {
              const foldScore = project(queryFold, passage.fold);
              return {
                ...p,
                score: p.score * 0.3 + foldScore * 0.7, // 70% fold, 30% keyword
                foldScore,
              };
            }
            return p;
          });

          // Re-sort by combined score
          scoredPassages.sort((a, b) => b.score - a.score);
          searchResult = { ...searchResult, passages: scoredPassages };
        }

        // ── Phase 9: Fold compression ──
        const foldedReading = foldReadingSnapshot(searchResult, {
          tokenBudget: context?.token_budget ?? 500,
          maxUnits: context?.max_units ?? 10,
          history: routingHistory,
        });

        queryResults.push({
          query: searchResult,
          folded: foldedReading,
        });

        yield {
          schema: "EngineEvent@1",
          type: "query",
          reading: searchResult,
          folded: foldedReading,
          semantic_head: state.semanticHead,
        };
      }

      // ── Phase 10: Veto ──
      // Apply veto to folded summaries
      const vetoResults = [];
      for (const qr of queryResults) {
        if (qr.folded?.summary) {
          const source = qr.query?.passages?.map(p =>
            (p.anchors?.exact_text ?? []).join(" ")
          ).join(" ") ?? "";

          const vetoResult = veto(qr.folded.summary, {
            source,
            strict: context?.strict_veto ?? true,
          });

          vetoResults.push({
            query: qr.query?.request?.query,
            veto: vetoResult,
          });

          if (!vetoResult.passed) {
            yield {
              schema: "EngineEvent@1",
              type: "veto",
              result: vetoResult,
              semantic_head: state.semanticHead,
            };
          }
        }
      }

      // ── Phase 11: Character lens assertion (the higher tier) ──
      // The relativistic construct: the reader ASSERTS what a character's lens is,
      // shaped by their priors and measured by the trajectory's red shift.
      const readerPrior = request.readerPrior ?? null;
      const characterLenses = [];

      // If the request specifies characters to track, compute their trajectories
      // and assert their lenses
      if (request.characters && Array.isArray(request.characters)) {
        for (const character of request.characters) {
          // The character's trajectory would be computed from the event log
          // For now, we use a placeholder — the real trajectory computation
          // requires the document's log and segment boundaries
          const traj = character.trajectory ?? null;
          if (traj) {
            const assertion = assertLens(traj, readerPrior);
            if (assertion) {
              characterLenses.push(assertion);
              yield {
                schema: "EngineEvent@1",
                type: "lens-assertion",
                assertion,
                spoken: speakLensAssertion(assertion),
                semantic_head: state.semanticHead,
              };
            }
          }
        }
      }

      // ── Phase 12: Complete ──
      const finalReading = read(state);

      // Compute uncertainty of the reading
      const readingFold = fold(JSON.stringify(finalReading), priors);
      const uncertainty = computeUncertainty(readingFold);
      const satisfiesUP = satisfiesUncertaintyPrinciple(readingFold);

      yield {
        schema: "EngineEvent@1",
        type: "complete",
        reading: finalReading,
        transitions: transitions.summarize(transState),
        uncertainty,
        satisfiesUncertaintyPrinciple: satisfiesUP,
        entanglementSize: entanglementGraph.size,
        characterLenses,
        semantic_head: state.semanticHead,
      };
    },
  };
}
