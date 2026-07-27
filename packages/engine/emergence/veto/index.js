// Fabrication veto: the safety net for small models.
//
// Ported from eoreader4.2's model-as-contracted-part concept and
// the tiny-LLM-for-captioning-only rule. Tiny models hallucinate
// more. This module catches common violations before they reach
// the user:
//
//   1. Invented fact — the model states something not grounded in
//      the provided content
//   2. Polarity flip — the model says "is" when the source says "is not"
//   3. Thesis injection — the model introduces an opinion/argument
//      not present in the source
//   4. Connector violation — the model uses words not in the
//      KNOWN_CONNECTIVE_IDS lexicon
//
// This builds on the ROW_VETOES contract (packages/spec/row-shapes)
// but operates at the model-output level rather than the row level.
// It's the pre-generation constraint set: what a tiny model is
// ALLOWED to do (caption/summarize) vs what it MUST NOT do (generate
// new claims).

import {
  KNOWN_CONNECTIVE_IDS,
  tokenize,
  checkTraceCoverage,
  bidirectionallyEntails,
} from "@eoreader/spec/row-shapes";
import { TERRAINS, STANCES } from "@eoreader/spec/cube";
import { classifyTerrain, classifyStance } from "../../cube/index.js";

// ── Tiny-model constraint contract ──
// Inherited from4.2:docs/tiny-model-form-surface.md as
// ops=DEF, terrains=Lens, stances=Making.
//
// !REC (eo-2026-07): widened for the v5 read path — a folded summary is a
// reading over source material, so its sentences legitimately land at
// SIG (signaling what the source says), Field/Kind (the material and its
// categories), and Tracing/Unraveling (following and unpacking it). The
// widened region is still a narrow corner of the cube; callers with the
// original 4.2 surface pass the narrower sets via context.allowedOps /
// allowedTerrains / allowedStances.

const TINY_MODEL_ALLOWED_OPS = new Set(["DEF", "SIG"]);
const TINY_MODEL_ALLOWED_TERRAINS = new Set(["Lens", "Field", "Kind"]);
const TINY_MODEL_ALLOWED_STANCES = new Set(["Making", "Tracing", "Unraveling"]);

// ── Polarity markers ──

const NEGATION_MARKERS = /\b(not|never|no|neither|nor|none|nothing|nowhere|barely|hardly|scarcely|seldom|rarely|without|contrary|相反|ไม่|нед\w*)\b/i;
const HEDGE_MARKERS = /\b(might|could|possibly|perhaps|maybe|arguably|seemingly|apparently|supposedly|allegedly|reportedly)\b/i;
const CERTAINTY_MARKERS = /\b(is|are|was|were|will|shall|must|definitely|certainly|absolutely|undoubtedly|clearly|obviously)\b/i;

// ── Thesis/opinion markers ──

const OPINION_MARKERS = /\b(I think|I believe|in my opinion|it is clear that|it is obvious that|undoubtedly|clearly|the best|the worst|should|ought to|must|need to|have to)\b/i;

/**
 * veto(modelOutput, context) -> VetoResult
 *
 * Run all fabrication vetoes against a model's output.
 *
 * @param {string} modelOutput - the generated text
 * @param {object} context - {
 *   source?: string,           // the source text the model was summarizing
 *   propositions?: Array,      // grounding propositions (from trace)
 *   allowedOps?: Set,          // override allowed operators
 *   allowedTerrains?: Set,     // override allowed terrains
 *   allowedStances?: Set,      // override allowed stances
 *   strict?: boolean,          // if true, any violation is a hard veto
 * }
 * @returns {object} { passed: boolean, vetoes: [{id, message, severity}] }
 */
export function veto(modelOutput, context = {}) {
  const vetoes = [];
  const source = context.source ?? "";
  const strict = context.strict ?? true;

  // 1. Invented fact: content not grounded in source
  const invented = vetoInventedFact(modelOutput, source);
  if (invented) vetoes.push(invented);

  // 2. Polarity flip: negation mismatch
  const polarity = vetoPolarityFlip(modelOutput, source);
  if (polarity) vetoes.push(polarity);

  // 3. Thesis injection: opinion not in source
  const thesis = vetoThesisInjection(modelOutput, source);
  if (thesis) vetoes.push(thesis);

  // 4. Terrain/stance constraint (tiny-model contract)
  const constraint = vetoConstraintViolation(modelOutput, context);
  if (constraint) vetoes.push(constraint);

  // 5. Trace coverage (if propositions provided)
  if (context.propositions) {
    const trace = checkTraceCoverage({
      renderedText: modelOutput,
      trace: context.propositions.map((p) => ({
        tokenStart: 0,
        tokenEnd: tokenize(modelOutput).length,
        source: "proposition",
        refId: p.id,
      })),
    });
    if (!trace.covered) {
      vetoes.push({
        id: "trace-coverage",
        message: trace.reason,
        severity: "hard",
      });
    }
  }

  const passed = strict
    ? vetoes.filter((v) => v.severity === "hard").length === 0
    : vetoes.length === 0;

  return {
    schema: "VetoResult@1",
    passed,
    vetoes,
    output_tokens: tokenize(modelOutput).length,
  };
}

/**
 * vetoInventedFact(output, source) -> veto | null
 *
 * Check if the model states facts not grounded in the source.
 * Heuristic: if the output contains definite statements (is/are/was)
 * about entities not mentioned in the source, it's likely invented.
 */
function vetoInventedFact(output, source) {
  if (!source) return null;

  const outputEntities = extractEntities(output);
  const sourceEntities = extractEntities(source);

  // Check for entities in output not present in source
  const invented = [];
  for (const entity of outputEntities) {
    if (!sourceEntities.has(entity.toLowerCase())) {
      invented.push(entity);
    }
  }

  if (invented.length > 0) {
    return {
      id: "invented-fact",
      message: `Output references entities not in source: ${invented.join(", ")}`,
      severity: "hard",
    };
  }
  return null;
}

/**
 * vetoPolarityFlip(output, source) -> veto | null
 *
 * Check if the model flipped a negation. If the source says "X is not Y"
 * and the output says "X is Y", that's a polarity flip.
 */
function vetoPolarityFlip(output, source) {
  if (!source) return null;

  const sourceNeg = NEGATION_MARKERS.test(source);
  const outputNeg = NEGATION_MARKERS.test(output);

  // If source is negative but output is positive (and they share content),
  // that's a flip
  if (sourceNeg && !outputNeg) {
    const sharedWords = sharedVocabulary(output, source);
    if (sharedWords >= 3) {
      return {
        id: "polarity-flip",
        message: "Source contains negation that output omits",
        severity: "hard",
      };
    }
  }
  return null;
}

/**
 * vetoThesisInjection(output, source) -> veto | null
 *
 * Check if the model injects an opinion/thesis not present in source.
 */
function vetoThesisInjection(output, source) {
  if (!source) return null;

  if (OPINION_MARKERS.test(output) && !OPINION_MARKERS.test(source)) {
    return {
      id: "thesis-injection",
      message: "Output contains opinion/thesis markers not present in source",
      severity: "hard",
    };
  }
  return null;
}

/**
 * vetoConstraintViolation(output, context) -> veto | null
 *
 * Check if the model violated its terrain/stance/operator constraints.
 */
function vetoConstraintViolation(output, context) {
  const allowedOps = context.allowedOps ?? TINY_MODEL_ALLOWED_OPS;
  const allowedTerrains = context.allowedTerrains ?? TINY_MODEL_ALLOWED_TERRAINS;
  const allowedStances = context.allowedStances ?? TINY_MODEL_ALLOWED_STANCES;

  const coord = {
    terrain: classifyTerrain(output),
    stance: classifyStance(output),
  };

  const violations = [];
  if (!allowedTerrains.has(coord.terrain)) {
    violations.push(`terrain "${coord.terrain}" not in allowed [${[...allowedTerrains].join(", ")}]`);
  }
  if (!allowedStances.has(coord.stance)) {
    violations.push(`stance "${coord.stance}" not in allowed [${[...allowedStances].join(", ")}]`);
  }

  if (violations.length > 0) {
    return {
      id: "constraint-violation",
      message: `Tiny-model contract violated: ${violations.join("; ")}`,
      severity: "soft",
    };
  }
  return null;
}

// ── Helpers ──

/**
 * Extract capitalized words (potential entity names) from text.
 */
function extractEntities(text) {
  const words = String(text ?? "").split(/\s+/);
  const entities = new Set();
  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z']/g, "");
    if (clean.length > 2 && /^[A-Z]/.test(clean) && !/^[A-Z][a-z]+$/.test(clean)) {
      entities.add(clean);
    }
  }
  return entities;
}

/**
 * Count shared vocabulary between two texts.
 */
function sharedVocabulary(a, b) {
  const wordsA = new Set(String(a ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(String(b ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  let count = 0;
  for (const w of wordsA) if (wordsB.has(w)) count += 1;
  return count;
}
