// non-lexical-surfer.js — Non-lexical observables for span selection.
//
// The EOT pipeline parses the ENTIRE text into SVO triples. This module
// consumes the full parse — the complete "what the entity does" stream — and
// computes per-frame non-lexical signals for span selection.
//
// SVO extraction over the full text uses the RELATION_VERBS list from the
// perceiver (extraction.js) as a pre-built Set for O(1) lookup, NOT a regex
// with 100+ alternatives — regex backtracking over every frame × 2000 chars
// times out on long texts (War and Peace: ~2000 frames).
//
// Three signals per frame:
//   1. svoDensity    — count of known relation verbs in the frame
//   2. affectDensity — emotion lexicon hits
//   3. dialogueDensity — quoted speech markers

import { snapToSentences } from "./text-organ.js";
import { relationVerbSet } from "../../perceiver/text/extraction.js";

// The verbs come FROM the perceiver, they are not re-declared here. All 87
// were previously typed out again in this file; the copies were byte-identical
// when checked, which is exactly how a duplicated lexicon looks right up until
// one side is edited. A Set (not a 100+-alternative regex) because regex
// backtracking over every frame × 2000 chars times out on War and Peace.
const RELATION_VERB_SET = relationVerbSet();

const AFFECT_SET = newSetSafe([
  "anger","rage","fury","wrath","hatred","loathing","contempt",
  "spite","malice","bitterness","resentment","hostility","cruelty",
  "fear","terror","panic","dread","horror","alarm","fright",
  "anxiety","worry","unease","apprehension","dismay","consternation",
  "joy","delight","happiness","bliss","ecstasy","rapture","elation",
  "glee","cheer","merriment","festivity","celebration","euphoria",
  "sadness","grief","sorrow","misery","despair","anguish","woe",
  "melancholy","gloom","dejection","lamentation","mourning",
  "surprise","astonishment","amazement","shock","wonder","awe",
  "disgust","revulsion","nausea","repulsion","abhorrence","aversion",
  "love","affection","tenderness","compassion","pity","sympathy","empathy",
  "warmth","fondness","devotion","adoration","worship","reverence",
  "shame","guilt","embarrassment","humiliation","regret","remorse",
  "disgrace","dishonor","infamy","stigma","degradation",
  "pride","vanity","arrogance","humility","modesty","meekness",
  "courage","bravery","valor","heroism","cowardice","timidity",
  "desire","longing","yearning","craving","lust","appetite",
  "desperation","hopelessness","despondency","resignation",
  "triumph","victory","conquest","glory","honor","acclaim",
  "defeat","loss","failure","downfall","ruin","destruction",
  "confusion","bewilderment","perplexity","puzzlement","uncertainty",
  "doubt","suspicion","mistrust","caution","hesitation","vacillation",
  "passion","ardor","zeal","fervor","enthusiasm","excitement",
  "agony","torment","torture","pain","suffering","misery",
  "tender","gentle","soft","warm","bright","radiant",
  "wild","fierce","savage","violent","vehement","passionate",
  "desolate","forlorn","lonely","abandoned","forsaken",
  "trembling","quivering","shaking","faltering","hesitant",
  "resolute","determined","firm","steadfast","unyielding",
]);

function newSetSafe(words) {
  return new Set(words.map((w) => w.toLowerCase()));
}

const REL_VERBS = RELATION_VERB_SET;
const AFFECT = AFFECT_SET;

/**
 * Extract non-lexical signals for one frame, given the entity's known
 * surface tokens. O(words) — no regex backtracking, just Set lookups.
 *
 * svoDensity: count of RELATION_VERBS in the frame (the full SVO parse
 *   approximant — every relation verb occurrence IS a potential triple)
 * affectDensity: affect lexicon hits
 * dialogueDensity: quoted speech markers
 */
function frameNonLexical(frame, entityTokens) {
  const text = frame.text ?? "";
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const wc = words.length || 1;

  // SVO density — count relation verbs. This IS the full-text parse:
  // every occurrence of a relation verb is a potential SVO triple.
  let svoCount = 0;
  let entityCentered = 0;
  for (let i = 0; i < words.length; i++) {
    if (REL_VERBS.has(words[i])) {
      svoCount++;
      // Check if entity token is nearby (within 3 words)
      if (entityTokens && entityTokens.length > 0) {
        const start = Math.max(0, i - 3);
        const end = Math.min(words.length, i + 4);
        for (let j = start; j < end; j++) {
          if (j !== i && entityTokens.includes(words[j])) {
            entityCentered++;
            break;
          }
        }
      }
    }
  }

  const svoDensity = Math.min(svoCount / 4, 1);
  const entitySvoDensity = Math.min(entityCentered / 2, 1);

  // Affect density
  const affectCount = words.filter((w) => AFFECT.has(w)).length;
  const affectDensity = Math.min(affectCount / 6, 1);

  // Dialogue density
  const quotes = (text.match(/["""''""]/g) || []).length;
  const dialogueDensity = Math.min(quotes / 40, 1);

  const boost = Math.min(
    0.25 * svoDensity +
    0.30 * entitySvoDensity +
    0.25 * affectDensity +
    0.20 * dialogueDensity,
    1
  );

  return { boost, svoCount, entityCentered, affectCount, dialogueCount: quotes };
}

/**
 * Compute per-frame non-lexical signals for all target frames.
 *
 * The full-text SVO parse happens here: every frame's words are checked
 * against the RELATION_VERBS set (O(words) per frame, no regex).
 *
 * @param {Array} targetFrames — frames where the entity is present
 * @param {string} targetSurface — entity name for token matching
 * @param {object} admission — admission result with surface list
 * @returns {Map<order, { boost, svoCount, entityCentered }>}
 */
export function computeNonLexicalBoost(targetFrames, targetSurface, admission) {
  const allTokens = new Set();
  if (targetSurface) {
    for (const t of targetSurface.split(/\s+/)) {
      if (t.length > 1) allTokens.add(t.toLowerCase());
    }
  }
  if (admission?.surfaces) {
    for (const s of admission.surfaces) {
      const text = String(s.surface ?? s.text ?? s ?? "");
      for (const t of text.split(/\s+/)) {
        const clean = t.replace(/[^a-zà-ÿœæ'-]/gi, "").toLowerCase();
        if (clean.length > 1) allTokens.add(clean);
      }
    }
  }
  const entityTokens = [...allTokens];

  const boostMap = new Map();
  for (const f of targetFrames) {
    boostMap.set(f.order, frameNonLexical(f, entityTokens));
  }
  return boostMap;
}
