import { test } from "node:test";
import assert from "node:assert/strict";
import { createLedger, recordStep, competencyGain, finalizeCompetency } from "./index.js";

const SCOPE = {
  horizon: { kind: "walk-forward", h: 1 },
  population: "series:demo",
  source_versions: ["sha256:" + "c".repeat(64)],
  evaluation_protocol: "prequential-walk-forward",
};

test("a ledger requires at least one baseline (invariant 7.5)", () => {
  assert.throws(() => createLedger({ task_id: "t", candidate_id: "c", baseline_ids: [] }), TypeError);
});

test("competency gain accumulates baseline loss minus candidate loss", () => {
  let ledger = createLedger({ task_id: "t", candidate_id: "c", baseline_ids: ["b1"] });
  ledger = recordStep(ledger, { candidate_loss: 1, baseline_losses: { b1: 2 } });
  ledger = recordStep(ledger, { candidate_loss: 1, baseline_losses: { b1: 3 } });
  assert.equal(ledger.observations, 2);
  assert.equal(ledger.cumulative_loss, 2);
  assert.equal(ledger.baseline_losses.b1, 5);
  assert.equal(competencyGain(ledger).b1, 3); // 5 - 2
});

test("recordStep is immutable — the input ledger is unchanged", () => {
  const ledger = createLedger({ task_id: "t", candidate_id: "c", baseline_ids: ["b1"] });
  const next = recordStep(ledger, { candidate_loss: 1, baseline_losses: { b1: 2 } });
  assert.equal(ledger.observations, 0);
  assert.equal(next.observations, 1);
  assert.notEqual(ledger, next);
});

test("a missing baseline loss for a declared baseline is refused", () => {
  const ledger = createLedger({ task_id: "t", candidate_id: "c", baseline_ids: ["b1", "b2"] });
  assert.throws(() => recordStep(ledger, { candidate_loss: 1, baseline_losses: { b1: 2 } }), /missing a finite loss for b2/);
});

test("an improper (null) candidate loss advances observations but not the proper total", () => {
  let ledger = createLedger({ task_id: "t", candidate_id: "c", baseline_ids: ["b1"] });
  ledger = recordStep(ledger, { candidate_loss: null, baseline_losses: { b1: 2 }, proper: false });
  assert.equal(ledger.observations, 1);
  assert.equal(ledger.proper_observations, 0);
  assert.equal(ledger.cumulative_loss, 0);
});

test("finalize requires a full scope and produces a sealed, scoped record", () => {
  let ledger = createLedger({ task_id: "t", candidate_id: "c", baseline_ids: ["b1"] });
  ledger = recordStep(ledger, { candidate_loss: 1, baseline_losses: { b1: 4 } });
  assert.throws(() => finalizeCompetency(ledger, { horizon: {}, population: "p" }), /must declare source_versions/);
  const rec = finalizeCompetency(ledger, SCOPE);
  assert.equal(rec.schema, "CompetencyRecord@1");
  assert.equal(rec.competency_gain.b1, 3);
  assert.match(rec.content_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(rec.warrant_status, "unknown");
  assert.equal(rec.status, "experimental");
});
