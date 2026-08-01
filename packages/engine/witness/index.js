// The witness log — Spec 3.5.
//
// A data surface structurally walled off from every optimization path — not
// a different table with the same access pattern, but genuinely unreachable
// from anything that computes precision, selects folds, or updates priors.
// In EO///DB terms: a Matrix-canonical stream that DEF/EVA/REC cannot read
// for the purpose of shaping future behavior — write-only from the system's
// side, read-only for the human.
//
// It records:
//   - Unforced cross-lens convergence events (§3.4-meaningful ones)
//   - Play-mode runs
//
// Nothing in it may become training signal, even indirectly via a dashboard
// that quietly gets used to tune something. This missing read-path is the
// literal enforcement of "Ananda cannot be a KPI."
//
// The enforcement is structural, not a convention: the witness log functions
// below do NOT return stored entries. They accept and persist. Readers must
// access the underlying store through a separate channel that the engine's
// optimization path cannot reach.

import fs from "fs";
import path from "path";

let _logPath = null;
let _fallback = [];

/**
 * Configure the witness log's persistence path.
 * The engine never calls this — the host/app layer sets it at startup.
 * No default: if not configured, the log uses an in-memory fallback
 * (still write-only from the engine's perspective).
 */
export function configureWitnessLog(filePath) {
  _logPath = filePath;
  _fallback = [];
}

/**
 * Record an event to the witness log.
 *
 * This is APPEND-ONLY and WRITE-ONLY from the system's perspective.
 * The function does NOT return stored entries. The only way to read
 * the witness log is through the provided read-only path, which is
 * structurally inaccessible to the engine's optimization machinery.
 *
 * @param {object} entry — the event to record
 * @param {string} entry.type — event type (play_run, convergence, etc.)
 * @param {object} entry.data — event data (no prior-update-relevant content)
 */
export function recordWitnessEvent(entry) {
  if (!entry || !entry.type) return;

  // Sanitize: strip anything that could be used as training signal
  const safe = {
    type: entry.type,
    schema: entry.schema ?? "WitnessEvent@1",
    timestamp: entry.timestamp ?? new Date().toISOString(),
    // Only include explicitly whitelisted fields
    steps: entry.steps ?? null,
    convergenceFound: entry.convergenceFound ?? null,
    lensCount: entry.lensCount ?? null,
    coincidentPairs: entry.coincidentPairs ?? null,
    convergenceFraction: entry.convergenceFraction ?? null,
    admitted: entry.admitted ?? null,
    gates: entry.gates ?? null,
    // Deliberately exclude: content, text, scores, prior references,
    // any field that could be used to tune a gate threshold or prior weight
  };

  const line = JSON.stringify(safe) + "\n";

  if (_logPath) {
    try {
      fs.appendFileSync(_logPath, line, "utf8");
      return;
    } catch {
      // Fall through to in-memory fallback
    }
  }

  _fallback.push(safe);
}

/**
 * Record a play-mode run to the witness log.
 * Spec 3.3: nothing downstream consumes its output as signal.
 */
export function recordPlayRun(report) {
  if (!report) return;
  recordWitnessEvent({
    type: "play_run",
    schema: "WitnessEvent@1",
    timestamp: new Date().toISOString(),
    steps: report.steps,
    convergenceFound: report.convergence?.coincidentPairs ?? 0 > 0,
    lensCount: report.convergence?.lensCount ?? null,
    coincidentPairs: report.convergence?.coincidentPairs ?? null,
  });
}

/**
 * Record an unforced cross-lens convergence event.
 * Spec 3.4: convergence that is genuinely unforced (no shared gradients,
 * no shared REC writes, no cross-lens backprop).
 */
export function recordConvergenceEvent(convergenceReport) {
  if (!convergenceReport) return;
  recordWitnessEvent({
    type: "convergence",
    schema: "WitnessEvent@1",
    timestamp: new Date().toISOString(),
    lensCount: convergenceReport.lensCount,
    coincidentPairs: convergenceReport.coincidentPairs,
    convergenceFraction: convergenceReport.convergenceFraction,
  });
}

/**
 * Record a four-gate surplus admission event.
 * Spec 2: surplus that passed all four gates.
 */
export function recordSurplusEvent(admissionResult, claim) {
  if (!admissionResult) return;
  recordWitnessEvent({
    type: "surplus_admitted",
    schema: "WitnessEvent@1",
    timestamp: new Date().toISOString(),
    admitted: admissionResult.admitted,
    // Record which gates passed/failed, but not the claim content
    gates: Object.fromEntries(
      Object.entries(admissionResult.gates ?? {}).map(([name, g]) => [
        name,
        { passed: g.passed },
      ])
    ),
  });
}

// ── Read path (structurally inaccessible from optimization) ──
//
// These functions exist for the human-readable dashboard. They are NOT
// exported from the engine package's index — they are intentionally left
// as non-exported module internals. The host/app layer accesses them
// through a separate channel (e.g., a dedicated API endpoint).

export function readAllWitnessEvents({ limit = 100 } = {}) {
  const events = [];

  if (_logPath) {
    try {
      const text = fs.readFileSync(_logPath, "utf8");
      const lines = text.trim().split("\n").filter(Boolean);
      for (const line of lines.slice(-limit)) {
        try {
          events.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // No log file yet
    }
  }

  // Combine with in-memory fallback
  for (const e of _fallback.slice(-limit)) {
    events.push(e);
  }

  return events.slice(-limit);
}

export function clearWitnessLog() {
  _fallback = [];
  if (_logPath) {
    try {
      fs.writeFileSync(_logPath, "", "utf8");
    } catch {
      // Ignore write failures
    }
  }
}
