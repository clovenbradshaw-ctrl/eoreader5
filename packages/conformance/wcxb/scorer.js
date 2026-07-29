// WCXB scorer — pure, deterministic, network-free.
//
// Implements the snippet-level metric from WCXB (Foley, 2026,
// arXiv:2605.21097): a page's ground truth carries `with[]` (3-8 word
// snippets that a correct extraction MUST include) and `without[]` (snippets
// from boilerplate that a correct extraction MUST exclude). See
// packages/conformance/wcxb/README.md for the boundary rationale.
//
// Beyond the classic metric this module adds the eoreader-native reading of
// `without[]`: in EOReader5 the cookie banner / nav / related-article cards
// are not deleted, they are RETAINED and TYPED (a SEG+typed discard in the
// semantic ledger, never a citable span). So a `without[]` snippet is not
// merely "absent from output" — it should be present in a retained, typed,
// non-citable unit and absent from the rendered/citable projection. That is
// the `typed_discard_rate` below, and it is the assertion the rest of the
// leaderboard cannot make because every other system throws the 80% away.
//
// This file has no dependency on @eoreader/engine on purpose: the metric is a
// property of (ground-truth, extraction) and must be verifiable without a
// reader. The mapping from an engine projection bundle to an `extraction`
// value lives in ./bundle-adapter.js.

/** Canonical text comparison: case-fold and collapse whitespace. */
export function normalizeText(s) {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when `snippet` occurs in `haystack` under normalized comparison. */
export function containsSnippet(haystack, snippet) {
  const n = normalizeText(snippet);
  if (n === "") return false;
  return normalizeText(haystack).includes(n);
}

/**
 * Score one page.
 *
 * @param {{page_type?: string, with?: string[], without?: string[]}} target
 *   Normalized WCXB ground truth (see scripts/wcxb-convert.mjs and
 *   ./sample/*.target.json).
 * @param {{rendered: string, retained_typed?: string}} extraction
 *   `rendered`  — the text a reader chose to surface as main content
 *                 (in EOReader5 terms, the concatenation of citable spans).
 *   `retained_typed` — text present in the reading but NOT citable, i.e.
 *                 typed-discarded regions still on the ledger. Optional;
 *                 defaults to "" for classic (extract-and-drop) systems, in
 *                 which case typed_discard_rate is 0 by construction.
 */
export function scorePage(target, extraction) {
  const withList = Array.isArray(target?.with) ? target.with : [];
  const withoutList = Array.isArray(target?.without) ? target.without : [];
  const rendered = extraction?.rendered ?? "";
  const retained = extraction?.retained_typed ?? "";

  const withHits = withList.filter((s) => containsSnippet(rendered, s));
  const missedWith = withList.filter((s) => !containsSnippet(rendered, s));
  const leaked = withoutList.filter((s) => containsSnippet(rendered, s));

  // Classic snippet metric. `with` hits are true positives; `with` misses are
  // false negatives; leaked `without` snippets are false positives.
  const tp = withHits.length;
  const fn = missedWith.length;
  const fp = leaked.length;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const withRecall = withList.length === 0 ? 1 : withHits.length / withList.length;
  const withoutLeakage = withoutList.length === 0 ? 0 : leaked.length / withoutList.length;

  // eoreader-native: a `without` snippet is scored as correctly typed-discarded
  // only if it is retained (typed, non-citable) AND not leaked into rendered.
  const typedDiscarded = withoutList.filter(
    (s) => containsSnippet(retained, s) && !containsSnippet(rendered, s),
  );
  const typedDiscardRate =
    withoutList.length === 0 ? 1 : typedDiscarded.length / withoutList.length;

  return {
    page_type: target?.page_type ?? null,
    with_total: withList.length,
    with_hit: withHits.length,
    with_recall: withRecall,
    without_total: withoutList.length,
    leaked: leaked.length,
    without_leakage: withoutLeakage,
    precision,
    recall,
    f1,
    typed_discard_rate: typedDiscardRate,
    missed_with: missedWith,
    leaked_snippets: leaked,
  };
}

/** Unweighted mean of a numeric field over a result list (0 when empty). */
function mean(results, field) {
  if (results.length === 0) return 0;
  return results.reduce((acc, r) => acc + r[field], 0) / results.length;
}

/**
 * Aggregate per-page scores into overall and per-page-type means. Stratifying
 * by page type is the whole point of WCXB: the field converges on articles
 * (~0.93) and diverges on collections/listings/products (~0.41-0.84), so a
 * single scalar hides exactly the gap this harness exists to watch.
 */
export function aggregate(results) {
  const byType = {};
  for (const r of results) {
    const t = r.page_type ?? "unknown";
    (byType[t] ??= []).push(r);
  }
  const perType = {};
  for (const [t, rs] of Object.entries(byType)) {
    perType[t] = {
      n: rs.length,
      f1: mean(rs, "f1"),
      with_recall: mean(rs, "with_recall"),
      without_leakage: mean(rs, "without_leakage"),
      typed_discard_rate: mean(rs, "typed_discard_rate"),
    };
  }
  return {
    n: results.length,
    overall: {
      f1: mean(results, "f1"),
      with_recall: mean(results, "with_recall"),
      without_leakage: mean(results, "without_leakage"),
      typed_discard_rate: mean(results, "typed_discard_rate"),
    },
    by_page_type: perType,
  };
}
