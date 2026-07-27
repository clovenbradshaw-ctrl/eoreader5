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

const TERRAIN_PATTERNS = [
  { terrain: "Void",        pattern: /\b(nothing|void|empty|absence|missing|silence|null|none)\b/i },
  { terrain: "Entity",      pattern: /\b(who|person|people|name|identity|he|she|they|I am|my name|character|figure|individual|actor|agent)\b/i },
  { terrain: "Kind",         pattern: /\b(type|kind|category|class|definition|is a|are a|was a|species|genre|sort|variety)\b/i },
  { terrain: "Field",        pattern: /\b(data|information|text|content|context|passage|quote|chapter|book|story|narrative|document|corpus)\b/i },
  { terrain: "Link",         pattern: /\b(relation|connection|link|dependency|bond|ally|enemy|friend|reports?\s+to|works?\s+for|between|relates)\b/i },
  { terrain: "Network",      pattern: /\b(system|network|structure|empire|state|republic|government|army|legion|senate|organization|institution)\b/i },
  { terrain: "Atmosphere",   pattern: /\b(feeling|mood|tone|emotion|passion|fear|anger|love|hate|desire|sentiment|atmosphere|ambience)\b/i },
  { terrain: "Lens",         pattern: /\b(perspective|view|angle|focus|frame|lens|interpretation|analysis|reading|stance|posture)\b/i },
  { terrain: "Paradigm",     pattern: /\b(theory|model|framework|paradigm|worldview|philosophy|principle|axiom|doctrine|canon)\b/i },
];

// ── Stance classification ──

const STANCE_PATTERNS = [
  { stance: "Clearing",     pattern: /\b(clear|remove|delete|empty|purge|wipe|erase|clean)\b/i },
  { stance: "Dissecting",   pattern: /\b(analyze|break\s+down|examine|inspect|dissect|compare|deconstruct|debug)\b/i },
  { stance: "Unraveling",   pattern: /\b(interpret|meaning|significance|why|reason|purpose|explain|decipher)\b/i },
  { stance: "Tending",      pattern: /\b(maintain|support|help|assist|care|nurture|sustain|preserve)\b/i },
  { stance: "Binding",      pattern: /\b(connect|link|relate|depend|bond|attach|join|unite|associate)\b/i },
  { stance: "Tracing",      pattern: /\b(what|tell\s+me|describe|summarize|overview|track|follow|trace|path|history|timeline)\b/i },
  { stance: "Cultivating",  pattern: /\b(grow|develop|evolve|learn|understand|deepen|mature|progress)\b/i },
  { stance: "Making",       pattern: /\b(create|make|build|construct|implement|produce|generate|forge)\b/i },
  { stance: "Composing",    pattern: /\b(organize|arrange|structure|design|plan|compose|orchestrate|layout)\b/i },
];

// ── Operator classification ──

const OPERATOR_PATTERNS = [
  { operator: "NUL", pattern: /\b(nothing|void|empty|remove|delete|clear|erase|purge)\b/i },
  { operator: "SEG", pattern: /\b(segment|piece|part|section|divide|split|cut|partition|chunk)\b/i },
  { operator: "DEF", pattern: /\b(define|declare|specify|set|establish|name|nominate|label)\b/i },
  { operator: "SIG", pattern: /\b(signal|indicate|point|show|reveal|express|manifest|display)\b/i },
  { operator: "CON", pattern: /\b(connect|link|relate|depend|bind|join|tie|attach|associate)\b/i },
  { operator: "EVA", pattern: /\b(evaluate|judge|assess|compare|measure|test|appraise|rank)\b/i },
  { operator: "INS", pattern: /\b(insert|add|create|make|build|generate|produce|introduce)\b/i },
  { operator: "SYN", pattern: /\b(synthesize|combine|merge|integrate|unify|fuse|blend|meld)\b/i },
  { operator: "REC", pattern: /\b(record|log|track|remember|capture|store|archive|document)\b/i },
];

/**
 * classifyTerrain(text) -> string
 *
 * Deterministic terrain classification. Returns one of the 9 TERRAINS.
 * Falls back to "Field" (the default domain for undifferentiated content).
 */
export function classifyTerrain(text) {
  const t = String(text ?? "");
  for (const { terrain, pattern } of TERRAIN_PATTERNS) {
    if (pattern.test(t)) return terrain;
  }
  return "Field";
}

/**
 * classifyStance(text) -> string
 *
 * Deterministic stance classification. Returns one of the 9 STANCES.
 * Falls back to "Tracing" (the default approach).
 */
export function classifyStance(text) {
  const t = String(text ?? "");
  for (const { stance, pattern } of STANCE_PATTERNS) {
    if (pattern.test(t)) return stance;
  }
  return "Tracing";
}

/**
 * classifyOperator(text) -> string
 *
 * Deterministic operator classification. Returns one of the 9 operator codes.
 * Falls back to "SIG" (the default act).
 */
export function classifyOperator(text) {
  const t = String(text ?? "");
  for (const { operator, pattern } of OPERATOR_PATTERNS) {
    if (pattern.test(t)) return operator;
  }
  return "SIG";
}

/**
 * classify(text) -> { operator, terrain, stance }
 *
 * Full cube coordinate classification in one call.
 */
export function classify(text) {
  return {
    operator: classifyOperator(text),
    terrain: classifyTerrain(text),
    stance: classifyStance(text),
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
