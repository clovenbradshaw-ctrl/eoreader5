import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createState, project, read, replay } from "../index.js";

const priorSnapshot = { schema: "PriorSnapshot@1", prior_id: "prior:sha256:abc" };

test("minimal observation ledger replays deterministically", () => {
  const state = createState({ engineVersion: "0.1.0", operatorEpoch: "eo-3x3", priorSnapshot });
  const once = applyCommand(state, { type: "observation.admit", payload: { observation_id: "obs:1" } });
  const twice = applyCommand(state, { type: "observation.admit", payload: { observation_id: "obs:1" } });
  assert.deepEqual(once.events, twice.events);
  assert.equal(once.semanticHead, twice.semanticHead);

  const replayed = replay(once.events, { engineVersion: "0.1.0", operatorEpoch: "eo-3x3", priorSnapshot });
  assert.equal(replayed.semanticHead, once.semanticHead);
});

test("discovery budget exhaustion is held as an abstention with continuation", () => {
  const state = createState({ engineVersion: "0.1.0", operatorEpoch: "eo-3x3", priorSnapshot });
  const next = applyCommand(state, { type: "discovery.advance", budget: { max_events: 1 } });
  assert.equal(next.events[0].event_type, "discovery.abstained");
  assert.equal(next.events[0].payload.reason, "held:budget_exhausted");
  assert.match(next.continuation, /^continuation:/);
});

test("read and project return neutral public contracts", () => {
  const state = createState({ engineVersion: "0.1.0", operatorEpoch: "eo-3x3", priorSnapshot });
  assert.equal(read(state).schema, "HypothesisSet@1");
  const bundle = project(state, { frame: "frame:1", lens: "lens:neutral" });
  assert.equal(bundle.schema, "ProjectionBundle@1");
  assert.deepEqual(Object.keys(bundle).includes("markup"), false);
});
