// Text-perceiver extraction: properties, relations, figures from English prose.
//
// This is MEDIUM-SPECIFIC extraction (English copulas, an English verb
// list, Latin-script capitalization), which is why it lives in the
// perceiver and not in emergence/summary — the summary layer must stay
// modality-agnostic and consumes these results as organ output.
//
// The extraction is heuristic and declared as such. What it will not do is
// fabricate: a relation's polarity is read from negation markers in the
// clause, never asserted positive by default.

// The one list. It is exported because `emergence/summary/non-lexical-surfer`
// needs the same verbs as a Set for O(1) per-frame lookup, and had re-typed all
// 87 of them inline — a second copy of a lexicon is a drift waiting to happen,
// and typing them as individually-quoted strings also trips the attribution-
// verb conformance gate. Consumers that want membership testing should call
// `relationVerbSet()` rather than re-splitting this themselves.
//
// Kept as a pipe-joined string because its primary use is regex alternation.
export const RELATION_VERBS =
  "married|fought|led|wrote|built|destroyed|founded|ruled|served|worked|lived|died|born|moved|traveled|said|told|asked|gave|took|made|found|held|stood|sat|ran|walked|spoke|thought|knew|saw|heard|felt|wanted|needed|loved|hated|feared|hoped|believed|claimed|stated|argued|showed|proved|revealed|demonstrated|indicated|suggested|implied|meant|intended|planned|tried|attempted|managed|failed|succeeded|won|lost|beat|defeated|conquered|controlled|dominated|influenced|shaped|changed|transformed|developed|grew|improved|declined|fell|rose|increased|decreased|remained|stayed|became|turned|seemed|appeared|looked|sounded|tasted|smelled";

// Membership view of RELATION_VERBS. Built once per call site, not per frame.
export function relationVerbSet() {
  return new Set(RELATION_VERBS.split("|"));
}

const NEGATION_BEFORE_VERB = /\b(?:not|never|no longer|hardly|scarcely|neither|nor|didn't|don't|doesn't|wouldn't|couldn't|shouldn't|won't|can't|cannot)\s+(?:\w+\s+){0,2}$/i;

// Word tokens must be Unicode-aware: translated prose is full of accented
// names (Natásha, Hélène) that ASCII \w silently truncates.
const W = "[\\p{L}\\p{N}_'’]+";

export function extractProperties(ranked, { limit = 6 } = {}) {
  const props = [];
  const seen = new Set();
  const propMatcher = new RegExp(`(?<=^|[^\\p{L}])(${W}(?:\\s+${W})?)\\s+(?:is|was|has|are|were|had)\\s+(.+?)(?:\\.|,|;|$)`, "giu");

  for (const unit of ranked) {
    const text = unit.text ?? "";
    // Simple pattern: "X is Y" or "X was Y" or "X has Y"
    const matches = text.match(propMatcher);
    if (matches) {
      for (const m of matches) {
        const parts = m.match(/^(.+?)\s+(?:is|was|has|are|were|had)\s+(.+?)$/iu);
        if (parts) {
          const label = parts[1].trim();
          const value = parts[2].trim().replace(/[.,;]$/, "");
          const key = `${label}|${value}`.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            props.push({ label, value, score: unit.foldScore ?? 0 });
          }
        }
      }
    }
  }

  return props.slice(0, limit);
}

export function extractRelations(ranked, { limit = 6 } = {}) {
  const rels = [];
  const seen = new Set();
  const matcher = new RegExp(`(?<=^|[^\\p{L}])(${W}(?:\\s+${W})?)\\s+(${RELATION_VERBS})\\s+(.+?)(?:\\.|,|;|$)`, "giu");
  const splitter = new RegExp(`^(.+?)\\s+(${RELATION_VERBS})\\s+(.+?)$`, "iu");

  for (const unit of ranked) {
    const text = unit.text ?? "";
    matcher.lastIndex = 0;
    let m;
    while ((m = matcher.exec(text)) !== null) {
      const parts = m[0].match(splitter);
      if (!parts) continue;
      const subject = parts[1].trim();
      const verb = parts[2].trim();
      const object = parts[3].trim().replace(/[.,;]$/, "");
      const key = `${subject}|${verb}|${object}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Polarity is READ from the clause, never asserted by default:
      // negation markers just before the verb flip it ("never married",
      // "did not love"). Everything else is affirmative in the source.
      const before = text.slice(Math.max(0, m.index - 40), m.index + parts[1].length + 1);
      const polarity = NEGATION_BEFORE_VERB.test(before) ? "-" : "+";
      rels.push({ subject, verb, object, polarity, score: unit.foldScore ?? 0 });
    }
  }

  return rels.slice(0, limit);
}

export function extractFigures(ranked, { limit = 8 } = {}) {
  const figures = [];
  const seen = new Set();

  for (const unit of ranked) {
    const text = unit.text ?? "";
    // Simple pattern: capitalized words that aren't at sentence start
    const matches = text.match(/(?<=[.!?]\s|^)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g);
    if (matches) {
      for (const m of matches) {
        const name = m.trim();
        // Skip common false positives
        if (/^(The|And|But|For|With|This|That|When|Where|While|He|She|It|They|His|Her|Their|Its|In|On|At|To|From|By|As|Or|If|So|No|Not|Yet|Now|Then|Also|Just|Only|Even|Still|Already|Always|Never|Often|Sometimes|Usually|Here|There|Every|Each|Both|Few|Many|Much|Some|Any|All|None|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)$/.test(name)) continue;
        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          figures.push({ label: name, count: 1 });
        }
      }
    }
  }

  // Deduplicate and sort by count
  const figureMap = new Map();
  for (const f of figures) {
    const existing = figureMap.get(f.label);
    if (existing) {
      existing.count += 1;
    } else {
      figureMap.set(f.label, { ...f });
    }
  }

  return [...figureMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
