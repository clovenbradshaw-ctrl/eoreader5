// motivation/gaps.js — Gap-navigation system.
//
// A gap is not an error. A gap is the edge of the known — the point where
// the engine has admitted it cannot resolve something without witness-channel
// data. The truth-seeking impulse turns gaps from terminal walls into
// navigable frontiers: each gap carries a resolution path, a severity, and
// an action the reader can take.
//
// This module makes gaps systematically enumerable: given a fold, a reading
// snapshot, or an entity summary, it lists every claim that is unresolved at
// the tier the reader demands, and for each one, what the reader can do about
// it. A truth-seeker who faces a gap instead of bypassing it is performing
// exactly Ramakrishna's move: refuse the substitute, demand the encounter.
//
// Gap resolution actions:
//   seek_witness   — the gap NEEDS witness-channel data; inject a prior or
//                     get a human reader to provide the missing knowledge.
//   accept_engine  — the reader accepts ENGINE-tier resolution and moves on
//                     (valid only if tierDemand does not insist on MODEL).
//   defer          — the gap is real but not urgent; leave it for later.
//   probe          — the gap can be reduced by reading more context (nearby
//                     frames, preceding sections, related passages).
//
// Every resolvable gap carries at least one action. A gap with no actions
// is a structural dead end — the engine cannot proceed, and the only valid
// response is to report it (which this module does).

// ── Known gap types and their default resolutions ──────────────────────────────

const GAP_TYPES = {
  descriptor_aliases_unresolved: {
    description: "emanon with no per-text coref prior; descriptor aliases unknown",
    defaultAction: "seek_witness",
    detail: "an entity referred to by common-noun descriptors (monster/wretch/fiend) has no injected alias set. The engine cannot derive these; supply a per-text coref prior from eoPriors.",
  },
  surface_scope_unresolved: {
    description: "a declared surface's anchor quotes could not be resolved to offsets",
    defaultAction: "probe",
    detail: "a surface declared in a coref prior carries anchor quotes that could not be found in the source text. The edition may differ; re-resolve with the correct edition or update the prior.",
  },
  narrator_span_unresolved: {
    description: "a narrator span's anchor quotes could not be resolved",
    defaultAction: "probe",
    detail: "a declared narrator span (where the referent speaks as 'I') could not be resolved. Check the edition or update the anchor quotes.",
  },
  tier_demand_not_met: {
    description: "resolved at ENGINE tier but reader demands MODEL-tier witness",
    defaultAction: "seek_witness",
    detail: "the claim is structurally resolved (name containment, shared surname) but the reader's orientation demands MODEL-tier evidence. Provide a per-text coref prior or witness-channel verification.",
  },
  pronoun_semantic_unresolved: {
    description: "pronoun reference requires world knowledge to disambiguate",
    defaultAction: "seek_witness",
    detail: "two equally-salient same-type candidates compete for a pronoun; only the trigger word's meaning (open-domain knowledge) can settle it. Inject a reader prior or witness observation.",
  },
  model_tier_boundary: {
    description: "a claim requires MODEL-tier evidence not yet provided",
    defaultAction: "seek_witness",
    detail: "this claim crosses the tier boundary (ENGINE→MODEL) and needsWitness === true. The engine will not fake it; provide witness-channel data.",
  },
  presence_boundary_gap: {
    description: "a span's offset falls at a boundary gap between frames",
    defaultAction: "probe",
    detail: "the entity is present in a nearby frame but the span's offset lands at a frame-overlap boundary. The frame organ's windowed overlap doesn't guarantee continuous coverage. Reading more context may resolve this.",
  },
  co_occurring_surface: {
    description: "two referents share the same string surface in different scopes",
    defaultAction: "probe",
    detail: "the same string ('I', 'the wretch') points at different referents depending on position. Scope-disambiguated reading may separate them.",
  },
};

// ── Gap objects ────────────────────────────────────────────────────────────────

/**
 * navigableGap(gap, orientation) -> NavigableGap
 *
 * Wrap a raw gap from the engine (presence.js, entity-fold, etc.) into a
 * navigable structure with actions and severity determined by the reader's
 * orientation.
 */
export function navigableGap(gap, orientation = null) {
  const template = GAP_TYPES[gap.reason] ?? {
    description: `unresolved: ${gap.reason}`,
    defaultAction: "seek_witness",
    detail: `a gap of type "${gap.reason}" requires witness-channel resolution.`,
  };

  const severity = gapSeverity(gap, orientation);
  const actions = gapActions(gap, orientation);

  return {
    reason: gap.reason,
    description: template.description,
    detail: gap.detail ?? template.detail,
    severity,
    // Is this gap structural or driven by the reader's tier demand?
    structural: !gap.readerDriven,
    // Can the reader resolve it with more reading, or does it need external data?
    needsExternal: template.defaultAction === "seek_witness",
    actions,
    recommendedAction: actions[0]?.action ?? template.defaultAction,
    rawGap: gap,
  };
}

/**
 * navigableGaps(entries, orientation) -> NavigableGap[]
 *
 * Given a set of entries (fold spans, reading units, entity summaries), return
 * every unresolved gap as a navigable structure. A truth-seeking reader sees
 * more gaps — gaps that a completion-seeking reader would accept at ENGINE
 * tier become reportable when tierDemand is high.
 */
export function navigableGaps(entries = [], orientation = null) {
  const gaps = [];
  const demand = orientation?.tierDemand ?? 0.5;

  for (const entry of entries) {
    // Direct gaps from the engine (presence.js emit gaps array)
    if (entry.gaps?.length > 0) {
      for (const g of entry.gaps) {
        gaps.push(navigableGap(g, orientation));
      }
    }

    // Entries that need witness evidence but are only ENGINE-resolved
    if (entry.needsWitness) {
      gaps.push(navigableGap({
        reason: "model_tier_boundary",
        detail: entry.tierDetail ?? "this claim requires MODEL-tier evidence",
        tier: "model",
        needsWitness: true,
      }, orientation));
    }

    // Tier demand gaps: the entry is ENGINE-resolved but reader demands MODEL
    if (entry.tier === "engine" && demand > 0.5 && !entry.needsWitness) {
      gaps.push(navigableGap({
        reason: "tier_demand_not_met",
        detail: `resolved at ENGINE tier (${entry.resolution ?? "structural"}) but reader tierDemand=${demand.toFixed(2)}`,
        readerDriven: true,
        entry,
      }, orientation));
    }
  }

  return gaps;
}

/**
 * gapSeverity(gap, orientation) -> number in [0, 1]
 *
 * How blocking this gap is for this reader. A structural gap (missing coref
 * prior) is always severe. A reader-driven gap (tierDemand not met) is severe
 * only for truth-seeking readers.
 */
export function gapSeverity(gap, orientation = null) {
  const demand = orientation?.tierDemand ?? 0.5;

  // Structural gaps: the engine literally cannot answer without this data.
  const structuralGaps = new Set([
    "descriptor_aliases_unresolved",
    "pronoun_semantic_unresolved",
    "model_tier_boundary",
  ]);
  if (structuralGaps.has(gap.reason)) {
    return 0.8 + demand * 0.2; // 0.8-1.0 depending on reader demand
  }

  // Scoped gaps: the prior is present but couldn't be resolved in this edition.
  const scopedGaps = new Set([
    "surface_scope_unresolved",
    "narrator_span_unresolved",
  ]);
  if (scopedGaps.has(gap.reason)) {
    return 0.5 + demand * 0.3; // 0.5-0.8
  }

  // Reader-driven gaps: the engine CAN answer but the reader demands more.
  if (gap.reason === "tier_demand_not_met") {
    return (demand - 0.5) * 2; // 0 at demand==0.5, 1 at demand==1.0
  }

  // Boundary gaps: edge cases the engine may resolve with more context.
  if (gap.reason === "presence_boundary_gap") {
    return 0.2 + demand * 0.2; // 0.2-0.4
  }

  // Co-occurring surfaces: the engine CAN disambiguate with scope.
  if (gap.reason === "co_occurring_surface") {
    return 0.1 + demand * 0.2; // 0.1-0.3
  }

  return 0.3 + demand * 0.3; // default: moderately severe
}

/**
 * gapActions(gap, orientation) -> GapAction[]
 *
 * What the reader can do about this gap, ordered from most to least
 * appropriate given the reader's orientation.
 */
export function gapActions(gap, orientation = null) {
  const demand = orientation?.tierDemand ?? 0.5;
  const actions = [];

  // seek_witness — get external data (prior, human reader, witness channel)
  if (gap.needsWitness || gap.tier === "model" ||
      gap.reason === "descriptor_aliases_unresolved" ||
      gap.reason === "model_tier_boundary" ||
      gap.reason === "pronoun_semantic_unresolved") {
    actions.push({
      action: "seek_witness",
      label: "demand direct witness",
      description: "this gap requires evidence the engine cannot derive. Inject a per-text coref prior, provide reader observations, or get a human reader to supply the missing witness-channel knowledge.",
      cost: demand > 0.5 ? "necessary" : "optional",
    });
  }

  // probe — read more context to reduce the gap
  if (gap.reason === "surface_scope_unresolved" ||
      gap.reason === "narrator_span_unresolved" ||
      gap.reason === "presence_boundary_gap" ||
      gap.reason === "co_occurring_surface" ||
      gap.reason === "tier_demand_not_met") {
    actions.push({
      action: "probe",
      label: "read more context",
      description: "this gap may be reduced by reading nearby frames, preceding sections, or related passages. The frame organ's windowed overlap may not cover the exact offset.",
      cost: "cheap",
    });
  }

  // accept_engine — accept ENGINE-tier resolution and move on
  if (gap.reason === "tier_demand_not_met" ||
      gap.reason === "presence_boundary_gap" ||
      gap.reason === "co_occurring_surface") {
    actions.push({
      action: "accept_engine",
      label: "accept ENGINE-tier resolution",
      description: "the engine has structurally resolved this. Accepting it means accepting second-hand authority rather than direct witness.",
      cost: demand > 0.5 ? "surrender" : "free",
    });
  }

  // defer — leave for later
  actions.push({
    action: "defer",
    label: "defer to later",
    description: "this gap is real but not urgent. The engine will report it again on the next pass.",
    cost: "postponed",
  });

  // Unknown or novel gap types default to seek_witness — the most conservative
  // action: don't guess, demand evidence.
  if (actions.length === 1 && actions[0].action === "defer") {
    actions.unshift({
      action: "seek_witness",
      label: "seek witness for unknown gap",
      description: "this gap type is not yet catalogued. Demand witness evidence as fallback.",
      cost: "necessary",
    });
  }

  return actions;
}

/**
 * unresolvedClaims(entries, orientation) -> { resolved, unresolved, unverifiable }
 *
 * Triage a set of entries by their resolution status relative to the reader's
 * tier demand. A truth-seeking reader (tierDemand > 0.5) will classify many
 * ENGINE-resolved entries as unverifiable — the engine says they're resolved
 * structurally but the reader's demand isn't met, and the engine cannot close
 * that gap without witness-channel data.
 */
export function unresolvedClaims(entries = [], orientation = null) {
  const demand = orientation?.tierDemand ?? 0.5;
  const result = { resolved: [], unresolved: [], unverifiable: [] };

  for (const entry of entries) {
    if (entry.isGap || entry.gaps?.length > 0 || entry.needsWitness) {
      result.unresolved.push(entry);
    } else if (entry.tier === "engine" && demand > 0.5) {
      // Engine-resolved but reader demands MODEL. These are structurally sound
      // but the reader's orientation makes them UNVERIFIABLE — the engine
      // says "yes" and the reader says "prove it." This IS the truth-seeking
      // gap. The engine cannot close it; only the witness channel can.
      result.unverifiable.push({
        ...entry,
        tierDemandGap: true,
        demand,
        resolution: "available ONLY via witness channel",
      });
    } else {
      result.resolved.push(entry);
    }
  }

  return result;
}

/**
 * gapSummary(gaps) -> { total, structural, readerDriven, severities }
 *
 * Aggregate statistics over a set of gaps.
 */
export function gapSummary(gaps = []) {
  const structural = gaps.filter((g) => g.structural).length;
  const readerDriven = gaps.filter((g) => !g.structural).length;
  const severities = gaps.map((g) => g.severity);
  const meanSeverity = severities.length > 0
    ? severities.reduce((a, b) => a + b, 0) / severities.length
    : 0;

  return {
    total: gaps.length,
    structural,
    readerDriven,
    meanSeverity,
    // How many gaps NEED external data (can't be resolved by more reading)
    needsExternal: gaps.filter((g) => g.needsExternal).length,
    // How many are blocking (severity > 0.7)
    blocking: gaps.filter((g) => g.severity > 0.7).length,
  };
}
