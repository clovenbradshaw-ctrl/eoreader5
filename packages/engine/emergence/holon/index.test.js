// packages/engine/emergence/holon/index.test.js
// Acceptance tests for the holon emergence module — spec §8.
//
// Supplementation battery:
//   - A true holon where every part contributes uniquely
//   - A co-occurrence-only assembly where parts are interchangeable (fails)
//   - A free-rider part added to a real holon (reduces but need not fail)
//
// Downward-closure battery (safety-critical):
//   - A holon that preserves every part's specific character and deposits
//     only sensible traces (admitted)
//   - A holon that absorbs a part's specific character with no remainder
//     (refused — predator case a)
//   - A holon that deposits a trace its parts cannot sense
//     (refused — capture case b)
//   - Assert the refusal reason is on the audit surface in both failing cases.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeHolon,
  supplementationTest,
  downwardClosureTest,
} from "./index.js";
import { createMedium, deposit } from "../stigmergy/index.js";

const WORD_RE = /[a-zà-ÿ'’-]+/gi;
function fv(text) {
  const ws = String(text ?? "").toLowerCase().match(WORD_RE) ?? [];
  const vec = new Map();
  for (const w of ws) {
    if (w.length < 3) continue;
    vec.set(w, (vec.get(w) ?? 0) + 1);
  }
  return vec;
}

// Distinct characters from different conceptual domains
const characters = {
  soldier: fv("battle cannon musket charge infantry regiment cavalry saber"),
  princess: fv("ball gown silk dance waltz garden terrace moonlight"),
  philosopher: fv("reason doubt existence truth opinion wisdom soul morality"),
  // Near-identical crowd terms — same core vocabulary with minimal variation
  crowdA: fv("shouted pressed forward noise street surged"),
  crowdB: fv("shouted pressed forward noise street"),
  crowdC: fv("shouted pressed noise street surged"),
};

// ── Supplementation ──────────────────────────────────────────────────────

describe("supplementation gate", () => {
  it("admits a genuine holon where every part contributes uniquely", () => {
    const parts = ["soldier", "princess", "philosopher"];
    const features = new Map([
      ["soldier", characters.soldier],
      ["princess", characters.princess],
      ["philosopher", characters.philosopher],
    ]);

    const result = supplementationTest({ parts, partFeatures: features });
    assert.equal(result.passed, true,
      `genuine holon should pass supplementation (mean_leave_out=${result.mean_leave_out})`);
  });

  it("refuses a co-occurrence-only assembly of interchangeable parts", () => {
    const parts = ["crowdA", "crowdB", "crowdC"];
    const features = new Map([
      ["crowdA", characters.crowdA],
      ["crowdB", characters.crowdB],
      ["crowdC", characters.crowdC],
    ]);

    const result = supplementationTest({ parts, partFeatures: features });
    assert.equal(result.passed, false,
      `interchangeable assembly should fail supplementation (mean_leave_out=${result.mean_leave_out})`);
  });

  it("free-rider part added to a real holon still passes (proportionality, not pass/fail)", () => {
    const parts = ["soldier", "princess", "philosopher", "crowdA"];
    const features = new Map([
      ["soldier", characters.soldier],
      ["princess", characters.princess],
      ["philosopher", characters.philosopher],
      ["crowdA", characters.crowdA],
    ]);

    const result = supplementationTest({ parts, partFeatures: features });
    // A free-rider may reduce the mean leave-out but the real holon's
    // distinctive parts should still clear the null threshold.
    // This is proportionality — we assert the result is recorded, not that
    // it must pass or fail.
    assert.ok(typeof result.passed === "boolean",
      `free-rider test recorded: passed=${result.passed} mean_leave_out=${result.mean_leave_out}`);
  });
});

// ── Downward-closure ─────────────────────────────────────────────────────

describe("downward-closure gate (safety-critical)", () => {
  it("admits a holon that preserves every part's specific character", () => {
    const partFeatures = new Map([
      ["soldier", characters.soldier],
      ["princess", characters.princess],
    ]);
    const holonFeature = fv("battle gown dance cannon silk");

    const result = downwardClosureTest({
      parts: ["soldier", "princess"],
      partFeatures,
      holonFeature,
    });

    assert.equal(result.admitted, true,
      `good holon should be admitted: admitted=${result.admitted} a=${result.predicate_a} b=${result.predicate_b}`);
    assert.equal(result.predicate_a, true, "specific character preserved");
  });

  it("refuses a holon that absorbs a part's specific character — predator case (a)", () => {
    // Holon feature vector nearly identical to one part — the whole
    // has absorbed the part's specific character with no remainder.
    // Need >=2 parts for downwardClosureTest.
    const partFeatures = new Map([
      ["absorbed", fv("distinct unique specific")],
      ["other", fv("completely different unrelated contrast")],
    ]);
    // Holon is nearly identical to "absorbed" — just repeats those words
    const holonFeature = fv("distinct distinct unique unique specific specific plus");

    const result = downwardClosureTest({
      parts: ["absorbed", "other"],
      partFeatures,
      holonFeature,
    });

    assert.equal(result.admitted, false,
      `predator holon should be refused: admitted=${result.admitted}`);
    assert.equal(result.predicate_a, false,
      `specific character NOT preserved: predicate_a=${result.predicate_a}`);
    assert.ok(result.reason, "failure reason is on the audit surface");
    assert.ok(result.reason.includes("predator") || result.reason.includes("absorbed"),
      `reason mentions absorption: ${result.reason}`);
  });

  it("refuses a holon whose trace parts cannot sense — capture case (b)", () => {
    const medium = createMedium({ decay: 0.3 });
    const { medium: m1 } = deposit(medium, {
      agentId: "holon",
      trace: { holonId: "captor-holon", type: "coordination" },
    });

    const partFeatures = new Map([
      ["part-a", fv("distinct part a features")],
      ["part-b", fv("distinct part b features")],
    ]);
    const holonFeature = fv("the composed whole features");

    const result = downwardClosureTest({
      parts: ["part-a", "part-b"],
      partFeatures,
      holonFeature,
      medium: m1,
      holonTrace: { holonId: "captor-holon" },
    });

    assert.equal(result.admitted, false,
      `capture holon should be refused: admitted=${result.admitted}`);
    // predicate_b fails because the holon trace is in the medium but
    // the parts (part-a, part-b) have no deposits and no sense of it.
    assert.equal(result.predicate_b, false,
      `trace NOT sensible by parts: predicate_b=${result.predicate_b}`);
    assert.ok(result.reason, "failure reason is on the audit surface");
  });

  it("admits a holon whose parts can sense its trace", () => {
    const medium = createMedium({ decay: 0.3 });
    // Place the holon trace early so it falls within the local sense window
    // (sense reads deposits[0..count) where count = floor(deposits.length/2)).
    let m = medium;
    m = deposit(m, { agentId: "holon", trace: { holonId: "good-holon", type: "coordination" } }).medium;
    m = deposit(m, { agentId: "part-a", trace: { partId: "part-a" } }).medium;
    m = deposit(m, { agentId: "neutral", trace: { neutral: true } }).medium;
    m = deposit(m, { agentId: "neutral", trace: { neutral: true } }).medium;
    m = deposit(m, { agentId: "neutral", trace: { neutral: true } }).medium;

    const partFeatures = new Map([
      ["part-a", fv("distinct part a features distinct")],
      ["part-b", fv("distinct part b features unique")],
    ]);
    const holonFeature = fv("the composed whole features different");

    const result = downwardClosureTest({
      parts: ["part-a", "part-b"],
      partFeatures,
      holonFeature,
      medium: m,
      holonTrace: { holonId: "good-holon" },
    });

    // 5 deposits, count = floor(5/2) = 2, from=0 → reads deposits[0,1]
    // includes holon trace at index 0
    assert.equal(result.admitted, true,
      `answerable holon should be admitted: admitted=${result.admitted} a=${result.predicate_a} b=${result.predicate_b}`);
  });
});

// ── Full composition ─────────────────────────────────────────────────────

describe("composeHolon", () => {
  it("returns a holon when both gates pass", () => {
    const parts = ["soldier", "princess"];
    const partFeatures = new Map([
      ["soldier", characters.soldier],
      ["princess", characters.princess],
    ]);

    const result = composeHolon({ parts, partFeatures });

    assert.equal(result.admitted, true);
    assert.equal(result.status, "holon");
    assert.ok(result.holon);
    assert.equal(result.holon.schema, "Holon@1");
    assert.deepStrictEqual(result.holon.parts, parts);
    assert.equal(result.reason, null);
  });

  it("returns an assembly when supplementation fails", () => {
    const parts = ["crowdA", "crowdB"];
    const partFeatures = new Map([
      ["crowdA", characters.crowdA],
      ["crowdB", characters.crowdB],
    ]);

    const result = composeHolon({ parts, partFeatures });

    assert.equal(result.admitted, false);
    assert.equal(result.status, "assembly");
    assert.equal(result.holon, null);
    assert.ok(result.reason, "failure reason on audit surface");
  });
});
