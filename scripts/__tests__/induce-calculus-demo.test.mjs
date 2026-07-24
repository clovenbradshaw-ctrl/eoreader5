import { test } from "node:test";
import assert from "node:assert/strict";
import { runCalculusDemo } from "../induce-calculus-demo.mjs";
import { validateCalculusCandidate } from "@eoreader/spec";

test("the calculus demo finds a calculus only on the genuine family, refusing both negative controls", () => {
  const results = runCalculusDemo();
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r.calculus]));
  const trendSeasonKey = Object.keys(byLabel).find((k) => k.includes("trend-season"));
  assert.ok(byLabel[trendSeasonKey], "independent realizations of one generative structure should induce a calculus");
  validateCalculusCandidate(byLabel[trendSeasonKey]);
  assert.deepEqual(byLabel[trendSeasonKey].proposed_extensions, [], "step 9 is opted into by the demo and honestly finds nothing to promote (see module header)");
  const negatives = Object.entries(byLabel).filter(([k]) => !k.includes("trend-season"));
  assert.equal(negatives.length, 2);
  for (const [label, calculus] of negatives) assert.equal(calculus, null, `${label} should induce no calculus`);
});
