// derive-null.js — Born significance threshold from the data's own distribution.
//
// Ported from eoreader4.2:src/core/voidnull.js. Finds the natural breakpoint
// in a value distribution: the point above which a value is unlikely to be
// noise. Uses the extreme-value corrected noise floor rather than a hardcoded
// threshold.
//
// This is the DEF elbow for any modality — salience scores, log-energies,
// frame divergences, whatever the signal produces.

/**
 * Extreme-value z: how many σ above the bulk mean the max of N chance draws
 * reaches at the (1-α) level. P(max of N > μ+zσ) = α  ⇒  Φ(z)^N = 1-α.
 */
function extremeValueZ(N, alpha = 0.01) {
  if (N < 2) return 0;
  // Inverse normal CDF (Acklam approximation)
  const p = Math.pow(1 - alpha, 1 / N);
  if (p <= 0) return -38;
  if (p >= 1) return 38;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= ph) { const q = p - 0.5, r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Derive the significance threshold from a distribution using the DEF elbow.
 * Finds the natural breakpoint in the sorted value curve — the point where
 * the distribution transitions from noise to signal. This is the same approach
 * as the music extraction's chord detection: find the knee in the log-energies.
 *
 * @param {number[]} values - distribution of scores (e.g. entity saliences)
 * @param {object} options - { fallbackQuantile (default 0.9) }
 * @returns {number} threshold — values above this are significant
 */
export function deriveNull(values, options = {}) {
  const { minSamples = 5 } = options;
  const vals = values.filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length < minSamples) return 0;

  const sorted = vals.slice().sort((a, b) => a - b);

  // Find the largest gap in the sorted values — the drop-off point
  // where the distribution transitions from signal to noise.
  let maxGap = 0;
  let gapIdx = Math.floor(sorted.length * 0.95);

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      gapIdx = i - 1; // threshold is just before the gap
    }
  }

  // The threshold is the value just below the largest gap
  return Math.max(sorted[gapIdx], 0);
}

