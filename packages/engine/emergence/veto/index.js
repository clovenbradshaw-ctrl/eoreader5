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
// !REC (eo-2026-07-28, spec 09 "declared address, evidence veto"): check 4
// used to decide what a model was ALLOWED to say by running
// classifyTerrain(output) / classifyStance(output) — a keyword-frequency
// argmax over the output's own words. Measured 2026-07-27 over 2,527
// paragraphs of Moby-Dick: 97.2% of terrain assignments survive destroying
// word order entirely, and length-matched random words land on the same
// modal cell as real prose at the same rate. It was checking which keywords
// appeared, not whether a claim was licensed; three plain fabrications (an
// invented figure, an invented actor, an invented cause) passed it clean.
//
// The rule installed instead: A COORDINATE THAT GATES IS DERIVED FROM A
// DECLARATION. The emitter states the cell it emits into and is held to it,
// as the kernel holds an EOT emission to its contract. A coordinate inferred
// from content is advisory and may never gate (see cube/index.js header).
//
// This builds on the ROW_VETOES contract (packages/spec/row-shapes)
// but operates at the model-output level rather than the row level.
// It's the pre-generation constraint set: what a tiny model is
// ALLOWED to do (caption/summarize) vs what it MUST NOT do (generate
// new claims).

import {
  KNOWN_CONNECTIVE_IDS,
  tokenize,
  isDesertCell,
  legalCellFor,
  runRowVetoes,
} from "@eoreader/spec/row-shapes";
import { TERRAINS, STANCES } from "@eoreader/spec/cube";

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

  // 4. The DECLARED cell, against the contract. No classifier is consulted.
  for (const v of vetoDeclaredCell(context)) vetoes.push(v);

  // 5-7. Evidence. Only reachable when the caller claims propositions;
  // claiming them WITHOUT a trace is itself a hard veto, never a silent skip.
  for (const v of vetoEvidence(modelOutput, context)) vetoes.push(v);

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
 * vetoDeclaredCell(context) -> veto[]
 *
 * The emitter declares the cell it is emitting into; this checks the
 * DECLARATION against the contract. An undeclared emission is a hard veto,
 * not a default — the old code silently supplied a coordinate for anything,
 * which is exactly how an unlicensed claim in the right vocabulary walked
 * through while a grounded one in the wrong vocabulary was refused.
 */
function vetoDeclaredCell(context) {
  const out = [];
  const cell = context.declaredCell;

  if (!cell || typeof cell !== "object") {
    return [{
      id: "undeclared-emission",
      message: "No declaredCell supplied. An emission must state its {operator, terrain, stance}; the veto does not infer one.",
      severity: "hard",
    }];
  }

  const { operator, terrain, stance } = cell;
  if (typeof operator !== "string" || typeof terrain !== "string" || typeof stance !== "string") {
    return [{
      id: "undeclared-emission",
      message: `Malformed declaredCell: expected {operator, terrain, stance} strings, got {${typeof operator}, ${typeof terrain}, ${typeof stance}}.`,
      severity: "hard",
    }];
  }

  const allowedOps = context.allowedOps ?? TINY_MODEL_ALLOWED_OPS;
  const allowedTerrains = context.allowedTerrains ?? TINY_MODEL_ALLOWED_TERRAINS;
  const allowedStances = context.allowedStances ?? TINY_MODEL_ALLOWED_STANCES;

  if (!TERRAINS.includes(terrain)) {
    out.push({ id: "unknown-terrain", message: `Declared terrain "${terrain}" is not one of the nine.`, severity: "hard" });
  }
  if (!STANCES.includes(stance)) {
    out.push({ id: "unknown-stance", message: `Declared stance "${stance}" is not one of the nine.`, severity: "hard" });
  }
  if (!allowedOps.has(operator)) {
    out.push({ id: "constraint-violation", message: `Declared operator "${operator}" not in allowed [${[...allowedOps].join(", ")}].`, severity: "hard" });
  }
  if (!allowedTerrains.has(terrain)) {
    out.push({ id: "constraint-violation", message: `Declared terrain "${terrain}" not in allowed [${[...allowedTerrains].join(", ")}].`, severity: "hard" });
  }
  if (!allowedStances.has(stance)) {
    out.push({ id: "constraint-violation", message: `Declared stance "${stance}" not in allowed [${[...allowedStances].join(", ")}].`, severity: "hard" });
  }

  // The one Generating x Ground address that never ships.
  if (isDesertCell({ op: operator, terrain, stance })) {
    out.push({ id: "desert-cell", message: "SYN(Field, Cultivating) is forbidden as a shipped address.", severity: "hard" });
  }

  // If a row shape is declared, the cell must be that shape's one legal cell.
  if (context.shape) {
    const legal = legalCellFor(context.shape);
    if (!legal) {
      out.push({ id: "unknown-shape", message: `Unknown row shape "${context.shape}".`, severity: "hard" });
    } else if (legal.op !== operator || legal.terrain !== terrain || legal.stance !== stance) {
      out.push({
        id: "shape-cell-mismatch",
        message: `Shape "${context.shape}" requires ${legal.op}(${legal.terrain}, ${legal.stance}); declared ${operator}(${terrain}, ${stance}).`,
        severity: "hard",
      });
    }
  }

  return out;
}

/**
 * vetoEvidence(output, context) -> veto[]
 *
 * checkTraceCoverage requires a PER-TOKEN trace. The previous call site
 * synthesised one entry per PROPOSITION, each spanning the whole output, so
 * the lengths agreed only by coincidence and the check refused correct
 * output — which meant no caller passed propositions and the check never ran.
 * The veto no longer synthesises anything: the caller supplies the trace a
 * realizeSlot would produce, or is refused.
 */
function vetoEvidence(output, context) {
  const out = [];
  const propositions = context.propositions;
  if (!propositions) return out;              // no evidence claimed, nothing to check

  const trace = context.trace;
  if (!Array.isArray(trace)) {
    return [{
      id: "missing-trace",
      message: "propositions supplied without a token trace. Supply context.trace (one entry per token) or claim no propositions.",
      severity: "hard",
    }];
  }

  const { fired } = runRowVetoes({ row: { renderedText: output, trace }, propositions });
  for (const f of fired) {
    out.push({ id: f.id, message: f.message, severity: f.refuses ? "hard" : "soft" });
  }

  for (const v of vetoSpanGrounding(output, context, trace, propositions)) out.push(v);
  return out;
}

/**
 * vetoSpanGrounding(output, context, trace, propositions) -> veto[]
 *
 * Entailment catches a token with no pointer. It does not catch a pointer to
 * a proposition the source never supported. For each cited proposition, the
 * numerals and proper nouns among the tokens tracing to it must appear in the
 * union of that proposition's own spans.
 *
 * Deliberately narrow: string containment over numerals and capitalised
 * non-sentence-initial tokens. No NLI, no embedding, no model. That is where
 * the invented figure and the invented actor live, and they are checkable
 * without any of it.
 */
function vetoSpanGrounding(output, context, trace, propositions) {
  const spans = context.spans;
  if (!spans) return [];                      // no span store supplied; nothing to resolve against

  const get = (id) => (spans instanceof Map ? spans.get(id) : spans[id]);
  const tokens = tokenize(output);
  const byProp = new Map();
  trace.forEach((ref, i) => {
    if (!ref || ref.source !== "proposition") return;
    if (!byProp.has(ref.refId)) byProp.set(ref.refId, []);
    byProp.get(ref.refId).push(i);
  });

  const out = [];
  for (const [refId, idxs] of byProp) {
    const prop = (propositions ?? []).find((p) => p.id === refId);
    const spanIds = prop?.provenance?.span_ids;
    if (!Array.isArray(spanIds) || spanIds.length === 0) {
      out.push({ id: "ungrounded-span", message: `Proposition "${refId}" carries no provenance.span_ids.`, severity: "hard" });
      continue;
    }
    const texts = [];
    let unresolved = false;
    for (const sid of spanIds) {
      const sp = get(sid);
      if (!sp) {
        out.push({ id: "ungrounded-span", message: `Proposition "${refId}" cites span "${sid}", which does not resolve.`, severity: "hard" });
        unresolved = true;
        continue;
      }
      texts.push(String(sp.text ?? ""));
    }
    if (unresolved) continue;
    const haystack = texts.join(" ").toLowerCase();
    if (!haystack) continue;

    for (const i of idxs) {
      // `tokenize` yields {text,start,end} records, not bare strings.
      const rec = tokens[i];
      const tok = String((rec && typeof rec === "object" ? rec.text : rec) ?? "");
      const bare = tok.replace(/[^\p{L}\p{N}'-]/gu, "");
      if (!bare) continue;
      const isNumeral = /\d/.test(bare);
      const isProper = i > 0 && /^\p{Lu}/u.test(bare) && bare.length > 2;
      if (!isNumeral && !isProper) continue;
      if (!haystack.includes(bare.toLowerCase())) {
        out.push({
          id: "ungrounded-span",
          message: `Token "${tok}" traces to proposition "${refId}" but appears in none of its spans [${spanIds.join(", ")}].`,
          severity: "hard",
        });
      }
    }
  }
  return out;
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
