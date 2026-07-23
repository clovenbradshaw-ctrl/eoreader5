// Proper scoring rules (spec "EO Emergent Mathematics for Predictive
// Competency" section 13.1). Scoring measures loss under a *committed*
// predictive distribution; it never decides promotion and never reads
// ambient time or randomness. Every function here is pure and deterministic.
//
// A predictive output is a tagged union so the same reveal-and-score path
// works across formal systems:
//
//   { kind: "point",       value }                     — a bare point estimate
//   { kind: "gaussian",    mean, sd }                  — a continuous density
//   { kind: "categorical", probs: { label: p, ... } }  — a finite event mass
//   { kind: "quantiles",   levels: [{ tau, value }] }  — predictive quantiles
//   { kind: "samples",     values: [n, ...] }          — an empirical ensemble
//
// Point predictions are permitted (section 13.1) but a probabilistic output
// is preferred; when a proper rule is unavailable for the emitted kind the
// returned record sets `proper: false` and records the limitation so honesty
// invariant 3.5 / non-goal "forecast into explanation" is preserved.

const LN = Math.log;
const TWO_PI = Math.PI * 2;

function assertFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`scoring: ${label} must be a finite number`);
  }
}

function assertDistribution(dist) {
  if (!dist || typeof dist !== "object" || Array.isArray(dist)) {
    throw new TypeError("scoring: predictive output must be an object");
  }
  if (typeof dist.kind !== "string") throw new TypeError("scoring: predictive output needs a kind");
}

/** Standard normal pdf. */
function normalPdf(y, mean, sd) {
  const z = (y - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(TWO_PI));
}

/** Standard normal cdf via erf (Abramowitz & Stegun 7.1.26 approximation). */
function normalCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  const cdf = 0.5 * (1 + Math.sign(x) * y);
  return cdf;
}

/** Standard normal pdf at x (mean 0, sd 1). */
function stdNormalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(TWO_PI);
}

function frozen(record) {
  return Object.freeze(record);
}

/**
 * Logarithmic loss: −log p(observed). The default proper score for
 * categorical and density predictions (section 13.1). For a gaussian it is
 * the negative log density; for a categorical it is −log of the mass on the
 * observed label. Lower is better.
 */
export function logLoss(dist, observed) {
  assertDistribution(dist);
  if (dist.kind === "gaussian") {
    assertFiniteNumber(dist.mean, "gaussian.mean");
    assertFiniteNumber(dist.sd, "gaussian.sd");
    if (dist.sd <= 0) throw new RangeError("scoring: gaussian.sd must be positive");
    assertFiniteNumber(observed, "observed");
    const density = normalPdf(observed, dist.mean, dist.sd);
    // Guard against log(0) underflow: the loss is large but finite.
    const loss = density > 0 ? -LN(density) : -LN(Number.MIN_VALUE);
    return frozen({ rule: "log-loss", loss, proper: true, kind: dist.kind });
  }
  if (dist.kind === "categorical") {
    const p = dist.probs?.[observed];
    if (typeof p !== "number" || p < 0) {
      throw new TypeError(`scoring: categorical output has no probability for observed label ${JSON.stringify(observed)}`);
    }
    const loss = p > 0 ? -LN(p) : -LN(Number.MIN_VALUE);
    return frozen({ rule: "log-loss", loss, proper: true, kind: dist.kind });
  }
  return frozen({
    rule: "log-loss",
    loss: null,
    proper: false,
    kind: dist.kind,
    note: `log-loss undefined for a ${dist.kind} output; emit a gaussian or categorical distribution`,
  });
}

/**
 * Brier score for a finite categorical event (section 13.1):
 * Σ_k (p_k − 1[observed = k])². Lower is better; proper.
 */
export function brierScore(dist, observed) {
  assertDistribution(dist);
  if (dist.kind !== "categorical") {
    return frozen({ rule: "brier", loss: null, proper: false, kind: dist.kind, note: "brier requires a categorical output" });
  }
  const probs = dist.probs ?? {};
  let loss = 0;
  for (const label of Object.keys(probs)) {
    const p = probs[label];
    assertFiniteNumber(p, `probs.${label}`);
    const indicator = label === observed ? 1 : 0;
    loss += (p - indicator) ** 2;
  }
  // A label that was observed but carried no probability still contributes (0 − 1)².
  if (!(observed in probs)) loss += 1;
  return frozen({ rule: "brier", loss, proper: true, kind: dist.kind });
}

/**
 * Continuous Ranked Probability Score (section 13.1). Closed form for a
 * gaussian predictive distribution; empirical estimator for an ensemble of
 * samples. Lower is better; proper.
 */
export function crps(dist, observed) {
  assertDistribution(dist);
  assertFiniteNumber(observed, "observed");
  if (dist.kind === "gaussian") {
    assertFiniteNumber(dist.mean, "gaussian.mean");
    assertFiniteNumber(dist.sd, "gaussian.sd");
    if (dist.sd <= 0) throw new RangeError("scoring: gaussian.sd must be positive");
    const z = (observed - dist.mean) / dist.sd;
    const loss = dist.sd * (z * (2 * normalCdf(z) - 1) + 2 * stdNormalPdf(z) - 1 / Math.sqrt(Math.PI));
    return frozen({ rule: "crps", loss, proper: true, kind: dist.kind });
  }
  if (dist.kind === "samples") {
    const xs = dist.values;
    if (!Array.isArray(xs) || xs.length === 0) throw new TypeError("scoring: samples.values must be non-empty");
    // CRPS = E|X − y| − ½ E|X − X'|, estimated over the ensemble.
    let term1 = 0;
    for (const x of xs) {
      assertFiniteNumber(x, "samples.value");
      term1 += Math.abs(x - observed);
    }
    term1 /= xs.length;
    let term2 = 0;
    for (const a of xs) for (const b of xs) term2 += Math.abs(a - b);
    term2 /= 2 * xs.length * xs.length;
    return frozen({ rule: "crps", loss: term1 - term2, proper: true, kind: dist.kind });
  }
  return frozen({ rule: "crps", loss: null, proper: false, kind: dist.kind, note: "crps requires a gaussian or samples output" });
}

/**
 * Pinball (quantile) loss (section 13.1), summed over the emitted quantile
 * levels. Lower is better; proper for the declared quantiles.
 */
export function pinballLoss(dist, observed) {
  assertDistribution(dist);
  assertFiniteNumber(observed, "observed");
  if (dist.kind !== "quantiles" || !Array.isArray(dist.levels) || dist.levels.length === 0) {
    return frozen({ rule: "pinball", loss: null, proper: false, kind: dist.kind, note: "pinball requires a quantiles output" });
  }
  let loss = 0;
  for (const { tau, value } of dist.levels) {
    assertFiniteNumber(tau, "quantile tau");
    assertFiniteNumber(value, "quantile value");
    if (tau <= 0 || tau >= 1) throw new RangeError("scoring: quantile tau must be in (0, 1)");
    const diff = observed - value;
    loss += diff >= 0 ? tau * diff : (tau - 1) * diff;
  }
  return frozen({ rule: "pinball", loss: loss / dist.levels.length, proper: true, kind: dist.kind });
}

/** Squared error for a point prediction (section 13.1). Not a proper score for a distribution. */
export function squaredError(dist, observed) {
  assertDistribution(dist);
  assertFiniteNumber(observed, "observed");
  const point = pointOf(dist);
  return frozen({ rule: "squared-error", loss: (point - observed) ** 2, proper: false, kind: dist.kind });
}

/** Absolute error for a point prediction (section 13.1). */
export function absoluteError(dist, observed) {
  assertDistribution(dist);
  assertFiniteNumber(observed, "observed");
  const point = pointOf(dist);
  return frozen({ rule: "absolute-error", loss: Math.abs(point - observed), proper: false, kind: dist.kind });
}

/** Collapse any distribution to a representative point (its mean/central value). */
function pointOf(dist) {
  switch (dist.kind) {
    case "point":
      assertFiniteNumber(dist.value, "point.value");
      return dist.value;
    case "gaussian":
      assertFiniteNumber(dist.mean, "gaussian.mean");
      return dist.mean;
    case "samples": {
      if (!Array.isArray(dist.values) || dist.values.length === 0) throw new TypeError("scoring: samples.values must be non-empty");
      return dist.values.reduce((a, b) => a + b, 0) / dist.values.length;
    }
    case "quantiles": {
      const mid = dist.levels?.find((l) => l.tau === 0.5) ?? dist.levels?.[Math.floor((dist.levels.length - 1) / 2)];
      if (!mid) throw new TypeError("scoring: quantiles output has no levels");
      return mid.value;
    }
    default:
      throw new TypeError(`scoring: cannot take a point of a ${dist.kind} output`);
  }
}

export const SCORING_RULES = Object.freeze({
  "log-loss": logLoss,
  brier: brierScore,
  crps,
  pinball: pinballLoss,
  "squared-error": squaredError,
  "absolute-error": absoluteError,
});

/**
 * Score `observed` under `dist` using a named rule. Returns a frozen record
 * { rule, loss, proper, kind, note? }. `loss` is null when the rule does not
 * apply to the emitted kind — the caller SHOULD fall back to a point loss and
 * record the limitation rather than silently treating an improper score as a
 * proper one (section 13.1).
 */
export function score(dist, observed, { rule = "log-loss" } = {}) {
  const fn = SCORING_RULES[rule];
  if (!fn) throw new TypeError(`scoring: unknown scoring rule ${rule}`);
  return fn(dist, observed);
}
