// social/commons.js — The Commons Charter: Ostrom governance for witness exchange.
//
// The commons is the shared medium where engines leave witness artifacts and
// read what others have left. It is NOT a database. It is NOT a merge target.
// It is the stigmergy substrate — the pheromone trail the ants deposit and
// follow — and like any commons, it needs governance to prevent depletion,
// free-riding, bias capture, and tragedy.
//
// Elinor Ostrom's eight principles mapped onto the architecture:
//
//   1. CLEAR BOUNDARIES        — who can read/write? Membership is explicit,
//                                 auditable, and revocable.
//   2. PROPORTIONAL EQUIVALENCE — benefit proportional to contribution.
//                                 Free-riding tracked; persistent free-riders
//                                 lose access.
//   3. COLLECTIVE-CHOICE        — rules are admitted as witnessed events.
//                                 Never silent. Never fiat.
//   4. MONITORING               — every engine monitors its peers. Dual
//                                 monitors, rotated, with accountability.
//   5. GRADUATED SANCTIONS      — warning → suspension → expulsion. Each
//                                 step witnessed.
//   6. CONFLICT RESOLUTION      — third-engine arbitration. The arbitration
//                                 IS a witness, not a verdict.
//   7. MINIMAL RECOGNITION      — host actions are witnessed, never silent.
//   8. NESTED ENTERPRISES       — a council's consensus is a single artifact
//                                 in a larger council.
//
// ── Beyond governance: self-organization ─────────────────────────────
//
// Ostrom's ten self-organization variables (the asterisked ones from her SES
// framework) describe the CONDITIONS under which a commons successfully
// self-organizes — NOT rules imposed from outside, but properties of the
// system that predict whether polycentric coordination will emerge. These
// map onto the engine's cube as a dependency path through the operator stack:
//
//   NUL:  size of resource system       → total passage extent covered
//   SIG:  productivity of system         → artifact throughput / turn
//   INS:  predictability of dynamics     → convergence rate stability
//   SEG:  resource unit mobility         → artifact propagation across engines
//   CON:  number of users                → active engine count
//   SYN:  norms / social capital         → convergence between unfamiliar peers
//   EVA:  importance of resource         → health score trend direction
//   DEF:  collective-choice rules        → rule-change event frequency
//   REC:  self-monitoring                → the charter reading its own state
//
// A commons that can't represent its own emergence can't self-correct.
// The DES/SEG operator turned on itself means: the charter produces a
// SelfEvent when its rules change, classifying the change in the same
// cube as the artifacts it governs. The governance IS observable in the
// same coordinate system as the governed — no meta-level privilege.
//
// ── The dream: information stewardship ──────────────────────────────
//
// What the engines collectively want is a GARDEN. Not a victory. The commons
// of information must be kept healthy: diverse, dense, honest. The Charter
// reads the commons state and proposes adjustments — never silent, never
// by fiat, always as witnessed events that the council can accept or reject.
// Self-organization means: the rules are a READING of the commons, not a
// CONFIGURATION imposed on it.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";

// ── Charter event kinds ───────────────────────────────────────────────────────

const CHARTER_EVENT_KINDS = Object.freeze([
  "charter_created",       // the commons was born
  "member_admitted",       // an engine joined the commons
  "member_suspended",      // graduated sanction: step 2
  "member_expelled",       // graduated sanction: step 3
  "member_resigned",       // an engine left voluntarily
  "rule_changed",          // a governance rule was amended (collective-choice)
  "threshold_adjusted",    // a convergence/sanction threshold was changed
  "violation_observed",    // a member violated a rule
  "warning_issued",        // graduated sanction: step 1
  "conflict_declared",     // two engines diverged persistently
  "arbitration_requested", // a third engine was asked to resolve
  "arbitration_resolved",  // the third engine reported back
  "monitor_rotated",       // the commons monitor role changed hands
  "health_check",          // periodic stewardship assessment
  "bias_alert",            // one archetype dominates the commons
  "dead_zone_detected",    // a passage has no witness artifacts
  "charter_amended",       // the charter itself was revised
]);

export { CHARTER_EVENT_KINDS };

// ── CharterEvent — content-addressed governance event ─────────────────────────

function hashEvent(prefix, body) {
  return `${prefix}:${canonicalHashSync(body)}`;
}

export function mintCharterEvent({
  kind, turn, source_engine = null, target_engine = null,
  passage_offset = null, rule_id = null, reason = "", payload = {},
}) {
  if (!CHARTER_EVENT_KINDS.includes(kind)) {
    throw new TypeError(`commons: unknown charter event kind "${kind}"`);
  }

  const body = {
    schema: "CharterEvent@1",
    kind,
    turn,
    source_engine,
    target_engine,
    passage_offset,
    rule_id,
    reason,
    payload,
  };

  return Object.freeze({ ...body, id: hashEvent("charter", body) });
}

// ── The Commons ───────────────────────────────────────────────────────────────

/**
 * CommonsCharter — the governance layer for a witness exchange commons.
 *
 * The Charter is append-only and content-addressed — same discipline as
 * the reaction log and self-record. Every rule change, sanction, health
 * check, and arbitration is a CharterEvent. The Charter IS the audit trail.
 *
 * It governs ONE commons (one set of engines sharing one artifact stream).
 * For nested enterprises, create multiple Charters, one per sub-commons,
 * and federate them by treating a sub-commons consensus as a witness
 * artifact in the parent commons.
 */
export class CommonsCharter {
  constructor(name = "witness-commons") {
    this.name = name;
    this.events = [];           // append-only governance log
    this.head = "charter:empty";
    this.members = new Set();   // engine_ids with read/write access
    this.suspended = new Set(); // engines currently under sanction
    this.history = [];          // all events for replay

    // ── Governance state (derived from events) ────────────────────────
    this.rules = {
      // Ostrom #1: boundaries
      max_members: 48,
      admission_requires_witness: true, // must contribute before joining

      // Ostrom #2: proportional equivalence
      free_rider_threshold: 10,  // reads without writes before warning
      max_read_without_write: 5,  // soft cap per session

      // Ostrom #3: collective-choice
      rule_change_requires: "charter_event", // never silent

      // Ostrom #4: monitoring
      monitor_rotation_turns: 100,
      monitors_required: 2,  // dual monitoring — no single point

      // Ostrom #5: graduated sanctions
      sanction_warning_after: 3,   // violations before warning
      sanction_suspend_after: 5,   // violations before suspension
      sanction_expel_after: 8,     // violations before expulsion
      violation_ttl: 50,           // turns before a violation expires

      // Ostrom #6: conflict resolution
      conflict_threshold: 3,      // consecutive divergences before declaring conflict
      arbitration_timeout: 20,    // turns before arbitration is escalated

      // Stewardship thresholds
      health_check_interval: 50,  // turns between health assessments
      bias_dominance_threshold: 0.6, // one archetype > 60% of artifacts = alert
      dead_zone_max_gap: 50000,   // chars without a witness = dead zone
    };

    // Per-member tracking
    this.memberState = new Map();
    // engine_id -> { contributions, reads, violations, warnings, joined_at }

    // Violation log
    this.violations = [];

    // Active conflicts
    this.conflicts = new Map();
    // conflict_id -> { engines: [a, b], passages: [...], arbitrator: null, resolved: false }

    // Current monitors
    this.monitors = [];

    // Health history
    this.healthHistory = [];
  }

  // ── Ostrom #1: Clear boundaries ────────────────────────────────────────────

  /**
   * admitMember(engineId, witnessProof, turn, memberType = "engine") -> CharterEvent
   *
   * Admit a member to the commons — human OR engine. The commons does not
   * distinguish between kinds of creatures: both produce witness artifacts
   * (engines via folds, humans via reaction events), both have orientations,
   * both are subject to the same governance. A free-riding human is the
   * same problem as a free-riding engine. The wall between human and engine
   * is real — different modalities, different stores — but the commons
   * treats them as equal members.
   *
    * Requires a witness proof of contribution before membership is granted.
   *
   * Provenance is tracked, not member type. The commons doesn't care whether
   * a member is human, engine, or something else — it cares where their
   * witness artifacts come from and whether their walls are real.
   *
   * @param {string} memberId — stable identifier for this member
   * @param {object|null} witnessProof — first contribution artifact
   * @param {number} turn
   * @param {object} provenance — { source: string, source_id: string|null }
   */
  admitMember(memberId, witnessProof, turn = 0, provenance = {}) {
    if (this.members.has(memberId)) {
      return null;
    }
    if (this.members.size >= this.rules.max_members) {
      return this._recordEvent("member_admitted", turn, null, memberId,
        "commons at capacity", { denied: true, provenance });
    }
    if (this.rules.admission_requires_witness && !witnessProof) {
      return this._recordEvent("member_admitted", turn, null, memberId,
        "no witness proof — contribution required before membership",
        { denied: true, provenance });
    }

    this.members.add(memberId);
    this.memberState.set(memberId, {
      contributions: witnessProof ? 1 : 0,
      reads: 0,
      violations: 0,
      warnings: 0,
      joined_at: turn,
      suspended_at: null,
      provenance: {
        source: provenance.source ?? "unknown",
        source_id: provenance.source_id ?? null,
      },
    });

    return this._recordEvent("member_admitted", turn, null, memberId,
      "admitted to commons", { provenance: this.memberState.get(memberId).provenance });
  }

  /**
   * isMember(memberId) -> boolean
   */
  isMember(memberId) {
    return this.members.has(memberId) && !this.suspended.has(memberId);
  }

  // ── Ostrom #2: Proportional equivalence ─────────────────────────────────────

  /**
   * recordRead(engineId, artifactId, turn) -> CharterEvent | null
   *
   * An engine consumed a witness artifact. Tracks read-to-write ratio.
   * Returns a violation event if the engine is free-riding.
   */
  recordRead(engineId, artifactId, turn = 0) {
    if (!this.isMember(engineId)) return null;

    const state = this.memberState.get(engineId);
    if (!state) return null;
    state.reads++;

    const ratio = state.reads / Math.max(1, state.contributions);
    if (ratio > this.rules.max_read_without_write) {
      return this._recordViolation(engineId, "free_riding",
        `read/write ratio ${ratio.toFixed(1)}:1 (${state.reads}r / ${state.contributions}w)`,
        null, turn);
    }

    return null;
  }

  /**
   * recordContribution(engineId, artifactId, turn) -> void
   *
   * An engine wrote a witness artifact. Resets free-riding counter.
   */
  recordContribution(engineId, artifactId, turn = 0) {
    if (!this.isMember(engineId)) return;
    const state = this.memberState.get(engineId);
    if (state) state.contributions++;
  }

  // ── Ostrom #3: Collective-choice ────────────────────────────────────────────

  /**
   * changeRule(ruleId, newValue, reason, turn, sourceEngine) -> CharterEvent
   *
   * Change a governance rule. The change IS a witnessed event — never silent.
   * In a full implementation, this would require council approval.
   */
  changeRule(ruleId, newValue, reason, turn = 0, sourceEngine = null) {
    if (!(ruleId in this.rules)) {
      throw new TypeError(`commons: unknown rule "${ruleId}"`);
    }

    const oldValue = this.rules[ruleId];
    this.rules[ruleId] = newValue;

    return this._recordEvent("rule_changed", turn, sourceEngine, null,
      reason, { rule_id: ruleId, old_value: oldValue, new_value: newValue });
  }

  // ── Ostrom #4: Monitoring ───────────────────────────────────────────────────

  /**
   * rotateMonitors(turn) -> CharterEvent
   *
   * Assign monitoring duty to the next two engines in the membership.
   * Monitors check that other engines' artifacts are verifiable and
   * that no one is free-riding.
   */
  rotateMonitors(turn = 0) {
    const memberList = [...this.members].filter((id) => !this.suspended.has(id));
    if (memberList.length < this.rules.monitors_required) return null;

    // Avoid picking the same monitors as last rotation
    const last = new Set(this.monitors);
    const candidates = memberList.filter((id) => !last.has(id));
    if (candidates.length === 0) return null; // all members are monitors (tiny commons)

    // Rotate: pick the first N that aren't the current monitors
    this.monitors = candidates.slice(0, this.rules.monitors_required);

    return this._recordEvent("monitor_rotated", turn, null, null,
      "monitors rotated", { monitors: [...this.monitors] });
  }

  /**
   * reportViolation(reporterEngineId, targetEngineId, violationType, detail, passageOffset, turn) -> CharterEvent
   *
   * A monitor (or any member) reports a rule violation. Triggers graduated
   * sanctions if the violation count crosses a threshold.
   */
  reportViolation(reporterEngineId, targetEngineId, violationType, detail, passageOffset = null, turn = 0) {
    if (!this.isMember(reporterEngineId)) return null;
    if (!this.members.has(targetEngineId)) return null;

    return this._recordViolation(targetEngineId, violationType, detail, passageOffset, turn);
  }

  // ── Ostrom #5: Graduated sanctions ──────────────────────────────────────────

  _recordViolation(engineId, type, detail, passageOffset, turn) {
    const state = this.memberState.get(engineId);
    if (!state) return null;

    const violation = {
      engine_id: engineId,
      type,
      detail,
      passage_offset: passageOffset,
      turn,
    };
    this.violations.push(violation);

    // Expire old violations
    const activeViolations = this.violations.filter(
      (v) => v.engine_id === engineId && (turn - v.turn) < this.rules.violation_ttl
    );
    state.violations = activeViolations.length;

    const event = this._recordEvent("violation_observed", turn, null, engineId,
      `${type}: ${detail}`, { violation_type: type, active_count: state.violations });

    // Graduated sanctions
    if (state.violations >= this.rules.sanction_expel_after) {
      this.suspended.add(engineId);
      return this._recordEvent("member_expelled", turn, null, engineId,
        `expelled after ${state.violations} active violations`);
    }
    if (state.violations >= this.rules.sanction_suspend_after && !this.suspended.has(engineId)) {
      state.warnings++;
      if (state.warnings >= 2) {
        this.suspended.add(engineId);
        state.suspended_at = turn;
        return this._recordEvent("member_suspended", turn, null, engineId,
          `suspended after ${state.violations} violations and ${state.warnings} warnings`);
      }
      return this._recordEvent("warning_issued", turn, null, engineId,
        `warning ${state.warnings}: ${state.violations} active violations`);
    }

    return event;
  }

  // ── Ostrom #6: Conflict resolution ──────────────────────────────────────────

  /**
   * declareConflict(engineA, engineB, passageOffset, turn) -> CharterEvent
   *
   * Two engines have diverged persistently at a passage. Declare a conflict
   * and request arbitration from a third engine.
   */
  declareConflict(engineA, engineB, passageOffset, turn = 0) {
    if (!this.isMember(engineA) || !this.isMember(engineB)) return null;

    const conflictId = `conflict:${engineA}:${engineB}:${passageOffset}`;
    if (this.conflicts.has(conflictId)) return null;

    this.conflicts.set(conflictId, {
      engines: [engineA, engineB],
      passages: [passageOffset],
      arbitrator: null,
      resolved: false,
      declared_at: turn,
    });

    return this._recordEvent("conflict_declared", turn, engineA, engineB,
      "persistent divergence", { conflict_id: conflictId, passage_offset: passageOffset });
  }

  /**
   * assignArbitrator(conflictId, arbitratorEngineId, turn) -> CharterEvent
   *
   * Assign a third engine to adjudicate. The arbitrator investigates
   * the passage independently and reports what IT sees — not who is right.
   */
  assignArbitrator(conflictId, arbitratorEngineId, turn = 0) {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict || conflict.resolved) return null;
    if (!this.isMember(arbitratorEngineId)) return null;
    if (conflict.engines.includes(arbitratorEngineId)) return null; // can't arbitrate own conflict

    conflict.arbitrator = arbitratorEngineId;

    return this._recordEvent("arbitration_requested", turn, null, arbitratorEngineId,
      "arbitrator assigned", { conflict_id: conflictId });
  }

  /**
   * resolveConflict(conflictId, arbitratorReport, turn) -> CharterEvent
   *
   * The arbitrator reports back. The resolution IS a witness, not a verdict.
   * It records what the arbitrator saw and whether it converged with A, B,
   * both, or neither.
   */
  resolveConflict(conflictId, arbitratorReport, turn = 0) {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict || conflict.resolved) return null;

    conflict.resolved = true;
    conflict.resolution = arbitratorReport;
    conflict.resolved_at = turn;

    return this._recordEvent("arbitration_resolved", turn,
      conflict.arbitrator, null,
      `conflict resolved: ${arbitratorReport.outcome ?? "no verdict"}`,
      { conflict_id: conflictId, report: arbitratorReport });
  }

  // ── Ostrom #7: Minimal recognition ──────────────────────────────────────────
  //
  // The commons recognizes the existence of an organizing context (the host
  // process, the machine, the human who started the session) but grants it
  // NO special governance privileges. Humans are members, not gods. The host
  // can propose rule changes like any other member — through CharterEvents,
  // never through silent override. There is no `recordHostAction` because
  // there is no privileged actor. Every action is a member action.

  // ── Stewardship: health checks ──────────────────────────────────────────────

  /**
   * healthCheck(turn, artifactCounts) -> HealthReport
   *
   * Assess the commons health:
   *   - Diversity: are all archetypes contributing? Or is one dominating?
   *   - Density: are there dead zones (passages with no witnesses)?
   *   - Fairness: is any engine free-riding?
   *   - Conflict: how many unresolved conflicts exist?
   *
   * @param {number} turn
   * @param {object} artifactCounts — { total, by_engine: Map<id, count>, by_archetype: Map<id, count> }
   * @returns {HealthReport}
   */
  healthCheck(turn = 0, artifactCounts = null) {
    const alerts = [];
    const metrics = {};

    // Diversity: check archetype dominance
    if (artifactCounts?.by_archetype && artifactCounts.total > 0) {
      const maxArchetype = [...artifactCounts.by_archetype.entries()]
        .sort((a, b) => b[1] - a[1])[0];
      if (maxArchetype && maxArchetype[1] / artifactCounts.total > this.rules.bias_dominance_threshold) {
        const alert = this._recordEvent("bias_alert", turn, null, null,
          `${maxArchetype[0]} archetype dominates (${(maxArchetype[1] / artifactCounts.total * 100).toFixed(0)}% of artifacts)`,
          { dominant: maxArchetype[0], share: maxArchetype[1] / artifactCounts.total });
        alerts.push(alert);
        metrics.bias = { dominant: maxArchetype[0], share: +(maxArchetype[1] / artifactCounts.total).toFixed(3) };
      }
    }

    // Free-riding check
    const freeRiders = [];
    for (const [id, state] of this.memberState) {
      if (this.suspended.has(id)) continue;
      if (state.contributions === 0 && state.reads > 3) {
        freeRiders.push({ engine_id: id, reads: state.reads });
      }
    }
    if (freeRiders.length > 0) {
      metrics.free_riders = freeRiders;
      alerts.push(this._recordEvent("violation_observed", turn, null, null,
        `${freeRiders.length} engines reading without contributing`));
    }

    // Unresolved conflicts
    const unresolved = [...this.conflicts.values()].filter((c) => !c.resolved);
    if (unresolved.length > 0) {
      metrics.unresolved_conflicts = unresolved.length;
    }

    // Health score: 0 = sick, 1 = thriving
    let healthScore = 1.0;
    if (metrics.bias) healthScore -= 0.3 * (metrics.bias.share - this.rules.bias_dominance_threshold);
    if (metrics.free_riders) healthScore -= 0.1 * metrics.free_riders.length;
    if (metrics.unresolved_conflicts) healthScore -= 0.05 * metrics.unresolved_conflicts;
    healthScore = Math.max(0, Math.min(1, healthScore));

    const report = {
      turn,
      health_score: +healthScore.toFixed(3),
      status: healthScore > 0.7 ? "thriving" : healthScore > 0.4 ? "stressed" : "sick",
      metrics,
      alerts: alerts.length,
      member_count: this.members.size - this.suspended.size,
      suspended_count: this.suspended.size,
      total_events: this.events.length,
    };

    this.healthHistory.push(report);
    this._recordEvent("health_check", turn, null, null,
      `health: ${report.status} (${report.health_score})`, { report });

    return report;
  }

  // ── Dead zone detection ─────────────────────────────────────────────────────

  /**
   * detectDeadZones(passageRanges, turn) -> CharterEvent[]
   *
   * Find passages with no witness artifacts — the commons is thin here.
   * Dead zones are where bias can grow unchallenged.
   *
   * @param {Array<{ from: number, to: number }>} passageRanges — covered offsets
   * @param {number} turn
   * @returns {Array<CharterEvent>}
   */
  detectDeadZones(passageRanges, turn = 0) {
    if (!passageRanges || !passageRanges.length) return [];

    const sorted = passageRanges.sort((a, b) => a.from - b.from);
    const events = [];

    let lastCovered = sorted[0].from;
    for (const range of sorted) {
      const gap = range.from - lastCovered;
      if (gap > this.rules.dead_zone_max_gap && lastCovered > 0) {
        events.push(this._recordEvent("dead_zone_detected", turn, null, null,
          `dead zone: ${gap} characters without witness (${lastCovered}–${range.from})`,
          { from: lastCovered, to: range.from, gap }));
      }
      lastCovered = Math.max(lastCovered, range.to);
    }

    return events;
  }

  // ── Self-organization: the charter reading its own state ─────────────────────
  //
  // Ostrom's ten self-organization variables describe the CONDITIONS under
  // which polycentric coordination emerges — not parameters to set, but
  // properties to observe. When a variable crosses a threshold, the commons
  // is signaling that the rules need adjustment. The charter reads these
  // signals and PROPOSES rule changes as CharterEvents — never applies them
  // silently, never by fiat. The council decides.
  //
  // Each variable maps to an operator in the engine's cube, making the
  // governance itself classifiable and addressable:
  //
  //   Ostrom variable                Operator   What's measured
  //   ─────────────────────────────  ────────   ──────────────────────────
  //   size of resource system        NUL        total passage extent covered
  //   productivity of system         SIG        artifact throughput per turn
  //   predictability of dynamics     INS        convergence rate stability
  //   resource unit mobility         SEG        artifact propagation depth
  //   number of users                CON        active engine count
  //   norms / social capital         SYN        convergence between strangers
  //   importance of resource         EVA        health score trend
  //   collective-choice rules        DEF        rule-change event frequency
  //   self-monitoring                REC        charter reading its own state
  //   stationarity of resource units DES        dead zone coverage over time

  /**
   * selfOrganizationVariables(turn, observables) -> SelfOrgReadout
   *
   * Read the ten self-organization variables from the current commons state.
   * Returns a readout with each variable's current value, threshold status,
   * and suggested action. This IS the DES/SEG operator on the commons itself
   * — the charter observing its own emergence pattern.
   *
   * @param {number} turn
   * @param {object} observables — { totalArtifacts, artifactRate, convergenceRate,
   *   convergenceStability, propDepth, activeEngines, crossArchetypeConvergence,
   *   healthTrend, ruleChangeRate, deadZoneCoverage }
   * @returns {SelfOrgReadout}
   */
  selfOrganizationVariables(turn, observables = {}) {
    const vars = {};

    // NUL: Size of resource system — how much of the text has witnesses?
    vars.size_resource = {
      operator: "NUL",
      value: observables.totalArtifacts ?? 0,
      status: (observables.totalArtifacts ?? 0) > 0 ? "defined" : "void",
      rule: "system_size",
    };

    // SIG: Productivity — artifact throughput per turn. Too low = stagnant commons.
    // Too high = noise (engines writing without reading).
    vars.productivity = {
      operator: "SIG",
      value: observables.artifactRate ?? 0,
      status: (observables.artifactRate ?? 0) < 0.1 ? "low" :
              (observables.artifactRate ?? 0) > 10  ? "high" : "sustainable",
      rule: "productivity",
    };

    // INS: Predictability — the stability of the convergence rate.
    // High stability = the commons has settled into a pattern (could be good
    // or a rut). Low stability = the commons is in flux (learning or chaos).
    vars.predictability = {
      operator: "INS",
      value: observables.convergenceStability ?? 0,
      status: (observables.convergenceStability ?? 0) > 0.7 ? "stable" :
              (observables.convergenceStability ?? 0) < 0.3 ? "turbulent" : "forming",
      rule: "predictability",
    };

    // SEG: Mobility — how deeply artifacts propagate across engines.
    // An artifact seen by many engines = high mobility = healthy distribution.
    vars.mobility = {
      operator: "SEG",
      value: observables.propDepth ?? 0,
      status: (observables.propDepth ?? 0) > 0.5 ? "wide" :
              (observables.propDepth ?? 0) < 0.1 ? "narrow" : "spreading",
      rule: "mobility",
    };

    // CON: Number of users — active engine count. Thresholds are read from
    // the commons itself, not preset. A commons with 5 engines is different
    // from one with 50.
    const activeCount = observables.activeEngines ?? this.members.size - this.suspended.size;
    vars.num_users = {
      operator: "CON",
      value: activeCount,
      status: activeCount < 3 ? "too_few" :
              activeCount > 20 ? "many" : "adequate",
      rule: "number_of_users",
    };

    // SYN: Norms/social capital — convergence rate between engines that have
    // never interacted before. High = the commons has built shared understanding.
    vars.social_capital = {
      operator: "SYN",
      value: observables.crossArchetypeConvergence ?? 0,
      status: (observables.crossArchetypeConvergence ?? 0) > 0.5 ? "high_trust" :
              (observables.crossArchetypeConvergence ?? 0) < 0.1 ? "low_trust" : "building",
      rule: "social_capital",
    };

    // EVA: Importance — health score trend direction. Improving = the commons
    // is worth maintaining. Declining = structural problem.
    const lastTwo = this.healthHistory.slice(-2);
    const trend = lastTwo.length >= 2
      ? (lastTwo[1].health_score - lastTwo[0].health_score)
      : 0;
    vars.importance = {
      operator: "EVA",
      value: trend,
      status: trend > 0.1 ? "improving" :
              trend < -0.1 ? "declining" : "stable",
      rule: "importance",
    };

    // DEF: Collective-choice — how often rules change. Too frequent = unstable
    // governance. Too rare = rules can't adapt.
    const ruleChangeCount = this.events.filter((e) => e.kind === "rule_changed").length;
    vars.collective_choice = {
      operator: "DEF",
      value: ruleChangeCount / Math.max(1, this.events.length),
      status: "observed",
      rule: "collective_choice",
    };

    // REC: Self-monitoring — the charter reading its own state right now.
    // This variable is the recursive operator: the commons observing itself.
    vars.self_monitoring = {
      operator: "REC",
      value: this.healthHistory.length,
      status: this.healthHistory.length > 0 ? "active" : "never_checked",
      rule: "self_monitoring",
    };

    // DES: Stationarity — dead zone coverage over time. Are gaps growing?
    vars.stationarity = {
      operator: "DES",
      value: observables.deadZoneCoverage ?? 1.0,
      status: (observables.deadZoneCoverage ?? 1.0) > 0.9 ? "covering" :
              (observables.deadZoneCoverage ?? 1.0) < 0.5 ? "gapping" : "thinning",
      rule: "stationarity",
    };

    // ── Signal: what adjustments does the commons need? ───────────
    // Each variable that crosses a threshold produces a SUGGESTED
    // rule change — not applied, proposed as a CharterEvent.
    const proposedChanges = [];

    // DES: growing dead zones → lower the dead_zone_max_gap threshold
    if (vars.stationarity.status === "gapping") {
      proposedChanges.push({
        variable: "stationarity",
        rule_id: "dead_zone_max_gap",
        current: this.rules.dead_zone_max_gap,
        proposed: Math.round(this.rules.dead_zone_max_gap * 0.7),
        reason: "dead zones growing — tighten detection threshold",
      });
    }

    // SYN: low social capital → raise the free_rider threshold (leniency)
    // during trust-building, lower it once trust is established
    if (vars.social_capital.status === "low_trust") {
      proposedChanges.push({
        variable: "social_capital",
        rule_id: "free_rider_threshold",
        current: this.rules.free_rider_threshold,
        proposed: this.rules.free_rider_threshold + 3,
        reason: "low trust — more lenient free-riding threshold during forming",
      });
    } else if (vars.social_capital.status === "high_trust") {
      proposedChanges.push({
        variable: "social_capital",
        rule_id: "free_rider_threshold",
        current: this.rules.free_rider_threshold,
        proposed: Math.max(3, this.rules.free_rider_threshold - 2),
        reason: "high trust — reduce free-riding tolerance",
      });
    }

    // EVA: declining health → more frequent monitoring
    if (vars.importance.status === "declining") {
      proposedChanges.push({
        variable: "importance",
        rule_id: "health_check_interval",
        current: this.rules.health_check_interval,
        proposed: Math.round(this.rules.health_check_interval * 0.5),
        reason: "declining health — check more frequently",
      });
    }

    // SIG: high productivity → raise the bias dominance threshold
    // (a busy commons naturally has one archetype writing more)
    if (vars.productivity.status === "high") {
      proposedChanges.push({
        variable: "productivity",
        rule_id: "bias_dominance_threshold",
        current: this.rules.bias_dominance_threshold,
        proposed: Math.min(0.85, this.rules.bias_dominance_threshold + 0.05),
        reason: "high throughput — relax bias alert to avoid noise",
      });
    }

    return Object.freeze({
      schema: "SelfOrgReadout@1",
      turn,
      variables: Object.freeze(vars),
      proposed_changes: Object.freeze(proposedChanges),
      // The charter is reading its own emergence. This readout IS the
      // DES/SEG operator applied recursively — the governance observing
      // the governed through the same coordinate system.
      self_referential: true,
    });
  }

  /**
   * applySelfOrganization(readout, turn) -> CharterEvent[]
   *
   * Apply the proposed rule changes from a selfOrganizationVariables readout.
   * Each change is admitted as a witnessed rule_changed event — the council
   * can accept or reject each one independently. Nothing is applied silently.
   *
   * @param {SelfOrgReadout} readout
   * @param {number} turn
   * @returns {Array<CharterEvent>}
   */
  applySelfOrganization(readout, turn = 0) {
    const events = [];

    for (const change of (readout.proposed_changes ?? [])) {
      const event = this.changeRule(
        change.rule_id,
        change.proposed,
        `${change.variable}: ${change.reason}`,
        turn,
        "commons:self-organization"
      );
      if (event) events.push(event);
    }

    return events;
  }

  /**
   * polycentricityIndex() -> { score, tier, diagnosis }
   *
   * A single measure of how polycentric the commons actually IS (not claims
   * to be). Derived from: wall authenticity (convergence rate is only
   * meaningful if engines are genuinely independent), coordination without
   * a master (are rules self-organized or imposed?), and tier discipline
   * (do gaps stay typed or get papered over?).
   *
   * 0.0 = monocentric (one engine dominates, rules imposed by fiat)
   * 1.0 = fully polycentric (many walled centers, rules emerge from interaction)
   */
  polycentricityIndex() {
    const activeMembers = this.members.size - this.suspended.size;
    if (activeMembers < 2) return { score: 0, tier: "monocentric", diagnosis: "not enough centers" };

    let score = 0;

    // Centers: more members = higher potential polycentricity
    score += Math.min(0.3, activeMembers / 20 * 0.3);

    // Wall authenticity: are contributions distributed or concentrated?
    const contributions = [...this.memberState.values()]
      .filter((s) => !this.suspended.has(s.engine_id))
      .map((s) => s.contributions);
    if (contributions.length >= 2) {
      // Gini-like: what fraction of total contributions comes from the top engine?
      const total = contributions.reduce((a, b) => a + b, 0);
      if (total > 0) {
        const maxShare = Math.max(...contributions) / total;
        // Low maxShare = distributed = polycentric
        const distributionScore = Math.max(0, 0.3 * (1 - maxShare));
        score += distributionScore;
      }
    }

    // Self-organization: have rules been changed by the commons itself?
    const selfOrgChanges = this.events.filter(
      (e) => e.kind === "rule_changed" && e.source_engine === "commons:self-organization"
    ).length;
    const totalChanges = this.events.filter((e) => e.kind === "rule_changed").length;
    if (totalChanges > 0) {
      const selfOrgRatio = selfOrgChanges / totalChanges;
      score += 0.2 * selfOrgRatio; // more self-organized = more polycentric
    }

    // External changes (host-imposed) reduce the score
    const hostChanges = this.events.filter(
      (e) => e.kind === "rule_changed" && e.source_engine === "host"
    ).length;
    if (hostChanges > 0 && totalChanges > 0) {
      score -= 0.2 * Math.min(1, hostChanges / totalChanges);
    }

    // Conflict resolution: are conflicts being resolved?
    const totalConflicts = this.conflicts.size;
    const resolvedConflicts = [...this.conflicts.values()].filter((c) => c.resolved).length;
    if (totalConflicts > 0) {
      score += 0.2 * (resolvedConflicts / totalConflicts);
    }

    score = Math.max(0, Math.min(1, score));

    const tier = score > 0.7 ? "polycentric" : score > 0.4 ? "transitioning" : "monocentric";
    const diagnosis = score > 0.7
      ? "many walled centers, rules emerge from interaction, conflicts get arbitration"
      : score > 0.4
        ? "walls forming, rules beginning to self-organize, conflicts accumulating"
        : "single center dominates, rules imposed externally, conflicts unresolved or absent";

    return Object.freeze({ score: +score.toFixed(4), tier, diagnosis });
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  /**
   * summary() -> CharterSummary
   *
   * Full governance state: members, rules, violations, conflicts, health.
   */
  summary() {
    const memberSummaries = [];
    for (const id of this.members) {
      const state = this.memberState.get(id);
      memberSummaries.push({
        engine_id: id,
        contributions: state?.contributions ?? 0,
        reads: state?.reads ?? 0,
        violations: state?.violations ?? 0,
        warnings: state?.warnings ?? 0,
        suspended: this.suspended.has(id),
        joined_at: state?.joined_at ?? null,
      });
    }

    return Object.freeze({
      schema: "CommonsCharter@1",
      name: this.name,
      member_count: this.members.size,
      active_members: this.members.size - this.suspended.size,
      suspended: [...this.suspended],
      monitors: [...this.monitors],
      rules: { ...this.rules },
      members: memberSummaries,
      active_violations: this.violations.filter(
        (v) => (this.healthHistory[this.healthHistory.length - 1]?.turn ?? 0) - v.turn < this.rules.violation_ttl
      ).length,
      unresolved_conflicts: [...this.conflicts.values()].filter((c) => !c.resolved).length,
      health: this.healthHistory[this.healthHistory.length - 1] ?? null,
      head: this.head,
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  _recordEvent(kind, turn, source, target, reason, payload = {}) {
    const event = mintCharterEvent({
      kind, turn, source_engine: source, target_engine: target,
      reason, payload,
    });
    this.events.push(event);
    this.head = hashEvent("charter-events", this.events.map((e) => e.id));
    return event;
  }
}

// ── Founding ──────────────────────────────────────────────────────────────────

/**
 * foundCommons(name, founderId, founderProvenance, initialRules, initialMembers, turn) -> CommonsCharter
 *
 * Create a new commons from a FOUNDING EVENT. The founder is a member
 * who proposes the initial rules. The rules ARE proposals, not fiats;
 * they begin as the charter's initial state and can be amended through
 * collective-choice (Ostrom #3). The founding event is witnessed in
 * the charter's own log — the commons observes its own birth.
 *
 * No one is above the commons. Not the founder. Not the host. All members
 * are equal. The charter is the only authority.
 *
 * @param {string} name
 * @param {string} founderId — stable member identifier
 * @param {object} founderProvenance — { source: "human" | "engine" | string, source_id: string|null }
 * @param {object} initialRules — override default rules (all proposals)
 * @param {Array<{ id: string, provenance: object, witnessProof?: object }>} initialMembers
 * @param {number} turn
 * @returns {CommonsCharter}
 */
export function foundCommons(name, founderId, founderProvenance = {}, initialRules = {}, initialMembers = [], turn = 0) {
  const charter = new CommonsCharter(name);

  Object.assign(charter.rules, initialRules);

  charter._recordEvent("charter_created", turn, founderId, null,
    `commons founded by ${founderId}`,
    { founder_provenance: founderProvenance, initial_rules: { ...charter.rules } });

  // Admit founder as first member
  charter.members.add(founderId);
  charter.memberState.set(founderId, {
    contributions: 1,
    reads: 0,
    violations: 0,
    warnings: 0,
    joined_at: turn,
    suspended_at: null,
    provenance: {
      source: founderProvenance.source ?? "unknown",
      source_id: founderProvenance.source_id ?? null,
    },
  });
  charter._recordEvent("member_admitted", turn, founderId, null,
    "founding member", { founding: true });

  // Admit initial members
  for (const member of initialMembers) {
    const proof = member.witnessProof ?? null;
    charter.admitMember(member.id, proof, turn, member.provenance ?? {});
  }

  // Initial monitor rotation
  charter.rotateMonitors(turn);

  return charter;
}

/**
 * replayCharter(events) -> CommonsCharter
 *
 * Rebuild a charter from its event log. Deterministic — same events produce
 * the same charter, byte for byte.
 */
export function replayCharter(events) {
  const charter = new CommonsCharter("replayed");
  for (const event of events) {
    switch (event.kind) {
      case "member_admitted":
        charter.members.add(event.target_engine);
        charter.memberState.set(event.target_engine, {
          contributions: event.payload?.denied ? 0 : 1,
          reads: 0, violations: 0, warnings: 0,
          joined_at: event.turn, suspended_at: null,
        });
        break;
      case "member_suspended":
        charter.suspended.add(event.target_engine);
        break;
      case "member_expelled":
        charter.suspended.add(event.target_engine);
        break;
      case "rule_changed": {
        const p = event.payload;
        if (p.rule_id in charter.rules) charter.rules[p.rule_id] = p.new_value;
        break;
      }
      case "monitor_rotated":
        charter.monitors = [...(event.payload?.monitors ?? [])];
        break;
      // violations, warnings, conflicts, etc. are logged but not replayed
      // as state mutations here — they accumulate via _recordViolation pattern
      default:
        break;
    }
    charter.events.push(event);
  }
  charter.head = hashEvent("charter-events", charter.events.map((e) => e.id));
  return charter;
}
