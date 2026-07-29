// Structured entity extraction and fold — the bridge from structured
// perceiver output to the engine's entity model.
//
// A structured entity is a referent that appears in tabular data:
//   - A categorical entity (radar station "ABC", product "DAA")
//   - A state entity ("clear air", "precipitation", "anomalous")
//   - An event entity (a contiguous run of high-value rows)
//   - A gap entity (a period with no data / system outage)
//
// The nameless-referent principle applies: the entity is the referent
// (the station, the storm, the outage), never its label string. The
// label is a surface — scoped evidence admitted by explicit events.
//
// This module produces entity records that can be folded through the
// engine's kernel (kernel.js::buildEntityPacket), the same way entity-fold
// folds literary characters.

import { analyzeStates, holonicDecompose, detectPhases } from "../states/index.js";
import { computeBoundaryStabilityGate } from "../boundaries/index.js";
import { DEF } from "../nulls/extreme-value.js";
import { discoverSeriesLevelRelation } from "../holon-level/series.js";

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

// ── Categorical entities ──────────────────────────────────────────

/**
 * extractCategoricalEntities(reading)
 *
 * Each unique value in a categorical column is an entity. The entity's
 * identity is the referent (the thing the category names), not the string.
 *
 * @returns {Array<{ id: string, kind: 'category', column: string, surface: string, frames: number[] }>}
 */
export function extractCategoricalEntities(reading) {
  const entities = [];
  const categories = reading.categories ?? {};
  const totalRows = reading.units.length;

  for (const [column, values] of Object.entries(categories)) {
    // Skip high-cardinality identifier columns (every row unique = not a category)
    if (values.length > totalRows * 0.5 || values.length > 100) continue;

    for (const value of values) {
      // Find rows where this category value appears
      const frames = [];
      for (let i = 0; i < reading.units.length; i++) {
        const unit = reading.units[i];
        if (unit.categorical && String(unit.categorical[column]) === value) {
          frames.push(i);
        }
      }

      if (frames.length > 0) {
        entities.push({
          id: `category:${column}:${value}`,
          kind: "category",
          column,
          surface: value,
          frames,
          entityType: "categorical",
          prevalence: frames.length / totalRows,
        });
      }
    }
  }

  return entities;
}

// ── State entities ────────────────────────────────────────────────

/**
 * extractStateEntities(reading, analysis)
 *
 * Each distinct state (mode in the value distribution) is an entity.
 * The binary clear/storm machine is two state entities.
 *
 * @returns {Array<{ id: string, kind: 'state', label: number, centroid: number, frames: number[] }>}
 */
export function extractStateEntities(reading, analysis) {
  const { modes } = analysis;
  const entities = [];

  for (let label = 0; label < modes.centroids.length; label++) {
    const frames = [];
    for (let i = 0; i < modes.labels.length; i++) {
      if (modes.labels[i] === label) frames.push(i);
    }

    const centroid = modes.centroids[label];
    const isBaseline = centroid === Math.min(...modes.centroids);

    entities.push({
      id: `state:${label}`,
      kind: "state",
      label,
      centroid,
      isBaseline,
      frames,
      entityType: "state",
      prevalence: frames.length / modes.labels.length,
      descriptor: isBaseline ? "baseline/clear" :
        centroid > modes.centroids.reduce((a, b) => a + b, 0) / modes.centroids.length
          ? "elevated/active" : "intermediate",
    });
  }

  return entities;
}

// ── Event entities ────────────────────────────────────────────────

/**
 * extractEventEntities(reading, analysis, opts)
 *
 * Contiguous runs of non-baseline states are event entities. Each storm
 * event in the NEXRAD data is one entity. The identity is the temporal
 * cluster, not the weather system's name.
 *
 * @returns {Array<{ id: string, kind: 'event', state: number, frames: number[], start: number, end: number, peak: number, total: number, duration: number }>}
 */
export function extractEventEntities(reading, analysis, opts = {}) {
  const { runs } = analysis;
  const entities = [];
  const { minRunLength = 3, minTotal = 2 } = opts;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.length < minRunLength) continue;
    if (run.sum < minTotal) continue;

    const frames = [];
    for (let j = run.startIndex; j <= run.endIndex; j++) {
      frames.push(j);
    }

    const duration = run.end - run.start;
    const peak = run.max;
    const total = run.sum;

    // Calculate anomaly score relative to baseline
    const baselineCentroid = Math.min(...analysis.modes.centroids);
    const anomalyScore = (peak - baselineCentroid) / (std(analysis.series) || 1);

    entities.push({
      id: `event:${i}`,
      kind: "event",
      state: run.state,
      frames,
      start: run.start,
      end: run.end,
      startIndex: run.startIndex,
      endIndex: run.endIndex,
      length: run.length,
      peak,
      total,
      mean: run.mean,
      duration,
      anomalyScore,
      entityType: "event",
    });
  }

  // Score events by anomaly to find significant ones
  entities.sort((a, b) => b.anomalyScore - a.anomalyScore);

  // Use DEF to find how many events are structurally significant
  if (entities.length > 2) {
    const scores = entities.map((e) => e.anomalyScore);
    try {
      const def = DEF(scores, { alpha: 0.05, maxK: entities.length });
      if (!def.abstain) {
        for (let i = 0; i < entities.length; i++) {
          entities[i].significant = i < def.k;
        }
      }
    } catch {
      // All events remain, marked as-is
    }
  }

  return entities;
}

// ── Gap entities ──────────────────────────────────────────────────

/**
 * extractGapEntities(reading, analysis, opts)
 *
 * Periods with no data or only null values are gap entities — system
 * outages in the radar, missing days in a log. The gap is the referent.
 *
 * @returns {Array<{ id: string, kind: 'gap', frames: number[], start: number, end: number, duration: number }>}
 */
export function extractGapEntities(reading, analysis, opts = {}) {
  const { minGap = 2 } = opts;
  const values = analysis.series;
  const entities = [];
  let gapStart = -1;

  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) {
      if (gapStart === -1) gapStart = i;
    } else {
      if (gapStart >= 0) {
        const length = i - gapStart;
        if (length >= minGap) {
          entities.push({
            id: `gap:${entities.length}`,
            kind: "gap",
            frames: Array.from({ length }, (_, j) => gapStart + j),
            start: reading.units[gapStart]?.pos ?? gapStart,
            end: reading.units[i - 1]?.pos ?? i - 1,
            startIndex: gapStart,
            endIndex: i - 1,
            duration: length,
            entityType: "gap",
          });
        }
        gapStart = -1;
      }
    }
  }

  // Trailing gap
  if (gapStart >= 0 && values.length - gapStart >= minGap) {
    entities.push({
      id: `gap:${entities.length}`,
      kind: "gap",
      frames: Array.from({ length: values.length - gapStart }, (_, j) => gapStart + j),
      start: reading.units[gapStart]?.pos ?? gapStart,
      end: reading.units[values.length - 1]?.pos ?? values.length - 1,
      startIndex: gapStart,
      endIndex: values.length - 1,
      duration: values.length - gapStart,
      entityType: "gap",
    });
  }

  return entities;
}

// ── Temporal rhythm detection ─────────────────────────────────────

/**
 * detectTemporalRhythms(reading, analysis, opts)
 *
 * Checks for cyclical patterns in the data: diurnal, weekly, etc.
 * For NEXRAD, detects the diurnal cycle by binning values by hour-of-day.
 *
 * @returns {object} { diurnal: { present: boolean, strength: number, peakHours: number[], troughHours: number[] } }
 */
export function detectTemporalRhythms(reading, analysis, opts = {}) {
  const { minStrength = 0.15 } = opts;
  const units = reading.units;
  if (units.length < 24) return { diurnal: { present: false, strength: 0, peakHours: [], troughHours: [] } };

  // Bin by hour
  const hourBins = new Array(24).fill(null).map(() => []);
  for (const unit of units) {
    if (unit.rawTimestamp) {
      const d = new Date(unit.rawTimestamp);
      const h = d.getUTCHours();
      if (unit.rawValue !== null) hourBins[h].push(unit.rawValue);
    }
  }

  const hourMeans = hourBins.map((vals) => vals.length > 0 ? mean(vals) : null);
  const validMeans = hourMeans.filter((m) => m !== null);
  if (validMeans.length < 6) return { diurnal: { present: false, strength: 0, peakHours: [], troughHours: [] } };

  const overallMean = mean(validMeans);
  const amplitude = (Math.max(...validMeans) - Math.min(...validMeans)) / (overallMean || 1);
  const strength = amplitude;

  if (strength < minStrength) {
    return { diurnal: { present: false, strength, peakHours: [], troughHours: [] } };
  }

  // Find peak and trough hours
  const sorted = hourMeans
    .map((m, h) => ({ hour: h, mean: m }))
    .filter((x) => x.mean !== null)
    .sort((a, b) => b.mean - a.mean);

  const peakCount = Math.min(3, Math.floor(sorted.length / 3));
  const peakHours = sorted.slice(0, peakCount).map((x) => x.hour);
  const troughHours = sorted.slice(-peakCount).map((x) => x.hour);

  return {
    diurnal: {
      present: strength >= minStrength,
      strength,
      peakHours,
      troughHours,
      hourMeans: hourMeans.map((m) => m ?? 0),
    },
  };
}

// ── Terrain-complete discovery ────────────────────────────────────
//
// The cube classifier defines 9 terrains. A terrain-complete engine must
// search for structure in every terrain, not just Entity/Field/Link.
// These functions are modality-blind: they work on any structured Reading@1.

// T1: Void — absence, gaps, missing data, silence.
export function detectVoidStructure(reading, opts = {}) {
  const { minGap = 4 } = opts;
  const units = reading.units;
  const voids = [];

  // Null-value runs in the primary numeric series
  const values = units.map((u) => u.rawValue);
  let nullStart = -1;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i] === null) {
      if (nullStart === -1) nullStart = i;
    } else {
      if (nullStart >= 0 && i - nullStart >= minGap) {
        voids.push({
          kind: "null-run",
          startIndex: nullStart,
          endIndex: i - 1,
          length: i - nullStart,
          startPos: units[nullStart]?.pos,
          endPos: units[i - 1]?.pos,
        });
      }
      nullStart = -1;
    }
  }

  // Timestamp gaps: large jumps in the position axis
  if (units.length > 1) {
    const gaps = [];
    for (let i = 1; i < units.length; i++) {
      const gap = units[i].pos - units[i - 1].pos;
      if (gap > 0) gaps.push(gap);
    }

    if (gaps.length > 3) {
      const meanGap = mean(gaps);
      const stdGap = std(gaps);
      const threshold = meanGap + 3 * stdGap;

      for (let i = 1; i < units.length; i++) {
        const gap = units[i].pos - units[i - 1].pos;
        if (gap > threshold && gap > meanGap * 5) {
          voids.push({
            kind: "timestamp-gap",
            afterIndex: i - 1,
            beforeIndex: i,
            gapSize: gap,
            meanGap,
            zScore: (gap - meanGap) / (stdGap || 1),
            startPos: units[i - 1]?.pos,
            endPos: units[i]?.pos,
            startTimestamp: units[i - 1]?.rawTimestamp,
            endTimestamp: units[i]?.rawTimestamp,
          });
        }
      }
    }
  }

  return voids;
}

// T6: Network — multi-entity systems, causal chains, topology.
export function detectNetworkStructure(tree, associations, opts = {}) {
  const networks = [];
  const events = tree.events;

  if (events.length < 2) return networks;

  // Causal chain: find the longest chain of causally-linked events
  // An event "causes" the next if the gap is unusual AND the first event
  // was high-magnitude
  const causalEdges = [];
  for (const assoc of associations) {
    if (assoc.kind === "precedes" && assoc.evidence) {
      const prevEvent = events.find((e) => `event:${e.id}` === assoc.from);
      if (prevEvent && prevEvent.peak > tree.modes.centroids.reduce((a, b) => a + b, 0) / tree.modes.centroids.length * 2) {
        causalEdges.push({ ...assoc, causal: true });
      }
    }
  }

  if (causalEdges.length > 0) {
    // Build the causal chain topology
    const nodes = new Set();
    for (const edge of causalEdges) {
      nodes.add(edge.from);
      nodes.add(edge.to);
    }

    networks.push({
      kind: "causal-chain",
      nodes: [...nodes],
      edges: causalEdges.map((e) => ({ from: e.from, to: e.to, strength: e.strength })),
      chainLength: causalEdges.length,
      description: causalEdges.length >= 2
        ? "multi-event causal cascade"
        : "single causal link",
    });
  }

  // System topology: all entities and their relationships as a graph
  const allNodes = new Set();
  const allEdges = [];
  for (const assoc of associations) {
    allNodes.add(assoc.from);
    allNodes.add(assoc.to);
    allEdges.push({
      from: assoc.from,
      to: assoc.to,
      kind: assoc.kind,
      strength: assoc.strength,
    });
  }

  if (allNodes.size > 2) {
    // Compute basic graph metrics
    const inDegree = {};
    const outDegree = {};
    for (const node of allNodes) { inDegree[node] = 0; outDegree[node] = 0; }
    for (const edge of allEdges) {
      outDegree[edge.from] = (outDegree[edge.from] || 0) + 1;
      inDegree[edge.to] = (inDegree[edge.to] || 0) + 1;
    }

    // Find hubs (nodes with high out-degree → causal sources)
    const hubs = Object.entries(outDegree)
      .filter(([, d]) => d >= 2)
      .map(([node, degree]) => ({ node, degree }))
      .sort((a, b) => b.degree - a.degree);

    networks.push({
      kind: "system-topology",
      nodeCount: allNodes.size,
      edgeCount: allEdges.length,
      density: allEdges.length / (allNodes.size * (allNodes.size - 1)),
      hubs,
      hasCycles: false, // temporal data shouldn't cycle
    });
  }

  return networks;
}

// T7: Atmosphere — ambient conditions, trends, the "mood" of the data.
export function detectAtmosphereStructure(reading, tree, opts = {}) {
  const values = reading.units.map((u) => u.rawValue).filter((v) => v !== null && isFinite(v));
  const atmosphere = [];

  // Trend direction: is activity increasing or decreasing?
  if (values.length > 10) {
    const half = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, half);
    const secondHalf = values.slice(half);

    const firstMean = mean(firstHalf);
    const secondMean = mean(secondHalf);
    const change = (secondMean - firstMean) / ((firstMean + secondMean) / 2 || 1);

    atmosphere.push({
      kind: "trend",
      direction: Math.abs(change) < 0.1 ? "stable" : change > 0 ? "intensifying" : "diminishing",
      magnitude: Math.abs(change),
      firstHalfMean: firstMean,
      secondHalfMean: secondMean,
    });
  }

  // Volatility: how much does the signal vary?
  if (values.length > 4) {
    const changes = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] > 0) {
        changes.push(Math.abs(values[i] - values[i - 1]) / values[i - 1]);
      }
    }
    const volatility = changes.length > 0 ? mean(changes) : 0;

    atmosphere.push({
      kind: "volatility",
      value: volatility,
      description: volatility < 0.1 ? "calm" : volatility < 0.5 ? "active" : "turbulent",
    });
  }

  // Activity duty cycle: what fraction of time is the system in non-baseline state?
  if (tree.modes.k > 1) {
    const baselineLabel = tree.modes.centroids.indexOf(Math.min(...tree.modes.centroids));
    const activeCount = tree.modes.labels.filter((l) => l !== null && l !== baselineLabel).length;
    const dutyCycle = activeCount / tree.modes.labels.length;

    atmosphere.push({
      kind: "duty-cycle",
      value: dutyCycle,
      activeFraction: dutyCycle,
      description: dutyCycle < 0.3 ? "mostly-quiet" :
        dutyCycle < 0.6 ? "intermittent" : "mostly-active",
    });
  }

  // Extreme event frequency: how often do anomalous values occur?
  const m = mean(values);
  const s = std(values);
  const anomalies = values.filter((v) => Math.abs(v - m) > 2 * s);
  const anomalyRate = anomalies.length / values.length;

  atmosphere.push({
    kind: "anomaly-rate",
    value: anomalyRate,
    anomalyCount: anomalies.length,
    totalCount: values.length,
    description: anomalyRate < 0.02 ? "rare-extremes" :
      anomalyRate < 0.1 ? "occasional-extremes" : "frequent-extremes",
  });

  return atmosphere;
}

// T8: Lens — the observer's perspective, the measurement apparatus.
export function detectLensStructure(reading, tree, opts = {}) {
  const lens = [];
  const units = reading.units;
  const values = units.map((u) => u.rawValue).filter((v) => v !== null && isFinite(v));

  // Lens 1: Measurement resolution — what's the finest detectable difference?
  if (values.length > 1) {
    const diffs = [];
    for (let i = 1; i < values.length; i++) {
      diffs.push(Math.abs(values[i] - values[i - 1]));
    }
    const nonzeroDiffs = diffs.filter((d) => d > 0);
    const resolution = nonzeroDiffs.length > 0 ? Math.min(...nonzeroDiffs) : 0;

    lens.push({
      kind: "measurement-resolution",
      value: resolution,
      relativeResolution: resolution / (mean(values) || 1),
      description: resolution < 1 ? "continuous-analog" : "quantized-digital",
    });
  }

  // Lens 2: Dynamic range — ratio of max to min observable
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const dynamicRange = minVal > 0 ? maxVal / minVal : Infinity;

  lens.push({
    kind: "dynamic-range",
    value: dynamicRange,
    min: minVal,
    max: maxVal,
    ordersOfMagnitude: minVal > 0 ? Math.log10(maxVal / minVal) : Infinity,
    description: dynamicRange < 10 ? "narrow-view" :
      dynamicRange < 100 ? "moderate-range" : "wide-field",
  });

  // Lens 3: Sampling cadence — how regularly does the observer sample?
  if (units.length > 2) {
    const intervals = [];
    for (let i = 1; i < Math.min(units.length, 200); i++) {
      const dt = units[i].pos - units[i - 1].pos;
      if (dt > 0) intervals.push(dt);
    }
    if (intervals.length > 0) {
      const meanInterval = mean(intervals);
      const stdInterval = std(intervals);
      const regularity = 1 - (stdInterval / (meanInterval || 1));

      lens.push({
        kind: "sampling-cadence",
        meanInterval,
        stdInterval,
        regularity: Math.max(0, Math.min(1, regularity)),
        description: regularity > 0.9 ? "clock-regular" :
          regularity > 0.5 ? "mostly-regular" : "irregular",
      });
    }
  }

  // Lens 4: Observable bias — does the measurement favor certain ranges?
  if (values.length > 10) {
    const sorted = [...values].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const skew = (mean(values) - (p10 + p90) / 2) / ((p90 - p10) / 2 || 1);

    lens.push({
      kind: "distribution-skew",
      value: skew,
      p10,
      p90,
      description: Math.abs(skew) < 0.3 ? "symmetric" :
        skew > 0 ? "high-biased" : "low-biased",
    });
  }

  return lens;
}

// T9: Paradigm — discovered rules, invariants, governing laws.
export function detectParadigmStructure(reading, tree, rhythms, events, opts = {}) {
  const paradigm = [];

  // Paradigm 1: Binary state law — the system has N distinct regimes
  if (tree.modes.k > 1) {
    paradigm.push({
      kind: "state-regime-law",
      k: tree.modes.k,
      statement: `system operates in ${tree.modes.k} distinct regimes`,
      centroids: tree.modes.centroids,
      evidence: "DEF-derived mode count from value distribution",
    });
  }

  // Paradigm 2: Diurnal law — cyclical temporal pattern
  if (rhythms.diurnal.present) {
    paradigm.push({
      kind: "diurnal-law",
      statement: `activity follows a ${rhythms.diurnal.strength < 0.3 ? "weak" : "strong"} diurnal cycle`,
      strength: rhythms.diurnal.strength,
      peakHours: rhythms.diurnal.peakHours,
      troughHours: rhythms.diurnal.troughHours,
      evidence: "hour-binned value means exceed noise floor",
    });
  }

  // Paradigm 3: Event magnitude clustering — similar-sized events are not random
  if (events.length >= 2) {
    const peaks = events.map((e) => e.peak).sort((a, b) => a - b);
    const peakRatios = [];
    for (let i = 1; i < peaks.length; i++) {
      if (peaks[i - 1] > 0) peakRatios.push(peaks[i] / peaks[i - 1]);
    }

    // Check if peak magnitudes cluster (pairs have similar magnitudes)
    const closePairs = peakRatios.filter((r) => r < 1.5).length;
    const clusteringStrength = peaks.length > 1 ? closePairs / (peaks.length - 1) : 0;

    if (clusteringStrength > 0.5) {
      paradigm.push({
        kind: "magnitude-clustering-law",
        statement: "event magnitudes cluster — similar-sized events are not randomly distributed",
        clusteringStrength,
        peakRatios: peakRatios.slice(0, 10),
        evidence: `${closePairs}/${peaks.length - 1} consecutive event pairs are within 1.5x magnitude`,
      });
    }
  }

  // Paradigm 4: Power-law or bimodality in the value distribution
  const values = reading.units.map((u) => u.rawValue).filter((v) => v !== null && isFinite(v));
  if (values.length > 20) {
    const sorted = [...values].sort((a, b) => a - b);
    const m = mean(values);
    const s = std(values);

    // Check for bimodality: is the value distribution bimodal?
    // Simple Hartigan dip test approximation: count values in [m-s, m+s]
    const inOneSigma = values.filter((v) => Math.abs(v - m) < s).length;
    const oneSigmaFraction = inOneSigma / values.length;

    if (oneSigmaFraction < 0.5) {
      paradigm.push({
        kind: "bimodality-law",
        statement: "value distribution is bimodal or heavy-tailed",
        oneSigmaFraction,
        evidence: `only ${(oneSigmaFraction * 100).toFixed(0)}% of values within 1σ of mean`,
      });
    }
  }

  // Paradigm 5: Scale invariance — do event durations follow a power law?
  if (events.length >= 4) {
    const durations = events.map((e) => e.length).sort((a, b) => a - b);
    const durRatios = [];
    for (let i = 1; i < durations.length; i++) {
      if (durations[i - 1] > 0) durRatios.push(durations[i] / durations[i - 1]);
    }
    const durCV = std(durations) / (mean(durations) || 1);

    if (durCV > 1) {
      paradigm.push({
        kind: "scale-invariance-law",
        statement: "event durations are scale-invariant (heavy-tailed)",
        cv: durCV,
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        evidence: `duration CV = ${durCV.toFixed(2)} (>1 indicates heavy tail)`,
      });
    }
  }

  return paradigm;
}

// ── Terrain coverage report ───────────────────────────────────────

/**
 * terrainCoverage(result)
 *
 * Given the full extraction result, reports which terrains are covered
 * and what evidence backs each one.
 *
 * @returns {object} { covered: string[], uncovered: string[], byTerrain: object }
 */
export function terrainCoverage(result) {
  const { categorical, states, events, gaps, rhythms, tree, associations, voids } = result;
  const terrains = ["Void", "Entity", "Kind", "Field", "Link", "Network", "Atmosphere", "Lens", "Paradigm"];
  const coverage = {};

  const innerTree = tree?.tree;

  coverage.Void = (gaps && gaps.length > 0) || (voids && voids.length > 0);
  coverage.Entity = states.length > 0 || events.length > 0;
  coverage.Kind = categorical.length > 0;
  coverage.Field = innerTree && innerTree.series && innerTree.series.length > 0;
  coverage.Link = associations.length > 0;
  coverage.Network = associations.length >= 3;
  coverage.Atmosphere = rhythms.diurnal.present || events.length > 1;
  coverage.Lens = innerTree && innerTree.modes;
  coverage.Paradigm = innerTree && innerTree.modes && innerTree.modes.k > 1;

  const covered = terrains.filter((t) => coverage[t]);
  const uncovered = terrains.filter((t) => !coverage[t]);

  return { covered, uncovered, byTerrain: coverage };
}

// ── Holonic tree builder ──────────────────────────────────────────

/**
 * buildHolonicTree(reading, opts)
 *
 * Full holonic decomposition of structured data. Recursively finds
 * structure at every level:
 *
 *   Level 0: Raw value series
 *   Level 1: State modes (binary clear/storm machine)
 *   Level 2: Event runs within non-baseline states
 *   Level 3: Phases within each event (onset, peak, decay)
 *   Level 4: Sub-modes within phases (pulse events)
 *
 * Each level's k (number of clusters) is determined by DEF on that
 * level's own data — the math grows itself.
 *
 * @returns {object} { tree, levels, entityCount }
 */
// buildHolonicTree's states/events/phases/subModes containment is assumed —
// true by construction (a phase is literally computed as a time-sub-segment
// of an event), but never confirmed as a genuine holon-level relation
// (docs/holon-level.md). This attaches that confirmation per event, using
// the same discovery discipline as everywhere else: existence-dependency +
// possibility-constraint (measured as real predictive competency gain, via
// ../holon-level/series.js — never assumed just because the decomposition
// nests them). Nulls in the raw series (a gap) are excluded, with an
// original-index <-> compacted-index map so an event's frames still resolve
// correctly in the gap-free series `discoverSeriesLevelRelation` needs.
function confirmEventLevelRelations(values, events, { permutations = 50, quantile } = {}) {
  const cleanSeries = [];
  const origToCompact = new Map();
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] === "number" && Number.isFinite(values[i])) {
      origToCompact.set(i, cleanSeries.length);
      cleanSeries.push(values[i]);
    }
  }

  return events.map((event) => {
    const candidateIndices = [];
    for (let i = event.startIndex; i <= event.endIndex; i++) {
      const compact = origToCompact.get(i);
      if (compact !== undefined) candidateIndices.push(compact);
    }

    if (candidateIndices.length < 2 || cleanSeries.length < candidateIndices.length + 4) {
      return {
        ...event,
        level_relation: null,
        level_relation_gap: "insufficient gap-free series data to confirm a holon-level relation for this event",
      };
    }

    const level_relation = discoverSeriesLevelRelation({
      series: cleanSeries,
      candidateIndices,
      subject_id: "whole-series",
      candidate_id: `event:${event.id}`,
      permutations,
      quantile,
    });

    return { ...event, level_relation };
  });
}

export function buildHolonicTree(reading, opts = {}) {
  const values = reading.units.map((u) => u.rawValue);
  const positions = reading.units.map((u) => u.pos);
  const tree = holonicDecompose(values, positions, opts);

  const eventsWithLevelRelations = confirmEventLevelRelations(values, tree.events, opts);
  const confirmedTree = { ...tree, events: eventsWithLevelRelations };

  // Count entities at each level
  const levelCounts = {
    states: tree.modes.k,
    events: tree.events.length,
    phases: tree.events.reduce((sum, e) => sum + e.phaseRuns.length, 0),
    subModes: tree.events.reduce((sum, e) => sum + (e.kSubModes > 1 ? e.kSubModes : 0), 0),
  };

  const totalEntities = levelCounts.states + levelCounts.events +
    levelCounts.phases + levelCounts.subModes;

  return {
    tree: confirmedTree,
    levels: levelCounts,
    entityCount: totalEntities,
    reading,
  };
}

// ── Cross-entity association ──────────────────────────────────────

/**
 * buildEntityAssociations(tree, reading, opts)
 *
 * Finds relationships between holonic entities without being told what
 * entities are. Relationships emerge from:
 *   - Temporal proximity (events that are close in time)
 *   - Containment (phase is contained in event, event in state)
 *   - Similarity (events with similar magnitude/profiles)
 *   - Causal implication (a gap following a major event suggests damage)
 *
 * @returns {Array<{ from, to, kind, strength, evidence }>}
 */
export function buildEntityAssociations(tree, reading, opts = {}) {
  const associations = [];
  const events = tree.events;

  // 1. Containment: phases contained in events
  for (const event of events) {
    for (const phaseRun of event.phaseRuns) {
      associations.push({
        from: `event:${event.id}`,
        to: `phase:${event.id}:${phaseRun.phase}`,
        kind: "contains",
        strength: phaseRun.length / event.length,
        evidence: { phase: phaseRun.phase, length: phaseRun.length },
      });
    }
  }

  // 2. Temporal proximity: consecutive events
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].start - events[i - 1].end;
    const proximity = gap > 0 ? 1 / (1 + gap) : 1;
    associations.push({
      from: `event:${events[i - 1].id}`,
      to: `event:${events[i].id}`,
      kind: "precedes",
      strength: proximity,
      evidence: { gap, prevEnd: events[i - 1].end, nextStart: events[i].start },
    });
  }

  // 3. Similarity: events with similar peak magnitudes
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const ratio = Math.min(events[i].peak, events[j].peak) /
        Math.max(events[i].peak, events[j].peak);
      if (ratio > 0.5) {
        associations.push({
          from: `event:${events[i].id}`,
          to: `event:${events[j].id}`,
          kind: "similar-magnitude",
          strength: ratio,
          evidence: {
            peakA: events[i].peak,
            peakB: events[j].peak,
            ratio,
          },
        });
      }
    }
  }

  // 4. Causal implication: gap following a major event
  // Check if any gap in the data follows a high-magnitude event
  const maxPeak = Math.max(...events.map((e) => e.peak));
  for (let i = 0; i < events.length - 1; i++) {
    const event = events[i];
    const nextEvent = events[i + 1];
    const gap = nextEvent.start - event.end;

    // Large gap after a major event suggests damage/outage
    if (event.peak > maxPeak * 0.7 && gap > (tree.runs.reduce((s, r) => Math.min(s, r.end - r.start), Infinity) || 10)) {
      associations.push({
        from: `event:${event.id}`,
        to: `gap:after-event-${event.id}`,
        kind: "potentially-caused-outage",
        strength: Math.min(1, event.peak / maxPeak),
        evidence: {
          eventPeak: event.peak,
          maxPeak,
          gapSize: gap,
          isLargestEvent: event.peak === maxPeak,
        },
      });
    }
  }

  // 5. State membership: events belong to states
  for (const event of events) {
    associations.push({
      from: `state:${event.state}`,
      to: `event:${event.id}`,
      kind: "contains",
      strength: 1,
      evidence: { stateLabel: event.state },
    });
  }

  return associations;
}

// ── Full extraction pipeline ──────────────────────────────────────

/**
 * extractAllEntities(reading, opts)
 *
 * Runs the full structured entity extraction pipeline: categorical entities,
 * state entities, event entities, gap entities, temporal rhythms, AND the
 * holonic tree with cross-entity associations.
 *
 * @param {object} reading — from buildStructuredReading()
 * @param {object} [opts]
 * @returns {object}
 *   { categorical, states, events, gaps, rhythms, tree, associations, analysis, reading }
 */
export function extractAllEntities(reading, opts = {}) {
  const analysis = analyzeStates(reading, opts);
  const categorical = extractCategoricalEntities(reading);
  const states = extractStateEntities(reading, analysis);
  const events = extractEventEntities(reading, analysis, opts);
  const gaps = extractGapEntities(reading, analysis, opts);
  const rhythms = detectTemporalRhythms(reading, analysis, opts);
  const tree = buildHolonicTree(reading, opts);
  const associations = buildEntityAssociations(tree.tree, reading, opts);

  // Terrain-complete discovery
  const voids = detectVoidStructure(reading, opts);
  const networks = detectNetworkStructure(tree.tree, associations, opts);
  const atmospheres = detectAtmosphereStructure(reading, tree.tree, opts);
  const lenses = detectLensStructure(reading, tree.tree, opts);
  const paradigms = detectParadigmStructure(reading, tree.tree, rhythms, events, opts);

  const result = {
    categorical,
    states,
    events,
    gaps,
    rhythms,
    tree,
    associations,
    analysis,
    reading,
    // Terrain-complete
    voids,
    networks,
    atmospheres,
    lenses,
    paradigms,
  };

  const tc = terrainCoverage(result);
  result.terrainCoverage = tc;

  return result;
}

// ── Structured entity fold ────────────────────────────────────────

/**
 * structuredEntityFold(reading, entity, opts)
 *
 * Produces a fold packet for a structured entity, compatible with the
 * engine's entity packet format (kernel.js::buildEntityPacket).
 *
 * A fold for a categorical entity contains all rows where that category
 * appears. A fold for a state entity contains all rows in that state.
 * A fold for an event entity contains the contiguous run's rows.
 * A fold for a gap entity describes the outage.
 *
 * @returns {object} { entity, spans, altitudes, stats }
 */
export function structuredEntityFold(reading, entity, opts = {}) {
  const { altitudes: altOpts = { 0: 3, 1: 6, 2: 12, 3: 24 } } = opts;

  const frames = entity.frames || [];
  const units = reading.units;
  const spans = frames.map((fi) => {
    const unit = units[fi];
    if (!unit) return null;
    return {
      offset: fi,
      text: unit.rawValue != null ? String(unit.rawValue) :
        unit.rawTimestamp ?? `row ${fi}`,
      raw: unit.rawValue != null ? String(unit.rawValue) : "",
      verified: true,
      rawValue: unit.rawValue,
      timestamp: unit.rawTimestamp,
      pos: unit.pos,
      drift: 0,
      entityPresent: true,
      field: unit.field,
      state: entity.kind === "state" ? entity.label : null,
    };
  }).filter(Boolean);

  // Score spans by anomaly (for events) or by rawValue (for others)
  const scored = spans.map((s, i) => {
    const anomalyScore = s.field ? Math.abs(s.field[3]) : 0; // anomaly channel
    const valueScore = s.rawValue != null ? s.rawValue : 0;
    return { ...s, idx: i, score: entity.kind === "event" ? anomalyScore : valueScore };
  });

  // Build altitudes by taking top-N scored spans
  const altitudeKeys = Object.keys(altOpts).map(Number).sort((a, b) => a - b);
  const altitudes = {};

  for (const level of altitudeKeys) {
    const count = Math.min(altOpts[level], scored.length);
    const top = [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .sort((a, b) => a.pos - b.pos);
    altitudes[level] = {
      label: `L${level}`,
      spans: top.map((s, i) => ({ ...s, idx: i })),
      totalSpans: scored.length,
    };
  }

  const stats = {
    totalFrames: frames.length,
    totalSpans: spans.length,
    prevalence: frames.length / Math.max(units.length, 1),
    entityType: entity.entityType || entity.kind,
  };

  if (entity.kind === "event") {
    stats.peak = entity.peak;
    stats.total = entity.total;
    stats.duration = entity.duration;
    stats.anomalyScore = entity.anomalyScore;
    stats.significant = entity.significant;
  }

  if (entity.kind === "state") {
    stats.centroid = entity.centroid;
    stats.isBaseline = entity.isBaseline;
  }

  return {
    entity,
    spans: scored,
    altitudes,
    stats,
    entityCoherent: spans.length > 0,
    gaps: [],
  };
}
