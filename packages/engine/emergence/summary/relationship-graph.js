// relationship-graph.js — cross-entity relationship edges for a whole text.
//
// entity-fold.js answers "what is the story of ONE entity?" This module
// answers "what connects every pair of entities?" — same identity primitive
// (admitReferent / presenceByFrame from perceiver/text/presence.js, the
// referent-centric organ; see docs/nameless-referent.md), applied pairwise
// instead of singly. It deliberately does NOT reintroduce graph.js's
// union-find name-merging: identity here is event-sourced through the
// referents organ, never a string match.
//
// The cast (who the referents are, and their per-text coref aliases) and the
// relation lexicon (which words in THIS language imply which relation
// category) are both passed in as data — see priors/coref/*.json and
// priors/lexicon/*.json — never hardcoded. The one MEDIUM-specific piece
// this module needs (some notion of a sub-sentence unit, to tell "the
// keyword describes THIS pair" from "the keyword is about a neighboring
// clause") is injected too, via `segmentUnits` (default: text-organ.js's
// punctuation-based clause splitter) — a musical or video organ would pass
// its own phrase/shot segmenter through the same slot rather than this file
// assuming commas exist. What's left after both are supplied — co-
// occurrence, the conditional-independence significance null, chain-
// adjacency evidence gating, emergent kind profiles — has no text or
// language baked in.
//
// Edge "reliability" is not a raw co-occurrence count. Two high-frequency
// referents co-occur often by base rate alone (Pierre is in half the book),
// which is exactly the "unconditional null" trap CLAUDE.md warns about — a
// single global mean/sd cannot tell a real relationship from base-rate
// crowding. The null here is CONDITIONAL on each pair's own marginal
// presence rate (expected = N * pA * pB, i.e. a 2x2 independence null), so
// two rare-but-paired characters and two ubiquitous-but-unrelated characters
// are judged on their own rates, not one global constant.

import { extractSurfaces, splitClauses as textClauseSegmenter, unitIndexOf } from "./text-organ.js";
import { admitReferent, presenceByFrame, diaNorm } from "../../perceiver/text/presence.js";
import { extractRelations } from "../../perceiver/text/extraction.js";

// ── Reading-shaped evidence (the fix for "keyword anywhere in the sentence") ──
//
// A first pass counted a lexicon keyword as evidence for a pair whenever it
// occurred ANYWHERE in a sentence both referents were present in. Measured
// failure: "Prince Andrew ... his father's house" with Pierre elsewhere in
// the same sentence tagged the Pierre-Andrew edge "kinship_parent_child" —
// the father in question is Andrew's, said in Pierre's presence, not a
// kinship claim BETWEEN Pierre and Andrew.
//
// A raw character-distance cap ("count it if within N chars") is not a
// better answer — it is just a different arbitrary knob, and it is not how
// anyone reads. A reader does not measure characters; they parse a sentence
// CLAUSE by clause, and a descriptor binds to whoever is named in that same
// clause or the very next one — the appositive shape "Andrew's sister,
// Mary," is legible precisely because "sister" and "Mary" sit one clause
// apart, not because they are within some number of characters. Tolstoy's
// compound sentences chain several independent clauses on unrelated topics
// with commas and semicolons; a word in clause 1 has no bearing on a name
// four clauses later, no matter how few characters separate them in a long
// quoted list. So the unit here is the CLAUSE, split at the punctuation a
// reader's eye actually pauses at (comma/semicolon/colon/dash), and a
// keyword counts as evidence only if it and both referents' mentions fall
// within one clause-step of each other — same clause, or immediately
// adjacent. Whole-word matching is the other half of the fix: a naive
// .includes() let "son" fire inside "person" and "ward" fire inside
// "toward"/"awkward" — pure noise, nothing to do with reading at all.
const WORD_BOUNDARY_OK = (ch) => !ch || !/[a-z0-9]/.test(ch);

function wholeWordPositions(haystackLower, needleLower) {
  if (!needleLower) return [];
  const positions = [];
  let i = haystackLower.indexOf(needleLower);
  while (i !== -1) {
    const before = i === 0 ? "" : haystackLower[i - 1];
    const after = i + needleLower.length >= haystackLower.length ? "" : haystackLower[i + needleLower.length];
    if (WORD_BOUNDARY_OK(before) && WORD_BOUNDARY_OK(after)) positions.push(i);
    i = haystackLower.indexOf(needleLower, i + 1);
  }
  return positions;
}

/** Character offsets (within one sentence) of any of a referent's admitted surfaces. */
function surfacePositions(sentenceText, surfaces) {
  const hay = diaNorm(sentenceText);
  const out = [];
  for (const s of surfaces ?? []) {
    out.push(...wholeWordPositions(hay, diaNorm(s.surface ?? s)));
  }
  return out;
}

/** Does this keyword occurrence plausibly describe the A-B relation, rather
 * than something incidental elsewhere in a multi-unit sentence? The
 * appositive/relative-clause shape a reader binds a descriptor with is a
 * CHAIN across consecutive sub-sentence units — "Andrew's father, [A, unit
 * i] the old colonel, [keyword, unit i+1] greeted Pierre [B, unit i+2]" —
 * so this requires A and B to sit in DIFFERENT units with the keyword's
 * unit falling inside that span, tightly (at most one unit between them).
 * Critically, if A and B already share ONE unit together ("Pierre danced
 * with Natásha, while Denísov's regiment marched east"), their relation is
 * whatever that shared unit's own verb says — a keyword in a merely-
 * adjacent unit about a third party is not evidence about the two of them,
 * no matter how close it sits.
 *
 * `segmentUnits(sentenceText) -> [{start,end}]` is WHICH sub-sentence unit
 * this check reasons over — injected, not assumed, because "clause" is
 * meaningful only for punctuated written language (see text-organ.js's
 * splitClauses header). The chain-adjacency logic itself has no punctuation
 * or English baked in; it would run identically over units supplied by a
 * different medium's own segmenter. */
function keywordEvidencesPair(sentenceText, keyword, posA, posB, segmentUnits) {
  if (!posA.length || !posB.length) return false;
  const hay = diaNorm(sentenceText);
  const units = segmentUnits(sentenceText);
  const keywordUnits = wholeWordPositions(hay, diaNorm(keyword)).map((k) => unitIndexOf(units, k));
  if (!keywordUnits.length) return false;
  for (const pa of posA) {
    const aUnit = unitIndexOf(units, pa);
    for (const pb of posB) {
      const bUnit = unitIndexOf(units, pb);
      if (aUnit === bUnit) continue; // already share a unit; a neighbor isn't evidence about THEM
      const lo = Math.min(aUnit, bUnit);
      const hi = Math.max(aUnit, bUnit);
      if (hi - lo > 2) continue;
      if (keywordUnits.some((ku) => ku >= lo && ku <= hi)) return true;
    }
  }
  return false;
}

/** Loose containment match between an SVO subject/object span and a
 * referent's admitted surfaces — same containment idiom presence.js and
 * graph.js already use for name matching, applied to extraction spans. */
function matchesAnySurface(phrase, surfaces) {
  const p = diaNorm(phrase);
  if (!p) return false;
  return (surfaces ?? []).some((s) => {
    const needle = diaNorm(s.surface ?? s);
    return needle && (p.includes(needle) || needle.includes(p));
  });
}

/**
 * Admit every cast member as a referent (event-sourced, per docs/nameless-
 * referent.md), sharing one pass of capitalized-surface extraction across
 * the whole cast the way entity-fold.js does for a single entity.
 *
 * @param {string} fullText
 * @param {Array<object>} corefPriors - per-text coref prior entries (the
 *   `cast` array of an eoPriors coref artifact: {id, name?, individuation?,
 *   display?, surfaces?, narratorSpans?})
 * @returns {{ allSurfaces: string[], cast: Map<string, { prior, admission }> }}
 */
export function admitCast(fullText, corefPriors) {
  const normText = String(fullText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const allSurfaces = [...new Set(extractSurfaces(normText))];
  // namesCorefer's containment rule treats a single shared token as a subset
  // match in EITHER direction: a two-token seed like "Prince Vasíli" absorbs
  // a bare one-word candidate "Prince" just as readily as it absorbs the
  // genuine "Prince Vasíli Kurágin". A lone honorific/title word is never
  // distinguishing evidence on its own — it is exactly the "leading shared
  // token" case the organ's surname rule already refuses to treat as
  // identity for two FULL names, just not (structurally can't) for a bare
  // one-word candidate. Measured: without this filter, "Prince Vasíli"
  // absorbed every standalone "Prince" address/vocative in the whole book
  // (used for at least half a dozen other princes), inflating his presence
  // ~13x and manufacturing a co-occurrence edge with nearly every named
  // character. Multi-word seeds only get multi-word candidates; single-word
  // seeds are unaffected (their own admission doesn't go through this list).
  const nameSurfaces = allSurfaces.filter((s) => s.trim().includes(" "));
  const cast = new Map();
  for (const prior of corefPriors) {
    const admission = admitReferent([], prior, { nameSurfaces, fullText: normText });
    cast.set(admission.referentId, { prior, admission });
  }
  return { allSurfaces, cast };
}

/**
 * Per-sentence presence for every referent. `sentences` are frame-shaped
 * records `{ order, offset, text }` — e.g. from text-organ.js::splitSentences
 * — so this reuses presenceByFrame exactly as entity-fold.js does, just
 * called once per referent instead of once for a single target.
 *
 * @returns {Map<string, Map<number, number>>} referentId -> (sentence order -> count)
 */
export function presenceBySentence(sentences, cast) {
  const presence = new Map();
  for (const [referentId, { admission }] of cast) {
    presence.set(referentId, presenceByFrame(sentences, admission.surfaces));
  }
  return presence;
}

/**
 * Node-level observables: total sightings (mass) and how many distinct
 * sentences a referent occupies, plus any admission gaps (typed, per
 * resolution-spectrum.js — never silently dropped).
 */
export function buildNodes(cast, presence, sentenceCount) {
  const nodes = [];
  for (const [referentId, { prior }] of cast) {
    const byOrder = presence.get(referentId) ?? new Map();
    let mass = 0;
    let occupied = 0;
    for (const n of byOrder.values()) {
      if (n > 0) { mass += n; occupied += 1; }
    }
    const admission = cast.get(referentId).admission;
    nodes.push({
      id: referentId,
      display: prior.display ?? prior.name ?? prior.id,
      individuation: prior.individuation ?? "holon",
      mass,
      sentenceCount: occupied,
      presenceRate: sentenceCount > 0 ? occupied / sentenceCount : 0,
      gaps: admission.gaps,
    });
  }
  return nodes.sort((a, b) => b.mass - a.mass);
}

/**
 * Sentence-level co-occurrence: two referents are linked if both are
 * present in the same sentence. This is the raw substrate the edges are
 * built from; significance/typing happen in later passes so the expensive
 * per-sentence scan happens exactly once.
 *
 * @returns {Array<{ a: string, b: string, sentences: Array<{order,offset,text}> }>}
 */
export function buildCoOccurrenceEdges(sentences, presence) {
  const referentIds = [...presence.keys()];
  const edgeMap = new Map();
  for (const s of sentences) {
    const present = referentIds.filter((id) => (presence.get(id).get(s.order) ?? 0) > 0);
    if (present.length < 2) continue;
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const [a, b] = present[i] < present[j] ? [present[i], present[j]] : [present[j], present[i]];
        const key = `${a}|${b}`;
        const e = edgeMap.get(key) ?? { a, b, sentences: [] };
        e.sentences.push({ order: s.order, offset: s.offset, text: s.text });
        edgeMap.set(key, e);
      }
    }
  }
  return [...edgeMap.values()];
}

/**
 * Conditional independence null for a co-occurrence count (see file header):
 * expected = N * pA * pB where pA/pB are each referent's OWN marginal
 * sentence-presence rate. lift = observed / expected. This is what makes an
 * edge between two rare, tightly-paired referents outrank an edge between
 * two ubiquitous but unrelated ones, instead of both scoring on raw count.
 */
export function annotateSignificance(edges, nodeById, sentenceCount, options = {}) {
  const { minCount = 3, minLift = 1.5 } = options;
  return edges.map((e) => {
    const pA = nodeById.get(e.a)?.presenceRate ?? 0;
    const pB = nodeById.get(e.b)?.presenceRate ?? 0;
    const expected = sentenceCount * pA * pB;
    const observed = e.sentences.length;
    const lift = expected > 0 ? observed / expected : (observed > 0 ? Infinity : 0);
    const reliable = observed >= minCount && lift >= minLift;
    return { ...e, observed, expected, lift, reliable };
  });
}

/**
 * Type each edge two ways, both grounded to WHERE in the sentence the
 * evidence sits, never just "this word occurs somewhere nearby":
 *
 *  - categoryCounts: injected lexicon (data — priors/lexicon/*.json) hits
 *    that sit between or tightly beside both referents' mentions
 *    (keywordEvidencesPair). Reports an uncollapsed amplitude vector, not a
 *    first-match label — same discipline as cube/index.js's
 *    classifyAmplitudes vs classify.
 *  - statedRelations: SVO relations from the English perceiver
 *    (perceiver/text/extraction.js) whose subject resolves to one referent's
 *    admitted surfaces and object to the other's — a directly stated
 *    predicate ("Andrew married Lise"), stronger evidence than a lexicon hit
 *    because it names WHO did WHAT to WHOM, not just a nearby word.
 *
 * `cast` (referentId -> { admission }) supplies each referent's admitted
 * surfaces so both checks can locate mentions inside a sentence, not just
 * know the pair co-occurred somewhere in it.
 */
export function classifyEdges(edges, lexicon = {}, cast = new Map(), options = {}) {
  const { segmentUnits = textClauseSegmenter } = options;
  const categories = Object.entries(lexicon);
  return edges.map((e) => {
    const admissionA = cast.get(e.a)?.admission;
    const admissionB = cast.get(e.b)?.admission;
    const categoryCounts = {};
    const categoryEvidence = {};
    const statedRelations = [];

    for (const s of e.sentences) {
      const posA = surfacePositions(s.text, admissionA?.surfaces);
      const posB = surfacePositions(s.text, admissionB?.surfaces);
      if (!posA.length || !posB.length) continue; // both should be here; skip defensively if not

      for (const [category, keywords] of categories) {
        const hit = keywords.some((kw) => keywordEvidencesPair(s.text, kw, posA, posB, segmentUnits));
        if (hit) {
          categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
          (categoryEvidence[category] ??= []).push({ offset: s.offset, text: s.text });
        }
      }

      for (const r of extractRelations([{ text: s.text, foldScore: 1 }], { limit: 8 })) {
        const subjA = matchesAnySurface(r.subject, admissionA?.surfaces);
        const subjB = matchesAnySurface(r.subject, admissionB?.surfaces);
        const objA = matchesAnySurface(r.object, admissionA?.surfaces);
        const objB = matchesAnySurface(r.object, admissionB?.surfaces);
        if (subjA && objB) statedRelations.push({ from: e.a, to: e.b, verb: r.verb, polarity: r.polarity, offset: s.offset, text: s.text });
        else if (subjB && objA) statedRelations.push({ from: e.b, to: e.a, verb: r.verb, polarity: r.polarity, offset: s.offset, text: s.text });
      }
    }

    const dominantCategory = Object.entries(categoryCounts).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    return { ...e, categoryCounts, categoryEvidence, dominantCategory, statedRelations };
  });
}

/**
 * Emergent per-node "kind": not assigned, derived — an amplitude vector over
 * the SAME relation categories the edges were typed with, pooled across a
 * node's incident RELIABLE edges (weighted by how many sentences evidenced
 * each category). `advisoryKind` is that vector's argmax, named per
 * CLAUDE.md's advisoryClassify* convention: informs display/ordering only,
 * never a gate, merge, or veto (packages/engine/conformance/invariants/
 * no-classifier-in-gates.test.js is the enforcement precedent this follows).
 */
export function computeNodeKindProfiles(nodes, edges, options = {}) {
  const { reliableOnly = true } = options;
  const amplitude = new Map(nodes.map((n) => [n.id, {}]));
  for (const e of edges) {
    if (reliableOnly && !e.reliable) continue;
    for (const [category, count] of Object.entries(e.categoryCounts ?? {})) {
      for (const id of [e.a, e.b]) {
        const amp = amplitude.get(id);
        if (amp) amp[category] = (amp[category] ?? 0) + count;
      }
    }
  }
  return nodes.map((n) => {
    const amp = amplitude.get(n.id) ?? {};
    const total = Object.values(amp).reduce((s, v) => s + v, 0);
    const ranked = Object.entries(amp).sort((a, b) => b[1] - a[1]);
    const kindProfile = Object.fromEntries(ranked.map(([k, v]) => [k, total > 0 ? v / total : 0]));
    return { ...n, kindProfile, advisoryKind: ranked[0]?.[0] ?? null };
  });
}

/**
 * Orchestrates the whole pipeline: admit the cast, split sentences, find
 * co-occurrence, annotate significance, classify. Every edge keeps its
 * source sentences (verbatim quote + offset) as evidence — no claim here is
 * unaccompanied by the text that grounds it.
 *
 * @param {string} fullText
 * @param {Array<object>} corefPriors
 * @param {object} options
 * @param {Array<{order,offset,text}>} options.sentences - pre-split sentences
 *   (e.g. text-organ.js::splitSentences(fullText)); computed if omitted.
 * @param {object} [options.lexicon] - relation-category keyword map (data)
 * @param {object} [options.significance] - { minCount, minLift } thresholds
 */
export function buildRelationshipGraph(fullText, corefPriors, options = {}) {
  const { sentences, lexicon = {}, significance = {}, segmentUnits } = options;
  const sents = sentences ?? [];
  const { cast } = admitCast(fullText, corefPriors);
  const presence = presenceBySentence(sents, cast);
  const nodes = buildNodes(cast, presence, sents.length);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const coOccurrence = buildCoOccurrenceEdges(sents, presence);
  const withSignificance = annotateSignificance(coOccurrence, nodeById, sents.length, significance);
  const edges = classifyEdges(withSignificance, lexicon, cast, { segmentUnits }).map(({ sentences: evidence, ...rest }) => ({
    ...rest,
    evidence,
  }));
  const kindedNodes = computeNodeKindProfiles(nodes, edges);
  return { nodes: kindedNodes, edges, sentenceCount: sents.length };
}
