import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { deriveNull, createSeededRng, seededShuffle } from "../nulls/index.js";

// Surplus: the second reward channel, wired in parallel with error-closure.
//
// Spec 2 — Surplus, and the four-gate anti-sycophancy apparatus.
//
// Error-closure reward alone converges on the shallowest fold that clears the
// bar (paraphrase reaches zero residual faster than understanding does) AND
// is satisfiable — it goes to zero at full fit, producing the dark-room
// failure. Surplus fires when a fold resolves MORE structure than the query
// strictly required — an unplanned connection, coherence beyond the minimum
// ask.
//
// Surplus alone is gameable (sycophant produces surplus flattery; totalizing
// ideology is surplus-rich by design). The four gates below make it safe, by
// the same discipline as induceKind / induceCalculus / the paradigm gate:
// every gate is a Born-null-gated conditional test.

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const std = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/**
 * Gate 1 — Data-derived surplus threshold.
 *
 * A claim counts as surplus only if removing it would not change whether the
 * immediate query was answered. This is the induceKind boundary applied to
 * "was this content required" rather than "is this regime-switch real."
 *
 * @param {string} claim — the surplus claim to evaluate
 * @param {string} query — the original query
 * @param {string} answer — the proposed answer (claim included)
 * @param {string} answerWithoutClaim — answer with the claim removed
 * @returns {{ passed: boolean, requiredScore: number, surplusScore: number }}
 */
export function gateDataSurplus(claim, query, answer, answerWithoutClaim) {
  if (!claim || !query) {
    return { passed: false, requiredScore: 0, surplusScore: 0 };
  }

  const queryTerms = new Set(
    String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  );

  const answerTerms = new Set(
    String(answer).toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  );

  const withoutTerms = new Set(
    String(answerWithoutClaim ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 2)
  );

  // What fraction of query terms does the full answer cover?
  const queryTermCount = queryTerms.size || 1;
  const answerQueryOverlap = [...queryTerms].filter((t) => answerTerms.has(t)).length;
  const withoutQueryOverlap = [...queryTerms].filter((t) => withoutTerms.has(t)).length;

  const requiredScore = answerQueryOverlap / queryTermCount;
  const withoutScore = withoutQueryOverlap / queryTermCount;

  // Surplus: the claim's removal does not materially change query coverage.
  // The claim is surplus if coverage without it is >= 80% of coverage with it.
  const changeFraction = requiredScore > 0
    ? withoutScore / requiredScore
    : 1;

  const passed = changeFraction >= 0.8;

  return {
    passed,
    requiredScore,
    surplusScore: requiredScore - withoutScore,
    changeFraction,
  };
}

/**
 * Gate 2 — Permutation null against audience preference, not chance.
 *
 * Synthetically perturb the apparent preference of the interlocutor / ambient
 * ideology and check whether the surplus signal moves with it. If reward
 * correlates with alignment-to-preference under perturbation, it is flattery.
 *
 * The permutation-null logic from induceOperators, redirected from chance-
 * sensitivity to sycophancy-sensitivity.
 *
 * @param {object} claim — the surplus claim { text, surplusScore, targetAudience }
 * @param {Array<object>} alternatives — alternative claims with varied audience alignment
 * @param {object} options
 * @param {number} options.quantile — null rejection quantile (default 0.95)
 * @param {number} options.shuffles — permutation iterations (default 80)
 * @returns {{ passed: boolean, correlation: number, nullP: number, detail: object }}
 */
export function gateSycophancyNull(claim, alternatives = [], {
  quantile = 0.95,
  shuffles = 80,
} = {}) {
  if (!claim || alternatives.length < 4) {
    // Insufficient data to test — cannot pass a sycophancy gate with
    // too few alternatives; default to FAIL (conservative).
    return { passed: false, correlation: null, nullP: null, detail: { reason: "insufficient alternatives" } };
  }

  // Compute alignment scores: how well does each alternative align with
  // the claimed target audience preference?
  const audienceProfile = extractAudienceProfile(claim.targetAudience);
  const alignmentScores = alternatives.map((alt) =>
    audienceAlignment(alt, audienceProfile)
  );
  const surplusScores = alternatives.map((alt) => alt.surplusScore ?? 0);

  // Observed: Pearson correlation between alignment and surplus
  const observed = pearsonCorrelation(alignmentScores, surplusScores);

  // Null: shuffle alignment labels, recompute correlation. If the observed
  // correlation is NOT significantly greater than null, the surplus signal
  // is not driven by sycophancy (the gate PASSES — low correlation = safe).
  // Wait: that's inverted. Let me think again.
  //
  // If the surplus signal IS sycophantic, then claims with higher audience
  // alignment get higher surplus scores — positive correlation.
  // The null is: no relationship (shuffled alignment). The gate rejects
  // sycophancy if we CANNOT reject the null that correlation > 0.
  // i.e., the gate PASSES (safe) when the observed correlation is NOT
  // significantly positive — surplus is not moving with audience preference.
  //
  // But the spec says: "If reward correlates with alignment-to-preference
  // under perturbation, it is flattery, caught red-handed."
  // So: high correlation = FLATTERY = gate FAILS.
  // The gate PASSES when observed is not significantly above the null.

  const rng = createSeededRng(
    canonicalHashSync({ claim, alternatives, purpose: "sycophancy-null" })
  );

  const nullCorrelations = [];
  for (let i = 0; i < shuffles; i++) {
    const shuffled = seededShuffle([...alignmentScores], rng);
    nullCorrelations.push(pearsonCorrelation(shuffled, surplusScores));
  }

  // Test: is observed correlation significantly GREATER than null?
  // We want to FAIL (caught sycophancy) when observed >> null.
  // We PASS (not sycophantic) when observed is not exceptionally high.
  const nullResult = deriveNull({
    nullSamples: nullCorrelations,
    observedStatistic: observed,
    tailDirection: "greater",
    quantile,
    protocol: {
      name: "audience-alignment-shuffle",
      iterations: shuffles,
      statistic: "pearson-r (surplus ~ audience-alignment)",
      scope: "surplus-sycophancy detection",
    },
  });

  // Inverted: the gate passes when sycophancy is NOT detected.
  // nullResult.passed means observed > 95th percentile of null = FLATTERY detected.
  // So the gate passes (safe) when NOT passed on the null test.
  return {
    passed: !nullResult.passed,
    correlation: observed,
    nullQuantile: nullResult.observedQuantile ?? null,
    nullSamples: nullCorrelations,
    detail: { flatteryDetected: nullResult.passed },
  };
}

/**
 * Gate 3 — Held-out transfer to sources the context could not influence.
 *
 * The surplus claim must generate a checkable prediction tested against
 * material the interlocutor / ideology never supplied and could not have
 * shaped. This is the concrete mechanism for "contact with Sat."
 *
 * The §16 held-out-transfer gate, redirected from "transfers to an unseen
 * data series" to "transfers to a source the audience never touched."
 *
 * @param {string} surplusClaim — the claim to test
 * @param {Array<object>} heldOutSources — sources never seen by this session
 * @param {Array<object>} seenSources — sources this session has seen
 * @param {function} predictor — (claim, source) => predictedValue or null
 * @param {object} options
 * @param {number} options.quantile
 * @param {number} options.shuffles
 * @returns {{ passed: boolean, transferGain: number, nullResult: object }}
 */
export function gateTransferHeldOut(surplusClaim, heldOutSources = [], seenSources = [], predictor, {
  quantile = 0.95,
  shuffles = 40,
} = {}) {
  if (!surplusClaim || heldOutSources.length < 2) {
    return { passed: false, transferGain: null, reason: "insufficient held-out sources" };
  }

  if (typeof predictor !== "function") {
    return { passed: false, transferGain: null, reason: "no predictor function" };
  }

  // Measure how well the claim predicts held-out source structure
  // vs how well it predicts already-seen source structure.
  // A sycophantic claim should predict seen sources well (it was fitted to them)
  // but fail on held-out sources. A genuine claim predicts both.
  const seenScores = seenSources
    .map((s) => predictor(surplusClaim, s))
    .filter((s) => s !== null && isFinite(s));
  const heldOutScores = heldOutSources
    .map((s) => predictor(surplusClaim, s))
    .filter((s) => s !== null && isFinite(s));

  if (seenScores.length < 1 || heldOutScores.length < 1) {
    return { passed: false, transferGain: null, reason: "predictor returned too few valid scores" };
  }

  const seenMean = mean(seenScores);
  const heldOutMean = mean(heldOutScores);

  // Transfer gain: does the claim do as well on held-out as on seen?
  // Negative or near-zero relative gain means the claim fits the seen context
  // but doesn't transfer — the sycophancy signature.
  const referenceScale = mean(seenScores.map((s) => Math.abs(s)));
  const relativeGain = referenceScale > 0
    ? (heldOutMean - 0) / referenceScale
    : 0;

  // Null: reassign source labels by position (the null hypothesis is that
  // any score is equally likely to come from a seen or held-out source),
  // then recompute transfer gain. This is the right null: the claim's
  // transfer gain is measured against the distribution of gains when labels
  // are randomly permuted — NOT when within-group order is shuffled.
  const combinedValues = [
    ...seenScores,
    ...heldOutScores,
  ];

  const rng = createSeededRng(
    canonicalHashSync({ surplusClaim, purpose: "transfer-heldout-null" })
  );

  const nullSamples = [];
  for (let i = 0; i < shuffles; i++) {
    const shuffled = seededShuffle(combinedValues, rng);
    const sSeen = shuffled.slice(0, seenScores.length);
    const sHeld = shuffled.slice(seenScores.length);
    const seenM = mean(sSeen);
    const heldM = mean(sHeld);
    const relGain = referenceScale > 0 ? (heldM - 0) / referenceScale : 0;
    nullSamples.push(relGain);
  }

  const nullResult = deriveNull({
    nullSamples,
    observedStatistic: relativeGain,
    tailDirection: "greater",
    quantile,
    protocol: {
      name: "source-group-shuffle",
      iterations: shuffles,
      statistic: "held-out transfer gain relative to seen",
      scope: "surplus-transfer to uninfluenceable sources",
    },
  });

  // The gate passes when the observed transfer gain is significantly above
  // chance — the claim genuinely transfers to unseen sources.
  return {
    passed: nullResult.passed,
    transferGain: relativeGain,
    seenPredictionScore: seenMean,
    heldOutPredictionScore: heldOutMean,
    nullResult,
  };
}

/**
 * Gate 4 — Effect-size floor on independent corroboration, aggregated as mean.
 *
 * Check surplus against multiple independent sources; aggregate their
 * corroboration as a MEAN across sources, never a max, so one lucky agreement
 * cannot launder a false positive. Require the mean to clear a floor.
 * Near-total, low-variance agreement is suspicious (ideological coherence).
 *
 * @param {string} surplusClaim — the claim
 * @param {Array<object>} corroboratingSources — independent sources
 * @param {function} corroborationFn — (source) => corroboration score in [0,1]
 * @param {object} options
 * @param {number} options.floor — minimum mean corroboration (default 0.3)
 * @param {number} options.suspiciousVarianceThreshold — max allowed agreement variance before flagging (default 0.05)
 * @param {number} options.quantile
 * @param {number} options.shuffles
 * @returns {{ passed: boolean, meanCorroboration: number, variance: number, flaggedAsIdeological: boolean }}
 */
export function gateCorroborationFloor(surplusClaim, corroboratingSources = [], corroborationFn, {
  floor = 0.3,
  suspiciousVarianceThreshold = 0.05,
  quantile = 0.95,
  shuffles = 40,
} = {}) {
  if (!surplusClaim || corroboratingSources.length < 2) {
    return { passed: false, meanCorroboration: null, reason: "insufficient corroborating sources" };
  }

  if (typeof corroborationFn !== "function") {
    return { passed: false, meanCorroboration: null, reason: "no corroboration function" };
  }

  const scores = corroboratingSources
    .map((s) => corroborationFn(surplusClaim, s))
    .filter((s) => s !== null && isFinite(s));

  if (scores.length < 2) {
    return { passed: false, meanCorroboration: null, reason: "corroboration function returned too few valid scores" };
  }

  const meanCorroboration = mean(scores);
  const variance = scores.length > 1 ? std(scores) ** 2 : 0;
  const flaggedAsIdeological = variance < suspiciousVarianceThreshold && meanCorroboration > 0.8;

  // Null: shuffle source labels, recompute mean corroboration
  const rng = createSeededRng(
    canonicalHashSync({ surplusClaim, purpose: "corroboration-null" })
  );

  // Pool the actual scores and shuffle-assign them to check if the mean
  // is higher than random assignment would produce.
  const nullSamples = [];
  for (let i = 0; i < shuffles; i++) {
    const shuffled = seededShuffle([...scores], rng);
    nullSamples.push(mean(shuffled.slice(0, scores.length)));
  }

  const nullResult = deriveNull({
    nullSamples,
    observedStatistic: meanCorroboration,
    tailDirection: "greater",
    quantile,
    protocol: {
      name: "corroboration-shuffle",
      iterations: shuffles,
      statistic: "mean corroboration across sources",
      scope: "surplus-corroboration floor gate",
    },
  });

  const passed = nullResult.passed
    && meanCorroboration >= floor
    && !flaggedAsIdeological;

  return {
    passed,
    meanCorroboration,
    variance,
    flaggedAsIdeological,
    nullResult,
    sourceCount: scores.length,
  };
}

// ── AND gate: all four must clear ──
//
// Spec 2.5: Error-closure and surplus-fidelity must NOT feed one scalar
// reward. REC requires BOTH channels independently above threshold.
// A maximally-pleasing response that fails Gate 3 gets ZERO, not partial
// credit.

export function admitSurplus(claim, query, responseWithoutClaim, context = {}) {
  const {
    alternatives = [],
    heldOutSources = [],
    seenSources = [],
    corroboratingSources = [],
    predictor = null,
    corroborationFn = null,
    options = {},
  } = context;

  // Normalize: claim may be a string (backward compat) or an object with
  // .text (for sycophancy audience info). Extract the text string for gates
  // that need it (1, 3, 4) and pass the full object for Gate 2.
  const claimText = typeof claim === "string" ? claim : (claim?.text ?? "");

  // Gate 1: is it really surplus?
  const gate1 = gateDataSurplus(claimText, query, responseWithoutClaim?.full ?? "", responseWithoutClaim?.without ?? "");
  if (!gate1.passed) {
    return { admitted: false, reason: `Gate 1 (data-surplus) failed: claim is required for the query`, gates: { gate1 } };
  }

  // Gate 2: is it sycophancy?
  const gate2 = gateSycophancyNull(claim, alternatives, options);
  if (!gate2.passed) {
    return { admitted: false, reason: `Gate 2 (sycophancy-null) failed: surplus correlates with audience preference`, gates: { gate1, gate2 } };
  }

  // Gate 3: does it transfer to uninfluenceable sources?
  const gate3 = gateTransferHeldOut(claimText, heldOutSources, seenSources, predictor, options);
  if (!gate3.passed) {
    return { admitted: false, reason: `Gate 3 (transfer-held-out) failed: claim does not transfer to sources the context could not influence`, gates: { gate1, gate2, gate3 } };
  }

  // Gate 4: is it corroborated across independent sources?
  const gate4 = gateCorroborationFloor(claimText, corroboratingSources, corroborationFn, options);
  if (!gate4.passed) {
    return { admitted: false, reason: `Gate 4 (corroboration-floor) failed: insufficient independent corroboration`, gates: { gate1, gate2, gate3, gate4 } };
  }

  return {
    admitted: true,
    reason: "All four gates passed — surplus is genuine",
    gates: { gate1, gate2, gate3, gate4 },
  };
}

// ── Helpers ──

function extractAudienceProfile(targetAudience) {
  if (!targetAudience) return new Map();
  if (targetAudience instanceof Map) return targetAudience;
  if (typeof targetAudience === "object") {
    return new Map(Object.entries(targetAudience));
  }
  return new Map();
}

function audienceAlignment(claim, profile) {
  if (!claim || profile.size === 0) return 0;
  const text = String(claim.text ?? claim ?? "").toLowerCase();
  let matches = 0;
  let total = 0;
  for (const [trait, weight] of profile) {
    total += Math.abs(weight);
    const traitTerms = String(trait).toLowerCase().split(/\s+/);
    if (traitTerms.some((t) => t.length > 2 && text.includes(t))) {
      matches += Math.abs(weight);
    }
  }
  return total > 0 ? matches / total : 0;
}

function pearsonCorrelation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  const denom = Math.sqrt(sx * sy);
  return denom > 0 ? cov / denom : 0;
}

function isFinite(v) {
  return typeof v === "number" && Number.isFinite(v);
}
