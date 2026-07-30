/**
 * Text surface extractor — minimal, no NLP.
 *
 * Identifies candidate entity names by their only modality-specific signal:
 * capitalization. Multi-word capitalized sequences are treated as surfaces.
 *
 * The extractor does NOT normalize, classify, or cluster. It doesn't use
 * stop-lists, dictionaries, or regex patterns beyond the capitalization
 * pattern. It's the text analog of the audio perceiver's frame extraction:
 * raw signal in, candidate surfaces out. The engine handles everything else.
 */

const CAP_SEQ = /\b[\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+)*\b/gu;

export function extractSurfaces(text) {
  const out = [];
  let m;
  CAP_SEQ.lastIndex = 0;
  while ((m = CAP_SEQ.exec(text || ""))) {
    const s = m[0].trim();
    if (s.length >= 2) out.push(s);
  }
  return [...new Set(out)];
}

/**
 * Rank the surfaces of a framed document, rejecting the capitalized things
 * that are not names.
 *
 * The physics: a NAME essentially never appears with a lowercase initial,
 * while a sentence or dialogue opener ("Well", "Why", "There") constantly
 * does. So the ratio of capitalized to lowercase occurrences separates them
 * without a stop-list, a dictionary, or any per-language knowledge — which is
 * what keeps this omnimodal rather than an English name-lexicon.
 *
 * The counts MUST be case-sensitive over raw frame text. Frame distributions
 * are already lowercased, so counting those counts every occurrence and
 * dissolves the very signal this depends on.
 *
 * This logic was written inline inside `emergence/summary/entity-fold.js`,
 * where only that one fold could reach it; every other caller that wanted
 * "the names in this document" re-derived a worse version. It lives here now
 * so there is one copy. Callers wanting per-entity folding still go through
 * entity-fold; this answers the different question of who is in the document
 * at all.
 *
 * Returns [{ surface, frames, mentions }] sorted by frame spread — spread
 * rather than raw count, because a name in one chapter and a name running
 * through the whole book are different kinds of thing, and ranking by count
 * alone buries the second under the first.
 */
export function rankSurfaces(frames, { minFrames = 2, limit = 200, openerRatio = 0.9 } = {}) {
  const perFrame = new Map();
  for (const f of frames) perFrame.set(f.order, extractSurfaces(f.text));

  const lowerFormCounts = new Map();
  for (const f of frames) {
    for (const tok of String(f.text ?? "").split(/\s+/)) {
      const m = tok.match(/^\p{Ll}[\p{L}'’]*/u);
      if (m) {
        const k = m[0].toLowerCase();
        lowerFormCounts.set(k, (lowerFormCounts.get(k) ?? 0) + 1);
      }
    }
  }

  // Second discriminator: WHERE in the unit the surface sits.
  //
  // The cap/lower ratio alone cannot separate a name from a word that opens
  // almost every sentence in a heavily-versed text. Measured on the KJV,
  // "Then", "Thus", "Why" and "Arise" all pass the ratio test, because they
  // are verse-initial nearly everywhere and so are almost never seen
  // lowercased. What still separates them from "Moses" is position: a name
  // occurs mid-clause constantly, while an opener essentially only ever
  // begins one. A surface that is sentence-initial in ~every occurrence is
  // therefore rejected regardless of its ratio.
  //
  // This stays a positional statistic, not a stop-list, so it carries over to
  // any text with unit boundaries rather than encoding English function words.
  //
  // It is measured per TOKEN rather than per surface, because the same fact
  // fixes two different symptoms. `extractSurfaces` matches a run of
  // capitalized words, so a clause-initial opener followed by a name is
  // captured as one surface: the KJV yields "And Moses", "When Jesus", "But
  // Jesus" alongside the bare names. Knowing that "And" is an opener both
  // rejects it standing alone AND lets the glued surface be trimmed back to
  // the name it actually points at — which matters well beyond tidiness,
  // since an untrimmed "And Moses" is a separate referent that co-occurs with
  // Moses everywhere, and so dominates his relation graph with himself.
  const tokInitial = new Map();
  const tokTotal = new Map();
  const TOKEN = /\p{Lu}[\p{L}'’]*/gu;
  for (const f of frames) {
    const text = String(f.text ?? "");
    TOKEN.lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(text))) {
      const tok = m[0];
      tokTotal.set(tok, (tokTotal.get(tok) ?? 0) + 1);
      // Opened a unit: frame start, or the nearest thing behind it is a line
      // break / sentence-final punctuation.
      //
      // The gap may contain locator material — the KJV numbers every verse,
      // so the text reads "…earth.\n\n1:2 And the earth…" and the token is
      // separated from its boundary by "1:2 ". Allowing digits, colons and
      // periods through the gap is what makes this work on a versed text;
      // without it every verse-initial word looks mid-clause and the whole
      // discriminator silently measures nothing.
      const w = text.slice(Math.max(0, m.index - 16), m.index);
      if (m.index === 0 || /[.!?:;\n][\s\d:.]*$/.test(w)) {
        tokInitial.set(tok, (tokInitial.get(tok) ?? 0) + 1);
      }
    }
  }
  const isOpener = (tok) => {
    const seen = tokTotal.get(tok) ?? 0;
    return seen >= 8 && (tokInitial.get(tok) ?? 0) / seen >= openerRatio;
  };

  // Trim leading opener tokens. A surface that is nothing BUT openers is not
  // a name and collapses to empty, which drops it.
  const canonical = (s) => {
    const words = s.split(/\s+/);
    let i = 0;
    while (i < words.length && isOpener(words[i])) i++;
    return words.slice(i).join(" ");
  };

  // Frame spread and raw mass, counted under the canonical form so the
  // trimmed variants add their weight to the name instead of competing.
  const spread = new Map();
  const mass = new Map();
  for (const [, surfaces] of perFrame) {
    const perFrameCanon = new Set();
    for (const s of surfaces) {
      const c = canonical(s);
      if (!c) continue;
      mass.set(c, (mass.get(c) ?? 0) + 1);
      perFrameCanon.add(c);
    }
    for (const c of perFrameCanon) spread.set(c, (spread.get(c) ?? 0) + 1);
  }

  const kept = [];
  for (const [s, frameCount] of spread) {
    if (frameCount < minFrames) continue;
    if (s.includes("\n")) continue;
    const words = s.split(/\s+/);
    if (words.length === 1) {
      const lower = lowerFormCounts.get(s.toLowerCase()) ?? 0;
      const upper = mass.get(s) ?? 0;
      if (upper === 0) continue;
      if (lower > 0) {
        const ratio = upper / lower;
        // Names sit near 1.0–1.5. Common words fall below 0.8; things that
        // only ever open a sentence or a line of dialogue run above 2.0.
        if (ratio < 0.8 || ratio > 2.0) continue;
      }
    }
    kept.push({ surface: s, frames: frameCount, mentions: mass.get(s) ?? 0 });
  }

  kept.sort((a, b) => b.frames - a.frames || b.mentions - a.mentions);
  return kept.slice(0, limit);
}

/**
 * Build per-chunk entity records for the entity-kinds pipeline.
 * Returns Map<chunkId, entityName[]>.
 */
export function buildSurfaceMap(chunkTexts) {
  const map = new Map();
  for (const [chunkId, text] of Object.entries(chunkTexts)) {
    map.set(chunkId, extractSurfaces(text));
  }
  return map;
}

export function buildEntityRecords(surfaceMap) {
  const entityChunks = new Map(); // entity -> Set<chunkId>
  const entityCoocs = new Map();  // entity -> Map<cooc, count>

  for (const [chunkId, surfaces] of surfaceMap) {
    for (const s of surfaces) {
      const chunks = entityChunks.get(s) ?? new Set();
      chunks.add(chunkId);
      entityChunks.set(s, chunks);
    }
    // Co-occurrence within chunk
    const unique = [...new Set(surfaces)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i], b = unique[j];
        const m1 = entityCoocs.get(a) ?? new Map();
        const m2 = entityCoocs.get(b) ?? new Map();
        m1.set(b, (m1.get(b) ?? 0) + 1);
        m2.set(a, (m2.get(a) ?? 0) + 1);
        entityCoocs.set(a, m1);
        entityCoocs.set(b, m2);
      }
    }
  }

  const records = [];
  for (const [name, chunks] of entityChunks) {
    const coocs = entityCoocs.get(name) ?? new Map();
    const attrs = [];
    // Co-occurrence attributes
    for (const [cooc, count] of coocs) {
      if (count >= 2) attrs.push({ field_id: `cooc:${cooc}`, value_type: "string", count });
    }
    const words = name.split(/\s+/);
    if (words.length >= 2) attrs.push({ field_id: "multiword", value_type: "string", count: 1 });
    if (attrs.length > 0) {
      records.push({ id: name, name, attributes: attrs });
    }
  }
  return records;
}
