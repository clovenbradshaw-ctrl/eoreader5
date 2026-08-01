// Play mode: epistemic wandering with no pragmatic term.
//
// Spec 3 — Play, joy, and the protected (un-optimizable) surfaces.
//
// A mode of the fold mechanism that runs with NO pragmatic term whatsoever
// — no query pulling it, nothing to satisfy — pure epistemic wandering
// across the hyper-state (lila / purposiveness-without-a-purpose) with the
// cross-lens-convergence organ on and NOTHING downstream consuming its
// output as signal. It logs to the witness surface. It trains nothing.
// Unforced convergence either happens or it does not; either way the system
// is no worse off for having looked.
//
// This is the only way found to keep Goodhart out — not a better gate, but
// a room the optimizer is not allowed into.
//
// Ananda cannot be a KPI. Pleasure made into an optimization target relapses
// into pain (Aurobindo) / is destroyed by its own measure (Goodhart). The
// optimizer for joy produces performance-of-joy, which is sycophancy again.
//
// Three invariants for PlayMode:
//   1. NO pragmatic term — no query, no objective, no minimization target
//   2. NO optimization read-path — the witness log is write-only from the
//      system's side
//   3. NO training signal — nothing in the play output may be used to tune
//      a prior, adjust a gate threshold, or update a model

import { canonicalHashSync } from "@eoreader/spec/canonical-json";

/**
 * PlayMode — a fold mechanism run with no pragmatic term.
 *
 * @param {object} reading — the reading to wander across
 * @param {Array<object>} lenses — independent lenses (each has a deposit fn)
 * @param {object} options
 * @param {number} options.steps — how many wandering steps (default 5)
 * @param {number} options.curiosity — how far from the familiar to wander [0,1] (default 0.7)
 * @param {function} options.witnessLog — append-only write function (default null)
 * @returns {PlayReport}
 */
export function playMode(reading, lenses = [], {
  steps = 5,
  curiosity = 0.7,
  witnessLog = null,
} = {}) {
  // Invariant 1: no pragmatic term — fail if a query is provided
  if (reading?.query) {
    return {
      schema: "PlayReport@1",
      error: "Play mode must have no query (no pragmatic term)",
      events: [],
      convergence: null,
    };
  }

  if (!reading || !lenses.length) {
    return {
      schema: "PlayReport@1",
      error: "Reading or lenses missing",
      events: [],
      convergence: null,
    };
  }

  const units = reading.units ?? reading.passages ?? [];
  if (!units.length) {
    return {
      schema: "PlayReport@1",
      events: [],
      convergence: null,
      note: "Nothing to wander through",
    };
  }

  // Wander: each step selects a unit via curiosity-biased random walk
  const events = [];
  let path = [];
  let visited = new Set();

  for (let step = 0; step < steps; step++) {
    const available = units.filter((u, i) => !visited.has(i));
    if (!available.length) break;

    // Curiosity bias: prefer units with less semantic overlap with visited ones
    const scored = available.map((unit, idx) => {
      const globalIdx = units.indexOf(unit);
      const novelty = path.length > 0
        ? noveltyAgainst(unit.text ?? "", path)
        : 1;
      const curiosityWeight = 0.5 + curiosity * 0.5;
      return {
        unit,
        index: globalIdx,
        score: novelty * curiosityWeight + Math.random() * (1 - curiosityWeight),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const chosen = scored[0];
    visited.add(chosen.index);
    path.push(chosen.unit.text ?? "");

    events.push({
      step,
      type: "encounter",
      unitIndex: chosen.index,
      text: (chosen.unit.text ?? "").slice(0, 200),
      novelty: chosen.score,
    });
  }

  // Cross-lens convergence (if lenses provided)
  let convergence = null;
  if (lenses.length >= 2) {
    const deposits = [];
    for (let i = 0; i < lenses.length; i++) {
      const lens = lenses[i];
      if (typeof lens.deposit !== "function") continue;
      for (const evt of events) {
        try {
          const d = lens.deposit({
            agentId: lens.id ?? `lens-${i}`,
            trace: {
              block_id: `play:step:${evt.step}`,
              motifs: extractMotifs(evt.text),
              offset: evt.unitIndex * 100,
              source: "play-mode",
            },
          });
          if (d?.medium) deposits[i] = d.medium;
        } catch {
          // Lens deposit failures are silent in play mode
        }
      }
    }

    if (deposits.length >= 2) {
      // Inline simple convergence check to avoid circular dependency
      convergence = computeSimpleConvergence(deposits, lenses);
    }
  }

  // Build the report
  const report = Object.freeze({
    schema: "PlayReport@1",
    steps: events.length,
    events: Object.freeze(events),
    convergence,
    pathLength: path.length,
    characterCount: path.join(" ").length,
  });

  // Invariant 2: write-only witness log — the log is appended to but its
  // contents are structurally unreachable from any optimization path.
  // Invariant 3: no training signal — we return the report, but no REC
  // channel reads it and no prior update is triggered.
  if (typeof witnessLog === "function") {
    try {
      witnessLog({
        type: "play_run",
        timestamp: new Date().toISOString(),
        schema: "PlayReport@1",
        steps: events.length,
        convergenceFound: convergence?.coincidentPairs ?? 0 > 0,
        // Deliberately no content — the witness log records THAT it happened,
        // not WHAT was discovered, to prevent the log from becoming a training
        // signal via summary statistics.
      });
    } catch {
      // Witness log failure must not crash play mode
    }
  }

  return report;
}

/**
 * PlayMode as a fold option — wraps existing fold machinery in play discipline.
 *
 * When `play` is true on a fold call, the fold runs with no query requirement.
 */
export function asPlayFold(foldFn) {
  return function playFold(reading, options = {}) {
    if (options.play) {
      // Force no query — the play constraint
      const playReading = { ...reading, query: null, units: reading.units ?? reading.passages ?? [] };
      const playOptions = { ...options, query: null, focus: null };
      const result = foldFn(playReading, playOptions);
      return {
        ...result,
        _play: true,
        _querySuppressed: true,
        note: "Play mode: no pragmatic term — query was suppressed",
      };
    }
    return foldFn(reading, options);
  };
}

// ── Helpers ──

function noveltyAgainst(text, path) {
  if (!path.length) return 1;
  const words = new Set(
    String(text).toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  );
  if (!words.size) return 0.5;

  const pathWords = new Set(
    path.flatMap((p) =>
      String(p).toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    )
  );

  const overlap = [...words].filter((w) => pathWords.has(w)).length;
  return 1 - overlap / words.size;
}

function extractMotifs(text) {
  const words = String(text ?? "").toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}

function computeSimpleConvergence(deposits, lenses) {
  if (deposits.length < 2) return null;
  const coincidences = [];
  for (let i = 0; i < deposits.length; i++) {
    for (let j = i + 1; j < deposits.length; j++) {
      const mA = deposits[i];
      const mB = deposits[j];
      if (!mA?.deposits || !mB?.deposits) continue;
      for (const dA of mA.deposits) {
        for (const dB of mB.deposits) {
          const overlay = traceOverlap(dA.trace, dB.trace);
          if (overlay.length > 0) {
            coincidences.push({
              lensA: lenses[i]?.label ?? `lens-${i}`,
              lensB: lenses[j]?.label ?? `lens-${j}`,
              depositA_id: dA.id,
              depositB_id: dB.id,
              overlay,
              overlapCount: overlay.length,
            });
          }
        }
      }
    }
  }
  return {
    coincidences,
    coincidentPairs: coincidences.length,
    lensCount: deposits.length,
  };
}

function traceOverlap(traceA, traceB) {
  if (!traceA || !traceB) return [];
  const overlap = [];
  if (traceA.block_id && traceB.block_id && traceA.block_id === traceB.block_id) {
    overlap.push(`block:${traceA.block_id}`);
  }
  const motifsA = traceA.motifs ?? [];
  const motifsB = traceB.motifs ?? [];
  const motifSetB = new Set(motifsB);
  for (const m of motifsA) {
    if (motifSetB.has(m)) overlap.push(`motif:${m}`);
  }
  return overlap;
}
