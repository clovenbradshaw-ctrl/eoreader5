import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { discoverCast, clusterSurfaces, castSurfaces } from "./discover-cast.js";

const FRANKENSTEIN = "../pg84.txt";

test("names cluster by containment and shared final token", () => {
  const { clusters } = clusterSurfaces([
    { surface: "Elizabeth Lavenza", frames: 100, mentions: 107 },
    { surface: "Elizabeth", frames: 90, mentions: 95 },
    { surface: "Lavenza", frames: 4, mentions: 4 },
    { surface: "Justine Moritz", frames: 46, mentions: 56 },
  ]);
  const eliz = clusters.find((c) => c.surfaces.some((s) => s.surface === "Elizabeth Lavenza"));
  assert.equal(eliz.surfaces.length, 3, "containment and surname join one cluster");
  assert.equal(clusters.length, 2);
});

test("a surface matching two referents is dropped to a gap, not assigned", () => {
  // The measured failure relationship-graph.js documents: a bare "Prince"
  // vocative absorbed into whichever prince came first is a silent wrong
  // answer, which this project holds is worse than silence.
  const { gaps } = clusterSurfaces([
    { surface: "Prince Andrew", frames: 700, mentions: 741 },
    { surface: "Prince Vasili", frames: 200, mentions: 210 },
    { surface: "Prince", frames: 400, mentions: 500 },
  ]);
  const amb = gaps.find((g) => g.type === "ambiguous_surface");
  assert.ok(amb, "the ambiguity must be reported");
  assert.equal(amb.surface, "Prince");
  assert.equal(amb.candidates.length, 2);
});

test("the Born-null gate drops texture and keeps referents", (t) => {
  if (!fs.existsSync(FRANKENSTEIN)) return t.skip("source text not present");
  const { cast, considered, gaps } = discoverCast(fs.readFileSync(FRANKENSTEIN, "utf8"));
  assert.ok(cast.length < considered, "the gate must reject something, or it is not a gate");
  assert.ok(gaps.some((g) => g.type === "did_not_individuate"));

  const ids = castSurfaces(cast);
  for (const who of ["elizabeth", "justine", "clerval", "victor", "frankenstein"]) {
    assert.ok(ids.some((s) => s.includes(who)), `${who} should be discovered from the text alone`);
  }
});

test("the unnamed central figure is correctly ABSENT — that is the emanon gap", (t) => {
  if (!fs.existsSync(FRANKENSTEIN)) return t.skip("source text not present");
  const { cast } = discoverCast(fs.readFileSync(FRANKENSTEIN, "utf8"));
  const ids = castSurfaces(cast);
  // "the creature" is a DESCRIPTOR, not a name. Deciding it predicates a being
  // is MODEL-tier and must stay injected; discovering it here would mean this
  // module had quietly started doing descriptor coref.
  assert.ok(!ids.includes("creature"), "an emanon must not be discovered as a name");
});

test("identity is injected, never derived", (t) => {
  if (!fs.existsSync(FRANKENSTEIN)) return t.skip("source text not present");
  const text = fs.readFileSync(FRANKENSTEIN, "utf8");
  const find = (r, n) => r.cast.find((x) => x.surfaces.some((s) => s.toLowerCase() === n));

  // "Victor Frankenstein" appears ZERO times in the book, so no containment or
  // shared-token path exists between them. Keeping them apart is correct.
  const bare = discoverCast(text);
  assert.notEqual(find(bare, "victor"), find(bare, "frankenstein"),
    "without a bridging surface these must stay separate");

  // Declared, they merge — and the declaration is on the record as a gap entry.
  const declared = discoverCast(text, { identities: [["Victor", "Frankenstein"]] });
  assert.equal(find(declared, "victor"), find(declared, "frankenstein"));
  assert.ok(declared.gaps.some((g) => g.type === "declared_identity"));
});
