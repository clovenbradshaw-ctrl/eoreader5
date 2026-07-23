// Born-null derivation (spec section 12.8 / "EO Terrain Promotion and
// Predictive Prior Induction v0.2"): scoring rules measure, deriveNull
// decides. No promotion gate anywhere in this engine may compare a
// statistic against a hand-set constant; every threshold MUST come from an
// explicit perturbation of the actual data.
//
// This module is pure and deterministic: it never reads ambient time or
// randomness (see packages/conformance/invariants/forbidden-dependencies
// .test.js). Callers who need to *generate* perturbations for a null
// distribution (shuffled sequence, random equal-size grouping, resampled
// boundary, ...) should derive their own perturbed samples using
// createSeededRng, then hand the resulting statistics to deriveNull.

/**
 * Deterministic PRNG (mulberry32), seeded from an explicit string or number.
 * Draws no ambient randomness at all; the same seed always produces the
 * same stream. Returns a function () => number in [0, 1).
 */
export function createSeededRng(seed) {
  let state = hashSeed(seed) >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return Math.trunc(seed);
  const text = String(seed ?? "eoreader5.deriveNull.default-seed");
  // FNV-1a, pure integer arithmetic, no ambient state.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash;
}

/**
 * Shuffle an array deterministically using a seeded rng (Fisher-Yates).
 * Does not mutate the input.
 */
export function seededShuffle(values, rng) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Derive a Born null threshold from an explicit null distribution and
 * report whether an observed statistic clears it.
 *
 * @param {object} args
 * @param {number[]} args.nullSamples - statistic values computed under an
 *   explicit perturbation of the actual data (the caller's job: shuffle,
 *   random-group, resample boundaries, etc). MUST be non-empty.
 * @param {number} args.observedStatistic - the statistic computed on the
 *   real, unperturbed data.
 * @param {"greater"|"less"} [args.tailDirection="greater"] - "greater" when
 *   a larger statistic is evidence for the candidate (e.g. transfer gain,
 *   mass, coupling); "less" when a smaller statistic is evidence for it
 *   (e.g. boundary displacement, exchangeability collapse residual).
 * @param {number} [args.quantile=0.95] - the null-distribution quantile the
 *   observed statistic must clear.
 * @param {object} [args.protocol] - free-form description of the
 *   perturbation used (name, iterations, scope, ...). Echoed back verbatim
 *   as `nullProtocol` so every threshold stays auditable per section 12.8.
 */
export function deriveNull({
  nullSamples,
  observedStatistic,
  tailDirection = "greater",
  quantile = 0.95,
  protocol,
}) {
  if (!Array.isArray(nullSamples) || nullSamples.length === 0) {
    throw new TypeError("deriveNull: nullSamples must be a non-empty array");
  }
  if (typeof observedStatistic !== "number" || Number.isNaN(observedStatistic)) {
    throw new TypeError("deriveNull: observedStatistic must be a number");
  }
  if (tailDirection !== "greater" && tailDirection !== "less") {
    throw new TypeError('deriveNull: tailDirection must be "greater" or "less"');
  }
  if (typeof quantile !== "number" || quantile <= 0 || quantile >= 1) {
    throw new TypeError("deriveNull: quantile must be in (0, 1)");
  }

  const sorted = [...nullSamples].sort((a, b) => a - b);
  const rank = quantile * (sorted.length - 1);
  const lowIndex = Math.floor(rank);
  const highIndex = Math.min(lowIndex + 1, sorted.length - 1);
  const fraction = rank - lowIndex;
  const upperQuantileValue = sorted[lowIndex] + (sorted[highIndex] - sorted[lowIndex]) * fraction;

  // "greater" tail: the candidate must beat what chance rarely exceeds, so
  // the threshold is the upper quantile of the null distribution.
  // "less" tail: the candidate must beat what chance rarely falls below, so
  // the threshold is the lower quantile (mirrored from the same quantile
  // computed off the other end of the sorted distribution).
  const threshold =
    tailDirection === "greater" ? upperQuantileValue : sorted[sorted.length - 1] + sorted[0] - upperQuantileValue;

  const passed = tailDirection === "greater" ? observedStatistic >= threshold : observedStatistic <= threshold;

  const asOrMoreExtreme =
    tailDirection === "greater"
      ? sorted.filter((value) => value >= observedStatistic).length
      : sorted.filter((value) => value <= observedStatistic).length;
  const pValue = asOrMoreExtreme / sorted.length;

  return Object.freeze({
    schema: "NullProtocol@1",
    null_protocol: protocol ?? null,
    // Retained (not just sample_count) so a gate result stays fully
    // replayable per section 27.14 without the caller needing to
    // regenerate the same perturbation twice.
    null_samples: Object.freeze(sorted),
    sample_count: sorted.length,
    quantile,
    tail_direction: tailDirection,
    threshold,
    observed_statistic: observedStatistic,
    passed,
    p_value: pValue,
  });
}
