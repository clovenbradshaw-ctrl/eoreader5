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

import { forwardScore, wordFrequencies, klDivergence } from "../surprise/index.js";
import { classify, scoreCoordinate, focusBias } from "../../cube/index.js";

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
  const { query, focus, history, queryCoord } = context;
  let score = 0;

  // Text relevance (keyword matching)
  const queryWords = (query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const chunkText = (chunk.text ?? "").toLowerCase();
  for (const w of queryWords) {
    if (chunkText.includes(w)) score += 3;
  }

  // Exact phrase match
  const queryPhrase = queryWords.join(" ");
  if (queryPhrase && chunkText.includes(queryPhrase)) score += 20;

  // Coordinate match (terrain/stance/operator alignment)
  const chunkCoord = chunk.coord ?? classify(chunk.text);
  if (queryCoord) {
    if (chunkCoord.terrain === queryCoord.terrain) score += 5;
    if (chunkCoord.stance === queryCoord.stance) score += 2;
    if (chunkCoord.operator === queryCoord.operator) score += 1;
  }

  // Focus bias
  if (focus) {
    score += focusBias({ coord: chunkCoord }, focus);
  }

  // Surprise (forward score against history)
  if (history && history.length > 0) {
    const novelty = forwardScore(chunk, history);
    score += Math.min(10, novelty);
  }

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
  const queryCoord = options.queryCoord ?? (query ? classify(query) : null);

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
  const context = { query, focus, history, queryCoord };
  const scored = units.map((unit) => ({
    ...unit,
    foldScore: scoreChunk(unit, context),
    coord: unit.coord ?? classify(unit.text),
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
