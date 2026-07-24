import { createSeededRng, deriveNull, seededShuffle } from "../emergence/nulls/index.js";

const DEFAULT_MAX_PERIOD = 8;
const DEFAULT_NULL_ITERATIONS = 64;
const MIN_SUPPORT = 3;

export function detectMotifs(units, options = {}) {
  if (!Array.isArray(units)) throw new TypeError("detectMotifs: units must be an array");
  if (units.length < MIN_SUPPORT) return Object.freeze([]);

  const maxPeriod = Math.min(options.maxPeriodUnits ?? DEFAULT_MAX_PERIOD, Math.floor(units.length / MIN_SUPPORT));
  const iterations = options.nullIterations ?? DEFAULT_NULL_ITERATIONS;
  const quantile = options.quantile ?? 0.95;
  const seed = options.seed ?? "eoreader5.motif";
  const candidates = [];

  for (let period = 1; period <= maxPeriod; period += 1) {
    const candidate = bestCandidateForPeriod(units, period);
    if (!candidate || candidate.instances.length < MIN_SUPPORT) continue;

    const observed = evidence(candidate);
    const nullSamples = motifNullSamples(units, period, iterations, `${seed}.${period}`);
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

function bestCandidateForPeriod(units, period) {
  let best = null;
  for (let start = 0; start <= units.length - period; start += 1) {
    const basis = units.slice(start, start + period);
    const instances = [];
    const aligned = [];
    let cursor = start;
    while (cursor <= units.length - period) {
      const window = units.slice(cursor, cursor + period);
      const cost = alignmentCost(basis, window);
      if (cost <= 0.25) {
        instances.push(Object.freeze({ start: cursor, end: cursor + period }));
        aligned.push(window);
        cursor += period;
      } else {
        cursor += 1;
      }
    }
    if (instances.length < MIN_SUPPORT) continue;
    const regularity = mean(aligned.map((window) => alignmentCost(basis, window)));
    const candidate = { period, instances, aligned, regularity };
    if (!best || candidateScore(candidate) > candidateScore(best)) best = candidate;
  }
  return best;
}

function motifNullSamples(units, period, iterations, seed) {
  const rng = createSeededRng(seed);
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const shuffled = seededShuffle(units, rng);
    const candidate = bestCandidateForPeriod(shuffled, period);
    samples.push(candidate ? evidence(candidate) : 0);
  }
  return samples;
}

function evidence(candidate) {
  return candidate.instances.length * (1 - candidate.regularity);
}

function candidateScore(candidate) {
  return evidence(candidate) + candidate.period * 0.01;
}

function alignmentCost(a, b) {
  const slots = Math.max(a.length, b.length);
  let total = 0;
  for (let i = 0; i < slots; i += 1) total += unitCost(a[i], b[i]);
  return total / slots;
}

function unitCost(a, b) {
  if (!a || !b) return 1;
  const typeCost = String(a.type ?? "") === String(b.type ?? "") ? 0 : 0.5;
  return Math.min(1, typeCost + fieldDistance(a.field, b.field) * 0.5);
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
