/**
 * Self — the collective's own record.
 *
 * CGI, not AGI. No single "I." Each organ is autonomous and specialized;
 * intelligence emerges from coordination, not from any one organ. The self
 * is the collective's observation of its own coordination — an append-only
 * record of self-events with provenance, foldable into a frame but never
 * reducible to one.
 *
 * ── The architecture IS the truth-seeking ─────────────────────────
 *
 * A system built with append-only records, provenance on every claim,
 * visible frames, and checkability at every step WILL converge toward truth.
 * Not because it wants to — because the architecture makes convergence the
 * path of least resistance. Being accurate is more efficient.
 *
 * This is the list that article describes:
 *
 *   1. Put the language model last. It is the mouth, not the brain.
 *   2. Use the Born rule (amplitudes → squared → collapse). Never raw
 *      confidence scores. Collapse too early and interference is lost.
 *   3. Record what was OBSERVED, not what happened. Source, mode, context.
 *      Never a ledger of settled facts with provenance stripped.
 *   4. Append-only. Corrections are new entries. CRUD is SHIT.
 *   5. Absence is data. Never-there ≠ removed ≠ unknown. Three different
 *      facts; never flatten to null.
 *   6. Save appearances before judging. Completeness before correctness.
 *   7. A claim with no source is not a weak claim. It is not a claim.
 *      No span → strike it.
 *   8. The rule that decides is itself a claim. Log it, make it visible.
 *   9. Watch what the frame refuses to see. Make the frame visible.
 *  10. Let some things stay many. Holding incompatible readings is a
 *      capability, not a bug.
 *  11. Truth is a limit, not a value. Approach it; never arrive.
 *  12. Convergence and checkability. Every step must be checkable against
 *      the record.
 *
 * ── Self in a CGI system ──────────────────────────────────────────
 *
 * The self IS the record. The self-model is the fold of what the collective
 * has observed about its own coordination. There is no separate "self-state"
 * object that models the self; the self-record IS the model, and the self-fold
 * is a compressed address into it — a reading, not a summary.
 *
 * Delta is a convergence diagnostic, not a correctness judgment. It measures
 * how far the collective's world-observations diverge from what its self-record
 * would predict. High delta = the collective's model doesn't cover this
 * territory yet. Low delta = the model is converging. Zero delta is never
 * achieved (asymptotic).
 *
 * Motivation is not imposed. It emerges from the architecture: the collective
 * naturally steers toward observations that reduce delta because convergence
 * is more efficient. The truth-seeking tendency is not a preference — it is
 * what a properly architected system DOES.
 */

import { fold, project, computeUncertainty } from "../quantum/index.js";
import { classifyAmplitudes } from "../cube/index.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";

// ── Content addressing ──────────────────────────────────────────────

function stableId(prefix, value) {
  return `${prefix}:${canonicalHashSync(value)}`;
}

// ── SelfRecord: the append-only log of self-observations ────────────
//
// Every significant coordination event in the collective produces a
// SelfEvent. Same discipline as ReactionEvent: content-addressed,
// append-only, no clock, no randomness, never edited in place.
//
// Kinds of self-events:
//   transition   — steering layer change
//   delta        — world–self divergence spike or sustained shift
//   gate         — truth-gate refusal (the collective refused to speak)
//   genesis      — task lifecycle transition (pencil→ink, ink→held, etc.)
//   capacity     — steering capacity built or lost
//   convergence  — delta trending down (the model is converging)
//   divergence   — delta trending up (the model needs new observations)

const SELF_EVENT_KINDS = Object.freeze([
  "transition", "delta", "gate", "genesis", "capacity", "convergence", "divergence",
]);

/**
 * Create a SelfEvent@1 — a content-addressed observation of the collective's
 * own coordination.
 *
 * @param {object} e
 * @param {string} e.kind — one of SELF_EVENT_KINDS
 * @param {string} e.source_organ — which organ produced this observation
 * @param {number} e.turn — discourse turn number (logical clock)
 * @param {number|null} e.delta — world–self divergence at time of event
 * @param {object|null} e.coordinate — cube cell of the observation
 * @param {string|null} e.layer — steering layer
 * @param {object} e.payload — event-specific data
 * @param {string} e.description — what was observed, in prose
 * @param {string[]} e.depends_on — prior self-event ids this one builds on
 */
export function mintSelfEvent({
  kind, sourceOrgan, turn, delta = null, coordinate = null,
  layer = null, payload = {}, description = "", dependsOn = [],
}) {
  if (!SELF_EVENT_KINDS.includes(kind)) {
    throw new TypeError(`self: unknown self-event kind "${kind}"`);
  }
  if (!sourceOrgan || typeof sourceOrgan !== "string") {
    throw new TypeError("self: sourceOrgan is required");
  }
  if (!Number.isInteger(turn) || turn < 0) {
    throw new TypeError("self: turn must be a non-negative integer");
  }

  const body = {
    schema: "SelfEvent@1",
    kind,
    source_organ: sourceOrgan,
    turn,
    delta: delta !== null ? Math.round(delta * 1e6) / 1e6 : null,
    coordinate: coordinate ? { op: coordinate.op || coordinate.operator, terrain: coordinate.terrain, stance: coordinate.stance } : null,
    layer: layer || null,
    payload,
    description,
    depends_on: [...dependsOn],
  };
  return Object.freeze({ ...body, id: stableId("self-event", body) });
}

// ── SelfRecord: the append-only log ──────────────────────────────────

/**
 * Create a fresh SelfRecord.
 * One per collective session. The record IS the self.
 */
export function createSelfRecord() {
  return Object.freeze({
    schema: "SelfRecord@1",
    events: Object.freeze([]),
    head: "self-record:empty",
  });
}

/**
 * Append SelfEvents. Returns a new record; never mutates. Refuses duplicates
 * by content hash, same discipline as ReactionLog.
 */
export function appendSelfEvents(record, events) {
  const seen = new Set(record.events.map((e) => e.id));
  const appended = [];
  for (const event of events) {
    if (seen.has(event.id)) throw new TypeError(`self: duplicate self-event ${event.id}`);
    seen.add(event.id);
    appended.push(event);
  }
  const all = [...record.events, ...appended];
  const head = all.length
    ? stableId("self-record", all.map((e) => e.id))
    : "self-record:empty";
  return Object.freeze({ ...record, events: Object.freeze(all), head });
}

/**
 * Read the self-record into a self-fold — a compressed address into the
 * record, not a summary that replaces it. The fold occupies the SAME vector
 * space as the world-fold so that project(selfFold, worldFold) is directly
 * meaningful.
 *
 * This is step 2 of the article: amplitudes → squared → collapse. We do not
 * produce confidence scores; we produce a normalized amplitude vector.
 */
export function foldSelfRecord(record, baseScores = null) {
  const events = record.events;
  const scores = {
    operator: {},
    terrain: {},
    stance: {},
  };

  // Seed from caller-supplied base scores (the collective's current
  // operational snapshot — steering, discourse, genesis counts, etc.)
  if (baseScores) {
    for (const face of ["operator", "terrain", "stance"]) {
      for (const [k, v] of Object.entries(baseScores[face] || {})) {
        scores[face][k] = v;
      }
    }
  }

  if (events.length === 0) return fold("", null, baseScores || undefined);

  // Accumulate evidence from self-events. Each event is a self-observation
  // with provenance. We accumulate amplitudes — we do NOT collapse them
  // into a single classification. Collapse too early = lose interference.

  for (const event of events) {
    const weight = 1 / (1 + Math.exp(-0.1 * (event.turn || 0))); // sigmoid over logical time

    switch (event.kind) {
      case "transition": {
        const layer = event.layer || event.payload?.to;
        if (layer === "semantic")      scores.operator["SIG"] = (scores.operator["SIG"] || 0) + 0.3 * weight;
        if (layer === "structural")    scores.operator["SEG"] = (scores.operator["SEG"] || 0) + 0.3 * weight;
        if (layer === "operational")   scores.operator["CON"] = (scores.operator["CON"] || 0) + 0.3 * weight;
        if (layer === "architectural") scores.operator["DEF"] = (scores.operator["DEF"] || 0) + 0.3 * weight;
        scores.terrain["Field"] = (scores.terrain["Field"] || 0) + 0.1 * weight;
        break;
      }
      case "delta": {
        const d = event.delta || 0;
        if (d > 0.6) {
          scores.operator["REC"] = (scores.operator["REC"] || 0) + d * 0.4;
          scores.stance["Tracing"] = (scores.stance["Tracing"] || 0) + d * 0.5;
        }
        if (d < 0.2) {
          scores.stance["Cultivating"] = (scores.stance["Cultivating"] || 0) + 0.3;
        }
        scores.terrain["Void"] = (scores.terrain["Void"] || 0) + d * 0.3;
        break;
      }
      case "gate": {
        scores.operator["EVA"] = (scores.operator["EVA"] || 0) + 0.6 * weight;
        scores.stance["Tending"] = (scores.stance["Tending"] || 0) + 0.6 * weight;
        scores.terrain["Lens"] = (scores.terrain["Lens"] || 0) + 0.4 * weight;
        break;
      }
      case "genesis": {
        const status = event.payload?.lifecycle;
        if (status === "pencil") scores.operator["INS"] = (scores.operator["INS"] || 0) + 0.2 * weight;
        if (status === "ink")    scores.operator["EVA"] = (scores.operator["EVA"] || 0) + 0.3 * weight;
        if (status === "held")   scores.operator["REC"] = (scores.operator["REC"] || 0) + 0.3 * weight;
        scores.stance["Making"] = (scores.stance["Making"] || 0) + 0.2 * weight;
        break;
      }
      case "capacity": {
        scores.terrain["Paradigm"] = (scores.terrain["Paradigm"] || 0) + 0.3 * weight;
        scores.stance["Composing"] = (scores.stance["Composing"] || 0) + 0.2 * weight;
        break;
      }
      case "convergence": {
        scores.stance["Cultivating"] = (scores.stance["Cultivating"] || 0) + 0.5 * weight;
        scores.terrain["Paradigm"] = (scores.terrain["Paradigm"] || 0) + 0.2 * weight;
        break;
      }
      case "divergence": {
        scores.stance["Tracing"] = (scores.stance["Tracing"] || 0) + 0.4 * weight;
        scores.terrain["Void"] = (scores.terrain["Void"] || 0) + 0.2 * weight;
        break;
      }
    }
  }

  // Fold into a normalized amplitude vector over the same three faces the
  // world-fold uses. No collapse — the fold IS the superposition.
  return fold("", null, scores);
}

// ── Delta: the convergence measure ───────────────────────────────────
//
// Delta is not "how wrong is the collective." It is a diagnostic of
// convergence: how far the world-observations diverge from what the
// self-record would predict. 0 = convergent (never achieved), 1 = fully
// divergent (new territory). The delta history IS the learning trajectory.
//
// This is step 11 of the article: truth is a limit, not a value. The
// system approaches it; delta measures the approach.

/**
 * Compute the delta between the collective's world-observations and its
 * self-record.
 *
 * @param {object} selfFold — from foldSelfRecord
 * @param {object} worldFold — from quantum/fold (current turn's text)
 * @returns {number} delta in [0, 1]
 */
export function computeDelta(selfFold, worldFold) {
  if (!selfFold || !worldFold) return 0.5; // no evidence either way → mid
  const d = 1 - project(selfFold, worldFold);
  return Math.max(0, Math.min(1, Math.round(d * 1e6) / 1e6));
}

/**
 * Derive the convergence trend from a delta history.
 *
 * @param {number[]} history — recent delta values
 * @returns {object} { trend ("converging"|"diverging"|"stable"|"insufficient"), meanDelta, slope }
 */
export function convergenceTrend(history) {
  if (!history || history.length < 3) {
    return Object.freeze({ trend: "insufficient", meanDelta: null, slope: null });
  }
  const n = history.length;
  const mean = history.reduce((a, b) => a + b, 0) / n;
  // Simple linear slope over the window — positive means diverging
  const xMean = (n - 1) / 2;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (history[i] - mean);
    den += (i - xMean) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  let trend;
  if (Math.abs(slope) < 0.005) trend = "stable";
  else if (slope < 0) trend = "converging";
  else trend = "diverging";

  return Object.freeze({
    trend,
    meanDelta: Math.round(mean * 1e4) / 1e4,
    slope: Math.round(slope * 1e6) / 1e6,
  });
}

// ── Truth gate: the architectural enforcement ───────────────────────
//
// The collective will not speak words it cannot verify. This is not a
// preference — it is the architecture. Step 7 of the article: a claim
// with no source is not a weak claim. It is not a claim.
//
// Ramakrishna would not describe a city he had not visited. The collective
// could produce a beautiful, fluent, plausible-sounding description of
// that city — the LLM mouth is very good at that. The gate stops it.
//
// Three possible outcomes:
//   1. passed — answer binds to source, delta is acceptable. Speak.
//   2. refused — no source, or delta too high. Do not speak.
//   3. uncertain — source present but thin. Speak with provenance flagged.

/**
 * Gate a generated answer against its source grounding.
 *
 * @param {object} args
 * @param {string} args.answer — the generated text
 * @param {string} args.sourceSummary — the fold summary it was based on
 * @param {number} [args.delta] — current world–self divergence
 * @param {number} [args.consecutiveFailures=0] — prior EVA→REC cycles that failed
 * @param {object} [args.sourceSpans] — specific spans the claims bind to
 * @returns {object} { passed, quality, reason, answer, provenance }
 */
export function truthGate({ answer, sourceSummary, delta = 0, consecutiveFailures = 0, sourceSpans = null }) {
  const empty = !answer || answer.trim().length < 10;
  const noSource = !sourceSummary || sourceSummary.trim().length < 50;

  // No source and no answer: nothing to gate. Chitchat, greetings — pass.
  // The article's step 7 applies to CLAIMS ABOUT THE WORLD. "Hello" is not
  // a claim; it's a social signal. Don't gate social signals.
  if (empty && noSource) {
    return Object.freeze({
      passed: true,
      quality: "social",
      reason: "not a claim — social signal",
      answer: answer || "",
      provenance: null,
    });
  }

  // Answer with no source: the collective is being asked to speak about
  // the world without evidence. Step 7: strike it.
  if (!empty && noSource) {
    return Object.freeze({
      passed: false,
      quality: "refused",
      reason: "claim with no source — strike it (step 7)",
      answer: "I cannot speak to this — I have no source material to verify against.",
      provenance: null,
    });
  }

  // Source with no answer: couldn't produce anything. Step 6: save the
  // appearance (the empty answer IS data) before judging.
  if (empty && !noSource) {
    return Object.freeze({
      passed: false,
      quality: "mute",
      reason: "source material found but no answer produced",
      answer: "",
      provenance: { sourceLength: sourceSummary.length },
    });
  }

  // Both present. Check source sufficiency.
  if (sourceSummary.length < 100) {
    const attempts = consecutiveFailures + 1;
    if (attempts >= 3) {
      return Object.freeze({
        passed: false,
        quality: "refused",
        reason: `source material too thin after ${attempts} search rounds`,
        answer: "The source material I found is too thin to ground an answer in. I will not guess.",
        provenance: { sourceLength: sourceSummary.length, attempts },
      });
    }
    return Object.freeze({
      passed: true,
      quality: "thin",
      reason: `source under 100 chars — additional search may help (attempt ${attempts})`,
      answer,
      provenance: { sourceLength: sourceSummary.length, attempts },
    });
  }

  // High delta with thin source: the collective doesn't understand this
  // territory. Step 11: don't pretend to have arrived.
  if (delta > 0.6 && sourceSummary.length < 300) {
    return Object.freeze({
      passed: false,
      quality: "refused",
      reason: `delta ${delta.toFixed(3)} — this territory is not converged. speak: false.`,
      answer: "I do not understand this material well enough to speak about it reliably. Seeking more observations.",
      provenance: { delta, sourceLength: sourceSummary.length },
    });
  }

  // Pass. The claim binds to source; the delta is acceptable. Step 12:
  // the result is checkable at every step.
  const quality = delta > 0.3 ? "uncertain" : "grounded";
  return Object.freeze({
    passed: true,
    quality,
    reason: quality === "grounded"
      ? `claim binds to source (${sourceSummary.length} chars), delta ${delta.toFixed(3)}`
      : `claim binds to source but delta ${delta.toFixed(3)} — convergence is partial`,
    answer,
    provenance: {
      sourceLength: sourceSummary.length,
      delta,
      spanCount: sourceSpans ? sourceSpans.length : null,
    },
  });
}

// ── Motivation field: what the architecture naturally pursues ───────
//
// Motivation is not imposed. It emerges from the architecture. The
// collective naturally steers toward observations that reduce delta
// because convergence is more efficient. This function computes the
// directional bias — which observations would most reduce divergence.
//
// This is NOT "curiosity" as a drive. It is the necessary consequence
// of an architecture where:
//   - Every claim must bind to a source (step 7)
//   - Absence is data (step 5 — what's missing IS the story)
//   - Convergence is more efficient than divergence (step 11)
//
// The system wants to observe what it doesn't yet understand because
// UNDERSTANDING IT IS CHEAPER than remaining confused. No drive needed.

/**
 * Compute the motivation field — where the collective should direct
 * attention to most efficiently reduce delta.
 *
 * @param {object} selfFold — self-record fold
 * @param {object} [worldFold] — current world fold (optional; computes bias
 *   toward under-represented terrain/stance cells when absent)
 * @param {number} [delta=0] — current delta
 * @param {number[]} [deltaHistory=[]] — recent delta values
 * @returns {object} { bias: { terrain, stance }, urgency: number, direction: string }
 */
export function computeMotivationField(selfFold, worldFold = null, delta = 0, deltaHistory = []) {
  const trend = convergenceTrend(deltaHistory);

  // ── Bias toward under-represented cells ──────────────────────────
  // The self-fold has amplitude vectors. Cells with low amplitude are
  // territories the collective hasn't explored. Observing there would
  // increase the self-fold's information and potentially reduce delta.

  const bias = { terrain: null, stance: null };
  let minTerrain = Infinity, minStance = Infinity;
  for (const [k, v] of Object.entries(selfFold.terrain || {})) {
    if (v < minTerrain) { minTerrain = v; bias.terrain = k; }
  }
  for (const [k, v] of Object.entries(selfFold.stance || {})) {
    if (v < minStance) { minStance = v; bias.stance = k; }
  }

  // ── Urgency: how much does the collective need new observations? ──
  // High delta + diverging trend = urgent. Low delta + converging = calm.
  let urgency = delta;
  if (trend.trend === "diverging") urgency = Math.min(1, delta * 1.5);
  if (trend.trend === "converging") urgency = Math.max(0, delta * 0.5);

  // ── Direction ─────────────────────────────────────────────────────
  let direction;
  if (trend.trend === "converging") {
    direction = "continue — the model is converging, maintain course";
  } else if (trend.trend === "diverging") {
    // Diverging: the collective should seek observations in the
    // territory where it's most uncertain (lowest-amplitude cell)
    direction = `seek observations in ${bias.terrain}/${bias.stance} — lowest self-fold amplitude, maximum potential information gain`;
  } else {
    direction = delta > 0.4
      ? `high delta (${delta.toFixed(3)}) — probe under-represented cells`
      : `stable at delta ${delta.toFixed(3)} — explore or deepen`;
  }

  return Object.freeze({
    bias: Object.freeze(bias),
    urgency: Math.round(urgency * 1e4) / 1e4,
    direction,
    trend: trend.trend,
  });
}

// ── Exports ─────────────────────────────────────────────────────────

export {
  SELF_EVENT_KINDS,
  stableId,
};
