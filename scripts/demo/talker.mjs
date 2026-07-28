// The talker: a CPU LLM used ONLY to make engine-determined content fluent.
//
// This is the 4.2 phraser->talker contract, and the split is the whole
// point: the engine decides WHAT is said (which passage, at which offset,
// on what evidence), the model decides only HOW it reads. The model never
// picks the evidence, never ranks it, and never gets to add to it.
// emergence/veto/index.js — written for exactly this, "the safety net for
// tiny models" — is what enforces that after the fact.
//
// ── Why a base model, and why few-shot ───────────────────────────
//
// The only CPU model reachable from this environment is Gemma 3 270M in
// Q4_K_M, shipped as a PyPI package (HuggingFace is blocked by the network
// policy; PyPI and GitHub releases are not). Its GGUF carries NO chat
// template — it is the BASE model, not the instruction-tuned one, and it
// cannot follow an instruction at all: asked to rewrite a sentence, it
// echoes the request back verbatim. Measured, all three phrasings.
//
// Base models do complete PATTERNS, so the talker is few-shot: several
// FACTS/ANSWER pairs, then the real one, stopped at the first blank line.
// That works (measured), and it is also the honest shape for this role —
// a 270M model doing template completion is much closer to what a phraser
// is supposed to be than a chat model improvising an answer.
//
// If no server is reachable the demo does not fail and does not fake a
// sentence; it reports `available: false` and the caller falls back to the
// engine's own grounded quote. A missing talker degrades the PROSE, never
// the answer — which is the correctness property the split exists to buy.

import { veto } from "../../packages/engine/emergence/veto/index.js";

export const DEFAULT_URL = process.env.EO_LLM_URL ?? "http://127.0.0.1:8080";

const FEW_SHOT = `FACTS: the ship is trapped; the ice surrounds it.
ANSWER: The ship is trapped, and the ice surrounds it.

FACTS: Elizabeth is adopted; she joins the family.
ANSWER: Elizabeth is adopted, and she joins the family.

FACTS: the traveller is exhausted; the crew bring him aboard.
ANSWER: The traveller is exhausted, and the crew bring him aboard.

`;

// ── The declared cell ─────────────────────────────────────────────
//
// veto's fourth check is "declared address": the emitter states the cube
// cell it emits into and is held to it. An UNDECLARED emission is a hard
// veto, deliberately — the old code silently supplied a coordinate for
// anything, which is how an unlicensed claim in the right vocabulary
// walked through while a grounded one in the wrong vocabulary was refused.
// A coordinate INFERRED from the output's own words may never gate
// (measured: 97.2% of terrain assignments survive destroying word order).
//
// So the talker declares its contract up front, and it is the narrow one a
// phraser is entitled to: SIG (signalling what the source says) / Field
// (the material itself) / Tracing (following it). Not DEF — the talker
// defines nothing. Not Making — it constructs nothing. If the phraser ever
// needs a wider cell, that is a change of contract to argue for, not a
// parameter to widen quietly.
export const TALKER_CELL = Object.freeze({ operator: "SIG", terrain: "Field", stance: "Tracing" });

export async function talkerAvailable(url = DEFAULT_URL) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    try {
      const res = await fetch(`${url}/props`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch { return false; }
  }
}

/**
 * Phrase engine-selected facts as one sentence.
 *
 * @param {string} facts - engine-determined content. NOT a prompt the model
 *   may reinterpret: whatever comes back is checked against this string.
 * @returns {{available, raw, text, vetoResult, usedFallback}}
 */
export async function phrase(facts, { url = DEFAULT_URL, maxTokens = 60, timeoutMs = 90000 } = {}) {
  let raw = null;
  try {
    const res = await fetch(`${url}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${FEW_SHOT}FACTS: ${facts}\nANSWER:`,
        temperature: 0,
        n_predict: maxTokens,
        repeat_penalty: 1.15,
        stop: ["\n", "FACTS:", "ANSWER:"],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { available: false, raw: null, text: null, vetoResult: null, usedFallback: true };
    const body = await res.json();
    raw = (body.content ?? "").trim();
  } catch {
    return { available: false, raw: null, text: null, vetoResult: null, usedFallback: true };
  }

  if (!raw) return { available: true, raw: "", text: null, vetoResult: null, usedFallback: true };

  // The veto reads the model's output against the engine's own evidence,
  // and against the cell the talker declared. Hard violations decide.
  const degenerate = isDegenerate(raw);
  const ungrounded = ungroundedTokens(raw, facts);
  const vetoResult = veto(raw, { source: facts, declaredCell: TALKER_CELL, strict: true });
  const passed = vetoResult.passed && !degenerate && ungrounded.length === 0;
  return {
    available: true,
    raw,
    degenerate,
    ungrounded,
    copied: isCopy(raw, facts),
    text: passed ? raw : null,
    vetoResult,
    usedFallback: !passed,
  };
}

// ── A measured hole in the veto, and the patch for it ────────────
//
// veto's invented-fact check works on ENTITIES (extractEntities), so it
// catches "the model named someone who isn't in the source". It does not
// catch a COMMON-NOUN substitution. Found by running this demo: handed
// "...the accomplishment of my toils", the talker returned "...the
// accomplishment of my labors". Grounded-looking, entity-clean, veto-clean
// — and "labors" is not a word in the evidence. At 270M the model is
// paraphrasing from its own priors, which is exactly what it must not do.
//
// This is a demo-level check, not a fix to the organ: tightening
// emergence/veto itself means deciding what a legitimate function-word
// gloss is, which is a real design question with tests attached and should
// not be settled as a side effect of a demo. Reported here so the hole is
// visible rather than passed.
const GLOSS_ALLOWED = new Set(["a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "is", "are", "was", "were", "it", "its", "he", "she", "they", "his", "her", "their", "that", "this", "with", "for", "as", "by", "from", "which", "who", "when", "then", "so", "i", "my", "me"]);

export function ungroundedTokens(output, facts) {
  const words = (s) => (s.toLowerCase().match(/[a-z']+/g) ?? []);
  const src = new Set(words(facts));
  const out = [];
  for (const w of words(output)) {
    if (GLOSS_ALLOWED.has(w) || src.has(w)) continue;
    // Allow a trivial inflection of a word that IS in the evidence.
    if ([...src].some((s) => s.startsWith(w.slice(0, Math.max(4, w.length - 2))) || w.startsWith(s.slice(0, Math.max(4, s.length - 2))))) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/**
 * Did the model fall into a repetition loop?
 *
 * A 270M model handed prose it cannot compress often emits the same clause
 * three or four times rather than stopping. That output is GROUNDED — every
 * word came from the evidence — so no veto in emergence/veto fires on it,
 * and it would otherwise be presented as a clean answer. It is a distinct
 * failure from fabrication and needs a distinct check; the veto organ is
 * for what a model added, this is for what it could not stop saying.
 */
export function isDegenerate(output) {
  const clauses = output.toLowerCase().split(/[.,;]+/).map((c) => c.trim()).filter((c) => c.split(/\s+/).length >= 4);
  if (clauses.length < 2) return false;
  const seen = new Set();
  for (const c of clauses) { if (seen.has(c)) return true; seen.add(c); }
  return false;
}

/**
 * Did the talker actually phrase anything, or just copy the evidence back?
 *
 * This has to be reported separately from the veto, because a verbatim copy
 * PASSES every veto trivially — it invents nothing, flips no polarity,
 * injects no thesis. "Veto passed" would otherwise read as "the model did
 * its job" when the model did nothing at all.
 *
 * Measured: at 220 characters of Shelley, Gemma 3 270M copies rather than
 * compresses on every question in the demo set. That is the honest ceiling
 * of a 270M base model on 19th-century prose, and it is reported as such
 * rather than dressed up as fluency.
 */
export function isCopy(output, facts) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const o = norm(output), f = norm(facts);
  if (!o) return true;
  if (f.includes(o) || o.includes(f)) return true;
  const ow = o.split(" "), fw = new Set(f.split(" "));
  const shared = ow.filter((w) => fw.has(w)).length;
  return ow.length > 0 && shared / ow.length >= 0.9;
}
