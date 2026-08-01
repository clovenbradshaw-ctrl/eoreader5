// dialogue.js — Dialogue segment extraction with speaker attribution.
//
// Extracts quoted speech from text and attributes each segment to an entity
// surface using presence-admitted surfaces. This is a non-lexical observable
// designed to feed the multi-altitude fold's candidate pool with
// dialogue-rich scenes, addressing the altitude-collapse gap (the candidate
// pool is deep in lexical-surprise peaks but blind to who speaks and where).
//
// Design constraints (same contract as every organ):
//   1. Every output span carries { offset, length, raw, verified } — provenance
//      round-trippable through locateRawSpan.
//   2. Speaker attribution uses ONLY entity surfaces already admitted by
//      presence.js — never guesses a new surface string.
//   3. The emanon case: the Creature has no name surface, only descriptor
//      aliases from the per-text prior. Dialogue attributed via those surfaces
//      is scored at the surface's declared weight.
//   4. Attribution is proximity-weighted: an attribution phrase 10 words after
//      the closing quote is stronger evidence than one 40 words away.
//   5. Multi-speaker dialogue (conversation, back-and-forth) is not segmented
//      per speech act — the whole quoted passage is one segment, attributed to
//      the closest speaker mention within the attribution window.
//   6. Attribution VERBS are MODEL-tier lexical knowledge — they vary by
//      language, literary convention, and period (English dialogue tags ≠
//      French ones ≠ Russian ones). The engine provides the structural pipeline
//      (quote boundaries, proximity scoring, surface matching) and accepts
//      the verb whitelist as a caller-supplied prior (options.attributionVerbs).
//      Without verbs, quote extraction works but speaker attribution returns
//      null — a typed gap, never a silently wrong label.

const OPEN_QUOTE = "\u201C"; // "
const CLOSE_QUOTE = "\u201D"; // "

const SURFACE_BOUNDARY_RE = /[^a-zA-Z\u00C0-\u024F'’\-_\d]+/;

function diaNorm(t) {
  const m = { 'á':'a','é':'e','í':'i','ó':'o','ú':'u','à':'a','è':'e','ì':'i','ò':'o','ù':'u','â':'a','ê':'e','î':'i','ô':'o','û':'u','ä':'a','ë':'e','ï':'i','ö':'o','ü':'u' };
  return String(t ?? "").toLowerCase().trim().split("").map(c => m[c] ?? c).join("");
}

function normTokens(t) {
  return diaNorm(t).split(SURFACE_BOUNDARY_RE).filter(Boolean);
}

function findQuotedSpans(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(OPEN_QUOTE, i);
    if (open === -1) break;
    const close = text.indexOf(CLOSE_QUOTE, open + 1);
    if (close === -1) break;
    const inner = text.slice(open + 1, close);
    if (inner.trim().length < 6) { i = close + 1; continue; }
    spans.push({ open, close, inner, offset: open });
    i = close + 1;
  }
  return spans;
}

function extractAttribution(context, attributionVerbs) {
  const ctx = diaNorm(context);
  const words = ctx.split(SURFACE_BOUNDARY_RE).filter(Boolean);
  if (words.length < 2) return null;

  const verbs = attributionVerbs instanceof Set ? attributionVerbs
    : Array.isArray(attributionVerbs) ? new Set(attributionVerbs.map(diaNorm))
    : null;
  if (!verbs) return null;

  let bestVerb = null, bestVi = -1;
  for (let vi = 0; vi < words.length; vi++) {
    if (verbs.has(words[vi])) {
      bestVerb = words[vi];
      bestVi = vi;
      break;
    }
  }
  if (!bestVerb) return null;

  let speakerPhrase = null;
  const maxLook = Math.min(bestVi + 6, words.length);
  for (let si = bestVi + 1; si < maxLook; si++) {
    if (verbs.has(words[si])) continue;
    if (words[si].length < 2) continue;
    speakerPhrase = words[si];
    break;
  }

  if (!speakerPhrase) {
    for (let si = bestVi - 1; si >= 0; si--) {
      if (verbs.has(words[si])) continue;
      if (words[si].length < 2) continue;
      speakerPhrase = words[si];
      break;
    }
  }

  if (!speakerPhrase) return { verb: bestVerb };

  const proximity = bestVi < words.length / 2
    ? 1 / (1 + bestVi)
    : 1 / (1 + Math.abs(bestVi - words.length));

  return { verb: bestVerb, phrase: speakerPhrase, proximity };
}

function matchSurface(phrase, surfaces) {
  const pn = diaNorm(phrase);
  if (pn.length < 3) return null;

  let best = null, bestScore = 0;

  for (const s of surfaces) {
    const sn = diaNorm(typeof s === "string" ? s : s.surface);
    if (sn.length < 3) continue;
    if (pn === sn) return { surface: typeof s === "string" ? s : s.surface, weight: s.weight ?? 1, score: 1.0 };
    if (sn.includes(pn) || pn.includes(sn)) {
      const score = Math.min(sn.length, pn.length) / Math.max(sn.length, pn.length);
      if (score > bestScore) {
        bestScore = score;
        best = { surface: typeof s === "string" ? s : s.surface, weight: s.weight ?? 1, score };
      }
    }
  }

  return best;
}

/**
 * extractDialogue(text, entitySurfaces, options) → Array<DialogueSegment>
 *
 * @param {string} text - source text
 * @param {Array<string|{surface:string,weight?:number}>} entitySurfaces - entity surfaces from presence admission
 * @param {object} options
 * @param {number} options.maxSegments - max segments to return (default 48)
 * @param {number} options.attrWindow - chars after closing quote to search for attribution (default 200)
 * @param {Set<string>|Array<string>} options.attributionVerbs - MODEL-tier prior: which words signal speaker attribution in this text's language/convention. Without this, speaker attribution returns null (typed gap).
 * @returns {Array<{offset:number, length:number, text:string, speaker:string|null, attribution:string|null, score:number, raw:string, verified:boolean}>}
 */
export function extractDialogue(text, entitySurfaces = [], options = {}) {
  const { maxSegments = 48, attrWindow = 200, attributionVerbs = null } = options;
  const src = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const quoted = findQuotedSpans(src);
  const surfaceMap = (entitySurfaces ?? []).map(s =>
    typeof s === "string" ? { surface: s, weight: 1 } : s
  );

  const results = [];

  for (const q of quoted) {
    const afterStart = q.close + 1;
    const afterEnd = Math.min(src.length, afterStart + attrWindow);
    const context = src.slice(afterStart, afterEnd);

    const attr = extractAttribution(context, attributionVerbs);

    let speaker = null;
    let surfaceWeight = 1;
    if (attr?.phrase && surfaceMap.length > 0) {
      const match = matchSurface(attr.phrase, surfaceMap);
      if (match) {
        speaker = match.surface;
        surfaceWeight = match.weight;
      }
    }

    const text = src.slice(q.open + 1, q.close);
    const length = q.close - q.open - 1;

    const attrScore = attr?.proximity ?? 0;
    const identScore = speaker ? surfaceWeight * (attr?.phrase ? 0.8 : 0.3) : 0.05;
    const lengthScore = Math.min(1, (text.trim().length) / 400);

    const score = 0.35 * attrScore + 0.40 * identScore + 0.25 * lengthScore;

    results.push({
      offset: q.open + 1,
      length,
      text,
      speaker,
      attribution: attr?.phrase ?? null,
      attrVerb: attr?.verb ?? null,
      score,
      raw: text,
      verified: length > 0,
    });
  }

  const out = results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSegments);

  return out;
}

/**
 * mergeDialogueIntoStream(dialogueSegments, rankedCandidates, options) → Array
 *
 * Merge dialogue-attributed segments into an existing ranked candidate pool.
 * Dialogue segments carry a "dialogue" source and are scored in the same
 * score-space as structural events and spine peaks so they can sort together.
 *
 * @param {Array} dialogueSegments - from extractDialogue
 * @param {Array} rankedCandidates - existing merged candidates
 * @param {object} options
 * @returns {Array} merged candidates with dialogue entries interleaved
 */
export function mergeDialogueIntoStream(dialogueSegments, rankedCandidates, options = {}) {
  const { dialogueBaseScore = 50, dedupeRadius = 150 } = options;

  const existingOffsets = new Set(
    rankedCandidates
      .filter((c) => c.offset != null)
      .map((c) => Math.round(c.offset / dedupeRadius))
  );

  const dialogueCandidates = [];
  for (const d of dialogueSegments) {
    if (!d.speaker) continue;
    const dedupeKey = d.offset != null ? Math.round(d.offset / dedupeRadius) : null;
    if (dedupeKey != null && existingOffsets.has(dedupeKey)) continue;

    dialogueCandidates.push({
      idx: d.offset ?? dialogueCandidates.length,
      offset: d.offset,
      source: "dialogue",
      text: d.text,
      context: d.text,
      score: dialogueBaseScore + (d.score ?? 0) * 40,
      type: null,
      speaker: d.speaker,
      attribution: d.attribution,
    });
    if (dedupeKey != null) existingOffsets.add(dedupeKey);
  }

  return [...rankedCandidates, ...dialogueCandidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
