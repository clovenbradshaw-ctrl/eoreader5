// svo.js — SVO differential encoding: kill the verb list.
//
// The existing extraction.js::extractRelations works by pattern-matching
// against an 87-verb RELATION_VERBS list. Any verb not on that list is
// invisible — "admired", "rescued", "comforted" all silently pass through.
// The list is the wrong abstraction: relations are not a closed class.
//
// DEF-based SVO encoding replaces the list with a differential:
//
//   verbDelta = embed(S V O) - embed(S _ O)
//
// where embed(S _ O) is the embedding of the clause with the verb masked.
// The delta is the verb's contribution to the relational representation,
// regardless of whether the verb is on any list. The delta IS the relation.
//
// This is NOT a classifier that says "this verb means X". It's a measurement:
// the delta varies continuously with the actual text, and it varies in a way
// that — if the EO geometric structure is real — should separate by Q1 axis
// (Differentiating/Relating/Generating).

import { lazyEncoder } from "./embedder.js";
import { shadowDelta, deltaCosine, deltaMagnitude } from "./shadow.js";

const MASK = "[MASK]";

/**
 * extractSVO(text) -> [{ subject, verb, object, polarity, offset }]
 *
 * Lightweight SVO extraction that does NOT use RELATION_VERBS. Uses simple
 * dependency-light patterns:
 *   NP + V + NP  (any verb, any NP)
 *
 * This is deliberately simpler than extraction.js's regex — it catches MORE
 * clauses (no verb filter) at the cost of more false positives. The DEF delta
 * downstream doesn't care about precision here: noise in the extraction just
 * makes the delta noisier, and the geometric scoring (z-score vs shuffled
 * labels) will surface whether the signal survives.
 */
export function extractSVO(text) {
  if (!text) return [];
  const results = [];
  const WORD = /[A-Za-zÀ-ÿ]+/g;
  const isCapitalized = (w) => w && /^[A-ZÀ-Ÿ]/.test(w);

  const sents = text.split(/(?<=[.!?])\s+/);

  for (const sent of sents) {
    const tokens = [];
    let m;
    while ((m = WORD.exec(sent)) !== null) {
      tokens.push({ word: m[0], index: m.index });
    }
    if (tokens.length < 3) continue;

    for (let i = 0; i < tokens.length - 2; i++) {
      const subj = tokens[i];

      const isPronoun = /^(He|She|It|They|I|We|You)$/i.test(subj.word);
      const subjIsNamed = isCapitalized(subj.word) || isPronoun;
      if (!subjIsNamed) continue;

      // A NAME can be more than one token.
      //
      // Taking three consecutive tokens as S/V/O parsed "Victor Frankenstein
      // grasped his throat" as subject="Victor", verb="frankenstein",
      // object="grasped" — the surname became the verb, so every downstream
      // relation compared the wrong things while looking perfectly well-formed.
      // Multi-word names are the common case, not the exception ("Prince
      // Vasíli", "Natásha Rostóva"), and relationship-graph.js already carries
      // a comment about what multi-word seeds do to naive matching.
      //
      // A capitalized non-pronoun subject absorbs the run of capitalized tokens
      // that follows it. Pronouns absorb nothing — "He Grasped" at a sentence
      // start must not swallow the verb.
      let subjEnd = i;
      if (!isPronoun && isCapitalized(subj.word)) {
        while (subjEnd + 2 < tokens.length && isCapitalized(tokens[subjEnd + 1].word)) subjEnd++;
      }
      if (subjEnd + 2 >= tokens.length) continue;

      const subject = tokens.slice(i, subjEnd + 1).map((t) => t.word).join(" ");
      const verb = tokens[subjEnd + 1];
      const obj = tokens[subjEnd + 2];

      results.push({
        subject,
        verb: verb.word.toLowerCase(),
        object: obj.word,
        offset: sent.length > 60 ? text.indexOf(sent) : 0,
        text: sent,
      });

      i = subjEnd + 2;
    }
  }

  return results;
}

/**
 * verbDelta(clauseText, subject, verb, object, options) -> delta vector
 *
 * Returns embed(S V O) - embed(S [MASK] O). The delta captures the verb's
 * specific contribution to the relational semantics of the clause, isolated
 * from the subject and object.
 *
 * A near-zero delta means the verb is redundant given S and O (or the
 * clause structure carries the relation, not the verb itself). A large
 * delta means the verb actively transforms the S-O relation.
 */
export async function verbDelta(clauseText, subject, verb, object, options = {}) {
  const enc = options.encoder || await lazyEncoder();

  // Full clause embedding
  const fullVec = await enc.encode(clauseText);

  // Construct the masked version: S [MASK] O (preserving as much structure as possible)
  const maskedText = clauseText.replace(
    new RegExp(`\\b${escapeRegex(verb)}\\b`, "i"),
    MASK
  );

  const maskedVec = await enc.encode(maskedText);
  return fullVec.map((v, i) => v - maskedVec[i]);
}

/**
 * roleDeltas(clauseText, subject, verb, object, options) -> { subj, verb, obj }
 *
 * Returns three deltas — one for each role — from a single clause:
 *   subj: embed(clause) - embed(clause with subject masked)
 *   verb: embed(clause) - embed(clause with verb masked)
 *   obj:  embed(clause) - embed(clause with object masked)
 *
 * This allows testing whether SVO role deltas systematically differ by Q3
 * axis (Background/Particular/Pattern for subject and object) and Q1 axis
 * (Differentiating/Relating/Generating for verb).
 */
export async function roleDeltas(clauseText, subject, verb, object, options = {}) {
  const enc = options.encoder || await lazyEncoder();
  const fullVec = await enc.encode(clauseText);

  const mask = (role) => {
    return clauseText.replace(new RegExp(`\\b${escapeRegex(role)}\\b`, "i"), MASK);
  };

  const [subjVec, verbVec, objVec] = await Promise.all([
    enc.encode(mask(subject)),
    enc.encode(mask(verb)),
    enc.encode(mask(object)),
  ]);

  return {
    subject: fullVec.map((v, i) => v - subjVec[i]),
    verb: fullVec.map((v, i) => v - verbVec[i]),
    object: fullVec.map((v, i) => v - objVec[i]),
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { deltaCosine, deltaMagnitude };
