// attribution.js — who did what to whom, checked against the evidence.
//
// The failure this exists to catch, measured on real output:
//
//   evidence (Frankenstein, ch. 16):  "I grasped his throat to silence him,
//                                      and in a moment he lay dead at my feet."
//   generated claim:                  "prompting Frankenstein to grasp its
//                                      throat and silence it"
//
// Every name in that claim appears in the cited passage. Every content word is
// ordinary. A bag-of-words fidelity check scores it 0.29 and passes it. It is
// nonetheless false in the most consequential way available: the passage is
// inside the CREATURE's narrator span, so its "I" is the creature killing
// William — and the claim hands that act to Victor. Agent and patient are
// swapped, and the swap is the whole meaning.
//
// Two things have to be true to catch it, and the engine already had both:
//
//   1. SVO extraction that is not gated on a verb list (svo.js::extractSVO).
//      A closed RELATION_VERBS list makes any unlisted verb invisible, and
//      "grasped" is exactly the kind of verb such lists omit.
//
//   2. Narrator spans (eoPriors coref priors). A first-person subject is a
//      SURFACE whose referent is fixed by scope, never by the string "I" —
//      the nameless-referent principle, applied to the one pronoun that
//      changes referent depending on who is holding the pen. Frankenstein is
//      a frame narrative; without this, every "I" in the creature's tale is
//      silently attributed to Victor.
//
// What this module does NOT do: decide whether a claim is interesting, well
// written, or true in the world. It compares a stated relation against the
// relations the evidence states, and reports where the agent does not match.
// Missing narrator prior => typed gap, never a guessed attribution.

import { extractSVO, verbDelta, deltaCosine } from "./svo.js";

// First-person surfaces. These are the only tokens whose referent is a
// function of WHO IS SPEAKING rather than of the token itself.
const FIRST_PERSON = new Set(["i", "me", "my", "mine", "myself", "we", "us", "our"]);

/**
 * Resolve a subject surface to a referent.
 *
 * A first-person surface inside referent R's narrator span IS R. Outside every
 * narrator span it belongs to the outer narrator, which the caller names.
 * Anything else resolves to itself — a name is already a surface of whatever it
 * predicates, and this module does not do general coref (that is
 * presence.js::admitReferent's job and must not be re-implemented here).
 *
 * Returns `{ referent, basis }`, or a gap when a first-person surface appears
 * and no narrator information was supplied — an unresolved "I" is the exact
 * condition under which a wrong attribution looks correct.
 */
export function resolveSubject(surface, offset, { narratorSpans = [], outerNarrator = null } = {}) {
  const s = String(surface || "").trim().toLowerCase();
  if (!s) return { referent: null, basis: "absent", gap: "no subject surface" };

  if (!FIRST_PERSON.has(s)) return { referent: s, basis: "surface" };

  const containing = narratorSpans.find((sp) => offset >= sp.start && offset < sp.end);
  if (containing) return { referent: String(containing.referent).toLowerCase(), basis: "narrator-span" };
  if (outerNarrator) return { referent: String(outerNarrator).toLowerCase(), basis: "outer-narrator" };

  return {
    referent: null,
    basis: "unresolved",
    gap: `first-person subject "${surface}" at offset ${offset} falls in no narrator span and no outer narrator was declared — attribution cannot be earned`,
  };
}

/** Do two referent labels denote the same thing, given injected surface sets? */
function sameReferent(a, b, aliases) {
  if (!a || !b) return false;
  if (a === b) return true;
  for (const group of aliases) {
    const g = group.map((x) => String(x).toLowerCase());
    if (g.includes(a) && g.includes(b)) return true;
  }
  // Containment covers "frankenstein" vs "victor frankenstein" without a
  // second alias map. It is deliberately weak: a false MATCH here suppresses a
  // veto, so this errs toward reporting a mismatch rather than hiding one.
  return a.includes(b) || b.includes(a);
}

/**
 * checkAttribution(claim, evidenceText, options) -> { vetoes, checked, gaps }
 *
 * For each relation the CLAIM states, look for a relation in the EVIDENCE with
 * the same verb, then compare resolved agents.
 *
 * - agent matches      -> supported
 * - agent differs      -> `misattribution`, a HARD veto. This is the case where
 *                         every name is real and the sentence is still false.
 * - no matching verb   -> `unsupported-relation`, soft: the evidence may state
 *                         it in words this extractor did not pair up, so it is
 *                         reported rather than treated as proof of invention.
 *
 * `useEmbeddings` matches verbs by DEF delta instead of string equality, so
 * "grasped"/"seized" count as the same act without anyone maintaining a
 * synonym list — the point of svo.js. Off by default because it loads a model;
 * the lexical path catches the swap on its own when the verb is reused, which
 * is the common case for a model paraphrasing a passage it was handed.
 */
export async function checkAttribution(claim, evidenceText, options = {}) {
  const {
    narratorSpans = [],
    outerNarrator = null,
    aliases = [],
    evidenceOffset = 0,
    useEmbeddings = false,
    verbThreshold = 0.55,
  } = options;

  const claimRels = extractSVO(claim);
  const evidenceRels = extractSVO(evidenceText);
  const vetoes = [];
  const gaps = [];
  let checked = 0;

  for (const c of claimRels) {
    // The claim is written by the model; it has no narrator span of its own, so
    // a first-person subject in a claim is not resolvable and is skipped rather
    // than guessed.
    const claimAgent = FIRST_PERSON.has(String(c.subject).toLowerCase())
      ? null
      : String(c.subject).toLowerCase();
    if (!claimAgent) continue;

    let matches = evidenceRels.filter((e) => e.verb.toLowerCase() === c.verb.toLowerCase());

    if (!matches.length && useEmbeddings) {
      // Same act, different word. The delta IS the relation (svo.js), so verbs
      // are compared by their contribution to the clause rather than by a list.
      for (const e of evidenceRels) {
        const [dc, de] = await Promise.all([
          verbDelta(c.text, c.subject, c.verb, c.object),
          verbDelta(e.text, e.subject, e.verb, e.object),
        ]);
        if (deltaCosine(dc, de) >= verbThreshold) matches.push(e);
      }
    }

    if (!matches.length) {
      vetoes.push({
        id: "unsupported-relation",
        severity: "soft",
        message: `claim states "${c.subject} ${c.verb} ${c.object}" but no evidence relation uses that act`,
        claim: c,
      });
      continue;
    }

    // If ANY matching evidence relation shares the agent, the claim is carried.
    let supported = false;
    const seen = [];
    for (const e of matches) {
      const r = resolveSubject(e.subject, evidenceOffset + (e.offset ?? 0), { narratorSpans, outerNarrator });
      if (r.gap) { gaps.push(r.gap); continue; }
      seen.push(r);
      if (sameReferent(claimAgent, r.referent, aliases)) { supported = true; break; }
    }
    checked++;

    if (!supported && seen.length) {
      vetoes.push({
        id: "misattribution",
        severity: "hard",
        message:
          `claim attributes "${c.verb} ${c.object}" to "${c.subject}", but the evidence states it of ` +
          seen.map((r) => `"${r.referent}" (${r.basis})`).join(" / ") +
          ` — agent and patient are not interchangeable`,
        claim: c,
        evidenceAgents: seen,
      });
    }
  }

  return { vetoes, checked, gaps, passed: vetoes.every((v) => v.severity !== "hard") };
}
