// text-organ.test.js — raw-span provenance (locateRawSpan). See the
// "Raw span provenance" section header in text-organ.js: offset/text pairs
// produced by frameText (trims leading whitespace without moving offset)
// and snapToSentences (collapses interior whitespace) are NOT guaranteed to
// be the literal source slice at that offset. locateRawSpan recovers the
// true raw span or reports a typed gap — never a silent guess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { locateRawSpan } from "./text-organ.js";

test("exact match: zero drift when offset already points at the text", () => {
  const source = "The quick brown fox jumps over the lazy dog.";
  const offset = source.indexOf("brown fox");
  const r = locateRawSpan(source, offset, "brown fox");
  assert.equal(r.verified, true);
  assert.equal(r.offset, offset);
  assert.equal(r.length, "brown fox".length);
  assert.equal(r.raw, "brown fox");
  assert.equal(r.drift, 0);
});

test("frameText bug case: leading whitespace trimmed away from a window", () => {
  // frameText slices a window at `offset`, then does chunk.trim() for its
  // `text` field but never adjusts `offset` for what trim() dropped.
  const source = "prelude text here.   \n\n  The count arrived at the ball.";
  const windowOffset = source.indexOf("   \n\n  The count"); // untrimmed window start
  const displayText = "The count arrived at the ball.";       // post chunk.trim()
  const r = locateRawSpan(source, windowOffset, displayText);
  assert.equal(r.verified, true);
  assert.ok(r.drift > 0, "true offset is after the untrimmed window start");
  assert.equal(r.offset, source.indexOf(displayText));
  assert.equal(r.raw, displayText);
});

test("snapToSentences bug case: interior whitespace/newlines collapsed", () => {
  // snapToSentences replaces /\s+/g with a single space before snapping to
  // a sentence boundary, so the display text has fewer, single-space
  // whitespace runs than the raw source (which may have line wraps).
  const source = "Chapter start.\nNatasha   danced\nall   night\nlong. Next sentence.";
  const displayText = "Natasha danced all night long.";
  const approxOffset = source.indexOf("Natasha");
  const r = locateRawSpan(source, approxOffset, displayText);
  assert.equal(r.verified, true);
  assert.ok(r.raw.includes("\n"), "raw span retains the source's real line breaks");
  assert.ok(r.length > displayText.length, "raw span is longer than the collapsed display text");
  assert.equal(r.raw.replace(/\s+/g, " ").trim(), displayText);
});

test("CRLF source: whitespace-based matching needs no CRLF pre-normalization", () => {
  const source = "Intro.\r\nThe letter arrived\r\nat dawn\r\nwithout warning. Epilogue.";
  const displayText = "The letter arrived at dawn without warning.";
  const approxOffset = source.indexOf("The letter");
  const r = locateRawSpan(source, approxOffset, displayText);
  assert.equal(r.verified, true);
  assert.ok(r.raw.includes("\r\n"));
  assert.equal(r.raw.replace(/\s+/g, " ").trim(), displayText);
});

test("recurring phrase: picks the occurrence nearest the approximate offset, not the first", () => {
  const filler = "x".repeat(50);
  const phrase = "the old house on the hill";
  const source = `${phrase}${filler}${phrase}${filler}${phrase}`;
  const firstOccurrence = source.indexOf(phrase);
  const secondOccurrence = source.indexOf(phrase, firstOccurrence + 1);
  const thirdOccurrence = source.indexOf(phrase, secondOccurrence + 1);
  assert.ok(secondOccurrence > firstOccurrence && thirdOccurrence > secondOccurrence);
  // approxOffset sits right next to the SECOND occurrence, far from the first/third.
  const r = locateRawSpan(source, secondOccurrence + 2, phrase);
  assert.equal(r.verified, true);
  assert.equal(r.offset, secondOccurrence);
});

test("no match within the search radius: typed gap, not a guessed slice", () => {
  const source = "a".repeat(10000) + "the real sentence is here" + "b".repeat(10000);
  // displayText was altered beyond whitespace (a real ellipsis-truncation
  // case) so it can never be found verbatim in the source.
  const r = locateRawSpan(source, 5000, "the real sentence is here but truncated differently");
  assert.equal(r.verified, false);
  assert.equal(r.raw, null);
  assert.equal(r.reason, "no_match_in_window");
});

test("no match: text present in source but outside the search radius", () => {
  const source = "the real sentence is here" + "z".repeat(20000);
  const r = locateRawSpan(source, 15000, "the real sentence is here", { radius: 50 });
  assert.equal(r.verified, false);
  assert.equal(r.raw, null);
});

test("degenerate input: empty text, missing offset, empty source never throw", () => {
  assert.equal(locateRawSpan("some source", null, "text").verified, false);
  assert.equal(locateRawSpan("some source", 0, "").verified, false);
  assert.equal(locateRawSpan("", 0, "text").verified, false);
  assert.equal(locateRawSpan("some source", -1, "text").verified, false);
  assert.doesNotThrow(() => locateRawSpan(undefined, undefined, undefined));
});

test("frame-boundary crossing: true text starts in the next overlapping frame", () => {
  // Simulates a hop-boundary case: the approximate offset is the PRIOR
  // frame's start, but the sentence actually begins ~900 chars later, in
  // the next (overlapping) frame's window.
  const prefix = "words ".repeat(150); // ~900 chars of filler between frames
  const source = prefix + "Pierre stood at the window and said nothing at all.";
  const priorFrameOffset = 0;
  const displayText = "Pierre stood at the window and said nothing at all.";
  const r = locateRawSpan(source, priorFrameOffset, displayText, { radius: 2500 });
  assert.equal(r.verified, true);
  assert.equal(r.offset, source.indexOf(displayText));
});

test("overlapping/nearby spans resolve independently with no shared state", () => {
  const source = "Andrei entered the room. Andrei sat by the fire. Andrei said nothing.";
  const a = locateRawSpan(source, source.indexOf("Andrei entered"), "Andrei entered the room.");
  const b = locateRawSpan(source, source.indexOf("Andrei sat"), "Andrei sat by the fire.");
  const c = locateRawSpan(source, source.indexOf("Andrei said"), "Andrei said nothing.");
  assert.equal(a.verified, true);
  assert.equal(b.verified, true);
  assert.equal(c.verified, true);
  assert.equal(a.offset, source.indexOf("Andrei entered"));
  assert.equal(b.offset, source.indexOf("Andrei sat"));
  assert.equal(c.offset, source.indexOf("Andrei said"));
  // Resolving b or c must not have perturbed a's already-computed result.
  const aAgain = locateRawSpan(source, source.indexOf("Andrei entered"), "Andrei entered the room.");
  assert.deepEqual(a, aAgain);
});

test("diacritics are NOT recovered (out of scope — presence.js owns identity matching)", () => {
  const source = "Natásha danced at the ball.";
  const r = locateRawSpan(source, 0, "Natasha danced at the ball.");
  assert.equal(r.verified, false, "diacritic mismatch is a genuine non-match, not silently accepted");
});
