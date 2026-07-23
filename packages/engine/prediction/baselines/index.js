// Minimum baselines for a numeric prediction task (spec section 13.4 and the
// Section 29 vertical slice). Every task SHALL include appropriate simple
// baselines so a complex program is never called "competent" merely for
// beating a deliberately weak one (section 13.4). A baseline is a pure
// function from the available history to a committed predictive distribution.
//
// Baselines emit a gaussian whose spread is *derived from the data* — never a
// hand-set constant — so log-loss and CRPS are well defined. When the derived
// spread is not a positive finite number (e.g. too little history, a constant
// series) the baseline honestly degrades to a bare point prediction.

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (Bessel-corrected). Returns 0 for <2 points or a constant series. */
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** First differences of a series: [x1-x0, x2-x1, ...]. */
function diffs(xs) {
  const out = [];
  for (let i = 1; i < xs.length; i += 1) out.push(xs[i] - xs[i - 1]);
  return out;
}

/**
 * Wrap a central value and a data-derived spread into a predictive output.
 * Falls back to a point prediction when the spread is not usable, so the
 * baseline never invents a probability it cannot justify.
 */
function gaussianOrPoint(centralValue, spread) {
  if (Number.isFinite(spread) && spread > 0) {
    return Object.freeze({ kind: "gaussian", mean: centralValue, sd: spread });
  }
  return Object.freeze({ kind: "point", value: centralValue });
}

/**
 * Last-value persistence: predict the most recent observation. Spread is the
 * stdev of first differences (the natural scale of one-step persistence error).
 */
export function lastValue(history) {
  requireHistory(history, "last-value");
  const last = history[history.length - 1];
  return gaussianOrPoint(last, stdev(diffs(history)));
}

/**
 * Random walk without drift: identical central value to persistence but the
 * spread grows with the diffusion of the increments. For one-step-ahead this
 * coincides with last-value persistence; kept distinct for auditability and
 * so multi-step callers can widen it.
 */
export function randomWalk(history, { steps = 1 } = {}) {
  requireHistory(history, "random-walk");
  const last = history[history.length - 1];
  const stepSd = stdev(diffs(history));
  return gaussianOrPoint(last, stepSd * Math.sqrt(Math.max(1, steps)));
}

/** Global mean: predict the mean of all history seen so far. Spread is the series stdev. */
export function globalMean(history) {
  requireHistory(history, "global-mean");
  return gaussianOrPoint(mean(history), stdev(history));
}

/** Moving mean over the last `window` observations. Spread from the window. */
export function movingMean(history, { window = 3 } = {}) {
  requireHistory(history, "moving-mean");
  const w = Math.max(1, Math.min(window, history.length));
  const tail = history.slice(history.length - w);
  return gaussianOrPoint(mean(tail), stdev(tail));
}

/**
 * Seasonal persistence: predict the value one period back. Spread from the
 * seasonal residuals x_t − x_{t-period}. Requires history longer than `period`.
 */
export function seasonalPersistence(history, { period }) {
  requireHistory(history, "seasonal-persistence");
  if (!Number.isInteger(period) || period < 1) throw new TypeError("seasonal-persistence: period must be a positive integer");
  if (history.length <= period) {
    // Not enough history to look a full period back: degrade to last-value.
    return lastValue(history);
  }
  const central = history[history.length - period];
  const residuals = [];
  for (let i = period; i < history.length; i += 1) residuals.push(history[i] - history[i - period]);
  return gaussianOrPoint(central, stdev(residuals));
}

function requireHistory(history, name) {
  if (!Array.isArray(history) || history.length === 0) {
    throw new TypeError(`${name}: history must be a non-empty array of numbers`);
  }
  for (const x of history) {
    if (typeof x !== "number" || !Number.isFinite(x)) throw new TypeError(`${name}: history must contain only finite numbers`);
  }
}

/**
 * The default baseline suite for a one-step numeric-series task. Each entry is
 * { id, predict } where predict(history) -> predictive output. Callers commit
 * every baseline's prediction under the same horizon as the candidate so the
 * competency comparison is honest (invariant 7.5, section 13.4).
 */
export function defaultNumericBaselines({ window = 3, seasonalPeriod } = {}) {
  const suite = [
    { id: "baseline:last-value", predict: (h) => lastValue(h) },
    { id: "baseline:global-mean", predict: (h) => globalMean(h) },
    { id: `baseline:moving-mean-${window}`, predict: (h) => movingMean(h, { window }) },
    { id: "baseline:random-walk", predict: (h) => randomWalk(h) },
  ];
  if (Number.isInteger(seasonalPeriod) && seasonalPeriod >= 1) {
    suite.push({
      id: `baseline:seasonal-${seasonalPeriod}`,
      predict: (h) => seasonalPersistence(h, { period: seasonalPeriod }),
    });
  }
  return suite;
}
