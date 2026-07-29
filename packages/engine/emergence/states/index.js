// State detection organ — find distinct modes in value distributions.
//
// Uses DEF (the elbow-finder from extreme-value nulls) to discover how many
// distinct states a numeric series contains. No hand-set threshold —
// the data's own gap structure tells us where one state ends and another
// begins.
//
// Modality-blind: works on any numeric series (file sizes, audio amplitude,
// video curl magnitude, EOT moment scores). The engine doesn't know it's
// looking at radar data — it just sees numbers and finds their regimes.
//
// Three operations:
//   1. detectModes — how many clusters does this series contain?
//   2. assignStates — which state is each value in?
//   3. findTransitions — where does the state change?

import { DEF } from "../nulls/extreme-value.js";

// ── Helpers ───────────────────────────────────────────────────────

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs) {
  if (xs.length < 2) return 1;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
}

// ── 1D k-means (Jenks natural breaks optimisation) ────────────────
// For sorted 1D data, k-means is O(kn) via dynamic programming.
// Finds optimal partition of sorted values into k clusters.

function jenksBreaks(sorted, k) {
  const n = sorted.length;
  if (k <= 1 || n <= k) {
    const m = mean(sorted);
    return { centroids: [m], boundaries: [], labels: new Array(n).fill(0) };
  }

  // Precompute cumulative sums for O(1) within-class variance
  const cumSum = [0];
  const cumSumSq = [0];
  for (let i = 0; i < n; i++) {
    cumSum.push(cumSum[i] + sorted[i]);
    cumSumSq.push(cumSumSq[i] + sorted[i] * sorted[i]);
  }

  const ssd = (i, j) => {
    const sum = cumSum[j] - cumSum[i];
    const sumSq = cumSumSq[j] - cumSumSq[i];
    const count = j - i;
    return sumSq - (sum * sum) / count;
  };

  // DP: D[m][i] = min SSD for m clusters covering first i points
  const D = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const B = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
  D[0][0] = 0;

  for (let m = 1; m <= k; m++) {
    for (let i = m; i <= n; i++) {
      for (let j = m - 1; j < i; j++) {
        const d = D[m - 1][j] + ssd(j, i);
        if (d < D[m][i]) {
          D[m][i] = d;
          B[m][i] = j;
        }
      }
    }
  }

  // Backtrack
  const boundaries = [];
  let j = n;
  for (let m = k; m > 0; m--) {
    boundaries.push(B[m][j]);
    j = B[m][j];
  }
  boundaries.reverse();
  boundaries.shift(); // remove 0

  // Compute centroids and labels
  const centroids = [];
  const labels = new Array(n).fill(0);
  let start = 0;
  for (let c = 0; c < k; c++) {
    const end = c < k - 1 ? boundaries[c] : n;
    centroids.push(mean(sorted.slice(start, end)));
    for (let i = start; i < end; i++) labels[i] = c;
    start = end;
  }

  return { centroids, boundaries, labels };
}

// ── Detect distinct modes in a value distribution ─────────────────

/**
 * detectModes(values, opts)
 *
 * Uses DEF to find how many distinct populations the value distribution
 * contains. A binary state machine (on/off) yields k=2; a gradient yields
 * k=1 (abstain).
 *
 * @param {number[]} values — numeric series
 * @param {object} [opts]
 * @param {number} [opts.maxK=5] — max number of states to consider
 * @param {number} [opts.alpha=0.05] — DEF false-positive tolerance
 * @returns {object} { k, centroids, boundaries, abstained, reason, evidence }
 */
export function detectModes(values, opts = {}) {
  const { maxK = 5, alpha = 0.05 } = opts;
  const clean = values.filter((v) => v !== null && isFinite(v));
  if (clean.length < 4) {
    return {
      k: 1,
      centroids: [mean(clean)],
      boundaries: [],
      labels: new Array(values.length).fill(0),
      abstained: true,
      reason: "insufficient-data",
      evidence: { candidates: clean.length },
    };
  }

  const sorted = [...clean].sort((a, b) => a - b);

  // Compute within-cluster SSD for k=1..maxK
  const ssds = [];
  for (let k = 1; k <= Math.min(maxK, sorted.length); k++) {
    const result = jenksBreaks(sorted, k);
    const ssd = result.labels.reduce((sum, label, i) => {
      const d = sorted[i] - result.centroids[label];
      return sum + d * d;
    }, 0);
    ssds.push(ssd);
  }

  // DEF on SSD improvements: sorted descending by improvement
  const improvements = [];
  for (let i = 1; i < ssds.length; i++) {
    improvements.push(ssds[i - 1] - ssds[i]);
  }
  improvements.sort((a, b) => b - a);

  if (improvements.length < 2) {
    const k = ssds[0] < ssds[ssds.length - 1] * 0.5 ? 2 : 1;
    const result = jenksBreaks(sorted, Math.min(k, sorted.length));
    return {
      k,
      centroids: result.centroids,
      boundaries: sorted.length > 0 ? [sorted[result.boundaries[0]]] : [],
      labels: values.map((v) => {
        if (v === null || !isFinite(v)) return null;
        const idx = sorted.indexOf(v);
        return idx >= 0 ? result.labels[idx] : null;
      }).map((l) => l ?? 0),
      abstained: false,
      reason: null,
      evidence: { k, ssds },
    };
  }

  try {
    const def = DEF(improvements, { alpha, maxK: Math.min(maxK - 1, improvements.length) });

    if (def.abstain) {
      // DEF abstained (not enough background gap samples), but the data may
      // still have real structure. Check if the largest SSD improvement
      // dominates the rest — a single huge gap means two genuine clusters,
      // even if the null model can't be calibrated.
      const largestImprovement = improvements[0];
      const secondLargest = improvements.length > 1 ? improvements[1] : 0;

      // If the best improvement is >3x the second-best, it's real structure
      if (largestImprovement > secondLargest * 3 && improvements.length >= 2) {
        const result = jenksBreaks(sorted, 2);
        return {
          k: 2,
          centroids: result.centroids,
          boundaries: result.boundaries.map((b) => sorted[b]),
          labels: values.map((v) => {
            if (v === null || !isFinite(v)) return null;
            let bestLabel = 0;
            let bestDist = Infinity;
            for (let c = 0; c < result.centroids.length; c++) {
              const d = Math.abs(v - result.centroids[c]);
              if (d < bestDist) { bestDist = d; bestLabel = c; }
            }
            return bestLabel;
          }),
          abstained: false,
          reason: null,
          evidence: { def, ssds, fallback: "dominant-improvement" },
        };
      }

      const result = jenksBreaks(sorted, 1);
      return {
        k: 1,
        centroids: result.centroids,
        boundaries: [],
        labels: new Array(values.length).fill(0),
        abstained: true,
        reason: "flat-spectrum",
        evidence: { def, ssds },
      };
    }

    const k = def.k + 1; // DEF on improvements, so k improvements means k+1 clusters
    const result = jenksBreaks(sorted, Math.min(k, sorted.length));

    return {
      k,
      centroids: result.centroids,
      boundaries: result.boundaries.map((b) => sorted[b]),
      labels: values.map((v) => {
        if (v === null || !isFinite(v)) return null;
        // Find closest centroid
        let bestLabel = 0;
        let bestDist = Infinity;
        for (let c = 0; c < result.centroids.length; c++) {
          const d = Math.abs(v - result.centroids[c]);
          if (d < bestDist) {
            bestDist = d;
            bestLabel = c;
          }
        }
        return bestLabel;
      }),
      abstained: false,
      reason: null,
      evidence: { def, k, ssds },
    };
  } catch {
    const result = jenksBreaks(sorted, 1);
    return {
      k: 1,
      centroids: result.centroids,
      boundaries: [],
      labels: new Array(values.length).fill(0),
      abstained: true,
      reason: "def-error",
      evidence: {},
    };
  }
}

// ── Find state transitions ────────────────────────────────────────

/**
 * findTransitions(labels, positions)
 *
 * Returns every index where the state label changes from one value to another.
 *
 * @param {(number|null)[]} labels — state assignment per row
 * @param {number[]} [positions] — position of each row (default: index)
 * @returns {Array<{ index: number, position: number, from: number, to: number }>}
 */
export function findTransitions(labels, positions) {
  const pos = positions ?? labels.map((_, i) => i);
  const transitions = [];
  let prevLabel = labels[0];

  for (let i = 1; i < labels.length; i++) {
    if (labels[i] !== prevLabel && labels[i] !== null && prevLabel !== null) {
      transitions.push({
        index: i,
        position: pos[i],
        from: prevLabel,
        to: labels[i],
      });
    }
    if (labels[i] !== null) prevLabel = labels[i];
  }

  return transitions;
}

// ── Find contiguous state runs (event entities) ───────────────────

/**
 * findStateRuns(labels, positions, values, opts)
 *
 * Groups contiguous runs of the same state into "events" — the building
 * blocks of structured entity detection. A storm event is a run of state
 * "precipitation" with a minimum duration.
 *
 * @param {(number|null)[]} labels
 * @param {number[]} positions
 * @param {number[]} values
 * @param {object} [opts]
 * @param {number} [opts.minRunLength=3] — minimum contiguous length
 * @param {number[]} [opts.eventStates] — which state labels count as events
 * @returns {Array<{ start: number, end: number, state: number, length: number, sum: number, max: number }>}
 */
export function findStateRuns(labels, positions, values, opts = {}) {
  const { minRunLength = 3, eventStates = null } = opts;
  const runs = [];
  let runStart = 0;
  let prevLabel = labels[0];

  for (let i = 1; i <= labels.length; i++) {
    if (i === labels.length || labels[i] !== prevLabel) {
      const length = i - runStart;
      if (length >= minRunLength) {
        const stateValues = values.slice(runStart, i).filter((v) => v !== null && isFinite(v));
        if (stateValues.length > 0) {
          const isEvent = eventStates === null || eventStates.includes(prevLabel);
          if (isEvent && prevLabel !== null) {
            runs.push({
              start: positions[runStart] ?? runStart,
              end: positions[i - 1] ?? i - 1,
              state: prevLabel,
              length,
              sum: stateValues.reduce((a, b) => a + b, 0),
              max: Math.max(...stateValues),
              mean: mean(stateValues),
              startIndex: runStart,
              endIndex: i - 1,
            });
          }
        }
      }
      runStart = i;
      prevLabel = labels[i];
    }
  }

  return runs;
}

// ── Holonic recursion: modes within modes ─────────────────────────
//
// The binary clear/storm state machine is Level 1. But within a storm
// event, there are sub-states: intensification, peak, decay. Within a
// peak, there are pulse events. Each level finds its own k via DEF —
// the math grows itself, no hand-set thresholds anywhere.

/**
 * detectSubModes(values, opts)
 *
 * Given a subset of values (e.g., all values where label=1, the "storm"
 * state), apply detectModes recursively to find sub-modes. Returns the
 * sub-mode decomposition with its own centroids, labels, and transitions.
 *
 * Only descends if DEF finds k > 1 at this level (i.e., the sub-population
 * has genuine structure, not just noise).
 *
 * @param {number[]} values — subset of the full series
 * @param {number[]} indices — original indices of these values
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=2] — how many levels to descend
 * @param {number} [opts.depth=0] — current depth (internal)
 * @returns {object|null} null if no structure found, or { modes, children }
 */
export function detectSubModes(values, indices, opts = {}) {
  const { maxDepth = 2, depth = 0 } = opts;
  const clean = values.filter((v) => v !== null && isFinite(v));
  if (clean.length < 4 || depth >= maxDepth) return null;

  const modes = detectModes(values, { ...opts, maxK: Math.min(4, Math.floor(clean.length / 3)) });

  // No sub-structure: k=1 or abstained
  if (modes.k <= 1 || modes.abstained) return null;

  // Check that the sub-modes are meaningfully different
  const centroids = modes.centroids.sort((a, b) => a - b);
  const spread = centroids[centroids.length - 1] - centroids[0];
  if (spread < 1e-9) return null;

  // Recursively descend into each sub-mode
  const children = [];
  for (let label = 0; label < modes.k; label++) {
    const subValues = [];
    const subIndices = [];
    for (let i = 0; i < modes.labels.length; i++) {
      if (modes.labels[i] === label) {
        subValues.push(values[i]);
        subIndices.push(indices[i]);
      }
    }
    if (subValues.length >= 4) {
      const child = detectSubModes(subValues, subIndices, { ...opts, depth: depth + 1, maxDepth });
      if (child) children.push({ label, child });
    }
  }

  return { modes, children, depth, indices };
}

// ── Phase detection within an event ───────────────────────────────
//
// Within a storm event, phases are detected by looking at the CHANGE
// series (first derivative) rather than the level. Onset = positive
// change, Peak = near-zero change, Decay = negative change.
//
// This is the same primitive as chapter detection (chapters/index.js)
// but specialised for within-event structure. The chapter organ's
// changeSeries() + detectBoundaries() pipeline is modality-blind and
// works here directly — but we also want phase classification, not
// just boundary positions.

/**
 * detectPhases(values, positions, opts)
 *
 * Given a contiguous run of non-baseline values (an event), classify each
 * point into a phase: onset (rising), peak (plateau), decay (falling).
 * Uses DEF on the change magnitude to find how many phase types exist.
 *
 * @param {number[]} values — the event's values in order
 * @param {number[]} positions — positions of each value
 * @param {object} [opts]
 * @param {number} [opts.smoothWindow=3] — smoothing window for the derivative
 * @returns {object} { phases, transitions, centroids }
 */
export function detectPhases(values, positions, opts = {}) {
  const { smoothWindow = 3 } = opts;
  if (values.length < 6) {
    return {
      phases: values.map(() => "onset"),
      transitions: [],
      centroids: { onset: 0, peak: 0, decay: 0 },
      k: 1,
    };
  }

  // Compute smoothed derivative
  const half = Math.floor(smoothWindow / 2);
  const changes = [];
  for (let i = 0; i < values.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(1, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      sum += values[j] - values[j - 1];
      count++;
    }
    changes.push(count > 0 ? sum / count : 0);
  }

  // Detect modes in the change distribution → how many phase types?
  const changeModes = detectModes(changes, { maxK: 3, alpha: 0.1 });

  let phaseLabels;
  if (changeModes.k >= 3) {
    // Three distinct change regimes → onset (positive), peak (near-zero), decay (negative)
    const centroids = changeModes.centroids;
    const sorted = centroids.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c);
    const negLabel = sorted[0].i;
    const zeroLabel = sorted[1].i;
    const posLabel = sorted[2].i;

    phaseLabels = changeModes.labels.map((l) => {
      if (l === posLabel) return "onset";
      if (l === zeroLabel) return "peak";
      if (l === negLabel) return "decay";
      return "peak";
    });

    return {
      phases: phaseLabels,
      phaseLabels: changeModes.labels,
      transitions: findTransitions(phaseLabels.map((p) => ({ onset: 0, peak: 1, decay: 2 }[p])), positions),
      centroids: {
        onset: centroids[posLabel],
        peak: centroids[zeroLabel],
        decay: centroids[negLabel],
      },
      k: 3,
    };
  } else if (changeModes.k === 2) {
    // Two regimes: one rising/falling direction
    const centroids = changeModes.centroids;
    const posIdx = centroids[0] > centroids[1] ? 0 : 1;
    const negIdx = posIdx === 0 ? 1 : 0;

    phaseLabels = changeModes.labels.map((l) => {
      if (l === posIdx) return "onset";
      return "decay";
    });

    return {
      phases: phaseLabels,
      phaseLabels: changeModes.labels,
      transitions: findTransitions(phaseLabels.map((p) => p === "onset" ? 0 : 1), positions),
      centroids: {
        onset: centroids[posIdx],
        peak: 0,
        decay: centroids[negIdx],
      },
      k: 2,
    };
  }

  // No distinct change regimes — all one phase
  return {
    phases: values.map(() => "peak"),
    transitions: [],
    centroids: { onset: 0, peak: 0, decay: 0 },
    k: 1,
  };
}

// ── Holonic decomposition ─────────────────────────────────────────

/**
 * holonicDecompose(values, positions, opts)
 *
 * Full recursive decomposition: detects states at the top level, then
 * for each non-baseline state run, detects sub-modes and phases.
 * Returns a tree where each node has its own DEF-derived structure.
 *
 * This is the organ that finds nested signal at all levels
 * autonomously — no hand-set parameters survive beyond the initial
 * maxDepth guard.
 *
 * @param {number[]} values
 * @param {number[]} positions
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=3] — max recursion depth
 * @returns {object} holonic tree
 */
export function holonicDecompose(values, positions, opts = {}) {
  const { maxDepth = 3 } = opts;

  // Level 0: top-level state detection
  const modes = detectModes(values, opts);

  // Level 1: within each non-baseline state, find event runs
  const baselineLabel = modes.centroids.indexOf(Math.min(...modes.centroids));
  const eventStates = [];
  for (let l = 0; l < modes.k; l++) {
    if (l !== baselineLabel) eventStates.push(l);
  }

  const runs = findStateRuns(modes.labels, positions, values, {
    eventStates,
    minRunLength: 3,
  });

  // Level 2+: within each event run, detect phases and sub-modes
  const events = runs.map((run, eventIdx) => {
    const eventValues = values.slice(run.startIndex, run.endIndex + 1);
    const eventPositions = positions.slice(run.startIndex, run.endIndex + 1);

    // Detect phases within the event
    const phases = detectPhases(eventValues, eventPositions, opts);

    // Detect sub-modes within the event
    const subModes = detectSubModes(eventValues,
      Array.from({ length: eventValues.length }, (_, i) => run.startIndex + i),
      { ...opts, maxDepth: maxDepth - 1 }
    );

    // Phase-segmented runs
    const phaseRuns = [];
    let phaseStart = 0;
    let prevPhase = phases.phases[0];
    for (let i = 1; i <= phases.phases.length; i++) {
      if (i === phases.phases.length || phases.phases[i] !== prevPhase) {
        if (i - phaseStart >= 2) {
          phaseRuns.push({
            phase: prevPhase,
            startIndex: run.startIndex + phaseStart,
            endIndex: run.startIndex + i - 1,
            length: i - phaseStart,
            meanValue: mean(eventValues.slice(phaseStart, i)),
            maxValue: Math.max(...eventValues.slice(phaseStart, i)),
          });
        }
        if (i < phases.phases.length) {
          phaseStart = i;
          prevPhase = phases.phases[i];
        }
      }
    }

    return {
      id: eventIdx,
      kind: "event",
      state: run.state,
      start: run.start,
      end: run.end,
      startIndex: run.startIndex,
      endIndex: run.endIndex,
      length: run.length,
      peak: run.max,
      total: run.sum,
      mean: run.mean,
      phases,
      phaseRuns,
      subModes,
      kPhases: phases.k,
      kSubModes: subModes?.modes?.k ?? 1,
    };
  });

  return {
    depth: 0,
    modes,
    baselineLabel,
    eventStates,
    runs,
    events,
    series: values,
    positions,
  };
}

// ── Summary ───────────────────────────────────────────────────────

/**
 * analyzeStates(reading)
 *
 * Full pipeline: takes a structured Reading@1, detects modes, assigns states,
 * finds transitions, and extracts event runs — all in one call.
 *
 * @param {object} reading — from buildStructuredReading()
 * @param {object} [opts]
 * @returns {object} { modes, labels, transitions, runs, series }
 */
export function analyzeStates(reading, opts = {}) {
  const values = reading.units.map((u) => u.rawValue);
  const positions = reading.units.map((u) => u.pos);

  const modes = detectModes(values, opts);
  const transitions = findTransitions(modes.labels, positions);

  // Event states: all states except the min-centroid (baseline/clear air)
  let eventStates = null;
  if (modes.k > 1) {
    const baselineIdx = modes.centroids.indexOf(Math.min(...modes.centroids));
    eventStates = modes.labels.reduce((acc, l, i) => {
      if (l !== null && l !== baselineIdx && !acc.includes(l)) acc.push(l);
      return acc;
    }, []);
  }

  const runs = findStateRuns(modes.labels, positions, values, {
    ...opts,
    eventStates,
  });

  return {
    modes,
    labels: modes.labels,
    transitions,
    runs,
    series: values,
  };
}
