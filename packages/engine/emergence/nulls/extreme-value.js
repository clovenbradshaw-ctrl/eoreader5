// Extreme-value Born null (ported from eoreader4.2: src/core/voidnull.js).
//
// Complementary to deriveNull in ./index.js: that function tests an observed
// statistic against an EXPLICIT null distribution the caller already
// generated (shuffle, resample). This module DERIVES a threshold from a
// background of scores directly — no perturbation step needed — using the
// extreme-value correction: the thing that fools a naive threshold is the
// LARGEST chance structure (max over N draws), not a typical draw.
//
// This is "the math that grows itself": DEF finds how many groups a sorted
// spectrum holds (the elbow), with abstention built in — a flat spectrum
// reports k=1 and abstains, a spectrum with a real gap reports the split.
// No hand-set threshold anywhere; everything derives from the data's own
// gap structure and its own background distribution.

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const std = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const median = (xs) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

// Inverse standard-normal CDF (Acklam's rational approximation).
const invNormCdf = (p) => {
  if (p <= 0) return -38;
  if (p >= 1) return 38;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= ph) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
};

// How many σ above the bulk mean the max of N chance draws reaches at the
// (1-α) level: P(max of N > μ+zσ) = α ⇒ Φ(z)^N = 1-α.
export const extremeValueZ = (N, alpha) => invNormCdf(Math.pow(1 - alpha, 1 / Math.max(2, N)));

export const MIN_SAMPLES = 4;
const GAP = 2.5;

/**
 * extremeValueNull(background, opts) -> number (threshold, or Infinity to abstain)
 *
 * Derive a threshold a proposed structure must EXCEED, from a background of
 * scores — no perturbation needed, the extreme-value correction accounts for
 * "max over many chance draws". Fits only the lower mode (the bulk) so a
 * handful of real structures already in the background don't raise the bar.
 *
 * @param {number[]} background - the also-ran scores (samples of what chance produces)
 * @param {object} [opts]
 * @param {'linear'|'log'} [opts.scale='linear'] - 'log' for heavy-tailed positive scores
 * @param {number} [opts.alpha=0.01] - tolerated false-positive rate
 * @param {number} [opts.N] - competition size for the extreme-value correction (defaults to sample count + 1)
 * @param {number} [opts.grain=0] - finest meaningful difference in the score's own units
 * @param {number|null} [opts.leaveOut=null] - a candidate score to exclude (leave-one-out)
 */
export const extremeValueNull = (background, { scale = 'linear', alpha = 0.01, N, grain = 0, leaveOut = null } = {}) => {
  let xs = background.filter((x) => Number.isFinite(x) && (scale !== 'log' || x > 0));
  if (leaveOut != null) {
    const i = xs.findIndex((x) => Math.abs(x - leaveOut) < 1e-12);
    if (i >= 0) xs.splice(i, 1);
  }
  if (xs.length < MIN_SAMPLES) return Infinity;

  const n = N || xs.length + 1;
  const z = extremeValueZ(n, alpha);
  const toW = scale === 'log' ? Math.log : (x) => x;
  const fromW = scale === 'log' ? Math.exp : (x) => x;
  const w = xs.map(toW).sort((a, b) => a - b);

  const m = median(w);
  const lowDev = w.filter((x) => x <= m).map((x) => m - x);
  const seedFloor = scale === 'log'
    ? (grain > 0 ? Math.log(1 + grain / Math.max(median(xs), grain)) : 1e-9)
    : grain;
  const seed = Math.max(mean(lowDev) * 1.2533, seedFloor, 1e-9);
  let cut = w.length;
  for (let i = Math.floor(w.length / 2); i < w.length - 1; i++) {
    if (w[i + 1] - w[i] > GAP * seed) { cut = i + 1; break; }
  }
  const bulkW = w.slice(0, Math.max(cut, Math.ceil(w.length / 2)));
  if (bulkW.length < MIN_SAMPLES) return Infinity;

  const bulkLin = bulkW.map(fromW);
  const projection = fromW(mean(bulkW) + z * std(bulkW));
  const grainFloor = mean(bulkLin) + z * grain;
  return Math.max(projection, grainFloor);
};

/**
 * DEF(values, opts) -> { k, gap, floor, abstain, idx }
 *
 * How many groups does a sorted-descending spectrum hold? The count is the
 * elbow: the largest gap between consecutive values, kept only if it beats
 * what the gaps' own background would produce by chance (extremeValueNull
 * on log-scale gap spacings). No significant gap -> flat spectrum -> k=1,
 * abstain. This is the same primitive whether the input is eigenvalues,
 * sorted log-energies (audio holon splitting), or any other ranked spectrum.
 *
 * @param {number[]} values - descending-sorted (or will be treated positionally)
 * @param {object} [opts]
 * @param {number} [opts.alpha=0.05]
 * @param {number} [opts.maxK=12]
 * @param {number} [opts.window=20] - how many leading values to weigh the elbow over
 */
export const DEF = (values, { alpha = 0.05, maxK = 12, window = 20 } = {}) => {
  const ev = (values || []).filter(Number.isFinite);
  if (ev.length < 2) return { k: ev.length, gap: 0, floor: null, abstain: true, idx: 0 };
  const lim = Math.min(ev.length, Math.max(2, window | 0));
  const gaps = [];
  for (let i = 1; i < lim; i++) gaps.push(ev[i - 1] - ev[i]);
  let kGap = 1, maxGap = -Infinity;
  for (let i = 0; i < gaps.length; i++) if (gaps[i] > maxGap) { maxGap = gaps[i]; kGap = i + 1; }
  const floor = extremeValueNull(gaps, { scale: 'log', alpha, N: gaps.length, leaveOut: maxGap });
  if (Number.isFinite(floor) && maxGap > floor) {
    return { k: Math.max(2, Math.min(maxK, kGap)), gap: maxGap, floor, abstain: false, idx: kGap };
  }
  return { k: 1, gap: Number.isFinite(maxGap) ? maxGap : 0, floor: Number.isFinite(floor) ? floor : null, abstain: true, idx: kGap };
};

/**
 * boundedNull(background, opts) -> number|fallback
 *
 * The bounded-signal complement to extremeValueNull: for scores that live in
 * a fixed range (a cosine in [-1,1], a fraction in [0,1]), the extreme-value
 * bound over-corrects (z·grain can exceed the ceiling). Reads the line as a
 * single decision (N=2) instead of a max-of-many.
 */
export const boundedNull = (background, { alpha = 0.05, leaveOut = null, grain = 0, ceiling = 1, fallback } = {}) => {
  const line = extremeValueNull(background, { scale: 'linear', alpha, N: 2, grain, leaveOut });
  return (Number.isFinite(line) && line < ceiling) ? line : fallback;
};
