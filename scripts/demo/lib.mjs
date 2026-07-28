// Shared ingest + retrieval for the end-to-end demo.
//
// Every organ here is the canonical one. Nothing in this file re-implements
// framing, sentence snapping, coref, or association — the "Consistently
// reinvented" list in AGENTS.md exists because those four have each been
// rebuilt worse more than once. This is a caller, not a second engine.

import { readFileSync, existsSync } from "node:fs";
import { frameText, snapToSentences } from "../../packages/engine/emergence/summary/text-organ.js";
import { buildStore, surface } from "../../packages/engine/emergence/store/index.js";
import { admitReferent, presenceByFrame } from "../../packages/engine/perceiver/text/presence.js";
import { entityFold } from "../../packages/engine/emergence/summary/entity-fold.js";
import { createSeededRng, deriveNull } from "../../packages/engine/emergence/nulls/index.js";
import { TIER, needsWitness } from "../../packages/engine/resolution/resolution-spectrum.js";

export const TEXT_CANDIDATES = [
  process.env.EO_TEXT,
  "/home/user/eo-witness/pg84.txt",
  new URL("../../../eo-witness/pg84.txt", import.meta.url).pathname,
].filter(Boolean);

export const COREF_CANDIDATES = [
  process.env.EO_COREF,
  "/home/user/eoPriors/priors/coref/pg84-frankenstein.json",
  new URL("../../../eoPriors/priors/coref/pg84-frankenstein.json", import.meta.url).pathname,
].filter(Boolean);

function firstExisting(paths, what) {
  for (const p of paths) if (p && existsSync(p)) return p;
  throw new Error(`demo: could not find ${what}; tried:\n  ${paths.join("\n  ")}`);
}

/** The engine's normalization contract: frameText slides over \n-normalized text. */
export function loadText(path = null) {
  const file = path ?? firstExisting(TEXT_CANDIDATES, "the source text (set EO_TEXT)");
  const text = readFileSync(file, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return { file, text };
}

export function loadCoref(path = null) {
  const file = path ?? firstExisting(COREF_CANDIDATES, "the coref prior (set EO_COREF)");
  return { file, prior: JSON.parse(readFileSync(file, "utf-8")) };
}

/**
 * Grow the organs over a text. Order matters and is the engine's own:
 * frames are the substrate, the store wires association across them,
 * the referent is admitted against them by explicit events, and the fold
 * reads all three back out as offset-grounded spans.
 */
export function ingest({ textPath = null, corefPath = null, referentId = "creature", sceneCount = 8 } = {}) {
  const timings = {};
  const clock = (label, fn) => { const t = Date.now(); const v = fn(); timings[label] = Date.now() - t; return v; };

  const { file: textFile, text } = clock("read", () => loadText(textPath));
  const { file: corefFile, prior } = loadCoref(corefPath);
  const referentPrior = prior.referents.find((r) => r.id === referentId) ?? null;

  const frames = clock("frames", () => frameText(text));
  const store = clock("store", () => buildStore(frames));

  // Referent presence is event-sourced, never string-matched. A missing
  // prior is a typed gap, which is why `gaps` is surfaced rather than
  // swallowed — a silently-wrong presence number is the cardinal regression.
  const admitted = referentPrior
    ? clock("referent", () => admitReferent(frames, referentPrior, { fullText: text }))
    : null;
  const presence = admitted ? presenceByFrame(frames, admitted.surfaces) : null;

  const packet = clock("fold", () => entityFold(text, referentId, {
    ...(referentPrior ? { referent: referentPrior } : {}),
    sceneCount,
    withEchoes: true,
  }));

  // The token STREAM, with repetition — the null's sampling pool.
  //
  // Sampling from a DEDUPED vocabulary was the first version and it was
  // wrong: a deduped list is mostly rare words, so every random cue drew
  // high-idf terms and spiked the activation floor to ~40, above which no
  // natural question ever scored. Sampling from the stream reproduces the
  // text's real frequency profile, which is what a natural-language cue
  // actually looks like. Measured: floor drops from ~40 to ~30 and the
  // in-vocabulary questions separate from the paraphrases.
  const tokens = clock("tokens", () => text.toLowerCase().match(/[a-z']{3,}/g) ?? []);

  return { textFile, corefFile, text, frames, store, referentPrior, admitted, presence, packet, tokens, timings };
}

/**
 * Retrieve evidence for a question. The store is the organ for "recall
 * related prior content" (AGENTS.md is explicit that anything else shaped
 * like this is a regression), so the question is used as a cue over it.
 *
 * Returns offset-grounded evidence only. Nothing here is generated: every
 * item is a pointer into the source with the text it points at.
 */
export function retrieve(organs, question, { limit = 3, presenceWeight = true, abstain = true, excerptChars = 320 } = {}) {
  const { frames, store, presence } = organs;
  const ranked = surface(store, question, {});
  if (!ranked.length) return { evidence: [], null: null, gaps: [{ kind: "no-activation", detail: "the cue activated no motif above the store's idf floor" }] };

  // ── Abstention, derived rather than assumed ──────────────────────
  //
  // `surface` always returns SOMETHING: a cue about the capital of France
  // still lights up whichever frames happen to share a stopword-ish motif.
  // Ranking without a floor turns that into a confident wrong answer, so
  // the top activation is checked against a null of length-matched random
  // cues drawn from the text's own vocabulary — the same protocol shape the
  // veto's own header cites (length-matched random words as the control).
  // Below the floor the honest output is a typed gap, not the best of a bad
  // ranking.
  const nullResult = abstain ? cueNull(organs, question, ranked[0].activation) : null;
  if (nullResult && !nullResult.passed) {
    const lex = lexicalReach(organs, question);
    return {
      evidence: [],
      null: nullResult,
      gaps: [Object.freeze({
        kind: "below-chance-activation",
        tier: TIER.MODEL,
        needsWitness: needsWitness(TIER.MODEL),
        detail: `top activation ${ranked[0].activation.toFixed(2)} does not clear the ${nullResult.quantile} quantile (${nullResult.threshold.toFixed(2)}) of frequency-matched random cues`,
        lexicalReach: lex,
        why: lex.missing.length
          ? `the question is a PARAPHRASE: ${lex.missing.map((w) => `"${w}"`).join(", ")} never occur${lex.missing.length === 1 ? "s" : ""} in this text. Matching them to what the text does say is descriptor synonymy — MODEL tier. The engine reports the gap rather than faking it.`
          : `every content word occurs in the text, but not together often enough to beat chance — no passage is licensed`,
      })],
    };
  }

  // Adjacent frames overlap by 50%, so the raw ranking repeats the same
  // passage under several orders, often at IDENTICAL activation. Keeping
  // whichever tied frame the sort happened to emit first showed the window
  // BEFORE the answer: "dreary night of November" tied frames 84 and 85 and
  // displayed 84, whose snapped text opens a paragraph earlier and cuts off
  // before the sentence the question asked about.
  //
  // Within a contiguous run, prefer the frame that literally contains most
  // of the question's content words. That is verbatim keyword matching —
  // engine tier by AGENTS.md's own line — used only to pick WHICH of two
  // equally-activated overlapping windows to show, never to rank.
  const terms = lexicalReach(organs, question).present;
  const covers = (order) => {
    const t = frames[order].text.toLowerCase();
    return terms.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  };
  const picked = [];
  const claimed = [];
  for (const r of ranked) {
    if (picked.length >= limit) break;
    if (claimed.some((o) => Math.abs(o - r.order) <= 1)) continue;
    // Gather the whole tied/contiguous run and keep its best-covering member.
    const run = ranked.filter((x) => Math.abs(x.order - r.order) <= 1);
    const best = run.reduce((a, b) => (covers(b.order) > covers(a.order) ? b : a), r);
    for (const x of run) claimed.push(x.order);
    picked.push(best);
  }

  const evidence = picked.map((r) => {
    const f = frames[r.order];
    const present = presence?.get(r.order) ?? null;
    const ex = excerptAround(f, terms, excerptChars);
    return {
      order: r.order,
      offset: f.offset,
      activation: Math.round(r.activation * 100) / 100,
      referentPresence: present,
      text: snapToSentences(f.text),
      // The part of the frame the question is actually about, with its own
      // offset. A frame is 2000 chars; showing its first 260 showed the
      // paragraph BEFORE the answer on both in-vocabulary questions.
      excerpt: snapToSentences(ex.text),
      excerptOffset: f.offset + ex.start,
      termsCovered: ex.covered,
    };
  });

  // Presence BOOSTS, it does not override. Sorting by presence alone threw
  // away the retrieval signal outright — measured: "what happened on the
  // dreary night of November" retrieved the exact chapter-5 frame at
  // activation 237, then demoted it below an activation-18 frame that
  // merely mentioned the creature more often. Multiplying keeps both
  // channels, the same shape as the engine's best significance selector
  // (forward-surprise x presence).
  if (presenceWeight && presence) {
    for (const e of evidence) e.rank = e.activation * (1 + (e.referentPresence ?? 0));
    evidence.sort((a, b) => b.rank - a.rank);
  }
  return { evidence, null: nullResult, gaps: [] };
}

/**
 * The window of a frame where the question's terms actually cluster.
 *
 * Slides a fixed-width window over the frame and keeps the position
 * covering the most distinct question terms, ties going to the earliest.
 * Presentation only: it never changes which frame was retrieved or how it
 * ranked, and the offset it reports is the window's real position so the
 * excerpt stays as checkable as the frame was.
 */
export function excerptAround(frame, terms, width = 320) {
  const text = frame.text;
  if (!terms.length || text.length <= width) return { text, start: 0, covered: terms.length ? terms.filter((w) => text.toLowerCase().includes(w)).length : 0 };
  const lower = text.toLowerCase();
  const hits = [];
  for (const w of terms) {
    let i = lower.indexOf(w);
    while (i !== -1) { hits.push({ i, w }); i = lower.indexOf(w, i + 1); }
  }
  if (!hits.length) return { text: text.slice(0, width), start: 0, covered: 0 };
  let best = { start: 0, covered: -1 };
  for (const h of hits) {
    const start = Math.max(0, Math.min(text.length - width, h.i - Math.floor(width / 3)));
    const seen = new Set(hits.filter((x) => x.i >= start && x.i < start + width).map((x) => x.w));
    if (seen.size > best.covered) best = { start, covered: seen.size };
  }
  return { text: text.slice(best.start, best.start + width), start: best.start, covered: best.covered };
}

/**
 * Which of a question's content words the text contains AT ALL.
 *
 * This is what separates the two abstention causes. "dreary night November"
 * is the book's own vocabulary and retrieves; "who created the creature"
 * is a paraphrase — Frankenstein never says "created", it says "infuse a
 * spark of being into the lifeless thing". Bridging those is descriptor
 * synonymy, which AGENTS.md places at MODEL tier, and model-tier absences
 * are reported as typed gaps. Faking one is called the cardinal regression.
 */
export function lexicalReach(organs, question) {
  const STOP = new Set(["what", "who", "the", "a", "an", "of", "to", "did", "do", "does", "is", "was", "in", "on", "at", "and", "for", "his", "her", "it", "its", "that", "this", "with", "how", "why", "when", "where"]);
  const words = (question.toLowerCase().match(/[a-z']{3,}/g) ?? []).filter((w) => !STOP.has(w));
  const present = [], missing = [];
  const hay = organs.text.toLowerCase();
  for (const w of words) (hay.includes(w) ? present : missing).push(w);
  return { content: words, present, missing };
}

/**
 * The null for "did this cue actually find anything?".
 *
 * Draws length-matched cues of random words from the text's own vocabulary,
 * takes each one's top activation, and asks deriveNull whether the real
 * cue's top activation beats that background. Seeded from the question, so
 * a given question always gets the same floor and the abstention is
 * replayable rather than a coin flip.
 */
export function cueNull(organs, question, observed, { samples = 30, quantile = 0.95 } = {}) {
  const { store, tokens } = organs;
  const words = question.split(/\s+/).filter(Boolean);
  const rng = createSeededRng(`cue-null:${question}`);
  const nullSamples = [];
  for (let i = 0; i < samples; i += 1) {
    const cue = Array.from({ length: Math.max(2, words.length) },
      () => tokens[Math.floor(rng() * tokens.length)]).join(" ");
    const r = surface(store, cue, {});
    nullSamples.push(r.length ? r[0].activation : 0);
  }
  return deriveNull({
    nullSamples,
    observedStatistic: observed,
    tailDirection: "greater",
    quantile,
    protocol: { name: "length-matched-random-cue", iterations: samples, statistic: "top-frame-activation", scope: "store retrieval" },
  });
}

/**
 * Round-trip check: does a span's offset actually point at the text it
 * claims to? Offsets were silently dropped at three layers once, so
 * anything span-shaped in this project is expected to prove itself.
 *
 * Compared whitespace-flexibly, because a span's `text` has been through
 * snapToSentences (which collapses runs of whitespace) while the source
 * still has its original line wrapping. Comparing them raw reports false
 * misses — the offset is right and only the spacing differs.
 */
export function verifyOffset(text, span, probeLen = 30) {
  const flat = (s) => s.replace(/\s+/g, " ");
  const head = flat(span.text).slice(0, probeLen);
  if (head.length < 8) return false;
  const window = flat(text.slice(Math.max(0, span.offset - 100), span.offset + 2500));
  return window.includes(head);
}

export const formatCoord = (c) =>
  c && typeof c === "object" ? `${c.operator}/${c.terrain}/${c.stance}` : String(c ?? "?");
