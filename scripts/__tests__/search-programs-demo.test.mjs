import { test } from "node:test";
import assert from "node:assert/strict";
import { runSearchDemo } from "../search-programs-demo.mjs";
import { validateCompetencyRecord } from "@eoreader/spec";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

test("the search demo rediscovers a competent program on a trend and ranks it above the mean", () => {
  const { trend } = runSearchDemo();
  const best = trend[0];
  assert.ok(best.reference_gain > 0, "top program should beat the global-mean reference");
  assert.match(JSON.stringify(best.program), /"last"|"diff"|"lag"/);
  validateCompetencyRecord(best.competency);
});

test("the search demo is a deterministic, replayable experiment", () => {
  const a = runSearchDemo();
  const b = runSearchDemo();
  assert.equal(canonicalHashSync(a.trend.map((r) => r.key)), canonicalHashSync(b.trend.map((r) => r.key)));
  assert.equal(canonicalHashSync(a.seasonal.map((r) => r.key)), canonicalHashSync(b.seasonal.map((r) => r.key)));
});
