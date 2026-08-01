// multi-altitude-fold.test.js — closes the loop from "locateRawSpan works in
// isolation" (text-organ.test.js) to "the real pipeline actually wires it
// correctly". A fixture with mixed line wraps and internal whitespace
// exercises exactly the frameText/snapToSentences decoupling the resolver
// exists to fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { multiAltitudeFold } from "./multi-altitude-fold.js";

function flatten(t) {
  return String(t ?? "").replace(/\s+/g, " ").trim();
}

// Built from short paragraphs with irregular line wraps and multi-space
// runs, so window-trimming (frameText) and whitespace-collapse
// (snapToSentences) both actually engage — a golden-path fixture would
// hide the offset/text decoupling this exists to catch.
const FIXTURE = `
Chapter One.

Natasha   Rostova   stood    at
the edge of the ballroom,  her
heart pounding with anticipation.
She had never felt so alive as
the orchestra began to play.

Natasha danced with Prince Andrei
until the candles burned low and
the guests began to drift toward
the doors, murmuring about the
late hour and the long ride home.

Later that night Natasha lay awake,
replaying every step of the dance,
every word exchanged beneath the
chandeliers, unable to sleep for
the fullness of her own happiness.
`.repeat(6); // repeat so frameText's window/hop actually produces multiple frames

test("multiAltitudeFold spans carry a verified raw span matching the source", () => {
  const packet = multiAltitudeFold(FIXTURE, "Natasha", { altitudes: { 0: 3, 4: Infinity } });
  const allSpans = [...packet.altitudes[0].spans, ...packet.altitudes[4].spans];
  assert.ok(allSpans.length > 0, "fixture should produce at least one span");

  let anyDrift = false;
  for (const span of allSpans) {
    if (span.length === 0) continue;
    assert.equal(span.verified, true, `span #${span.idx} should resolve a verified raw span`);
    assert.equal(
      FIXTURE.slice(span.offset, span.offset + span.length),
      span.raw,
      `span #${span.idx}: raw field must equal the literal source slice at [offset, offset+length)`
    );
    assert.equal(
      flatten(span.raw),
      flatten(span.text),
      `span #${span.idx}: raw span must reproduce the displayed text once whitespace is flattened`
    );
    if (span.drift !== 0) anyDrift = true;
  }
  assert.ok(anyDrift, "this fixture's line wraps should force at least one nonzero-drift resolution");
});

test("keyMoments also carry verified raw spans", () => {
  const packet = multiAltitudeFold(FIXTURE, "Natasha", { altitudes: { 4: Infinity } });
  const moments = packet.altitudes[4].keyMoments;
  assert.ok(moments.length > 0);
  for (const m of moments) {
    if (m.length === 0) continue;
    assert.equal(m.verified, true);
    assert.equal(FIXTURE.slice(m.offset, m.offset + m.length), m.raw);
  }
});
