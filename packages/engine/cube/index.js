// Cube coordinate: terrain/stance classification and focus-biased scoring.
//
// Ported from eoreader4.2:src/wiki/terrains.js, src/turn/meta-route.js
// (bornSalience routing over terrain/stance), and the proxy's classify()
// (eoreader-proxy/eoreader5.js). The4.2 classifier was regex-based and
// terrain-only; this version adds stance classification and the focus
// bias mechanism from the proxy.
//
// The engine is pure: no ambient state, no model calls. Classification
// is deterministic over the text. Focus bias is a pure function of
// the current coordinate and the candidate's coordinate.

import { TERRAINS, STANCES, DIAGONAL_CELLS, isDiagonal, coherence } from "@eoreader/spec/cube";
import { OPERATOR_CODES } from "@eoreader/spec/operators";

// ── Terrain classification ──
// Regex-based, deterministic. Maps free text to one of 9 terrains.

// Each category carries STRONG evidence (terms that specifically denote it)
// and WEAK evidence (terms that co-occur with it but are ubiquitous in running
// prose). The split exists because the previous first-match-wins cascade let
// ubiquitous function words decide the coordinate: `Void` was tested first and
// matched "nothing/none", `Entity` second and matched "he/she/they", so between
// them they claimed 99.2% of War and Peace frames and Atmosphere/Lens/Paradigm
// fired on ZERO frames — which made the REC_Cultivating_Paradigm diagonal
// (recontextualisation) structurally unreachable.
//
// Scoring all nine and taking amplitudes instead means a passage that mentions
// "she" thirty times but "love/tears/grief" five times reads as Atmosphere,
// not Entity — the evidence competes rather than short-circuiting on order.

const WEAK = 0.15;

const TERRAIN_TERMS = [
  { terrain: "Void",       strong: /\b(void|absence|emptiness|nothingness|oblivion|silence|vacant|barren)\b/gi,
                           weak:   /\b(nothing|empty|missing|none|null|no\s+one)\b/gi },
  { terrain: "Entity",     strong: /\b(who|person|people|name|identity|character|figure|individual|actor|agent|my\s+name|I\s+am)\b/gi,
                           weak:   /\b(he|she|they|him|her|his|their|them)\b/gi },
  { terrain: "Kind",       strong: /\b(type|kind|category|class|definition|species|genre|sort|variety)\b/gi,
                           weak:   /\b(is\s+a|are\s+a|was\s+a)\b/gi },
  { terrain: "Field",      strong: /\b(data|information|content|passage|quote|narrative|document|corpus|record)\b/gi,
                           weak:   /\b(text|context|chapter|book|story)\b/gi },
  { terrain: "Link",       strong: /\b(relation|connection|link|dependency|bond|ally|enemy|reports?\s+to|works?\s+for|relates)\b/gi,
                           weak:   /\b(between|friend|with)\b/gi },
  { terrain: "Network",    strong: /\b(system|network|empire|republic|government|army|legion|senate|organization|institution|regiment|society)\b/gi,
                           weak:   /\b(structure|state)\b/gi },
  { terrain: "Atmosphere", strong: /\b(feeling|feelings|mood|emotion|passion|fear|anger|love|loved|hate|desire|sentiment|atmosphere|joy|joyful|grief|sorrow|tenderness|shame|despair|rapture|terror|pity|weep|wept|weeping|tears|sobbed|sobbing|trembled|trembling|blushed)\b/gi,
                           weak:   /\b(tone|happy|sad|glad|afraid)\b/gi },
  { terrain: "Lens",       strong: /\b(perspective|standpoint|angle|lens|interpretation|analysis|stance|posture|point\s+of\s+view|in\s+his\s+eyes|in\s+her\s+eyes|as\s+if\s+seeing)\b/gi,
                           weak:   /\b(view|focus|frame|reading|seemed\s+to\s+him|seemed\s+to\s+her)\b/gi },
  { terrain: "Paradigm",   strong: /\b(theory|framework|paradigm|worldview|philosophy|doctrine|canon|providence|destiny|the\s+meaning\s+of\s+life|God's\s+will|first\s+principles)\b/gi,
                           weak:   /\b(model|principle|axiom|fate|truth|faith|law\s+of)\b/gi },
];

const STANCE_TERMS = [
  { stance: "Clearing",    strong: /\b(clear|remove|delete|purge|wipe|erase|clean|abandon|renounce)\b/gi,
                           weak:   /\b(empty|leave|left)\b/gi },
  { stance: "Dissecting",  strong: /\b(analyze|analyse|break\s+down|examine|inspect|dissect|deconstruct|debug|scrutin)\w*\b/gi,
                           weak:   /\b(compare|study)\b/gi },
  { stance: "Unraveling",  strong: /\b(interpret|significance|decipher|unravel|make\s+sense\s+of|puzzle)\w*\b/gi,
                           weak:   /\b(meaning|why|reason|purpose|explain)\b/gi },
  { stance: "Tending",     strong: /\b(nurse|nursed|nursing|tend|tended|care\s+for|nurture|sustain|preserve|comfort|soothe|watch\s+over)\b/gi,
                           weak:   /\b(maintain|support|help|assist|care)\b/gi },
  { stance: "Binding",     strong: /\b(bind|bound|betroth|engage[dm]|marry|married|wed|vow|pledge|unite|attach)\w*\b/gi,
                           weak:   /\b(connect|link|relate|depend|bond|join|associate)\b/gi },
  { stance: "Tracing",     strong: /\b(tell\s+me|describe|summarize|summarise|overview|trace|timeline|recount)\b/gi,
                           weak:   /\b(what|track|follow|path|history)\b/gi },
  // Cultivating carries the growth/realisation sense: the stance a character is
  // in when their understanding is changing, not merely when time passes.
  { stance: "Cultivating", strong: /\b(realiz|realis|understood|recogniz|recognis|came\s+to\s+see|dawned|matured|grew\s+to|learned\s+that|for\s+the\s+first\s+time)\w*\b/gi,
                           weak:   /\b(grow|develop|evolve|learn|understand|deepen|progress)\b/gi },
  { stance: "Making",      strong: /\b(create|construct|implement|forge|fashion)\w*\b/gi,
                           weak:   /\b(make|build|produce|generate)\b/gi },
  { stance: "Composing",   strong: /\b(orchestrate|compose|arrange|layout|choreograph)\w*\b/gi,
                           weak:   /\b(organize|organise|structure|design|plan)\b/gi },
];

const OPERATOR_TERMS = [
  { operator: "NUL", strong: /\b(void|annihilat|obliterat|vanish|cease)\w*\b/gi,
                     weak:   /\b(nothing|empty|remove|delete|clear|erase|purge)\b/gi },
  { operator: "SEG", strong: /\b(segment|partition|subdivide|demarcat)\w*\b/gi,
                     weak:   /\b(piece|part|section|divide|split|cut|chunk)\b/gi },
  { operator: "DEF", strong: /\b(define|declare|specify|nominate|stipulate)\w*\b/gi,
                     weak:   /\b(set|establish|name|label)\b/gi },
  { operator: "SIG", strong: /\b(signal|indicate|manifest|betoken)\w*\b/gi,
                     weak:   /\b(point|show|reveal|express|display)\b/gi },
  { operator: "CON", strong: /\b(interlink|interrelate|correlate)\w*\b/gi,
                     weak:   /\b(connect|link|relate|depend|bind|join|tie|attach|associate)\b/gi },
  { operator: "EVA", strong: /\b(evaluate|appraise|adjudge|condemn|approve|reproach|blame|forgive|forgave)\w*\b/gi,
                     weak:   /\b(judge|assess|measure|test|rank)\b/gi },
  { operator: "INS", strong: /\b(insert|introduce|instantiate)\w*\b/gi,
                     weak:   /\b(add|create|make|build|generate|produce)\b/gi },
  { operator: "SYN", strong: /\b(synthesiz|synthesis|integrat|unif|fuse|coalesc)\w*\b/gi,
                     weak:   /\b(combine|merge|blend)\b/gi },
  // REC is RECONTEXTUALISATION — the operator that fires when the reader's or a
  // character's frame on someone/something CHANGES. The previous vocabulary
  // (record|log|archive|document) encoded filing-cabinet bookkeeping instead,
  // which is why REC fired on 2.4% of frames and never at a narrative turn.
  { operator: "REC", strong: /\b(for\s+the\s+first\s+time|no\s+longer|never\s+before|had\s+never|suddenly\s+(?:saw|understood|realiz|realis|felt)|now\s+seemed|seemed\s+different|changed\s+his\s+mind|changed\s+her\s+mind|came\s+to\s+see|it\s+dawned|struck\s+him|struck\s+her|occurred\s+to\s+(?:him|her)|as\s+never\s+before|understood\s+for)\w*\b/gi,
                     weak:   /\b(record|log|remember|remembered|recall|archive|reconsider)\b/gi },
];

// Count occurrences without leaking regex lastIndex between calls.
const hits = (t, re) => (t.match(re) ?? []).length;

// Evidence weight for one category. log1p damps repetition so a word used
// thirty times is stronger than one used five times, but not six times stronger.
function evidence(t, { strong, weak }) {
  return Math.log1p(hits(t, strong)) + WEAK * Math.log1p(hits(t, weak));
}

/**
 * amplitudesFor(text, table, key) -> Array<{ label, score, amplitude }>
 *
 * Scores ALL categories in a dimension and normalises to amplitudes. This is
 * the superposition the fold is defined over: a passage is not "Entity", it is
 * mostly-Atmosphere-partly-Entity, and collapsing to a single label before any
 * measurement is what previously destroyed the signal.
 */
function amplitudesFor(text, table, key) {
  const t = String(text ?? "");
  const scored = table.map((row) => ({ label: row[key], score: evidence(t, row) }));
  const total = scored.reduce((s, r) => s + r.score, 0);
  return scored.map((r) => ({ ...r, amplitude: total > 0 ? r.score / total : 0 }));
}

function argmax(amps, fallback) {
  let best = null;
  for (const a of amps) if (a.score > 0 && (!best || a.score > best.score)) best = a;
  return best ? best.label : fallback;
}

/**
 * advisoryClassifyTerrain(text) -> string
 *
 * Deterministic terrain classification. Returns one of the 9 TERRAINS.
 * Falls back to "Field" (the default domain for undifferentiated content).
 */
// !REC (eo-2026-07-28, spec 09): these are KEYWORD-FREQUENCY ESTIMATORS, not
// readings. Measured 2026-07-27 over 2,527 paragraphs of Moby-Dick: shuffling
// the words inside each paragraph — destroying every proposition, reference
// and syntactic relation, preserving only the word inventory — left 95.7% of
// full cell assignments unchanged (terrain 97.2%, operator 98.9%, stance
// 99.4%). Length-matched random words drawn from the same book land on the
// modal cell SIG|Entity|Tracing at 34.7%, against real prose's 33.5%.
// Cells ever occupied: 221 of 729; effective cells by entropy: 22.6.
//
// They may inform display, ordering, or a prior weight.
// They may NEVER gate, veto, route, or address. That is why they are named
// `advisory*`: a call site that wants to gate has to rename it to do so.

export function advisoryClassifyTerrain(text) {
  return argmax(amplitudesFor(text, TERRAIN_TERMS, "terrain"), "Field");
}

/**
 * advisoryClassifyStance(text) -> string
 *
 * Deterministic stance classification. Returns one of the 9 STANCES.
 * Falls back to "Tracing" (the default approach).
 */
export function advisoryClassifyStance(text) {
  return argmax(amplitudesFor(text, STANCE_TERMS, "stance"), "Tracing");
}

/**
 * advisoryClassifyOperator(text) -> string
 *
 * Deterministic operator classification. Returns one of the 9 operator codes.
 * Falls back to "SIG" (the default act).
 */
export function advisoryClassifyOperator(text) {
  return argmax(amplitudesFor(text, OPERATOR_TERMS, "operator"), "SIG");
}

/**
 * classifyAmplitudes(text) -> { operator, terrain, stance }
 *
 * The uncollapsed fold: full amplitude distribution over each dimension,
 * sorted strongest-first. `classify` is the argmax projection of this.
 */
export function classifyAmplitudes(text) {
  const bySize = (a, b) => b.amplitude - a.amplitude;
  return {
    operator: amplitudesFor(text, OPERATOR_TERMS, "operator").sort(bySize),
    terrain: amplitudesFor(text, TERRAIN_TERMS, "terrain").sort(bySize),
    stance: amplitudesFor(text, STANCE_TERMS, "stance").sort(bySize),
  };
}

/**
 * classify(text) -> { operator, terrain, stance }
 *
 * Full cube coordinate classification in one call.
 */
export function classify(text) {
  return {
    operator: advisoryClassifyOperator(text),
    terrain: advisoryClassifyTerrain(text),
    stance: advisoryClassifyStance(text),
  };
}

/**
 * scoreCoordinate(cell, focus) -> number
 *
 * Score how well a cell matches a focus coordinate.
 * Returns 0-8: +3 for terrain match, +2 for operator match,
 * +1 for stance match, +2 for diagonal bonus.
 */
export function scoreCoordinate(cell, focus) {
  if (!cell || !focus) return 0;
  let score = 0;
  if (cell.terrain === focus.terrain) score += 3;
  if (cell.operator === focus.operator) score += 2;
  if (cell.stance === focus.stance) score += 1;
  if (isDiagonal(cell)) score += 2;
  return score;
}

/**
 * focusBias(entry, focus) -> number
 *
 * Pure focus-bias scoring. Given an entry with a .coord property
 * (from classify) and a focus coordinate, return the bias amount.
 * Ported from eoreader-proxy/eoreader5.js search() focus bias.
 */
export function focusBias(entry, focus) {
  if (!focus?.operator || !entry?.coord) return 0;
  let bias = 0;
  if (entry.coord.operator === focus.operator) bias += 4;
  if (entry.coord.terrain === focus.terrain) bias += 3;
  if (entry.coord.stance === focus.stance) bias += 1;
  return bias;
}

export { TERRAINS, STANCES, DIAGONAL_CELLS, isDiagonal, coherence };
