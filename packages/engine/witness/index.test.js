import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  recordWitnessEvent,
  recordPlayRun,
  recordConvergenceEvent,
  recordSurplusEvent,
  readAllWitnessEvents,
  configureWitnessLog,
  clearWitnessLog,
} from "./index.js";

beforeEach(() => {
  // Use null to trigger in-memory fallback (no filesystem I/O)
  configureWitnessLog(null);
});

test("recordWitnessEvent stores an event and the log is readable", () => {
  recordWitnessEvent({ type: "fold", schema: "WitnessEvent@1", data: { test: true } });
  const entries = readAllWitnessEvents();
  assert.ok(entries.length > 0, "should have stored the entry");
});

test("witness log stores events but content is sanitized", () => {
  recordWitnessEvent({ type: "secret", schema: "WitnessEvent@1", data: { value: 42 } });
  const entries = readAllWitnessEvents();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "secret");
});

test("recordPlayRun records play-mode run", () => {
  recordPlayRun({ steps: 5, convergence: { coincidentPairs: 2, lensCount: 2 } });
  const entries = readAllWitnessEvents();
  assert.ok(entries.length > 0, "play run should be logged");
  const playEntry = entries[0];
  assert.equal(playEntry.type, "play_run");
});

test("recordConvergenceEvent records convergence info", () => {
  recordConvergenceEvent({
    lensCount: 2,
    coincidentPairs: 3,
    convergenceFraction: 0.75,
  });
  const entries = readAllWitnessEvents();
  assert.ok(entries.length > 0, "convergence event should be logged");
  const entry = entries[0];
  assert.equal(entry.type, "convergence");
});

test("recordSurplusEvent records surplus admission", () => {
  recordSurplusEvent({
    admitted: true,
    gates: { gate1: { passed: true }, gate2: { passed: true } },
  });
  const entries = readAllWitnessEvents();
  assert.ok(entries.length > 0, "surplus event should be logged");
  const entry = entries[0];
  assert.equal(entry.type, "surplus_admitted");
  assert.equal(entry.admitted, true);
});

test("multiple events are stored and readable", () => {
  recordWitnessEvent({ type: "play_run", schema: "WitnessEvent@1" });
  recordWitnessEvent({ type: "convergence", schema: "WitnessEvent@1" });
  recordWitnessEvent({ type: "surplus_admitted", schema: "WitnessEvent@1" });
  const entries = readAllWitnessEvents();
  assert.equal(entries.length, 3);
  assert.equal(entries[0].type, "play_run");
  assert.equal(entries[1].type, "convergence");
  assert.equal(entries[2].type, "surplus_admitted");
});

test("clearWitnessLog empties the log", () => {
  recordWitnessEvent({ type: "test", schema: "WitnessEvent@1" });
  clearWitnessLog();
  const entries = readAllWitnessEvents();
  assert.equal(entries.length, 0);
});
