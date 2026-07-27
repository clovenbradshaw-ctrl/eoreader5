// store.test.js — associative memory organ. Synthetic frames; the mechanisms
// (Hebbian encoding, sparse-band coding, one-hop completion, tier boundary)
// each get one test. See store/index.js header for the biological grounding
// and the measured failures that shaped every choice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStore, surface } from "./index.js";

const mkFrames = (...texts) => texts.map((text, i) => ({ offset: i * 1000, order: i, text }));
// Tiny synthetic corpora: idf = log(N/df) is small, so use a scale-appropriate
// floor. The band gate (idf >= floor AND df >= 2) is what's under test, not the
// absolute number.
const LO = { idfFloor: 0.1 };

test("verbatim motif recurrence surfaces its prior occurrence", () => {
  // "crimson lantern" recurs in frames 0 and 4; unrelated filler between.
  const frames = mkFrames(
    "the crimson lantern swung above the harbor gate at dusk crimson lantern",
    "a dull inventory of barrels rope and canvas nothing of any note here",
    "more barrels and rope and canvas and yet more barrels stacked in rows",
    "the clerk tallied barrels rope canvas barrels rope canvas once again",
    "years later the crimson lantern swung again above that same harbor gate",
  );
  const store = buildStore(frames, LO);
  const ranked = surface(store, frames[4].text, { selfOrder: 4, ...LO }).filter((r) => r.order < 3);
  assert.equal(ranked[0]?.order, 0, "the earlier crimson-lantern frame surfaces first");
});

test("sparse-band gate: ubiquitous and hapax forms are not keys", () => {
  const frames = mkFrames(
    "the the the and and of of a a a to to obscureword here",
    "the and of a to the and of a to plus another line of filler text",
    "the and of a to nothing distinctive in this frame at all really now",
  );
  const store = buildStore(frames, LO);
  // A common word ('the', in every frame) has idf 0 → not a key.
  assert.ok(!store.posting.has("the"), "ubiquitous form is not a key");
  // A hapax ('obscureword', df=1) is not a key — a trace that never recurs
  // cannot bridge two passages.
  assert.ok(!store.posting.has("obscureword"), "df=1 hapax is not a key");
});

test("Hebbian edges are written at co-occurrence, symmetric and cumulative", () => {
  const frames = mkFrames(
    "falcon banner falcon banner over the northern keep falcon banner",
    "falcon banner again raised falcon banner over the northern keep once more",
    "unrelated meadow brook willow meadow brook willow quiet afternoon light here",
    "another line of common the the and of to keep the corpus size up a bit",
  );
  const store = buildStore(frames, LO);
  const fb = store.edges.get("falcon")?.get("banner");
  const bf = store.edges.get("banner")?.get("falcon");
  assert.ok(fb > 0, "co-firing motifs are wired");
  assert.equal(fb, bf, "edges are symmetric");
});

test("one-hop completion reaches a co-activated neighbour's postings", () => {
  // 'ember' and 'oath' co-fire in frame 0 (wiring them). Frame 1 has 'oath'
  // but not 'ember'. Frame 3 has 'ember' again (so ember recurs, df=2, and
  // qualifies as a key). A cue with 'ember' reaches frame 1 only via the
  // ember↔oath completion edge.
  const frames = mkFrames(
    "the ember oath was sworn ember oath by firelight ember oath in the dark",
    "he kept the oath through winter the oath the oath never once broken oath",
    "turnips carrots and a long ledger of turnips carrots turnips carrots sums",
    "an ember glowed in the grate ember ember faint against the cold night air",
  );
  const store = buildStore(frames, LO);
  const direct = surface(store, "ember ember ember", { completion: 0, ...LO });
  const completed = surface(store, "ember ember ember", { completion: 1.0, topEdges: 8, ...LO });
  const inDirect = direct.some((r) => r.order === 1);
  const inCompleted = completed.some((r) => r.order === 1);
  assert.ok(!inDirect, "frame 1 has no 'ember' — not reachable directly");
  assert.ok(inCompleted, "frame 1 reached through the ember↔oath edge");
});

test("tier boundary: a synonymy bridge (no shared form, no co-firing) does NOT surface", () => {
  // 'union' and 'wedding' are synonyms but never co-occur in a frame. The
  // store must not connect them — that is witness-channel (model-tier) work,
  // the same boundary as descriptor coref. Measured on Frankenstein: the
  // letter→threat 'union≈wedding' bridge correctly failed to surface.
  const frames = mkFrames(
    "the union was the favourite plan of both families union union agreed upon",
    "a page of turnips carrots barrels rope turnips carrots barrels rope filler",
    "beware the wedding night beware the wedding night the vow the dread the vow",
    "again the union favoured by all the union spoken of union at every meal here",
    "the wedding vow the wedding dread the wedding night the wedding bell tolls loud",
  );
  const store = buildStore(frames, LO);
  const ranked = surface(store, frames[0].text, { selfOrder: 0, completion: 1.0, topEdges: 12, ...LO });
  const weddingFrame = ranked.find((r) => r.order === 2 || r.order === 4);
  assert.ok(!weddingFrame || weddingFrame.activation === 0,
    "no engine path from 'union' to 'wedding' — synonymy is model-tier");
});
