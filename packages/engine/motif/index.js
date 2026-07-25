import { createSeededRng, deriveNull, seededShuffle } from "../emergence/nulls/index.js";

export function detectMotifs(units, options = {}) {
  if (!Array.isArray(units)) throw new TypeError("detectMotifs: units must be an array");

  const n = units.length;
  const maxPeriod = Math.min(
    options.maxPeriodUnits ?? Math.max(4, Math.floor(Math.sqrt(n) / 2)),
    Math.floor(n / 2),
  );
  const iterations = options.nullIterations ?? Math.max(32, n * 4);
  const quantile = options.quantile ?? 0.95;
  const seed = options.seed ?? "eoreader5.motif";
  const candidates = [];

  const minSupport = deriveMinSupport(units);
  if (n < minSupport) return Object.freeze([]);

  const typeCosts = deriveTypeCosts(units);
  const fieldWeight = deriveFieldWeight(units);

  const costFn = (a, b) => {
    if (!a || !b) return 1;
    const typeCost =
      String(a.type ?? "") === String(b.type ?? "")
        ? typeCosts.same
        : typeCosts.diff;
    return Math.min(1, typeCost + fieldDistance(a.field, b.field) * fieldWeight);
  };

  const alignCost = (a, b) => {
    const slots = Math.max(a.length, b.length);
    let total = 0;
    for (let i = 0; i < slots; i += 1) total += costFn(a[i], b[i]);
    return total / slots;
  };

  const alignThreshold = deriveAlignmentThreshold(units, costFn);

  for (let period = 1; period <= maxPeriod; period += 1) {
    const candidate = bestCandidateForPeriod(
      units, period, minSupport, alignCost, alignThreshold, maxPeriod,
    );
    if (!candidate || candidate.instances.length < minSupport) continue;

    const observed = evidence(candidate);
    const nullSamples = motifNullSamples(
      units, period, iterations, `${seed}.${period}`, minSupport, alignCost, alignThreshold, maxPeriod,
    );
    const nullResult = deriveNull({
      nullSamples,
      observedStatistic: observed,
      tailDirection: "greater",
      quantile,
      protocol: { name: "unit-sequence-shuffle", iterations, period_units: period },
    });

    if (!nullResult.passed || nullResult.p_value > 1 - quantile) continue;
    candidates.push(toMotif(candidate, nullResult));
  }

  return Object.freeze(selectNonRedundant(candidates));
}

function deriveMinSupport(units) {
  const typeCounts = new Map();
  for (const u of units) {
    const t = String(u.type ?? "");
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }
  const freqs = [...typeCounts.values()];
  if (freqs.length === 0) return 2;
  return Math.max(2, Math.ceil(freqs.reduce((a, b) => a + b, 0) / freqs.length));
}

function deriveTypeCosts(units) {
  const typeCounts = new Map();
  const coOccurrence = new Map();
  for (const u of units) {
    const t = String(u.type ?? "");
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    if (!coOccurrence.has(t)) coOccurrence.set(t, new Map());
  }
  for (let i = 0; i < units.length; i += 1) {
    const tA = String(units[i].type ?? "");
    for (let j = i + 1; j < units.length; j += 1) {
      const tB = String(units[j].type ?? "");
      if (tA === tB) continue;
      const mA = coOccurrence.get(tA);
      const mB = coOccurrence.get(tB);
      mA.set(tB, (mA.get(tB) || 0) + 1);
      mB.set(tA, (mB.get(tA) || 0) + 1);
    }
  }
  const similarities = [];
  for (const [tA, coMap] of coOccurrence) {
    const cA = typeCounts.get(tA) || 0;
    if (cA === 0) continue;
    for (const [tB, co] of coMap) {
      const cB = typeCounts.get(tB) || 0;
      similarities.push(co / Math.max(cA, cB));
    }
  }
  let diffCost = 0.5;
  if (similarities.length > 0) {
    similarities.sort((a, b) => a - b);
    const mid = Math.floor(similarities.length / 2);
    const median =
      similarities.length % 2 === 0
        ? (similarities[mid - 1] + similarities[mid]) / 2
        : similarities[mid];
    diffCost = Math.min(1, Math.max(0, 1 - median));
  }
  return { same: 0, diff: diffCost };
}

function deriveFieldWeight(units) {
  const distances = [];
  for (let i = 0; i < units.length; i += 1) {
    for (let j = i + 1; j < units.length; j += 1) {
      distances.push(fieldDistance(units[i].field, units[j].field));
    }
  }
  if (distances.length === 0) return 0.5;
  const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
  const variance = distances.reduce((acc, d) => acc + (d - mean) ** 2, 0) / distances.length;
  return 1 / (1 + Math.sqrt(variance));
}

function deriveAlignmentThreshold(units, costFn) {
  const costs = [];
  for (let i = 0; i < units.length; i += 1) {
    for (let j = i + 1; j < units.length; j += 1) {
      costs.push(costFn(units[i], units[j]));
    }
  }
  if (costs.length === 0) return 0.25;
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
  const variance = costs.reduce((acc, c) => acc + (c - mean) ** 2, 0) / costs.length;
  return mean + 1.96 * Math.sqrt(variance) / Math.sqrt(units.length);
}

function bestCandidateForPeriod(units, period, minSupport, alignmentCost, alignThreshold, maxPeriod) {
  let best = null;
  for (let start = 0; start <= units.length - period; start += 1) {
    const basis = units.slice(start, start + period);
    const instances = [];
    const aligned = [];
    let cursor = start;
    while (cursor <= units.length - period) {
      const window = units.slice(cursor, cursor + period);
      const cost = alignmentCost(basis, window);
      if (cost <= alignThreshold) {
        instances.push(Object.freeze({ start: cursor, end: cursor + period }));
        aligned.push(window);
        cursor += period;
      } else {
        cursor += 1;
      }
    }
    if (instances.length < minSupport) continue;
    const regularity = mean(aligned.map((window) => alignmentCost(basis, window)));
    const candidate = { period, instances, aligned, regularity };
    if (!best || candidateScore(candidate, maxPeriod) > candidateScore(best, maxPeriod)) best = candidate;
  }
  return best;
}

function motifNullSamples(units, period, iterations, seed, minSupport, alignmentCost, alignThreshold, maxPeriod) {
  const rng = createSeededRng(seed);
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const shuffled = seededShuffle(units, rng);
    const candidate = bestCandidateForPeriod(shuffled, period, minSupport, alignmentCost, alignThreshold, maxPeriod);
    samples.push(candidate ? evidence(candidate) : 0);
  }
  return samples;
}

function evidence(candidate) {
  return candidate.instances.length * (1 - candidate.regularity);
}

function candidateScore(candidate, maxPeriod) {
  return evidence(candidate) + candidate.period / maxPeriod;
}

function fieldDistance(a, b) {
  const va = Array.isArray(a) ? a : [];
  const vb = Array.isArray(b) ? b : [];
  const length = Math.max(va.length, vb.length);
  if (length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    const delta = Number(va[i] ?? 0) - Number(vb[i] ?? 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum) / Math.sqrt(length);
}

function toMotif(candidate, nullResult) {
  return Object.freeze({
    period_units: candidate.period,
    instances: Object.freeze(candidate.instances),
    schema: Object.freeze(schemaFor(candidate.aligned)),
    regularity: candidate.regularity,
    null_p: nullResult.p_value,
    null_result: nullResult,
  });
}

function schemaFor(aligned) {
  const period = aligned[0].length;
  const slots = [];
  for (let index = 0; index < period; index += 1) {
    const present = aligned.map((instance) => instance[index]).filter(Boolean);
    const vectors = present.map((unit) => (Array.isArray(unit.field) ? unit.field : []));
    slots.push(Object.freeze({
      role_hint: `slot_${index}`,
      fill_rate: present.length / aligned.length,
      variance: vectorVariance(vectors),
      unit_types: Object.freeze([...new Set(present.map((unit) => String(unit.type ?? "")))].sort()),
    }));
  }
  return slots;
}

function vectorVariance(vectors) {
  if (vectors.length <= 1) return 0;
  const length = Math.max(...vectors.map((v) => v.length), 0);
  if (length === 0) return 0;
  let total = 0;
  for (let dim = 0; dim < length; dim += 1) {
    const values = vectors.map((v) => Number(v[dim] ?? 0));
    const avg = mean(values);
    total += mean(values.map((value) => (value - avg) ** 2));
  }
  return total / length;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function selectNonRedundant(candidates) {
  return [...candidates]
    .sort(
      (a, b) =>
        b.instances.length * b.period_units - a.instances.length * a.period_units ||
        b.instances.length - a.instances.length ||
        a.regularity - b.regularity ||
        b.period_units - a.period_units,
    )
    .slice(0, 1);
}
