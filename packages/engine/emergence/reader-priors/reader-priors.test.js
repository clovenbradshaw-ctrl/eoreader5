// emergence/reader-priors/reader-priors.test.js — Verify that priorConfidenceBoost
// derives its weights from the reader's observed history, never from frozen constants.
//
// The architectural rule: every weight starts as a NULL (0 — no prior belief) and
// converges toward the reader's observed calibration as evidence accumulates.
// The reader's own history determines what they can trust; no constant from a
// single center imposes belief.

import assert from "node:assert/strict";
import test from "node:test";
import { createReaderPrior, priorConfidenceBoost } from "./index.js";

// ── Helper: build a prior with specific familiarity ──

function testPrior(familiarity = 0.7, frames = {}, experiences = {}) {
  return createReaderPrior({
    id: "test-reader",
    label: "Test Reader",
    familiarity,
    interpretiveFrames: frames,
    experiential: experiences,
  });
}

// ── Fresh reader: no history → all boosts are 0 ──

test("fresh reader with no history gets zero boost", () => {
  const prior = testPrior(0.8);
  const assertion = { frame: "marxist" };

  // No readerHistory → all weights are null (0)
  const boost = priorConfidenceBoost(prior, assertion, null);
  assert.equal(boost, 0, "fresh reader with no history should get zero boost");
});

test("fresh reader with empty history gets zero boost", () => {
  const prior = testPrior(0.8);
  const assertion = { frame: "marxist" };

  // Empty history (0 assertions) → all weights are null
  const boost = priorConfidenceBoost(prior, assertion, { totalAssertions: 0 });
  assert.equal(boost, 0, "reader with zero assertions should get zero boost");
});

// ── Established history: boost converges toward observed calibration ──

test("reader with established history gets non-zero familiarity boost", () => {
  const prior = testPrior(0.8);
  const history = {
    totalAssertions: 50,
    familiarityCalibration: 0.2,
    maxObservedBoost: 0.3,
  };

  const boost = priorConfidenceBoost(prior, {}, history);
  assert(boost > 0, "established reader should get positive boost");
  // 0.8 * (0.2 * sigmoid(50)) ≈ 0.8 * 0.2 * 0.98 ≈ 0.157
  assert(boost < 0.25, "boost should not exceed familiarity * calibration");
});

test("reader with few assertions gets damped boost", () => {
  const prior = testPrior(0.8);
  const history = {
    totalAssertions: 1,
    familiarityCalibration: 0.2,
    maxObservedBoost: 0.3,
  };

  const boost = priorConfidenceBoost(prior, {}, history);
  // With only 1 assertion, sigmoid weight is small: 0.2 * (1 - 1/2) = 0.1
  // 0.8 * 0.1 = 0.08
  assert(boost > 0, "even one assertion should give some boost");
  assert(boost < 0.15, "single assertion should give very small boost");
});

// ── Frame calibration: boost reflects actual frame usage ──

test("frame boost uses reader's observed frame frequency", () => {
  const prior = testPrior(0.7, { marxist: 0.9 });
  const assertion = { frame: "marxist" };
  const history = {
    totalAssertions: 50,
    frameUsageFrequency: new Map([["marxist", 0.8]]),
    maxObservedBoost: 0.3,
  };

  const boost = priorConfidenceBoost(prior, assertion, history);
  // Frame boost: 0.9 * (0.8 * sigmoid(50)) ≈ 0.9 * 0.8 * 0.98 ≈ 0.706
  // Plus familiarity boost: 0.7 * (0 * sigmoid) = 0 (no famCalibration set)
  // Total ≈ 0.706 capped at ~0.3
  assert(boost > 0, "frame match with history should give boost");
});

test("frame not in reader's history gets zero frame boost", () => {
  const prior = testPrior(0.7, { marxist: 0.9 });
  const assertion = { frame: "marxist" };
  const history = {
    totalAssertions: 50,
    frameUsageFrequency: new Map([["feminist", 0.8]]), // different frame
    maxObservedBoost: 0.3,
  };

  const boost = priorConfidenceBoost(prior, assertion, history);
  // Marxist frame is not in frameUsageFrequency → frameFreq = 0 → no boost
  // But familiarityCalibration is null → 0 weight
  // So total should be 0
  assert.equal(boost, 0, "frame not in history should give zero frame boost");
});

// ── Contradictory history: boost softens ──

test("reader with contradictory history gets damped boost", () => {
  const prior = testPrior(0.9, { marxist: 0.9 });
  const assertion = { frame: "marxist" };
  const history = {
    totalAssertions: 50,
    frameUsageFrequency: new Map([["marxist", 0.2]]), // only uses it 20% of the time
    maxObservedBoost: 0.3,
  };

  const boost = priorConfidenceBoost(prior, assertion, history);
  // Frame boost: 0.9 * (0.2 * 0.98) ≈ 0.176
  assert(boost > 0 && boost < 0.3, "contradictory history should damp boost");
});

// ── Experience calibration ──

test("experience boost uses reader's observed experience frequency", () => {
  const prior = createReaderPrior({
    id: "test-reader",
    label: "Test Reader",
    familiarity: 0.6,
    experiential: { combat: 0.8 },
  });
  const assertion = { experience: "combat" };
  const history = {
    totalAssertions: 50,
    experienceUsageFrequency: new Map([["combat", 0.7]]),
    maxObservedBoost: 0.3,
  };

  const boost = priorConfidenceBoost(prior, assertion, history);
  assert(boost > 0, "experience match with history should give boost");
});

// ── Cap: derived from reader's max observed boost ──

test("cap is derived from reader's max observed boost", () => {
  const prior = testPrior(0.5);
  const history = {
    totalAssertions: 100,
    familiarityCalibration: 0.9, // very high calibration
    maxObservedBoost: 0.15, // but reader has never achieved high boosts
  };

  const boost = priorConfidenceBoost(prior, {}, history);
  // Cap with maxObservedBoost=0.15 and 100 assertions:
  // sigmoid(0.15, 100) ≈ 0.148
  assert(boost <= 0.15, "cap should respect reader's max observed boost");
});

test("cap converges upward as reader demonstrates higher boosts", () => {
  const prior = testPrior(0.5);
  const history = {
    totalAssertions: 100,
    familiarityCalibration: 0.9,
    maxObservedBoost: 0.4,
  };

  const boost = priorConfidenceBoost(prior, {}, history);
  // Cap: sigmoid(0.4, 100) ≈ 0.396
  assert(boost <= 0.4, "cap should grow as reader demonstrates capability");
});

// ── Monocentric prevention: no constant survives a null reader ──

test("no hardcoded constant produces a boost for a null reader", () => {
  const prior = testPrior(1.0, { marxist: 1.0 });
  const assertion = {
    frame: "marxist",
    experience: "combat",
    currentState: new Map([["test", 1]]),
    stats: { meanShift: 0.5, maxShift: 0.8 },
  };

  // Null history
  const boost1 = priorConfidenceBoost(prior, assertion, null);
  assert.equal(boost1, 0, "null reader with max prior and max assertion should get zero");

  // Empty history
  const boost2 = priorConfidenceBoost(prior, assertion, { totalAssertions: 0 });
  assert.equal(boost2, 0, "empty-history reader with max prior and max assertion should get zero");
});
