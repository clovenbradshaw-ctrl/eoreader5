// Holon self-teaching: patterns found at higher levels become templates
// that lower-level holons use to find similar patterns elsewhere.
// Cross-modal: same centroid-trajectory approach works for film cut
// acceleration, music fugue subject recurrence, and text section pacing.

import { FRAME_WIDTH, FRAME_HEIGHT, BLOCK_SIZE } from './reading.js';

// ── Acceleration template ────────────────────────────────────────
// A sequence of values (shot lengths, inter-cut intervals) that shows
// a characteristic pattern. The Odessa Steps acceleration is:
// long → medium → short → very short → climax.
//
// We store the template as a normalized centroid trajectory (same
// approach as the fugue subject tracking in emergence/trajectory/).

export class AccelTemplate {
  constructor(values, label = '') {
    this.label = label;
    // Store as normalized trajectory (mean-subtracted, unit-variance)
    const n = values.length;
    this.raw = values;
    this.length = n;
    const mean = values.reduce((a, v) => a + v, 0) / n;
    const norm = values.map(v => v - mean);
    const std = Math.sqrt(norm.reduce((a, v) => a + v * v, 0) / n) || 1;
    this.trajectory = norm.map(v => v / std);
    // Compression ratio: how much shorter does the sequence get?
    // > 1 means accelerating (getting shorter)
    this.compression = values.length > 1 ? values[0] / values[values.length - 1] : 1;
    // Acceleration strength: look at the RATIO between consecutive values
    const ratios = [];
    for (let i = 1; i < values.length; i++) {
      ratios.push(values[i - 1] / Math.max(values[i], 0.001));
    }
    this.ratios = ratios;
    this.meanRatio = ratios.reduce((a, v) => a + v, 0) / ratios.length;
    // Monotonicity: are values consistently getting shorter?
    this.monotonicity = values.length > 2
      ? values.slice(0, -1).filter((v, i) => v > values[i + 1]).length / (values.length - 1)
      : 0;
  }

  // Match this template against a sequence of candidate values
  // Returns correlation (0-1) and whether it's significant
  match(candidate) {
    if (candidate.length < 3) return { corr: 0, significant: false };
    const n = Math.min(this.length, candidate.length);
    const ref = this.trajectory.slice(0, n);
    const cand = candidate.slice(0, n);
    const cm = cand.reduce((a, v) => a + v, 0) / n;
    const cn = cand.map(v => v - cm);
    const cs = Math.sqrt(cn.reduce((a, v) => a + v * v, 0) / n) || 1;
    const cu = cn.map(v => v / cs);
    let corr = 0;
    for (let i = 0; i < n; i++) corr += ref[i] * cu[i];
    corr = Math.max(0, corr / n); // 0-1, higher = better match

    return {
      corr,
      significant: corr > 0.6 && this.monotonicity > 0.4,
      matchedLength: n,
    };
  }
}

// ── Structural vocabulary ─────────────────────────────────────────
// Stores learned templates across films/modalities, so the system
// can recognize "this looks like the Odessa Steps acceleration" or
// "this shot pattern resembles a fugue exposition."

export class StructuralVocabulary {
  constructor() {
    this.templates = [];
    this.filmStats = { films: 0, totalShots: 0, meanShotLength: 0, meanCutRate: 0 };
  }

  // Register a learned template
  learn(label, values) {
    const t = new AccelTemplate(values, label);
    this.templates.push(t);
    return t;
  }

  // Find known templates that match a candidate sequence
  recognize(candidate) {
    return this.templates
      .map(t => ({ template: t, ...t.match(candidate) }))
      .filter(r => r.significant)
      .sort((a, b) => b.corr - a.corr);
  }

  // Add film-level statistics for cross-film prior
  recordFilm(shotCount, meanShotLength, totalDuration) {
    const prev = this.filmStats;
    const total = prev.films * prev.totalShots + shotCount;
    this.filmStats = {
      films: prev.films + 1,
      totalShots: total,
      meanShotLength: (prev.meanShotLength * prev.films + meanShotLength) / (prev.films + 1),
      meanCutRate: total / (totalDuration / 60),
    };
  }

  // Get a prior for expected shot length (from learned film statistics)
  getShotLengthPrior() {
    if (this.filmStats.films === 0) return null;
    return {
      expected: this.filmStats.meanShotLength,
      expectedRange: this.filmStats.meanShotLength * 0.5,
    };
  }

  // The cross-modal bridge: templates can be matched against ANY
  // time series — film cut intervals, music inter-onset intervals,
  // text paragraph lengths. Same centroid trajectory math.
  getCrossModalBridge() {
    return this.templates.map(t => ({
      label: t.label,
      modality: 'film',  // could also be 'music', 'text'
      shape: 'acceleration',
      compression: t.compression,
      monotonicity: t.monotonicity,
    }));
  }
}

// ── Match acceleration across any time series ────────────────────
// This is the same centroid-trajectory matching used for the
// fugue subject, applied to film cut intervals. Cross-modal bridge.

export function findAccelerationPattern(values, { minLength = 5, maxLength = 30 } = {}) {
  // Sliding window: for each possible sub-sequence, check if it
  // shows the characteristic acceleration shape
  const candidates = [];
  for (let len = minLength; len <= Math.min(maxLength, values.length); len++) {
    for (let start = 0; start + len <= values.length; start++) {
      const window = values.slice(start, start + len);
      const template = new AccelTemplate(window);
      // An acceleration pattern has:
      // - High monotonicity (consistently getting shorter)
      // - High compression ratio (start >> end)
      // - Positive mean ratio
      if (template.monotonicity > 0.5 && template.compression > 1.2) {
        candidates.push({
          start, length: len,
          compression: template.compression,
          monotonicity: template.monotonicity,
          strength: template.meanRatio,
          template,
        });
      }
    }
  }
  // Return the strongest pattern
  candidates.sort((a, b) => b.strength - a.strength);
  return candidates.slice(0, 5);
}

// ── Narrative arc detection ──────────────────────────────────────
// A film has a characteristic narrative arc:
// Exposition → Rising action → Climax → Falling action → Resolution
// This corresponds to cut rate: slow → accelerating → fastest → decelerating → slow
// Detect this by finding the acceleration/deceleration inflection point.

export function detectNarrativeArc(cutIntervals) {
  const n = cutIntervals.length;
  if (n < 20) return null;

  // Smoothed cut rate
  const windowSize = Math.max(3, Math.floor(n / 20));
  const smoothed = [];
  for (let i = 0; i < n - windowSize; i++) {
    const avg = cutIntervals.slice(i, i + windowSize).reduce((a, v) => a + v, 0) / windowSize;
    smoothed.push(avg);
  }

  // Find the acceleration inflection point
  const diffs = [];
  for (let i = 1; i < smoothed.length; i++) {
    diffs.push(smoothed[i - 1] - smoothed[i]); // positive = accelerating
  }

  // Find where acceleration peaks (the climax)
  let climaxIdx = 0;
  let maxAccel = 0;
  for (let i = 1; i < diffs.length - 2; i++) {
    // The climax is where acceleration turns to deceleration
    const before = diffs.slice(i - 2, i).reduce((a, v) => a + v, 0) / 2;
    const after = diffs.slice(i, i + 2).reduce((a, v) => a + v, 0) / 2;
    if (before > 0 && after < 0 && before - after > maxAccel) {
      maxAccel = before - after;
      climaxIdx = i;
    }
  }

  if (climaxIdx === 0) return null;

  const totalDuration = cutIntervals.reduce((a, v) => a + v, 0);
  return {
    expositionEnd: 0, // start
    climaxPosition: climaxIdx / n, // 0-1 where climax falls
    climaxTime: cutIntervals.slice(0, climaxIdx).reduce((a, v) => a + v, 0),
    hasClimax: maxAccel > 0.1,
    arcType: climaxIdx < n * 0.33 ? 'early-climax' :
             climaxIdx < n * 0.66 ? 'mid-climax' :
             'late-climax',
    accelerationStrength: maxAccel,
  };
}
