// WCXB eval harness — conformance tests.
//
// These MUST pass with the network disabled (packages/conformance is the
// offline gate). They pin two things:
//   1. the WCXB snippet metric (with-recall, without-leakage, snippet-F1);
//   2. the eoreader-native reading of without[] as typed-discard, which is the
//      assertion no other system on the WCXB leaderboard can make.
//
// What is NOT pinned yet: scoring a real engine reading end-to-end. The engine
// does not decode HTML and the fold/typed-discard read path is still being
// built, so `extractionFromBundle` is exercised on hand-built bundles here and
// the end-to-end case is an explicit `todo` gate below — a visible IOU, not a
// silent gap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePage, aggregate, containsSnippet, normalizeText } from "../wcxb/scorer.js";
import { extractionFromBundle } from "../wcxb/bundle-adapter.js";
import { loadTargets } from "../wcxb/load.js";

const ARTICLE = {
  page_type: "Article",
  with: ["council approved the harbor dredging", "work begins in September"],
  without: ["Accept all cookies to continue", "Subscribe to our newsletter"],
};

test("snippet match is case- and whitespace-insensitive", () => {
  assert.equal(containsSnippet("The COUNCIL   approved\nthe plan", "council approved the"), true);
  assert.equal(normalizeText("  A  B\tC "), "a b c");
  assert.equal(containsSnippet("nothing here", ""), false);
});

test("a perfect extraction: all with[] rendered, no without[] leaked", () => {
  const r = scorePage(ARTICLE, {
    rendered: "The council approved the harbor dredging. Work begins in September.",
    retained_typed: "Accept all cookies to continue. Subscribe to our newsletter.",
  });
  assert.equal(r.with_recall, 1);
  assert.equal(r.without_leakage, 0);
  assert.equal(r.f1, 1);
  assert.equal(r.typed_discard_rate, 1);
});

test("leaked boilerplate is a false positive: F1 and leakage both react", () => {
  const r = scorePage(ARTICLE, {
    rendered:
      "The council approved the harbor dredging. Work begins in September. Subscribe to our newsletter.",
    retained_typed: "Accept all cookies to continue",
  });
  assert.equal(r.with_recall, 1);
  assert.equal(r.leaked, 1);
  assert.equal(r.without_leakage, 0.5);
  assert.ok(r.f1 < 1, "one leaked without[] snippet must drop F1 below 1");
  // typed-discard: the leaked snippet cannot count as correctly discarded.
  assert.equal(r.typed_discard_rate, 0.5);
});

test("missing with[] content lowers recall and F1", () => {
  const r = scorePage(ARTICLE, { rendered: "The council approved the harbor dredging." });
  assert.equal(r.with_recall, 0.5);
  assert.deepEqual(r.missed_with, ["work begins in September"]);
  assert.ok(r.f1 < 1);
});

test("typed-discard is the differentiator: dropping boilerplate entirely still scores classic-clean but not typed-discarded", () => {
  // Classic extract-and-drop system: boilerplate is gone, not retained.
  const dropped = scorePage(ARTICLE, {
    rendered: "The council approved the harbor dredging. Work begins in September.",
    // retained_typed omitted -> ""
  });
  assert.equal(dropped.without_leakage, 0, "nothing leaked, classic metric is happy");
  assert.equal(dropped.f1, 1);
  assert.equal(
    dropped.typed_discard_rate,
    0,
    "but nothing was retained-and-typed: the 80% was thrown away, which the eoreader metric refuses to credit",
  );
});

test("empty with[]/without[] degrade to defined neutral values", () => {
  const r = scorePage({ page_type: "Service", with: [], without: [] }, { rendered: "" });
  assert.equal(r.with_recall, 1);
  assert.equal(r.without_leakage, 0);
  assert.equal(r.typed_discard_rate, 1);
  assert.equal(r.f1, 1, "no targets => vacuous precision=recall=1 => F1 defined as 1");
});

test("aggregate stratifies by page type (the reason WCXB exists)", () => {
  const results = [
    scorePage({ page_type: "Article", with: ["a"], without: [] }, { rendered: "a" }),
    scorePage({ page_type: "Collection", with: ["x", "y"], without: [] }, { rendered: "x" }),
  ];
  const agg = aggregate(results);
  assert.equal(agg.n, 2);
  assert.equal(agg.by_page_type.Article.f1, 1);
  assert.ok(agg.by_page_type.Collection.f1 < 1, "collection recall 0.5 must show up as a separate, worse bucket");
  assert.equal(agg.by_page_type.Collection.n, 1);
});

test("bundle adapter maps citable spans -> rendered, retained -> typed-discard", () => {
  const bundle = {
    spans: [{ source_id: "doc:1", text: "The council approved the harbor dredging" }],
    retained: [{ text: "Accept all cookies to continue" }],
  };
  const extraction = extractionFromBundle(bundle);
  assert.ok(extraction.rendered.includes("council approved"));
  assert.ok(extraction.retained_typed.includes("Accept all cookies"));
  const r = scorePage(
    { page_type: "Article", with: ["council approved the harbor dredging"], without: ["Accept all cookies to continue"] },
    extraction,
  );
  assert.equal(r.with_recall, 1);
  assert.equal(r.typed_discard_rate, 1);
  assert.equal(r.without_leakage, 0);
});

test("committed sample loads offline and is well-formed", () => {
  const targets = loadTargets();
  assert.ok(targets.length >= 3, "expected the bundled article/collection/listing sample");
  for (const t of targets) {
    assert.equal(typeof t.page_type, "string");
    assert.ok(Array.isArray(t.with) && Array.isArray(t.without));
    assert.equal(t.synthetic, true, "bundled sample must be flagged synthetic, not passed off as CC-BY data");
  }
  // Every sample must be scoreable; an oracle extraction (rendered = all with[],
  // retained = all without[]) must score perfectly, proving the fixtures and
  // scorer agree.
  for (const t of targets) {
    const oracle = scorePage(t, {
      rendered: t.with.join("\n"),
      retained_typed: t.without.join("\n"),
    });
    assert.equal(oracle.with_recall, 1, `oracle recall for ${t.file_id}`);
    assert.equal(oracle.without_leakage, 0, `oracle leakage for ${t.file_id}`);
    assert.equal(oracle.typed_discard_rate, 1, `oracle typed-discard for ${t.file_id}`);
  }
});

// END-TO-END GATE (pending the real read path). When packages/engine can turn
// an HTML-derived ObservationEnvelope into a ReadingSnapshot + projection
// bundle with typed-discard units, replace this todo with: build state via
// applyCommand, project(), extractionFromBundle(bundle), scorePage(target, …),
// and assert per-page-type F1 floors on the materialized WCXB dev split.
test("end-to-end: score a real engine reading against WCXB dev split", { todo: true }, () => {
  assert.fail("blocked on the engine HTML->fold->typed-discard read path (see bundle-adapter.js)");
});
