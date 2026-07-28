// presence.test.js — enforcement of docs/nameless-referent.md.
// If a change here starts failing, it is probably re-deriving identity from
// strings. Read the doc before "fixing" a test.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  namesCorefer,
  admitReferent,
  presenceByFrame,
  resolveSpans,
} from "./presence.js";

// Hand-built frames: presence only needs { offset, order, text }.
const mkFrames = (...texts) =>
  texts.map((text, i) => ({ offset: i * 1000, order: i, text }));

test("holon: structural name coreference admits variants, not lookalikes", () => {
  const frames = mkFrames("Natásha danced.", "Prince Andrew watched.");
  const { surfaces, events } = admitReferent(frames, { id: "natasha", name: "Natásha" }, {
    nameSurfaces: ["Natásha Rostóva", "Prince Andrew", "Prince Vasili", "CHAPTER XIII\n\nWhen Natásha"],
  });
  const labels = surfaces.map((s) => s.surface);
  assert.ok(labels.includes("Natásha Rostóva"), "containment variant admitted");
  assert.ok(!labels.includes("Prince Andrew"), "shared honorific is not identity");
  assert.ok(!labels.some((l) => l.includes("\n")), "chapter-header spans rejected");
  // every admitted surface has an explicit event — no implicit admission
  for (const l of labels) {
    assert.ok(events.some((e) => e.type === "DEF.admit" && e.surface === l), `event for ${l}`);
  }
});

test("emanon: seed handle counts, absent prior yields a typed gap — never a silent zero", () => {
  const frames = mkFrames("the creature moved", "nothing here");
  const { surfaces, gaps } = admitReferent(frames, { id: "creature" }, {});
  const presence = presenceByFrame(frames, surfaces);
  assert.ok(presence.get(0) > 0, "seed 'creature' counts as a surface");
  const gap = gaps.find((g) => g.reason === "descriptor_aliases_unresolved");
  assert.ok(gap, "missing prior is reported");
  assert.equal(gap.tier, "model");
  assert.equal(gap.needsWitness, true);
});

test("scope: the same string points at different referents in different spans", () => {
  // "I" belongs to the creature only inside [2000, 3000).
  const frames = mkFrames("I walked to town.", "I hated him.", "I am thy creature.", "I sailed north.");
  const surfaces = [{ surface: "i", weight: 1, scope: [{ from: 2000, to: 3000 }] }];
  const presence = presenceByFrame(frames, surfaces);
  assert.equal(presence.get(0), 0, "out of scope: not the referent");
  assert.equal(presence.get(1), 0, "out of scope: not the referent");
  assert.ok(presence.get(2) > 0, "in scope: the referent speaks");
  assert.equal(presence.get(3), 0, "out of scope: not the referent");
});

test("narrator spans admit first person at reduced weight, via anchors", () => {
  const text = "Victor spoke. THE TALE BEGINS I was benevolent and good. THE TALE ENDS Victor again.";
  const frames = [{ offset: 0, order: 0, text }];
  const { resolved } = resolveSpans(text, [{ fromAnchor: "THE TALE BEGINS", toAnchor: "THE TALE ENDS" }]);
  assert.equal(resolved.length, 1);
  const { surfaces } = admitReferent(frames, {
    id: "creature",
    surfaces: [{ surface: "the creature" }],
    narratorSpans: [{ fromAnchor: "THE TALE BEGINS", toAnchor: "THE TALE ENDS" }],
  }, { fullText: text });
  const fp = surfaces.filter((s) => ["i", "me", "my", "myself"].includes(s.surface));
  assert.equal(fp.length, 4, "first-person surfaces admitted");
  assert.ok(fp.every((s) => s.weight < 1), "pronoun sighting weighs less than a name");
  assert.ok(fp.every((s) => Array.isArray(s.scope)), "and only inside the narrator span");
});

test("anchor resolution tolerates whitespace/line-wrap differences", () => {
  // The anchor was authored against a single-line quote, but the live text
  // has been re-wrapped (line break + extra interior spacing) — same
  // characters, different whitespace. Exact substring match fails; the
  // whitespace-collapsed mapping (shared with text-organ.js::locateRawSpan)
  // must still find it.
  const text = "Victor spoke. THE TALE\n  BEGINS I was benevolent   and good. THE TALE ENDS Victor again.";
  const { resolved, unresolved } = resolveSpans(text, [
    { fromAnchor: "THE TALE BEGINS", toAnchor: "THE TALE ENDS" },
  ]);
  assert.equal(unresolved.length, 0, "whitespace-flexible match should resolve, not drop, the anchor");
  assert.equal(resolved.length, 1);
  const { from, to } = resolved[0];
  assert.equal(text.slice(from, from + 3), "THE", "resolved offset points at the true raw start");
  assert.ok(to > from);
});

test("unresolved anchors are reported, never guessed", () => {
  const { surfaces, gaps } = admitReferent(
    [{ offset: 0, order: 0, text: "some text" }],
    { id: "x", surfaces: [{ surface: "the thing" }], narratorSpans: [{ fromAnchor: "NOT IN TEXT" }] },
    { fullText: "some text" },
  );
  assert.ok(gaps.some((g) => g.reason === "narrator_span_unresolved"));
  assert.ok(!surfaces.some((s) => ["i", "me"].includes(s.surface)), "no first person admitted on a failed anchor");
});

test("admission is event-sourced: the projection carries every surface", () => {
  const { events, projection, referentId } = admitReferent(
    mkFrames("x"),
    { id: "creature", surfaces: [{ surface: "the monster" }, { surface: "the dæmon" }] },
    { fullText: "x" },
  );
  assert.ok(events.some((e) => e.type === "SYN.merge"), "descriptor admission is a merge event");
  const ref = [...projection.values()].find((r) => r.id === referentId && !r.mergedInto);
  assert.ok(ref, "referent projected");
  const projected = [...ref.surfaces];
  assert.ok(projected.includes("the monster"));
  assert.ok(projected.includes("the dæmon"));
});

test("REGRESSION GUARD: no distributional coref derivation is exported", async () => {
  // Frame-lift and complementary-distribution admission both failed measurably
  // (see module header). If someone re-adds a derivation export, this fails
  // and docs/nameless-referent.md explains why it must not come back.
  const mod = await import("./presence.js");
  for (const name of Object.keys(mod)) {
    assert.ok(
      !/derive|lift|distribution/i.test(name),
      `export "${name}" looks like a distributional coref derivation`,
    );
  }
});
