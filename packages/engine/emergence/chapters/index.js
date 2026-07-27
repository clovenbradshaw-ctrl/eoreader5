// Chapter detection: DEF over a physics time series.
//
// The Potemkin analysis found a chapter boundary at 56:00 by running
// DEF over the frame-to-frame change in a physics observable. That
// pipeline lived in an inline eval script, which meant the result could
// not be reproduced, tested, or pointed at any other input. This is the
// same pipeline as a module.
//
// It is modality-blind by construction: it takes a scalar series and an
// axis, nothing else. The series can be
//
//   video   curl / divergence / current density per frame
//   audio   chroma flux or spectral-moment change per frame
//   text    EOT moment scores along the narrative axis
//
// and the boundaries mean the same thing in each case — the points
// where the series' own statistics say the regime changed, at a
// threshold derived from the series rather than set by hand.
//
// The primitive is the one the rest of the engine already uses:
// DEF finds the elbow in a sorted spectrum, with abstention built in.
// A series with no real structure reports no boundaries and says so,
// rather than returning the top-k largest changes as though they meant
// something.

import { DEF, extremeValueNull, boundedNull } from '../nulls/extreme-value.js';

// ── Change series ────────────────────────────────────────────────
//
// A boundary is where the series CHANGES, so the quantity DEF ranks is
// the change, not the level. `window` smooths first: a single noisy
// frame is not a chapter break, and at 2 fps a real structural boundary
// persists across several frames.
export function changeSeries(series, { window = 1 } = {}) {
  const clean = series.map((v) => (Number.isFinite(v) ? v : null));
  const smoothed = window > 1 ? movingMean(clean, window) : clean;
  const change = new Array(smoothed.length).fill(null);
  for (let i = 1; i < smoothed.length; i++) {
    const a = smoothed[i - 1];
    const b = smoothed[i];
    change[i] = a === null || b === null ? null : Math.abs(b - a);
  }
  return change;
}

function movingMean(series, window) {
  const half = Math.floor(window / 2);
  const out = new Array(series.length).fill(null);
  for (let i = 0; i < series.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(series.length - 1, i + half); j++) {
      if (series[j] === null) continue;
      sum += series[j];
      n++;
    }
    out[i] = n > 0 ? sum / n : null;
  }
  return out;
}

// ── Boundary detection ───────────────────────────────────────────
//
// `series`    the observable, one value per unit along the axis
// `positions` where each unit sits on the axis (seconds, chars, …).
//             Defaults to the index.
// `minGap`    minimum separation between boundaries, in AXIS units.
//             Two boundaries three frames apart are one boundary seen
//             twice; this is the only structural parameter, and it
//             belongs to the medium (a film cannot have two chapter
//             breaks two seconds apart), not to the data.
export function detectBoundaries(series, {
  positions = null,
  window = 1,
  alpha = 0.05,
  minGap = 0,
  maxBoundaries = 32,
} = {}) {
  const pos = positions ?? series.map((_, i) => i);
  const change = changeSeries(series, { window });

  // Candidates: every measurable change, ranked descending. DEF reads a
  // sorted spectrum, so this is the spectrum.
  const candidates = [];
  for (let i = 0; i < change.length; i++) {
    if (change[i] === null) continue;
    candidates.push({ index: i, position: pos[i], magnitude: change[i] });
  }
  if (candidates.length < 2) {
    return emptyResult('insufficient-data', candidates.length);
  }
  candidates.sort((a, b) => b.magnitude - a.magnitude);
  const spectrum = candidates.map((c) => c.magnitude);

  // ── The zero-variance background ──
  //
  // DEF derives its threshold from the background's own spread, so a
  // background with NO spread defeats it: if every non-structural
  // change is exactly equal, the gap spectrum is all zeros, the
  // extreme-value fit has nothing to fit, and DEF abstains — reporting
  // "no structure" for the cleanest structure there is.
  //
  // That abstention is right in general and wrong here. When the
  // background is literally constant there is no chance variation that
  // could produce a larger value, so anything strictly above it is
  // structure with no null model required. Real physics series always
  // carry noise and take the DEF path below; synthetic and heavily
  // quantised series land here.
  const floorValue = spectrum[spectrum.length - 1];
  let flatCount = 0;
  for (const v of spectrum) if (v === floorValue) flatCount++;
  if (flatCount * 2 >= spectrum.length && spectrum[0] > floorValue) {
    const above = candidates.filter((c) => c.magnitude > floorValue).slice(0, maxBoundaries);
    const kept = separate(above, minGap);
    return Object.freeze({
      boundaries: Object.freeze(kept.map((b) => Object.freeze({ ...b }))),
      abstained: false,
      reason: null,
      evidence: Object.freeze({
        k: above.length,
        elbowGap: spectrum[0] - floorValue,
        elbowFloor: floorValue,
        threshold: floorValue,
        candidates: candidates.length,
        strongest: candidates[0].magnitude,
        background: 'zero-variance',
      }),
    });
  }

  // DEF: how many groups does this spectrum hold? k = 1 with abstain
  // means the changes are one flat population — no chapter structure,
  // and the honest answer is none rather than the k largest.
  const def = DEF(spectrum, { alpha, maxK: maxBoundaries });

  // The threshold a change must exceed. DEF's elbow index gives the
  // count; the extreme-value line gives the level, corrected for the
  // fact that the largest of many chance changes is large by
  // construction.
  const floor = extremeValueNull(spectrum, {
    scale: 'log',
    alpha,
    N: spectrum.length,
    leaveOut: spectrum[0],
  });

  if (def.abstain) {
    return emptyResult('flat-spectrum', candidates.length, { def, floor });
  }

  const cut = Number.isFinite(floor)
    ? candidates.filter((c) => c.magnitude > floor)
    : candidates.slice(0, def.k);
  const selected = cut.slice(0, Math.min(def.k, maxBoundaries));

  const kept = separate(selected, minGap);

  return Object.freeze({
    boundaries: Object.freeze(kept.map((b) => Object.freeze({ ...b }))),
    abstained: false,
    reason: null,
    // The evidence, so a boundary claim can be audited rather than
    // taken on faith.
    evidence: Object.freeze({
      k: def.k,
      elbowGap: def.gap,
      elbowFloor: def.floor,
      threshold: Number.isFinite(floor) ? floor : null,
      candidates: candidates.length,
      strongest: candidates[0].magnitude,
    }),
  });
}

// Enforce minimum separation, keeping the stronger of any pair that is
// too close. Input is magnitude-ordered, so a greedy sweep keeps the
// strongest of each cluster; output is axis-ordered.
function separate(selected, minGap) {
  const kept = [];
  for (const c of selected) {
    if (kept.every((k) => Math.abs(k.position - c.position) >= minGap)) kept.push(c);
  }
  return kept.sort((a, b) => a.position - b.position);
}

function emptyResult(reason, candidates, extra = {}) {
  return Object.freeze({
    boundaries: Object.freeze([]),
    abstained: true,
    reason,
    evidence: Object.freeze({
      candidates,
      k: extra.def?.k ?? 1,
      elbowGap: extra.def?.gap ?? 0,
      elbowFloor: extra.def?.floor ?? null,
      threshold: Number.isFinite(extra.floor) ? extra.floor : null,
      strongest: null,
    }),
  });
}

// ── Chapters from boundaries ─────────────────────────────────────

export function segmentChapters(boundaries, { extent, start = 0 } = {}) {
  const cuts = [start, ...boundaries.map((b) => b.position), extent]
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const chapters = [];
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] <= cuts[i - 1]) continue;
    chapters.push(Object.freeze({
      index: chapters.length,
      start: cuts[i - 1],
      end: cuts[i],
      duration: cuts[i] - cuts[i - 1],
    }));
  }
  return Object.freeze(chapters);
}

// ── The pipeline ─────────────────────────────────────────────────
//
// Series in, chapters out, with the evidence for each boundary. This is
// the reusable form of the Potemkin chapter pipeline.
export function detectChapters(series, opts = {}) {
  const result = detectBoundaries(series, opts);
  const positions = opts.positions ?? series.map((_, i) => i);
  const extent = opts.extent ?? positions[positions.length - 1] ?? 0;
  return Object.freeze({
    ...result,
    chapters: segmentChapters(result.boundaries, { extent, start: opts.start ?? positions[0] ?? 0 }),
  });
}

// ── Agreement across observables ─────────────────────────────────
//
// One observable finding a boundary is a hypothesis. Several
// independent observables finding it at the same place is evidence —
// the same redundancy argument the cross-modal invariant cycle makes,
// applied within a modality.
//
// `seriesMap` is { name: series }; all must share an axis.
export function consensusBoundaries(seriesMap, { tolerance = null, minAgreement = 2, ...opts } = {}) {
  const names = Object.keys(seriesMap);
  const perObservable = {};
  const all = [];
  for (const name of names) {
    const r = detectBoundaries(seriesMap[name], opts);
    perObservable[name] = r;
    for (const b of r.boundaries) all.push({ ...b, observable: name });
  }
  if (all.length === 0) {
    return Object.freeze({ boundaries: Object.freeze([]), perObservable: Object.freeze(perObservable), tolerance: null });
  }

  // How close is "the same boundary"? Derived from the observed
  // clustering rather than assumed: boundedNull over the gaps between
  // consecutive boundary positions. Abstention falls back to the
  // caller's minGap, and failing that to zero — exact agreement only.
  all.sort((a, b) => a.position - b.position);
  let band = tolerance;
  if (band === null) {
    const gaps = [];
    for (let i = 1; i < all.length; i++) gaps.push(all[i].position - all[i - 1].position);
    band = gaps.length ? boundedNull(gaps, { ceiling: Infinity, fallback: null }) : null;
    if (band === null) band = opts.minGap ?? 0;
  }

  // Cluster boundaries that fall within the band of each other.
  const clusters = [];
  for (const b of all) {
    const last = clusters[clusters.length - 1];
    if (last && b.position - last.positions[last.positions.length - 1] <= band) {
      last.positions.push(b.position);
      last.observables.add(b.observable);
      last.magnitude += b.magnitude;
    } else {
      clusters.push({ positions: [b.position], observables: new Set([b.observable]), magnitude: b.magnitude });
    }
  }

  const boundaries = clusters
    .filter((c) => c.observables.size >= minAgreement)
    .map((c) => Object.freeze({
      position: c.positions.reduce((a, v) => a + v, 0) / c.positions.length,
      observables: Object.freeze([...c.observables]),
      agreement: c.observables.size / names.length,
      magnitude: c.magnitude,
    }));

  return Object.freeze({
    boundaries: Object.freeze(boundaries),
    perObservable: Object.freeze(perObservable),
    tolerance: band,
  });
}
