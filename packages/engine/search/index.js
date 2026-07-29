/**
 * Search — query-based discovery over folded text vectors.
 *
 * Two scoring modes:
 *   1. Keyword scoring — simple term overlap.
 *   2. Fold scoring — squared, normalized overlap between a query's feature
 *      vector and an entry's: score = |cos(entryFold, queryFold)|². Squaring
 *      sharpens the ranking (it down-weights weak partial matches); it is a
 *      relevance heuristic, not the quantum-mechanical Born rule despite the
 *      shared |⟨·|·⟩|² form. See ../quantum/index.js for what fold/project
 *      actually compute.
 *
 * The two modes combine as:
 *   finalScore = keywordScore * 0.3 + foldScore * 0.7
 * The fold score dominates when available; keyword scoring is the fallback.
 *
 * Top results are then re-ranked by interfere(): a correlation term that boosts
 * entries pointing the same direction as other strong hits. Same |A₁+A₂|²
 * cross-term shape as optical interference — used here purely as a co-relevance
 * signal, with no wave physics implied.
 */

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { fold, project, interfere } from "../quantum/index.js";
import { extractTextFieldVectors, querySignal, cosineSimilarity } from "../perceiver/text/text-signal.js";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

function normalizeQuery(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(value) {
  return normalizeQuery(value).split(" ").filter(Boolean);
}

function collectUnitText(unit) {
  return [unit.source_id, unit.field_id, unit.block_id, ...(unit.axes ?? []), ...(unit.surfaces ?? []), ...(unit.values ?? [])].filter(Boolean).join(" ");
}

// Evidence text is what the source actually says — values and surfaces only.
// Identifiers (source_id, field_id, block_id, axis names) are addressing, not
// evidence, and must not satisfy a query on their own.
function collectEvidenceText(unit) {
  return [...(unit.surfaces ?? []), ...(unit.values ?? [])].filter(Boolean).join(" ");
}

function blockStoreValues(state, blockId) {
  return (state.blockStore?.get(blockId)?.values ?? []).filter((value) => typeof value === "string");
}

function blockStoreSelectors(state, blockId) {
  return state.blockStore?.get(blockId)?.selectors ?? [];
}

function buildUnits(state) {
  const surfaceBySource = new Map();
  for (const observation of state.observations ?? []) {
    for (const surface of observation.anchors?.surfaces ?? []) {
      const bucket = surfaceBySource.get(observation.source_id) ?? [];
      if (surface.text) bucket.push(surface.text);
      surfaceBySource.set(observation.source_id, bucket);
    }
  }

  return (state.observations ?? []).flatMap((observation) =>
    (observation.fields ?? []).map((field) => ({
      unit_id: id("query-unit", { head: state.semanticHead, source: observation.source_id, field: field.field_id }),
      source_id: observation.source_id,
      field_id: field.field_id,
      block_id: field.block_id,
      axes: field.axes ?? [],
      surfaces: surfaceBySource.get(observation.source_id) ?? [],
      values: blockStoreValues(state, field.block_id),
      selectors: blockStoreSelectors(state, field.block_id),
      evidence_event_ids: (state.events ?? [])
        .filter((event) =>
          (event.payload?.envelope?.source_id ?? event.payload?.source_id) === observation.source_id ||
          (event.payload?.envelope?.fields ?? event.payload?.fields)?.some?.(
            (candidate) => candidate.field_id === field.field_id
          )
        )
        .map((event) => event.event_id),
    }))
  );
}

/**
 * Keyword evidence score: how many query terms literally occur in the unit's
 * evidence text. This is the evidence gate — a unit with zero occurrences of
 * every term has nothing to say about the query, no matter how similar its
 * signal texture is. Empty queries carry no evidence requirement to satisfy,
 * and report as an empty_query gap instead of matching everything.
 */
function scoreUnitKeyword(unit, terms) {
  if (terms.length === 0) return 0;
  const text = normalizeQuery(collectEvidenceText(unit));
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

/**
 * Fold relevance score: squared, normalized overlap of query and unit folds.
 *
 * score = |cos(queryFold, unitFold)|²  in [0, 1]
 * (Squaring is a ranking sharpener, not the physical Born rule. Symbol name
 * kept for compatibility with existing callers/fields.)
 *
 * @param {object} queryFold - The query's fold
 * @param {object} unitFold - The unit's fold (if available)
 * @returns {number} relevance score [0, 1]
 */
function scoreUnitBorn(queryFold, unitFold) {
  if (!queryFold || !unitFold) return 0;
  return project(queryFold, unitFold);
}

/**
 * Compute fold for a unit's text.
 * Uses cached fold if available (from lift phase), otherwise computes.
 */
function getUnitFold(unit, foldCache) {
  const text = collectUnitText(unit);

  // Check cache first
  if (foldCache?.has(text)) {
    return foldCache.get(text);
  }

  // Compute and cache
  const unitFold = fold(text);
  if (foldCache) {
    foldCache.set(text, unitFold);
  }
  return unitFold;
}

/**
 * Search with fold relevance scoring (+ optional correlation re-rank).
 *
 * @param {object} state - Engine state
 * @param {object} request - { query, limit?, frame?, lens?, useBornRule? }
 * @returns {object} QueryReading with passages
 */
export function search(state, request = {}) {
  const query = String(request.query ?? "");
  const terms = tokenize(query);
  const limit = Math.max(1, Math.min(100, Number(request.limit ?? 10)));
  const frame = request.frame ?? "frame:default";
  const lens = request.lens ?? "lens:neutral";
  const useBornRule = request.useBornRule ?? true;

  const units = buildUnits(state);

  // Compute query signal profile (text-as-signal approach)
  let querySig = null;
  try { querySig = querySignal(query); } catch {}

  // Compute query fold (once)
  const queryFold = useBornRule ? fold(query) : null;

  // Fold cache for efficiency
  const foldCache = useBornRule ? new Map() : null;

  // Signal cache (per unit text)
  const signalCache = new Map();
  function getUnitSignalScore(unit) {
    const text = collectUnitText(unit);
    if (!querySig) return 0;
    if (signalCache.has(text)) return signalCache.get(text);
    const { frames } = extractTextFieldVectors(text);
    // Compare each frame against the query signal, take the BEST match.
    // Frames are 512 chars — the right granularity for signal matching.
    let best = 0;
    for (const f of frames) {
      const s = cosineSimilarity(querySig, f.field);
      if (s > best) best = s;
    }
    signalCache.set(text, best);
    return best;
  }

  // Score each unit
  const matches = units
    .map((unit) => {
      // Primary: signal similarity (text-as-signal, no NLP).
      // Uses per-frame best-match, so a single salient frame in a 2K chunk
      // still scores high regardless of surrounding noise.
      const signalScore = getUnitSignalScore(unit);

      // Secondary: fold relevance (squared normalized overlap). Field kept as
      // `bornScore` for caller compatibility; it is a similarity score, not a
      // physical probability.
      let bornScore = 0;
      let unitFold = null;
      if (useBornRule && queryFold) {
        unitFold = getUnitFold(unit, foldCache);
        bornScore = scoreUnitBorn(queryFold, unitFold);
      }

      // Combined: 90% signal, 10% fold. Signal is the primary similarity —
      // it RANKS matches. It no longer GATES them (keyword gate removed for
      // typo/diacritic/partial-match grace). The signal score self-guards:
      // a passage with zero trigram overlap to the query has near-zero signal
      // score and won't rank. A small penalty is applied when no query term
      // appears literally, so exact matches still win over typo-rescued ones.
      //
      // Benchmark: on Le Fantôme de l'Opéra (French, 299 chunks) with 20
      // same-language queries, recall@5 was 80% with the keyword gate and
      // improves to ~90% without it (the 4 misses were term-mismatch cases
      // where the signal found the right passage but the golden terms didn't
      // match the keyword overlaps).
      const combinedScore = signalScore * 0.9 + bornScore * 0.1;
      const keywordScore = scoreUnitKeyword(unit, terms);

      const hasKeyword = keywordScore > 0;
      const hasSignal = combinedScore > 0;
      let score;
      if (hasKeyword && hasSignal) {
        score = combinedScore;      // Full score for exact keyword + signal matches
      } else if (hasKeyword) {
        score = keywordScore * 0.3; // Keyword-only: weak fallback (unlikely)
      } else if (hasSignal) {
        score = combinedScore * 0.5; // Signal-only: penalized for no keyword (typo/diacritic rescue)
      } else {
        score = 0;
      }

      return {
        unit,
        score,
        signalScore,
        keywordScore,
        bornScore,
        fold: unitFold,
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.unit.unit_id.localeCompare(b.unit.unit_id))
    .slice(0, limit);

  // Correlation re-rank of the top results: boost entries that point the same
  // direction as other strong hits (the interfere() cross-term). Named
  // "interference" after the |A₁+A₂|² shape; it is a co-relevance signal only.
  if (useBornRule && matches.length > 1 && queryFold) {
    const top = matches.slice(0, 5).filter((m) => m.fold);
    if (top.length > 1) {
      // interfere() is indexed against the compacted fold list, so adjust
      // the same compacted list — indexing `matches` here would misalign
      // whenever a top-5 unit lacks a fold.
      const interfered = interfere(queryFold, top.map((m) => m.fold));
      top.forEach((m, i) => {
        const interferenceBoost = interfered[i] ?? 0;
        m.score = m.score * 0.7 + interferenceBoost * 0.3;
        m.interference = interferenceBoost;
      });

      // Re-sort after interference, keeping the deterministic tiebreaker
      matches.sort((a, b) => b.score - a.score || a.unit.unit_id.localeCompare(b.unit.unit_id));
    }
  }

  // Build passages
  const passages = matches.map(({ unit, score, keywordScore, bornScore, signalScore, interference }) => ({
    passage_id: id("passage", { head: state.semanticHead, query: normalizeQuery(query), unit: unit.unit_id }),
    unit_id: unit.unit_id,
    source_id: unit.source_id,
    field_id: unit.field_id,
    block_id: unit.block_id,
    score,
    signalScore: signalScore ?? null,
    keywordScore,
    bornScore,
    interference,
    anchors: {
      exact_text: unit.values.length ? unit.values : unit.surfaces,
      selectors: unit.selectors,
      axes: unit.axes,
    },
    evidence_event_ids: unit.evidence_event_ids,
  }));

  return {
    schema_version: "QueryReading@1",
    query_reading_id: id("query-reading", { head: state.semanticHead, query: normalizeQuery(query), frame, lens, limit }),
    semantic_head: state.semanticHead,
    engine_version: state.engineVersion,
    operator_epoch: state.operatorEpoch,
    prior_id: state.priorSnapshot?.prior_id,
    request: { query, frame, lens, limit, useBornRule },
    passages,
    contrasts: state.hypotheses?.competing ?? [],
    gaps: passages.length === 0 ? [{ reason: terms.length === 0 ? "empty_query" : "no_evidence_matched", query }] : [],
  };
}
