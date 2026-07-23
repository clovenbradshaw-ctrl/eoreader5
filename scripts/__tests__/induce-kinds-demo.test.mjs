import { test } from "node:test";
import assert from "node:assert/strict";
import { runKindsDemo } from "../induce-kinds-demo.mjs";
import { validateKindCandidate } from "@eoreader/spec";

test("the kinds demo finds a kind only on the genuine regime-switch, refusing all four negative controls", () => {
  const results = runKindsDemo();
  const byPopulation = Object.fromEntries(results.map((r) => [r.population, r.kind]));
  const trendFlatKey = Object.keys(byPopulation).find((k) => k.includes("trend-flat"));
  assert.ok(byPopulation[trendFlatKey], "the genuine regime-switch should induce a kind");
  validateKindCandidate(byPopulation[trendFlatKey]);
  const negatives = Object.entries(byPopulation).filter(([k]) => !k.includes("trend-flat"));
  assert.equal(negatives.length, 3);
  for (const [label, kind] of negatives) assert.equal(kind, null, `${label} should induce no kind`);
});
