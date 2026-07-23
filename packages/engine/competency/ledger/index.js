// Competency ledger (spec section 13.2 "incremental competency" and record
// 22.3 "CompetencyRecord"). Prequential accumulation of a candidate's loss
// against one or more baselines, under a single declared target and horizon.
//
//   CompetencyGain(m, b) = Σ_t [ L(b, y_t) − L(m, y_t) ]
//
// A positive gain means the candidate carried lower cumulative predictive loss
// than the baseline. The ledger is immutable — every recordStep returns a new
// ledger — so a locked historical evaluation can never be edited by a later
// re-run (invariant 12.12: promoted priors alter future search, never past
// evaluations). Competency is always scoped (invariant 7.5): finalize() forces
// the caller to name target, horizon, baselines, scoring rule, and protocol.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";

/**
 * Start an empty ledger for one candidate on one task.
 *
 * @param {object} args
 * @param {string} args.task_id
 * @param {string} args.candidate_id
 * @param {string[]} args.baseline_ids - the baselines the candidate is scored against.
 * @param {string} [args.scoring_rule="log-loss"]
 */
export function createLedger({ task_id, candidate_id, baseline_ids, scoring_rule = "log-loss" }) {
  if (typeof task_id !== "string" || !task_id) throw new TypeError("ledger: task_id is required");
  if (typeof candidate_id !== "string" || !candidate_id) throw new TypeError("ledger: candidate_id is required");
  if (!Array.isArray(baseline_ids) || baseline_ids.length === 0) throw new TypeError("ledger: at least one baseline_id is required (invariant 7.5, section 13.4)");
  const baselineLosses = {};
  for (const id of baseline_ids) baselineLosses[id] = 0;
  return Object.freeze({
    task_id,
    candidate_id,
    scoring_rule,
    baseline_ids: Object.freeze([...baseline_ids]),
    observations: 0,
    cumulative_loss: 0,
    baseline_losses: Object.freeze(baselineLosses),
    // Number of steps where a proper score was available for the candidate.
    proper_observations: 0,
  });
}

/**
 * Fold one revealed step into the ledger. `candidate_loss` and every entry of
 * `baseline_losses` are the per-step losses produced by revealAndScore under
 * the same target and horizon. A step whose candidate loss is null (no proper
 * score for the emitted kind) still advances `observations` but does not
 * corrupt the cumulative proper-score total; the mismatch is surfaced by
 * `proper_observations < observations`.
 */
export function recordStep(ledger, { candidate_loss, baseline_losses, proper = true }) {
  if (!ledger || typeof ledger !== "object") throw new TypeError("ledger: ledger is required");
  if (!baseline_losses || typeof baseline_losses !== "object") throw new TypeError("ledger: baseline_losses is required");
  for (const id of ledger.baseline_ids) {
    if (typeof baseline_losses[id] !== "number" || !Number.isFinite(baseline_losses[id])) {
      throw new TypeError(`ledger: baseline_losses is missing a finite loss for ${id}`);
    }
  }
  const lossIsProper = proper && typeof candidate_loss === "number" && Number.isFinite(candidate_loss);
  const nextBaseline = {};
  for (const id of ledger.baseline_ids) nextBaseline[id] = ledger.baseline_losses[id] + baseline_losses[id];
  return Object.freeze({
    ...ledger,
    observations: ledger.observations + 1,
    proper_observations: ledger.proper_observations + (lossIsProper ? 1 : 0),
    cumulative_loss: ledger.cumulative_loss + (lossIsProper ? candidate_loss : 0),
    baseline_losses: Object.freeze(nextBaseline),
  });
}

/** Per-baseline competency gain = baseline cumulative loss − candidate cumulative loss. */
export function competencyGain(ledger) {
  const gain = {};
  for (const id of ledger.baseline_ids) gain[id] = ledger.baseline_losses[id] - ledger.cumulative_loss;
  return Object.freeze(gain);
}

/**
 * Seal the ledger into a scoped, content-addressed CompetencyRecord
 * (record 22.3). Every competency value MUST identify target, horizon,
 * population, baselines, scoring rule, and protocol (invariant 7.5), so those
 * are required here rather than defaulted.
 *
 * @param {object} scope
 * @param {object} scope.horizon - horizon spec (e.g. { kind: "walk-forward", h: 1 }).
 * @param {string} scope.population - the evaluation population identifier.
 * @param {string[]} scope.source_versions - source content hashes / versions.
 * @param {string} scope.evaluation_protocol - e.g. "prequential-walk-forward".
 * @param {string} [scope.warrant_status="unknown"] - semantic warrant band (section 21.1).
 * @param {"experimental"|"replicated"|"failed"|"invalidated"} [scope.status="experimental"]
 */
export function finalizeCompetency(ledger, scope) {
  if (!ledger || typeof ledger !== "object") throw new TypeError("ledger: ledger is required");
  if (!scope || typeof scope !== "object") throw new TypeError("ledger: scope is required (invariant 7.5)");
  for (const field of ["horizon", "population", "source_versions", "evaluation_protocol"]) {
    if (scope[field] === undefined) throw new TypeError(`ledger: competency scope must declare ${field} (invariant 7.5)`);
  }
  const gain = competencyGain(ledger);
  const body = {
    schema: "CompetencyRecord@1",
    candidate_id: ledger.candidate_id,
    task_id: ledger.task_id,
    baseline_ids: [...ledger.baseline_ids],
    scoring_rule: ledger.scoring_rule,
    scope: {
      horizon: scope.horizon,
      population: scope.population,
      source_versions: [...scope.source_versions],
      evaluation_protocol: scope.evaluation_protocol,
    },
    observations: ledger.observations,
    proper_observations: ledger.proper_observations,
    cumulative_loss: ledger.cumulative_loss,
    baseline_losses: { ...ledger.baseline_losses },
    competency_gain: gain,
    warrant_status: scope.warrant_status ?? "unknown",
    status: scope.status ?? "experimental",
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, id: `competency:${content_hash}`, content_hash });
}
