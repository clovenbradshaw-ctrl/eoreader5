import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences } from "./text-organ.js";

test("splitSentences: offsets round-trip to the source text", () => {
  const text = "Pierre smiled. Prince Andrew frowned!";
  const sentences = splitSentences(text);
  assert.equal(sentences.length, 2);
  for (const s of sentences) {
    assert.equal(text.slice(s.offset, s.offset + s.text.length), s.text);
  }
});

test("splitSentences: a paragraph break is a hard boundary even without terminating punctuation", () => {
  // A chapter heading has no terminator; scanning terminators alone would
  // glue it onto the next paragraph's opening sentence.
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
