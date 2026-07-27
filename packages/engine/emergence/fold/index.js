// Fold compression: the context manager for tiny models.
//
// Ported from eoreader4.2's fold kernel concept (src/turn/stages.js
// fold/foldReading stages) and the fold_summary mechanism in
// eoreader-proxy/proxy.js. The fold takes a reading (a set of
// scored units) and a token budget, and produces a compressed
// summary that fits within that budget.
//
// This is the single most important mechanism for small-context
// chat: the fold decides what to keep and what to discard before
// the model ever sees it.
//
// The fold is a pure function: it scores chunks by surprise and
// relevance, selects the best ones within the budget, and returns
// a structured summary. No model calls, no ambient state.

import { classify } from "../../cube/index.js";

/**
 * Approximate token count (words + punctuation).
 * Not a real tokenizer — just a budget estimator.
 */
function estimateTokens(text) {
  return String(text ?? "").split(/\s+/).filter(Boolean).length;
}

/**
 * scoreChunk(chunk, context) -> number
 *
 * Score a chunk for inclusion in the fold. Combines:
 *   - text relevance (keyword overlap with query)
 *   - surprise (forward score against history)
 *   - coordinate match (terrain/stance/operator alignment)
 *   - focus bias (if a focus coordinate is set)
 *
 * @param {object} chunk - { text, coord?, meta? }
 * @param {object} context - { query, focus?, history?, queryCoord? }
 * @returns {number} composite score
 */
export function scoreChunk(chunk, context) {
  const { query } = context;
  let score = 0;

  const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "has", "had", "have", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "can", "shall", "what", "which",
    "who", "whom", "when", "where", "why", "how", "this", "that", "these",
    "those", "it", "its", "they", "them", "their", "we", "our", "you",
    "your", "he", "she", "his", "her", "him", "me", "my", "not", "no",
    "nor", "so", "if", "then", "than", "just", "about", "into", "over",
    "after", "before", "between", "under",
  ]);
  const queryWords = (query ?? "").toLowerCase()
    .split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (queryWords.length === 0) return 0;

  const chunkText = (chunk.text ?? "").toLowerCase();
  const wordCount = chunkText.split(/\s+/).filter(Boolean).length;

  // Keyword density — normalizes by chunk size so
  // a dense 200-word passage beats a diffuse 2000-word one
  let keywordMatches = 0;
  const uniqueQueryWords = new Set(queryWords);
  for (const w of uniqueQueryWords) {
    if (chunkText.includes(w)) keywordMatches++;
  }
  if (keywordMatches > 0 && wordCount > 0) {
    score += (keywordMatches / wordCount) * 1000;
  }

  // Exact phrase match
  const queryPhrase = [...uniqueQueryWords].join(" ");
  if (queryPhrase && chunkText.includes(queryPhrase)) score += 200;

  return score;
}

/**
 * fold(reading, options) -> FoldedReading
 *
 * The fold: compress a reading into a token-budget-constrained summary.
 *
 * @param {object} reading - { units: [{ text, coord?, meta?, score? }], query?, focus? }
 * @param {object} options - { tokenBudget, maxUnits, history?, focus?, queryCoord? }
 * @returns {object} FoldedReading with selected units, summary, and metadata
 */
export function fold(reading, options = {}) {
  const tokenBudget = options.tokenBudget ?? 500;
  const maxUnits = options.maxUnits ?? 10;
  const history = options.history ?? [];
  const focus = options.focus ?? null;
  const query = reading.query ?? "";
  const units = reading.units ?? [];
  if (units.length === 0) {
    return {
      schema: "FoldedReading@1",
      selected: [],
      summary: "",
      totalTokens: 0,
      budget: tokenBudget,
      dropped: 0,
      reason: "no units to fold",
    };
  }

  // Score each chunk
  const context = { query, focus, history };
  const scored = units.map((unit) => ({
    ...unit,
    foldScore: scoreChunk(unit, context),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.foldScore - a.foldScore);

  // Select units within budget
  const selected = [];
  let usedTokens = 0;
  let dropped = 0;

  for (const unit of scored) {
    if (selected.length >= maxUnits) break;
    const unitTokens = estimateTokens(unit.text);
    if (usedTokens + unitTokens > tokenBudget) {
      dropped += 1;
      continue;
    }
    selected.push(unit);
    usedTokens += unitTokens;
  }

  // Build summary: selected units joined with source attribution
  const summaryParts = selected.map((unit) => {
    const source = unit.meta?.file ?? unit.meta?.source ?? "";
    return source ? `[${source}] ${unit.text}` : unit.text;
  });

  return {
    schema: "FoldedReading@1",
    selected,
    summary: summaryParts.join("\n\n"),
    totalTokens: usedTokens,
    budget: tokenBudget,
    dropped,
    reason: dropped > 0
      ? `${selected.length} of ${units.length} units kept, ${dropped} dropped by budget`
      : `all ${selected.length} units fit within budget`,
  };
}

/**
 * foldReadingSnapshot(snapshot, options) -> FoldedReading
 *
 * Higher-level fold that works with a full reading snapshot
 * (as produced by the engine's readingSnapshot). Extracts units
 * from the snapshot's passages and folds them.
 *
 * @param {object} snapshot - reading snapshot with passages array
 * @param {object} options - same as fold()
 * @returns {object} FoldedReading
 */
export function foldReadingSnapshot(snapshot, options = {}) {
  const passages = snapshot?.passages ?? [];
  const units = passages.map((p) => ({
    text: (p.anchors?.exact_text ?? []).join(" ") ?? "",
    coord: classify((p.anchors?.exact_text ?? []).join(" ")),
    meta: { source_id: p.source_id, field_id: p.field_id },
    score: p.score,
  }));
  return fold({ units, query: snapshot?.request?.query ?? "" }, options);
}
