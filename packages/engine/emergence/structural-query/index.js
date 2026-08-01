// Cross-modal structural similarity search: index a corpus into shape
// descriptors (novelty / recurrence / operator distribution) and rank windows
// against an archetype, with two nulls as gates.
//
// THE ENGINE HAS NO CLOCK, AND NO AMBIENT RANDOMNESS
//
// `ts` is supplied by the host and never generated here, exactly as the
// reaction channel does it (packages/engine/reaction/index.js). A query that
// stamped an ambient wall-clock read would not be the same query twice, which
// breaks byte-identical replay and makes golden/workflow resume
// unreproducible. A host that does not supply `ts` gets `timestamp: null` —
// a typed gap, not a fabricated reading of a clock the engine does not have.
//
// Randomness is likewise seeded from content, never ambient. The operator
// distribution of a synthesized archetype used to be drawn from the ambient
// PRNG, which meant `synth:sonata-allegro-form` was a DIFFERENT archetype on
// every call and the gates scored against a moving target.
//
// Both rules are enforced by source-text scan in
// packages/conformance/invariants/forbidden-dependencies.test.js, so this
// module may not even name the forbidden calls in a comment.
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";
import { extractTextFieldVectors, cosineSimilarity } from "../../perceiver/text/text-signal.js";
import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { induceCalculus } from "../calculus/index.js";

const DEFAULT_WINDOW_UNITS = 16;
const DEFAULT_STRIDE = 8;
const RESAMPLE_LENGTH = 24;
const OPERATOR_DIMS = 9;

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += a[i]; my += b[i]; }
  mx /= n; my /= n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = a[i] - mx, dy = b[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 1e-12 ? Math.max(-1, Math.min(1, num / denom)) : 0;
}

function resample(series, targetLen) {
  if (series.length === 0) return new Float64Array(targetLen);
  const out = new Float64Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const pos = (i / (targetLen - 1)) * (series.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, series.length - 1);
    const frac = pos - lo;
    out[i] = series[lo] + (series[hi] - series[lo]) * frac;
  }
  return out;
}

function noveltyCurve(units) {
  const curve = [];
  for (let i = 0; i < units.length; i++) {
    let maxSim = 0;
    for (let j = Math.max(0, i - 10); j < i; j++) {
      const sim = cosineSimilarity(units[i].field, units[j].field);
      if (sim > maxSim) maxSim = sim;
    }
    curve.push(1 - maxSim);
  }
  return curve;
}

function recurrenceCurve(units) {
  const curve = [];
  for (let i = 0; i < units.length; i++) {
    let rec = 0;
    for (let j = 0; j < i; j++) {
      rec += cosineSimilarity(units[i].field, units[j].field);
    }
    curve.push(i > 0 ? rec / i : 0);
  }
  return curve;
}

function operatorDistribution(units) {
  const dist = new Float64Array(OPERATOR_DIMS);
  for (const u of units) {
    const classified = classifyFieldVector(u.field);
    for (let d = 0; d < OPERATOR_DIMS; d++) dist[d] += classified[d];
  }
  const total = dist.reduce((s, v) => s + v, 0);
  if (total > 0) for (let d = 0; d < OPERATOR_DIMS; d++) dist[d] /= total;
  return dist;
}

function classifyFieldVector(field) {
  const out = new Float64Array(OPERATOR_DIMS);
  if (!field || field.length < 2) return out;
  const entropy = -field.reduce((s, v) => v > 0 ? s + v * Math.log(v + 1e-10) : s, 0);
  const peakIdx = field.indexOf(Math.max(...field));
  const energy = field.reduce((s, v) => s + v * v, 0);
  out[Math.floor(entropy * 9 / 5) % 9] += 0.5;
  out[Math.floor(peakIdx % 9)] += 0.3;
  out[Math.floor(energy * 9) % 9] += 0.2;
  return out;
}

function normalize(v) {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm > 1e-10) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function shapeDistance(a, b) {
  const novelDist = 1 - pearson(a.novelty, b.novelty);
  const recurDist = 1 - pearson(a.recurrence, b.recurrence);
  const opDist = 1 - cosineSimilarity(a.operatorDist, b.operatorDist);
  return 0.4 * novelDist + 0.4 * recurDist + 0.2 * opDist;
}

export function buildShapeDescriptors(text, options = {}) {
  const windowUnits = options.windowUnits ?? DEFAULT_WINDOW_UNITS;
  const stride = options.stride ?? DEFAULT_STRIDE;
  const resampleLen = options.resampleLen ?? RESAMPLE_LENGTH;

  const signal = extractTextFieldVectors(text);
  const frames = signal.frames;
  if (frames.length === 0) return { windows: [], units: [] };

  const units = frames.map((f, i) => ({
    offset: f.pos,
    length: f.span,
    field: f.field,
    index: i,
  }));

  const windows = [];
  for (let start = 0; start + windowUnits <= units.length; start += stride) {
    const slice = units.slice(start, start + windowUnits);
    if (slice.length < 3) continue;
    const rawNovelty = noveltyCurve(slice);
    const rawRecurrence = recurrenceCurve(slice);
    windows.push({
      startUnit: start,
      endUnit: start + slice.length - 1,
      byteOffset: slice[0].offset,
      byteLength: slice[slice.length - 1].offset + slice[slice.length - 1].length - slice[0].offset,
      descriptors: {
        novelty: resample(rawNovelty, resampleLen),
        recurrence: resample(rawRecurrence, resampleLen),
        operatorDist: normalize(operatorDistribution(slice)),
      },
    });
  }

  return { windows, units };
}

export function resolveArchetype(archetypeRef, { kindRegistry = null, instanceRegistry = null } = {}) {
  if (typeof archetypeRef !== "string") return { error: "archetypeRef must be a string" };

  const synthMatch = archetypeRef.match(/^synth:(.+)/);
  if (synthMatch) {
    return {
      kind: "synthesized",
      id: `synth:${canonicalHashSync({ description: synthMatch[1] }).slice(0, 16)}`,
      description: synthMatch[1],
      status: "experimental",
      ref: archetypeRef,
    };
  }

  if (kindRegistry && kindRegistry.has(archetypeRef)) {
    return {
      kind: "kind",
      id: archetypeRef,
      status: "resolved",
      ref: archetypeRef,
    };
  }

  if (instanceRegistry && instanceRegistry.has(archetypeRef)) {
    return {
      kind: "instance",
      id: archetypeRef,
      status: "resolved",
      ref: archetypeRef,
    };
  }

  return {
    error: `unresolvable archetype "${archetypeRef}" — no such Kind, Instance, or synthesized form`,
    missing: true,
    kind: null,
    ref: archetypeRef,
  };
}

export function structuralQuery(corpusId, archetypeRef, options = {}) {
  const {
    foldCache = null,
    windowUnits = DEFAULT_WINDOW_UNITS,
    stride = DEFAULT_STRIDE,
    topK = 10,
    resampleLen = RESAMPLE_LENGTH,
    permutationSamples = 200,
    specificityTopK = 10,
    kindRegistry = null,
    instanceRegistry = null,
    useCalculus = false,
    ts = null,
  } = options;

  const archetype = resolveArchetype(archetypeRef, { kindRegistry, instanceRegistry });
  if (archetype.error) {
    return {
      schema: "StructuralQueryResult@1",
      corpusId,
      archetypeRef,
      error: archetype.error,
      coldStart: true,
      needed: archetype.missing ? { archetypeRef } : {},
      results: [],
      timestamp: ts,
    };
  }

  if (!foldCache || !foldCache.windows || foldCache.windows.length === 0) {
    return {
      schema: "StructuralQueryResult@1",
      corpusId,
      archetypeRef,
      error: `corpus "${corpusId}" has no fold cache — ingest and fold the corpus first`,
      coldStart: true,
      needed: { corpusId, action: "ingest-and-fold" },
      results: [],
      timestamp: ts,
    };
  }

  if (archetype.kind === "synthesized") {
    const resolved = synthesizeArchetype(foldCache, archetype.description, { resampleLen });
    if (resolved.error) {
      return { schema: "StructuralQueryResult@1", corpusId, archetypeRef, error: resolved.error, results: [], timestamp: ts };
    }
    archetype.descriptors = resolved.descriptors;
  }

  if (!archetype.descriptors && archetype.kind !== "synthesized") {
    return {
      schema: "StructuralQueryResult@1",
      corpusId,
      archetypeRef,
      error: `archetype "${archetypeRef}" has no precomputed descriptors`,
      coldStart: true,
      needed: { archetypeRef, action: "induce-descriptors" },
      results: [],
      timestamp: ts,
    };
  }

  let scored;
  if (useCalculus) {
    const calcResults = calculusScoredWindows(foldCache.windows, archetype.descriptors, {
      topK: Math.max(topK, specificityTopK),
      permutationSamples,
      resampleLen,
    });
    scored = calcResults.map((cr) => {
      const win = foldCache.windows[cr.windowIndex];
      return { windowIndex: cr.windowIndex, distance: cr.distance, calculusGain: cr.calculusGain, calculusPassed: cr.calculusPassed, ...win };
    });
  } else {
    scored = [];
    for (let i = 0; i < foldCache.windows.length; i++) {
      const win = foldCache.windows[i];
      const dist = shapeDistance(win.descriptors, archetype.descriptors);
      scored.push({ windowIndex: i, distance: dist, ...win });
    }
    scored.sort((a, b) => a.distance - b.distance);
  }

  const topCandidates = scored.slice(0, Math.max(topK, specificityTopK));

  const gateResults = { permutation: null, specificity: null };

  if (topCandidates.length > 0) {
    gateResults.permutation = runGateA(topCandidates[0], foldCache, archetype, { resampleLen, samples: permutationSamples });
  }

  if (topCandidates.length >= specificityTopK) {
    gateResults.specificity = runGateB(topCandidates.slice(0, specificityTopK), scored, archetype, { resampleLen });
  }

  const results = topCandidates.slice(0, topK).map((c) => {
    const passedA = gateResults.permutation ? gateResults.permutation.passed : false;
    const passedB = gateResults.specificity ? (gateResults.specificity.rank <= specificityTopK) : false;
    return {
      windowIndex: c.windowIndex,
      distance: c.distance,
      byteOffset: c.byteOffset,
      byteLength: c.byteLength,
      startUnit: c.startUnit,
      endUnit: c.endUnit,
      gates: {
        permutationPassed: passedA,
        specificityPassed: passedB,
        allPassed: passedA && passedB,
      },
    };
  }).filter((r) => r.gates.allPassed);

  const event = {
    schema: "StructuralQueryEvent@1",
    queryText: null,
    resolvedArchetypeRef: { id: archetype.id, kind: archetype.kind, status: archetype.status },
    corpusId,
    foldVersion: foldCache.foldVersion ?? "unknown",
    windowGrain: windowUnits,
    stride,
    gateResults,
    topK: results,
    timestamp: ts,
    agent: "eo-query",
  };

  return {
    schema: "StructuralQueryResult@1",
    corpusId,
    archetypeRef,
    archetypeKind: archetype.kind,
    archetypeStatus: archetype.status,
    results,
    gateResults,
    nCandidates: scored.length,
    nPassed: results.length,
    event,
    timestamp: ts,
  };
}

// The sonata and fugue templates specify novelty and recurrence shapes but
// say nothing about an operator mix, so the operator distribution is filler.
// Filler still has to be the SAME filler every time: it is 20% of
// shapeDistance, so drawing it fresh per call made two queries for the same
// archetype incomparable. Seeded on the description, so one description is
// one archetype.
function syntheticOperatorDist(description, label) {
  const rng = createSeededRng(canonicalHashSync({ description, label, purpose: "structural-query-synthesize-operator-dist" }));
  return normalize(new Float64Array(OPERATOR_DIMS).map(() => rng()));
}

export function synthesizeArchetype(foldCache, description, options = {}) {
  const resampleLen = options.resampleLen ?? RESAMPLE_LENGTH;
  const desc = description.toLowerCase();

  if (desc.includes("sonata") || desc.includes("sonata-allegro")) {
    const themeA = new Float64Array(resampleLen);
    const themeB = new Float64Array(resampleLen);
    const development = new Float64Array(resampleLen);
    for (let i = 0; i < resampleLen; i++) {
      const t = i / (resampleLen - 1);
      themeA[i] = 0.2 + 0.8 * (1 - t);
      themeB[i] = 0.3 + 0.7 * (1 - t * 0.5) * Math.sin(t * Math.PI * 0.5 + 0.5);
      development[i] = 0.5 + 0.5 * Math.sin(t * Math.PI * 3);
    }
    return {
      descriptors: {
        novelty: themeA,
        recurrence: themeB,
        operatorDist: syntheticOperatorDist(description, "sonata-allegro-form"),
      },
      label: "sonata-allegro-form",
      experimental: true,
    };
  }

  if (desc.includes("fugue")) {
    const entries = new Float64Array(resampleLen);
    for (let i = 0; i < resampleLen; i++) {
      const t = i / (resampleLen - 1);
      entries[i] = 0.2 + 0.8 * Math.exp(-t * 2) * Math.sin(t * Math.PI * 2 + 0.5);
    }
    return {
      descriptors: {
        novelty: entries,
        recurrence: entries.map((v) => 1 - v * 0.5),
        operatorDist: syntheticOperatorDist(description, "fugue-form"),
      },
      label: "fugue-form",
      experimental: true,
    };
  }

  if (foldCache.windows.length > 0) {
    const avgNovelty = new Float64Array(resampleLen);
    const avgRecurrence = new Float64Array(resampleLen);
    const avgOp = new Float64Array(OPERATOR_DIMS);
    let count = 0;
    for (const win of foldCache.windows) {
      if (win.descriptors) {
        for (let i = 0; i < resampleLen; i++) avgNovelty[i] += win.descriptors.novelty[i];
        for (let i = 0; i < resampleLen; i++) avgRecurrence[i] += win.descriptors.recurrence[i];
        for (let i = 0; i < OPERATOR_DIMS; i++) avgOp[i] += win.descriptors.operatorDist[i];
        count++;
      }
    }
    if (count > 0) {
      for (let i = 0; i < resampleLen; i++) { avgNovelty[i] /= count; avgRecurrence[i] /= count; }
      for (let i = 0; i < OPERATOR_DIMS; i++) avgOp[i] /= count;
      normalize(avgOp);
      return {
        descriptors: { novelty: avgNovelty, recurrence: avgRecurrence, operatorDist: avgOp },
        label: `corpus-average`,
        experimental: true,
        note: "no matching archetype — using corpus average as placeholder",
      };
    }
  }

  return {
    error: `cannot synthesize archetype from description "${description}" — no corpus windows available`,
  };
}

export function runGateA(candidate, foldCache, archetype, options = {}) {
  const samples = options.samples ?? 200;
  const resampleLen = options.resampleLen ?? RESAMPLE_LENGTH;

  const realDistance = candidate.distance;
  const rng = createSeededRng(canonicalHashSync({ candidateIndex: candidate.windowIndex, archetypeId: archetype.id, purpose: "structural-query-gateA" }));

  const nullDistances = [];
  const win = foldCache.windows[candidate.windowIndex];
  if (!win) return { passed: false, error: "candidate window not found in fold cache", pValue: 1, nullMean: 1, nullSd: 0 };

  for (let s = 0; s < samples; s++) {
    const permutedNovelty = seededShuffle(Array.from(win.descriptors.novelty), rng);
    const permutedRecurrence = seededShuffle(Array.from(win.descriptors.recurrence), rng);
    const permutedOp = seededShuffle(Array.from(win.descriptors.operatorDist), rng);
    const dist = shapeDistance(
      { novelty: permutedNovelty, recurrence: permutedRecurrence, operatorDist: permutedOp },
      archetype.descriptors,
    );
    nullDistances.push(dist);
  }

  const result = deriveNull({
    nullSamples: nullDistances,
    observedStatistic: realDistance,
    tailDirection: "less",
    protocol: {
      name: "temporal-shuffle",
      iterations: samples,
      statistic: "shape-distance",
      scope: "within-window-unit-order",
    },
  });

  const nullMean = nullDistances.reduce((a, b) => a + b, 0) / nullDistances.length;
  const nullVariance = nullDistances.reduce((s, d) => s + (d - nullMean) ** 2, 0) / nullDistances.length;

  return {
    passed: result.passed,
    pValue: result.p_value,
    threshold: result.threshold,
    observedStatistic: realDistance,
    nullMean,
    nullSd: Math.sqrt(nullVariance),
    samples,
    nullProtocol: result.null_protocol,
  };
}

export function runGateB(topCandidates, allScored, archetype, options = {}) {
  const resampleLen = options.resampleLen ?? RESAMPLE_LENGTH;
  const rng = createSeededRng(canonicalHashSync({ archetypeId: archetype.id, purpose: "structural-query-gateB" }));

  const randomNovelty = resample(
    Array.from({ length: 20 }, () => rng()),
    resampleLen,
  );
  const randomRecurrence = resample(
    Array.from({ length: 20 }, () => rng()),
    resampleLen,
  );
  const randomOp = normalize(Array.from({ length: OPERATOR_DIMS }, () => rng()));

  const randomArchetype = {
    descriptors: { novelty: randomNovelty, recurrence: randomRecurrence, operatorDist: randomOp },
  };

  const reRanked = allScored.map((c) => ({
    ...c,
    randomDistance: shapeDistance(c.descriptors, randomArchetype.descriptors),
  }));
  reRanked.sort((a, b) => a.randomDistance - b.randomDistance);

  const rankMap = new Map(reRanked.map((c, i) => [c.windowIndex, i]));
  const topRanks = topCandidates.map((c) => rankMap.get(c.windowIndex) ?? allScored.length);
  const bestRank = Math.min(...topRanks);

  return {
    rank: bestRank + 1,
    n: allScored.length,
    passed: bestRank < allScored.length * 0.1,
    control: "random-unspecific-archetype",
  };
}

export function buildFoldCache(corpusId, text, options = {}) {
  const foldVersion = options.foldVersion ?? "v1";
  // Host-supplied; null when the host does not stamp one. See the clock note
  // at the top of this module — `builtAt` is provenance, not a cache key, and
  // a wall-clock read here would make two identical folds unequal.
  const builtAt = options.ts ?? null;
  const descriptors = buildShapeDescriptors(text, options);
  return {
    corpusId,
    foldVersion,
    windows: descriptors.windows,
    units: descriptors.units,
    nUnits: descriptors.units.length,
    nWindows: descriptors.windows.length,
    builtAt,
  };
}

export function calculusScoredWindows(windows, archetypeDescriptors, options = {}) {
  const topK = options.topK ?? 10;
  const preFilterK = options.preFilterK ?? Math.max(50, topK * 3);
  const resampleLen = options.resampleLen ?? RESAMPLE_LENGTH;
  const opDims = OPERATOR_DIMS;

  const archetypeFlat = [
    ...Array.from(archetypeDescriptors.novelty),
    ...Array.from(archetypeDescriptors.recurrence),
    ...Array.from(archetypeDescriptors.operatorDist),
  ];

  const preScored = windows.map((w, i) => {
    const dist = shapeDistance(w.descriptors, archetypeDescriptors);
    return { windowIndex: i, distance: dist, window: w };
  });
  preScored.sort((a, b) => a.distance - b.distance);
  const candidates = preScored.slice(0, preFilterK);

  const calculusResults = candidates.map((c) => {
    const windowFlat = [
      ...Array.from(c.window.descriptors.novelty),
      ...Array.from(c.window.descriptors.recurrence),
      ...Array.from(c.window.descriptors.operatorDist),
    ];

    const seriesFamily = [
      { id: "archetype", series: archetypeFlat },
      { id: `window:${c.windowIndex}`, series: windowFlat },
    ];

    try {
      const calc = induceCalculus(seriesFamily, {
        proposeFraction: 0.5,
        minProposeSeries: 1,
        minHoldoutSeries: 1,
        minVocabularySize: 1,
        minSupportFraction: 0.5,
        shuffles: Math.max(8, Math.floor(options.permutationSamples ?? 20)),
        quantile: 0.8,
        minRelativeEffect: 0.01,
        population: `structural-query:${c.windowIndex}`,
      });

      if (calc && calc.transfer_null) {
        const gain = calc.aggregate_transfer_gain ?? 0;
        const passed = calc.transfer_null.passed ?? false;
        const pValue = calc.transfer_null.p_value ?? 1;
        return {
          windowIndex: c.windowIndex,
          calculusGain: gain,
          calculusPassed: passed,
          pValue,
          distance: c.distance,
        };
      }
    } catch {
      return { windowIndex: c.windowIndex, calculusGain: -Infinity, calculusPassed: false, pValue: 1, distance: c.distance };
    }
    return { windowIndex: c.windowIndex, calculusGain: -Infinity, calculusPassed: false, pValue: 1, distance: c.distance };
  });

  calculusResults.sort((a, b) => (b.calculusGain - a.calculusGain) || (a.distance - b.distance));
  return calculusResults.slice(0, topK);
}

export { shapeDistance };
