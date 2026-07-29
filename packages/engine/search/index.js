/**
 * Search — query-based discovery over folded text vectors.
 *
 * A term must OCCUR for a unit to qualify at all (the evidence gate — silence
 * over fabrication). Among units that qualify, three signals rank:
 *   1. Lexical evidence — rarity-weighted coverage of the query's terms, plus
 *      a bonus when they appear contiguously as a phrase. This LEADS.
 *   2. Signal similarity — cosine over text-as-signal field vectors.
 *   3. Fold relevance — |cos(entryFold, queryFold)|². Squaring sharpens the
 *      ranking; it is a relevance heuristic, not the quantum-mechanical Born
 *      rule despite the shared |⟨·|·⟩|² form. See ../quantum/index.js.
 *
 *   finalScore = coverage*0.6 + phrase*0.25 + (signal*0.9 + fold*0.1)*0.15
 *
 * Measured dead end — do NOT restore it. Signal-led ranking (signal*0.9 +
 * fold*0.1, with keyword overlap used ONLY as a gate) meant term overlap did
 * not rank at all: every unit containing any single query word, including a
 * stopword, was ordered by a texture uncorrelated with the query, so the
 * LARGEST source won on volume. On a 14-probe verbatim-phrase set over four
 * sources it scored top-1 7/14 — and "dreary night of November" did not return
 * Frankenstein, whose text contains that exact phrase.
 *
 * Top results are then re-ranked by interfere(): a correlation term that boosts
 * entries pointing the same direction as other strong hits. Same |A₁+A₂|²
 * cross-term shape as optical interference — used here purely as a co-relevance
 * signal, with no wave physics implied.
 */

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { fold, project, interfere } from "../quantum/index.js";
import { extractTextFieldVectors, querySignal, cosineSimilarity } from "../perceiver/text/text-signal.js";
import { diaNorm } from "../perceiver/text/presence.js";

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
    }))
  );
}

// Evidence event ids for ONE unit. This was computed eagerly inside buildUnits
// for every field on every search, which is O(fields × events) — on a corpus of
// a few thousand chunks it dominated query latency while all but `limit` of the
// results were then discarded. Resolving it lazily for the returned passages
// only is the same value at a fraction of the cost.
function evidenceEventIds(state, unit) {
  return (state.events ?? [])
    .filter((event) =>
      (event.payload?.envelope?.source_id ?? event.payload?.source_id) === unit.source_id ||
      (event.payload?.envelope?.fields ?? event.payload?.fields)?.some?.(
        (candidate) => candidate.field_id === unit.field_id
      )
    )
    .map((event) => event.event_id);
}

/**
 * Keyword evidence score: how many query terms occur in the unit's evidence
 * text. This is the evidence gate — a unit with zero occurrences of every
 * term has nothing to say about the query, no matter how similar its signal
 * texture is (silence over fabrication — an absent term returns nothing, not
 * a nearest guess). The comparison is diacritic-normalized (`diaNorm`, the
 * canonical single-pass version in `perceiver/text/presence.js` — do not add
 * a second diacritic map, per AGENTS.md's "Consistently reinvented" list) so
 * "café"/"cafe" still count as the same evidence; it is not otherwise fuzzy.
 * Empty queries carry no evidence requirement to satisfy, and report as an
 * empty_query gap instead of matching everything.
 */
function scoreUnitKeyword(unit, terms) {
  if (terms.length === 0) return 0;
  const text = diaNorm(collectEvidenceText(unit));
  return terms.reduce((score, term) => score + (text.includes(diaNorm(term)) ? 1 : 0), 0);
}

/**
 * Rarity weights over the units admitted in THIS session.
 *
 * NOT the corpus-prior dead end in AGENTS.md. That one tried to derive a
 * READER PRIOR — what a reader finds salient — from an external corpus's
 * vocabulary, and collapsed toward the text every time. This is a retrieval
 * weight and nothing else: it answers "which of these units best matches the
 * terms the caller typed", never "what matters in this text". It ranks only
 * what the evidence gate already admitted, is recomputed per call from the
 * live state (no snapshot, no external corpus), and feeds no organ downstream.
 *
 * Why it is needed: term COUNT is not evidence strength. "dreary night of
 * November" and a verse containing only "of" both scored, and the tie was then
 * broken by a signal texture uncorrelated with the query — so the largest
 * source won on volume. Weighting each term by log(N / df) makes a stopword
 * nearly free and a rare term decisive, which is the actual ask.
 */
function termWeights(units, terms, evidenceCache) {
  const n = Math.max(1, units.length);
  const weights = new Map();
  for (const term of terms) {
    const needle = diaNorm(term);
    if (!needle || weights.has(term)) continue;
    let df = 0;
    for (const unit of units) {
      if (evidenceCache.get(unit).includes(needle)) df++;
    }
    // +1 smoothing keeps a term that matches everything at a small positive
    // weight rather than exactly zero, so an all-stopword query still ranks.
    weights.set(term, Math.log(1 + n / (1 + df)));
  }
  return weights;
}

/**
 * Rarity-weighted term coverage in [0, 1], plus a verbatim-phrase bonus.
 *
 * Coverage is (weight of matched terms) / (weight of all terms), so it does not
 * reward a long unit for accumulating incidental matches. The phrase bonus is
 * the strongest evidence available short of an exact span: when the caller's
 * words appear CONTIGUOUSLY, this unit is not merely about the same subject,
 * it contains the thing asked for.
 */
function scoreUnitLexical(evidence, query, terms, weights) {
  let matched = 0;
  let total = 0;
  for (const term of terms) {
    const w = weights.get(term) ?? 0;
    total += w;
    if (evidence.includes(diaNorm(term))) matched += w;
  }
  const coverage = total > 0 ? matched / total : 0;

  // Longest contiguous run of query terms present as a phrase. Checking every
  // window would be quadratic in query length; the full query and then the
  // longest prefix/suffix runs capture the cases that matter (a quoted line,
  // a name plus title) without the cost.
  const evidenceText = evidence;
  let phrase = 0;
  for (let len = terms.length; len >= 2 && phrase === 0; len--) {
    for (let start = 0; start + len <= terms.length; start++) {
      const window = diaNorm(terms.slice(start, start + len).join(" "));
      if (evidenceText.includes(window)) {
        phrase = len / terms.length;
        break;
      }
    }
  }

  return { coverage, phrase };
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

  // Pass 1 — cheap. Evidence gate + rarity-weighted lexical rank over every
  // unit. String containment only; no fold, no signal extraction.
  const evidenceCache = new Map();
  for (const unit of units) evidenceCache.set(unit, diaNorm(collectEvidenceText(unit)));
  const weights = termWeights(units, terms, evidenceCache);

  const gated = [];
  for (const unit of units) {
    const keywordScore = scoreUnitKeyword(unit, terms);
    if (keywordScore <= 0) continue; // the evidence gate, unchanged
    const { coverage, phrase } = scoreUnitLexical(evidenceCache.get(unit), query, terms, weights);
    gated.push({ unit, keywordScore, coverage, phrase, lexical: coverage + phrase });
  }
  gated.sort((a, b) => b.lexical - a.lexical || a.unit.unit_id.localeCompare(b.unit.unit_id));

  // Pass 2 — expensive. Signal and fold vectors are computed only for units
  // that already cleared the gate and rank near the top, because they can only
  // reorder a shortlist, never rescue a unit the gate rejected. Scoring all of
  // them was the bulk of query latency on a multi-thousand-chunk corpus.
  const CANDIDATE_CAP = Math.max(limit * 10, 100);
  const candidates = gated.slice(0, CANDIDATE_CAP);

  const matches = candidates
    .map(({ unit, keywordScore, coverage, phrase }) => {
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
      // it RANKS matches. It never GATES them: a unit only qualifies at all
      // when the query's terms occur (diacritic-normalized) in its evidence
      // (silence over fabrication — an absent term returns nothing, not a
      // nearest guess). A prior version dropped this gate for typo/diacritic
      // grace and scored any nonzero signal similarity as a match, but the
      // signal score does not reliably separate a genuine near-match from a
      // genuinely absent term at this granularity — measured directly: a
      // real one-letter typo ("alfa" vs "Alpha river") scored 0.048, LOWER
      // than a genuinely unrelated term ("gamma" vs "Alpha river") at 0.059.
      // Gating on a score that noisy reintroduces exactly the fabricated-
      // match failure mode `reliability-read-path.test.js` and
      // `search/index.test.js` enforce. Diacritic tolerance is recovered
      // instead inside `scoreUnitKeyword` itself (`diaNorm`), which keeps the
      // "must actually occur" invariant intact while still matching
      // "café"/"cafe".
      // Lexical evidence LEADS the rank; signal texture only breaks ties among
      // units that already match the caller's terms comparably well. The old
      // weighting had it backwards — signal at 0.9 meant term overlap did not
      // rank at all, so a verse sharing only "of" with the query could outrank
      // the sentence the caller quoted verbatim.
      const combinedScore = signalScore * 0.9 + bornScore * 0.1;
      const score = coverage * 0.6 + phrase * 0.25 + combinedScore * 0.15;

      return {
        unit,
        score,
        signalScore,
        keywordScore,
        bornScore,
        coverage,
        phrase,
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
        // Gentle. At the old 0.3 this term could reorder the top 5 outright,
        // overriding verbatim term evidence with a co-relevance signal that
        // never saw the query's words. It is a nudge among near-equals.
        m.score = m.score * 0.9 + interferenceBoost * 0.1;
        m.interference = interferenceBoost;
      });

      // Re-sort after interference, keeping the deterministic tiebreaker
      matches.sort((a, b) => b.score - a.score || a.unit.unit_id.localeCompare(b.unit.unit_id));
    }
  }

  // Build passages
  const passages = matches.map(({ unit, score, keywordScore, bornScore, signalScore, interference, coverage, phrase }) => ({
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
    // Why this passage ranked where it did, carried on the passage itself so a
    // caller can show its work instead of asserting relevance.
    coverage,
    phrase,
    anchors: {
      exact_text: unit.values.length ? unit.values : unit.surfaces,
      selectors: unit.selectors,
      axes: unit.axes,
    },
    evidence_event_ids: evidenceEventIds(state, unit),
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
