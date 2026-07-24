// The Ground -> Figure individuation gate (spec section 13, "EO Terrain
// Promotion and Predictive Prior Induction v0.2"). See docs/individuation-
// gate.md for the normative writeup this module implements.
//
// A ReferentHypothesis (see ./index.js) is ambient material with a
// provisional handle. It becomes a Figure only when this gate admits it:
// mass x coupling typing (field/emanon/protogon/holon), gated additionally
// by boundary stability under re-segmentation (a figure is a place where
// the cut keeps landing, spec section 13.3/33.4).
//
// Every threshold here is a Born null from deriveNull, never a hand-set
// constant (spec section 12.8, 13.2). This module is terrain-parametric in
// spirit: it consumes row-supplied observables (mass, coupling, agency
// signal, named bit) and never assumes they came from text specifically -
// the same gate covers Field -> Link and Atmosphere -> Lens (spec 13.6)
// once a row supplies its own observable extraction.

import { deriveNull } from "../emergence/nulls/index.js";
import { computeBoundaryStabilityGate } from "../emergence/boundaries/index.js";

export const INDIVIDUATION_TYPES = Object.freeze(["field", "emanon", "protogon", "holon", "apparatus"]);

/**
 * Type a referent by mass x coupling, with the named/INS bit deciding
 * between emanon and holon on the high-mass side (spec 13.2, 13.5):
 *
 *   field:    low mass, low coupling   - ambient, not individuated
 *   protogon: low mass, high coupling  - orbited but absent (Kurtz)
 *   emanon:   high mass, unnamed       - present and agentive, never name-admitted
 *   holon:    high mass, named         - fully individuated, name-bound
 *
 * @param {object} args
 * @param {number} args.mass - sighting mass for this referent.
 * @param {number} args.coupling - rho, incident edge weight (co-occurrence
 *   / relational weight) for this referent.
 * @param {boolean} args.named - the INS bit: has a name-bind
 *   (unifyDescriptor-equivalent) ever fired for this referent.
 * @param {number[]} args.massNullSamples - mass values computed under an
 *   explicit perturbation of the actual data (e.g. shuffled sighting-to-
 *   referent assignment) - the null "what mass would this referent have by
 *   chance" distribution.
 * @param {number[]} args.couplingNullSamples - same, for coupling.
 * @param {number} [args.quantile=0.95] - Born-null quantile for both mass
 *   and coupling thresholds.
 */
export function classifyIndividuationType({
  mass,
  coupling,
  named,
  massNullSamples,
  couplingNullSamples,
  attributiveShare = null,
  couplingDispersion = null,
  attributiveNullSamples,
  dispersionNullSamples,
  patientShare = null,
  patientNullSamples,
  agentiveShare = null,
  agentiveNullSamples,
  quantile = 0.95,
}) {
  if (typeof mass !== "number" || Number.isNaN(mass)) throw new TypeError("classifyIndividuationType: mass must be a number");
  if (typeof coupling !== "number" || Number.isNaN(coupling)) throw new TypeError("classifyIndividuationType: coupling must be a number");

  const massNull = deriveNull({
    nullSamples: massNullSamples,
    observedStatistic: mass,
    tailDirection: "greater",
    quantile,
    protocol: { name: "shuffled-sighting-mass" },
  });
  const couplingNull = deriveNull({
    nullSamples: couplingNullSamples,
    observedStatistic: coupling,
    tailDirection: "greater",
    quantile,
    protocol: { name: "shuffled-incidence-coupling" },
  });

  const highMass = massNull.passed;
  const highCoupling = couplingNull.passed;

  let individuationType;
  if (highMass) {
    individuationType = named ? "holon" : "emanon";
  } else if (highCoupling) {
    individuationType = "protogon";
  } else {
    individuationType = "field";
  }

  const frame = computeFrameDemotionEvidence({
    individuationType,
    attributiveShare,
    couplingDispersion,
    attributiveNullSamples,
    dispersionNullSamples,
    patientShare,
    patientNullSamples,
    agentiveShare,
    agentiveNullSamples,
    quantile,
  });
  if (frame.demotes) individuationType = "apparatus";

  return deepFreeze({
    individuation_type: individuationType,
    high_mass: highMass,
    high_coupling: highCoupling,
    named: Boolean(named),
    mass_null: massNull,
    coupling_null: couplingNull,
    attributive_share: attributiveShare,
    coupling_dispersion: couplingDispersion,
    attributive_null: frame.attributiveNull,
    dispersion_null: frame.dispersionNull,
    subject_reentry: frame.subjectReentry,
  });
}

/**
 * Run the full Ground -> Figure gate for one referent: type it by mass x
 * coupling, then additionally require boundary invariance under
 * re-segmentation (spec 13.1, 13.3). A referent typed "field" never
 * admits. A referent of any other type admits only once boundary stability
 * has actually been evaluated and passed - per spec 4.4 ("fail closed when
 * an inference lacks provenance"), an unevaluated boundary is not a passing
 * one.
 *
 * @param {object} args - all classifyIndividuationType args, plus:
 * @param {string} args.referentId
 * @param {number} [args.agencySignal] - subjShare; carried through for
 *   record-keeping, not itself gating (spec 11.2, 13.2).
 * @param {{observedDisplacements: number[], nullDisplacements: number[], quantile?: number, protocol?: object}} [args.boundary]
 *   - inputs to computeBoundaryStabilityGate. Omit only for a
 *   provisional/typing-only read; the result's gate_result.admitted will be
 *   false and status "pending" until a boundary result is supplied.
 */
export function individuateReferent({
  referentId,
  mass,
  coupling,
  named,
  agencySignal,
  massNullSamples,
  couplingNullSamples,
  quantile = 0.95,
  boundary,
  attributiveShare = null,
  couplingDispersion = null,
  attributiveNullSamples,
  dispersionNullSamples,
  patientShare = null,
  patientNullSamples,
  agentiveShare = null,
  agentiveNullSamples,
}) {
  if (typeof referentId !== "string" || referentId.length === 0) {
    throw new TypeError("individuateReferent: referentId must be a non-empty string");
  }

  const typing = classifyIndividuationType({
    mass,
    coupling,
    named,
    massNullSamples,
    couplingNullSamples,
    attributiveShare,
    couplingDispersion,
    attributiveNullSamples,
    dispersionNullSamples,
    patientShare,
    patientNullSamples,
    agentiveShare,
    agentiveNullSamples,
    quantile,
  });
  const boundaryStability = boundary ? computeBoundaryStabilityGate(boundary) : null;

  const isField = typing.individuation_type === "field";
  const boundaryPassed = Boolean(boundaryStability?.passed);
  const boundaryFailed = Boolean(boundary) && !boundaryPassed;
  const admitted = !isField && boundaryPassed;

  let status;
  let reason;
  if (isField) {
    status = "field";
    reason = "mass and coupling do not clear their Born-null thresholds - remains ambient, not individuated";
  } else if (!boundary) {
    status = "pending";
    reason = "mass/coupling typing passed but boundary stability has not been evaluated";
  } else if (boundaryFailed) {
    status = "field";
    reason = "boundary does not stay put under re-segmentation - remains field, not admitted, despite mass/coupling typing";
  } else if (typing.individuation_type === "apparatus") {
    status = "apparatus";
    reason = "admitted as apparatus: attributive share and coupling dispersion clear Born-null thresholds without subject re-entry";
  } else {
    status = "active";
    reason = `admitted as ${typing.individuation_type}: mass/coupling typing and boundary stability both passed`;
  }

  // A referent that fails boundary invariance "remains field, not admitted"
  // (spec 13.1 worked example) - the boundary test can downgrade a typed
  // candidate, but it cannot promote one past what mass/coupling earned.
  const individuationType = isField ? "field" : boundaryFailed ? "field" : typing.individuation_type;

  return deepFreeze({
    schema: "IndividuationResult@1",
    referent_id: referentId,
    individuation_type: individuationType,
    mass,
    coupling,
    agency_signal: agencySignal ?? null,
    named: typing.named,
    mass_null: typing.mass_null,
    coupling_null: typing.coupling_null,
    attributive_share: typing.attributive_share,
    coupling_dispersion: typing.coupling_dispersion,
    attributive_null: typing.attributive_null,
    dispersion_null: typing.dispersion_null,
    subject_reentry: typing.subject_reentry,
    boundary_stability: boundaryStability,
    gate_result: Object.freeze({ admitted, status, reason }),
  });
}

function computeFrameDemotionEvidence({
  individuationType,
  attributiveShare,
  couplingDispersion,
  attributiveNullSamples,
  dispersionNullSamples,
  patientShare,
  patientNullSamples,
  agentiveShare,
  agentiveNullSamples,
  quantile,
}) {
  const attributiveNull = deriveOptionalNull(attributiveNullSamples, attributiveShare, quantile, "shuffled-predicate-attribution");
  const dispersionNull = deriveOptionalNull(dispersionNullSamples, couplingDispersion, quantile, "shuffled-incidence-dispersion");
  const patientNull = deriveOptionalNull(patientNullSamples, patientShare, quantile, "shuffled-predicate-patient");
  const agentiveNull = deriveOptionalNull(agentiveNullSamples, agentiveShare, quantile, "shuffled-predicate-agentive");

  let subjectReentry = null;
  if (patientNull?.passed) {
    subjectReentry = { passed: true, basis: "patient", null_result: patientNull };
  } else if (agentiveNull?.passed) {
    subjectReentry = { passed: true, basis: "agentive", null_result: agentiveNull };
  } else if (patientNull || agentiveNull) {
    subjectReentry = { passed: false, basis: "none", null_result: patientNull ?? agentiveNull };
  }

  const eligible = individuationType === "holon" || individuationType === "emanon";
  return {
    attributiveNull,
    dispersionNull,
    subjectReentry,
    demotes: eligible && Boolean(attributiveNull?.passed) && Boolean(dispersionNull?.passed) && !Boolean(subjectReentry?.passed),
  };
}

function deriveOptionalNull(nullSamples, observedStatistic, quantile, name) {
  if (observedStatistic === null || observedStatistic === undefined) return null;
  if (!Array.isArray(nullSamples)) return null;
  return deriveNull({
    nullSamples,
    observedStatistic,
    tailDirection: "greater",
    quantile,
    protocol: { name },
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

/**
 * A later name-bind (unifyDescriptor-equivalent) is the INS that promotes
 * emanon -> holon (spec 13.5): it does not change mass or coupling, only
 * the named bit, and it emits a REC held:true promotion. This is a pure
 * re-derivation, not a mutation - callers keep both the pre- and
 * post-name-bind individuation results for the audit trail (spec 7.11).
 */
export function applyNameBind(individuationResult) {
  if (individuationResult.individuation_type !== "emanon") {
    throw new Error(
      `applyNameBind: name-bind promotion only applies to an emanon (got "${individuationResult.individuation_type}")`
    );
  }
  return individuateReferent({
    referentId: individuationResult.referent_id,
    mass: individuationResult.mass,
    coupling: individuationResult.coupling,
    named: true,
    agencySignal: individuationResult.agency_signal,
    massNullSamples: individuationResult.mass_null.null_samples,
    couplingNullSamples: individuationResult.coupling_null.null_samples,
    quantile: individuationResult.mass_null.quantile,
    boundary: individuationResult.boundary_stability
      ? {
          observedDisplacements: [individuationResult.boundary_stability.mean_observed_displacement],
          nullDisplacements: individuationResult.boundary_stability.null_result.null_samples,
          quantile: individuationResult.boundary_stability.null_result.quantile,
        }
      : undefined,
  });
}


export function applyFrameDemotion(individuationResult, evidence) {
  if (individuationResult.individuation_type !== "holon" && individuationResult.individuation_type !== "emanon") {
    throw new Error(`applyFrameDemotion: frame demotion only applies to a holon or emanon (got "${individuationResult.individuation_type}")`);
  }
  const post = deepFreeze({
    ...individuationResult,
    individuation_type: "apparatus",
    attributive_share: evidence.attributiveShare ?? individuationResult.attributive_share ?? null,
    coupling_dispersion: evidence.couplingDispersion ?? individuationResult.coupling_dispersion ?? null,
    attributive_null: evidence.attributiveNull ?? individuationResult.attributive_null ?? null,
    dispersion_null: evidence.dispersionNull ?? individuationResult.dispersion_null ?? null,
    subject_reentry: individuationResult.subject_reentry ?? null,
    gate_result: { admitted: true, status: "apparatus", reason: "admitted as apparatus: frame demotion retained in ledger" },
  });
  return deepFreeze({
    result: post,
    rec: { operator: "REC", held: false, transition: "frame-demotion", pre: individuationResult, post },
  });
}

export function applySubjectReentry(individuationResult, evidence) {
  if (individuationResult.individuation_type !== "apparatus") {
    throw new Error(`applySubjectReentry: subject re-entry only applies to apparatus (got "${individuationResult.individuation_type}")`);
  }
  const restoredType = individuationResult.named ? "holon" : "emanon";
  const nullResult = evidence.nullResult ?? evidence.patientNull ?? evidence.agentiveNull;
  const post = deepFreeze({
    ...individuationResult,
    individuation_type: restoredType,
    subject_reentry: { passed: true, basis: evidence.basis, null_result: nullResult },
    gate_result: { admitted: true, status: "active", reason: `subject re-entry restored ${restoredType}: ${evidence.basis} evidence cleared its Born null` },
  });
  return deepFreeze({
    result: post,
    rec: { operator: "REC", held: true, transition: "subject-reentry", pre: individuationResult, post },
  });
}
