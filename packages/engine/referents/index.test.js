import { test } from "node:test";
import assert from "node:assert/strict";
import { projectReferents, surfacesIndicateSameReferent } from "./index.js";

test("same-string surfaces do not auto-merge across distinct referents", () => {
  const events = [
    { type: "admit", referent_id: "r1", surface: "Alex" },
    { type: "admit", referent_id: "r2", surface: "Alex" },
  ];
  const projection = projectReferents(events);
  assert.equal(projection.size, 2);
  assert.notEqual(
    [...projection.values()].find((r) => r.id === "r1"),
    [...projection.values()].find((r) => r.id === "r2")
  );
});

test("different strings can indicate one referent via admit", () => {
  const events = [
    { type: "admit", referent_id: "r1", surface: "Alex" },
    { type: "admit", referent_id: "r1", surface: "the mayor" },
  ];
  assert.equal(surfacesIndicateSameReferent(events, "Alex", "the mayor"), true);
});

test("merge preserves all prior surfaces from both sides", () => {
  const events = [
    { type: "admit", referent_id: "r1", surface: "Alex" },
    { type: "admit", referent_id: "r2", surface: "the mayor" },
    { type: "merge", into_id: "r1", from_ids: ["r2"], provenance: { reason: "confirmed same person" } },
  ];
  const projection = projectReferents(events);
  assert.equal(projection.size, 1);
  const survivor = projection.get("r1");
  assert.deepEqual(new Set(survivor.surfaces), new Set(["Alex", "the mayor"]));
});

test("split creates new referents without deleting the source's admitted history", () => {
  const events = [
    { type: "admit", referent_id: "r1", surface: "the twins" },
    {
      type: "split",
      from_id: "r1",
      into_ids: ["r1a", "r1b"],
      surfaces: { r1a: ["Alex"], r1b: ["Sam"] },
    },
  ];
  const projection = projectReferents(events);
  assert.ok(projection.has("r1"));
  assert.deepEqual(projection.get("r1").surfaces, ["the twins"]);
  assert.deepEqual(projection.get("r1a").surfaces, ["Alex"]);
  assert.deepEqual(projection.get("r1b").surfaces, ["Sam"]);
});

test("same_as proposal alone does not unify identity", () => {
  const events = [
    { type: "admit", referent_id: "r1", surface: "Alex" },
    { type: "admit", referent_id: "r2", surface: "the mayor" },
    { type: "same_as", referent_id: "r1", target_id: "r2", provenance: {} },
  ];
  assert.equal(surfacesIndicateSameReferent(events, "Alex", "the mayor"), false);
});
