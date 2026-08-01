// text-organ.test.js — raw-span provenance (locateRawSpan) + sentence splitting.
// See the "Raw span provenance" section header in text-organ.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { locateRawSpan, splitSentences } from "./text-organ.js";

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
  const source = "prelude text here.   \n\n  The count arrived at the ball.";
  const windowOffset = source.indexOf("   \n\n  The count");
  const displayText = "The count arrived at the ball.";
  const r = locateRawSpan(source, windowOffset, displayText);
  assert.equal(r.verified, true);
  assert.ok(r.drift > 0, "true offset is after the untrimmed window start");
  assert.equal(r.offset, source.indexOf(displayText));
  assert.equal(r.raw, displayText);
});

test("snapToSentences bug case: interior whitespace/newlines collapsed", () => {
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
  const r = locateRawSpan(source, secondOccurrence + 2, phrase);
  assert.equal(r.verified, true);
  assert.equal(r.offset, secondOccurrence);
});

test("no match within the search radius: typed gap, not a guessed slice", () => {
  const source = "a".repeat(10000) + "the real sentence is here" + "b".repeat(10000);
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
  const prefix = "words ".repeat(150);
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
  const aAgain = locateRawSpan(source, source.indexOf("Andrei entered"), "Andrei entered the room.");
  assert.deepEqual(a, aAgain);
});

test("diacritics are NOT recovered (out of scope — presence.js owns identity matching)", () => {
  const source = "Natásha danced at the ball.";
  const r = locateRawSpan(source, 0, "Natasha danced at the ball.");
  assert.equal(r.verified, false, "diacritic mismatch is a genuine non-match, not silently accepted");
});

test("splitSentences: offsets round-trip to the source text", () => {
  const text = "Pierre smiled. Prince Andrew frowned!";
  const sentences = splitSentences(text);
  assert.equal(sentences.length, 2);
  for (const s of sentences) {
    assert.equal(text.slice(s.offset, s.offset + s.text.length), s.text);
  }
});

test("splitSentences: a paragraph break is a hard boundary even without terminating punctuation", () => {
  const text = "CHAPTER XII\n\nWhen Natásha entered, Pierre rose.";
  const sentences = splitSentences(text);
  assert.equal(sentences[0].text, "CHAPTER XII");
  assert.equal(sentences[1].text, "When Natásha entered, Pierre rose.");
  assert.ok(!sentences[1].text.includes("CHAPTER"), "heading must not leak into the following sentence");
});

test("splitSentences: closing quotes stay attached to their sentence", () => {
  const text = '"Well, Prince," he said. Then he left.';
  const sentences = splitSentences(text);
  assert.equal(sentences[0].text, '"Well, Prince," he said.');
});

test("splitSentences: sequential order and non-overlapping offsets", () => {
  const text = "One. Two. Three.";
  const sentences = splitSentences(text);
  assert.deepEqual(sentences.map((s) => s.order), [0, 1, 2]);
  for (let i = 1; i < sentences.length; i++) {
    assert.ok(sentences[i].offset >= sentences[i - 1].offset + sentences[i - 1].text.length);
  }
});
});
