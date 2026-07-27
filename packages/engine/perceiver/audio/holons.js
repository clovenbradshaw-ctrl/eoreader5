// Nested signal/noise holon separation (ported from eoreader4.2:
// src/organs/in/acoustic.js). This is structure that GROWS ITSELF: no fixed
// loudness threshold anywhere. The whole clip is a holon; runs above its own
// derived floor are SIGNAL holons, runs below are NOISE holons; inside each
// signal holon, a higher LOCAL floor (re-derived from that holon's own
// energy distribution) finds louder bursts nested within — recursively, a
// few levels deep. The threshold at every level is DEF's null-gated gap
// elbow: the boundary between the loud tier and the quiet tier is the
// largest gap in sorted log-energies, kept only if it beats what the OTHER
// gaps in this window would produce by chance.
//
// This is the "math that grows itself" — no percentile, no fixed dB cutoff.
// A window that is genuinely flat (true silence/noise, nothing to split)
// abstains and stays a single leaf.

import { DEF, extremeValueNull } from '../../emergence/nulls/extreme-value.js';

const DB_FLOOR = -120;
export const toDb = (lin) => (lin > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(lin)) : DB_FLOOR);

// Per-frame RMS energy — the raw material of the separation. Everything
// below reads this track, never the samples again.
export const frameEnergies = (mono, sampleRate, frameMs = 20) => {
  const n = mono?.length || 0;
  const frameLen = Math.max(1, Math.round((frameMs / 1000) * sampleRate));
  const frames = Math.max(1, Math.ceil(n / frameLen));
  const rms = new Float64Array(frames);
  const times = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = f * frameLen, b = Math.min(n, a + frameLen);
    let sq = 0;
    for (let i = a; i < b; i++) sq += mono[i] * mono[i];
    rms[f] = b > a ? Math.sqrt(sq / (b - a)) : 0;
    times[f] = a / sampleRate;
  }
  return { rms, times, frameDur: frameLen / sampleRate, frameLen };
};

// Merge a per-frame signal/noise flag array into contiguous [start,end] runs.
const runsFromFlags = (flags, energies, times, frameDur) => {
  const runs = [];
  let i = 0;
  while (i < flags.length) {
    let j = i, sq = 0, cnt = 0, mx = 0;
    while (j < flags.length && flags[j] === flags[i]) {
      const e = energies[j]; sq += e * e; mx = Math.max(mx, e); cnt++; j++;
    }
    const start = times[i];
    const end = (j < times.length ? times[j] : times[times.length - 1] + frameDur);
    runs.push({ kind: flags[i] ? 'signal' : 'noise', start, end, dur: end - start, rms: cnt ? Math.sqrt(sq / cnt) : 0, peak: mx });
    i = j;
  }
  return runs;
};

// The threshold that separates signal from noise INSIDE a window: a
// null-gated elbow pointed at the window's own sorted log-energies.
//
// DEF's global elbow (largest gap anywhere in the spectrum) is tuned for
// "a few dominant components over a flat tail" (eigenvalue spectra, speech
// on/off patterns). Continuous musical dynamics are more bimodal — a loud
// tier and a quiet tier each comprising a substantial share of the window —
// so the genuine tier boundary sits somewhere in the MIDDLE of the sorted
// spectrum, not at the extreme edge where the single largest gap of the
// FULL range tends to land (an isolated attack transient, not the tier
// boundary). Scoping the elbow search to the middle band encodes exactly
// that expectation, while still using the same null-gate machinery (a
// candidate gap must beat what the OTHER gaps in this window would produce
// by chance) — the threshold still grows from the window's own statistics,
// just searched where a real two-tier split is expected to live.
const windowThreshold = (eWin, alpha, absFloorLin) => {
  const logE = eWin.map((e) => Math.log(Math.max(e, absFloorLin)));
  if (logE.length < 2) return Infinity;
  const sorted = logE.slice().sort((a, b) => b - a); // descending, log-space
  const n = sorted.length;

  const gaps = [];
  for (let i = 1; i < n; i++) gaps.push(sorted[i - 1] - sorted[i]);

  // Search the middle band (15th-85th percentile of position) for the
  // candidate split; fall back to the full range if the window is too
  // small to have a meaningful middle band.
  const loIdx = Math.max(1, Math.floor(n * 0.15));
  const hiIdx = Math.min(gaps.length, Math.ceil(n * 0.85));
  const bandStart = hiIdx > loIdx ? loIdx : 1;
  const bandEnd = hiIdx > loIdx ? hiIdx : gaps.length;

  let bestI = -1, bestGap = -Infinity;
  for (let i = bandStart - 1; i < bandEnd; i++) {
    if (gaps[i] > bestGap) { bestGap = gaps[i]; bestI = i; }
  }
  if (bestI < 0) return Infinity;
  const idx = bestI + 1; // index into `sorted` where the split falls (sorted[idx-1] | sorted[idx])

  // The null floor still comes from ALL gaps in the window (the background
  // of "what a chance gap looks like here"), not just the searched band.
  const floor = extremeValueNull(gaps, { scale: 'log', alpha, N: gaps.length, leaveOut: bestGap });
  if (Number.isFinite(floor) && bestGap > floor) {
    return Math.exp((sorted[idx - 1] + sorted[idx]) / 2);
  }
  // Many-gap bound abstained; retry as a single N=2 decision.
  const floor2 = extremeValueNull(gaps, { scale: 'log', alpha, N: 2, leaveOut: bestGap });
  if (Number.isFinite(floor2) && bestGap > floor2) {
    return Math.exp((sorted[idx - 1] + sorted[idx]) / 2);
  }
  return Infinity;
};

// Fold runs shorter than `minDur` into the neighbour they most resemble, so
// the segmentation reads phrases, not frame flicker.
const coalesce = (runs, minDur) => {
  if (runs.length <= 1) return runs;
  let cur = runs.map((r) => ({ ...r }));
  let changed = true;
  while (changed && cur.length > 1) {
    changed = false;
    let idx = -1;
    for (let i = 0; i < cur.length; i++) if (cur[i].dur < minDur) { idx = i; break; }
    if (idx < 0) break;
    const left = cur[idx - 1], right = cur[idx + 1];
    const into = (!right || (left && left.dur >= right.dur)) ? left : right;
    if (!into) break;
    const merged = mergeRun(into, cur[idx]);
    if (into === left) cur.splice(idx - 1, 2, merged);
    else cur.splice(idx, 2, merged);
    changed = true;
  }
  return cur;
};

const mergeRun = (a, b) => {
  const start = Math.min(a.start, b.start), end = Math.max(a.end, b.end);
  const dur = end - start;
  const rms = dur > 0 ? Math.sqrt((a.rms * a.rms * a.dur + b.rms * b.rms * b.dur) / dur) : Math.max(a.rms, b.rms);
  const kind = a.dur >= b.dur ? a.kind : b.kind;
  return { kind, start, end, dur, rms, peak: Math.max(a.peak || 0, b.peak || 0) };
};

/**
 * separateHolons(mono, sampleRate, opts) — the whole clip as ONE holon whose
 * children alternate signal/noise, each signal child recursively holding its
 * own louder bursts.
 */
export const separateHolons = (mono, sampleRate, opts = {}) => {
  const {
    frameMs = 20,
    alpha = 0.05,
    minDur = 0.2,
    maxDepth = 3,
    absFloorDb = -55,
  } = opts;

  const { rms: energies, times, frameDur } = frameEnergies(mono, sampleRate, frameMs);
  const duration = (mono?.length || 0) / sampleRate;
  const absFloorLin = Math.pow(10, absFloorDb / 20);

  let idCounter = 0;
  const nextId = () => `h${idCounter++}`;

  const build = (a, b, depth) => {
    if (depth >= maxDepth || (b - a) < minDur * 2) return [];
    const eWin = [], tWin = [];
    for (let f = 0; f < energies.length; f++) {
      if (times[f] < a - 1e-9 || times[f] >= b - 1e-9) continue;
      eWin.push(energies[f]); tWin.push(times[f]);
    }
    if (eWin.length < 2) return [];
    const thr = windowThreshold(eWin, alpha, absFloorLin);
    const flags = eWin.map((e) => (e > thr ? 1 : 0));
    let runs = runsFromFlags(flags, eWin, tWin, frameDur);
    runs = coalesce(runs, minDur);
    if (runs.length <= 1) return [];
    return runs.map((r) => {
      const kids = r.kind === 'signal' ? build(r.start, r.end, depth + 1) : [];
      return holon(r.kind, r.start, r.end, r.rms, r.peak, kids);
    });
  };

  const holon = (kind, start, end, rms, peak, children) => ({
    id: nextId(), kind, start, end, dur: end - start,
    rms, db: toDb(rms), peakDb: toDb(peak),
    children,
  });

  const children = build(0, duration, 0);
  const root = { id: nextId(), kind: 'root', start: 0, end: duration, dur: duration, rms: 0, db: null, peakDb: null, children };
  {
    let sq = 0; for (let i = 0; i < energies.length; i++) sq += energies[i] * energies[i];
    root.rms = energies.length ? Math.sqrt(sq / energies.length) : 0;
    root.db = toDb(root.rms);
  }

  const signalSpans = children.filter((c) => c.kind === 'signal').map((c) => ({ start: c.start, end: c.end, dur: c.dur, rms: c.rms, db: c.db, children: c.children }));
  const noiseSpans = children.filter((c) => c.kind === 'noise').map((c) => ({ start: c.start, end: c.end, dur: c.dur }));
  const signalSeconds = signalSpans.reduce((s, c) => s + c.dur, 0);
  const noiseSeconds = noiseSpans.reduce((s, c) => s + c.dur, 0);

  let count = 0, deepest = 0;
  const walk = (h, d) => { count++; deepest = Math.max(deepest, d); (h.children || []).forEach((k) => walk(k, d + 1)); };
  (children || []).forEach((c) => walk(c, 1));

  return {
    root, signalSpans, noiseSpans,
    signalSeconds, noiseSeconds,
    signalRatio: duration > 0 ? signalSeconds / duration : 0,
    count, depth: deepest,
    alpha, absFloorDb, frameMs,
  };
};
