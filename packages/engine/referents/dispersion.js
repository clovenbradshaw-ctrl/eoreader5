/**
 * Normalised Shannon entropy of a referent's incident coupling weights.
 * Returns null for degree < 2, zero/non-positive total weight, or no usable
 * finite positive incident weights: those cases cannot evidence a flat
 * infrastructural neighbourhood.
 */
export function couplingDispersion(incidentWeights) {
  if (!Array.isArray(incidentWeights)) {
    throw new TypeError("couplingDispersion: incidentWeights must be an array");
  }

  const weights = incidentWeights.filter((weight) => typeof weight === "number" && Number.isFinite(weight) && weight > 0);
  if (weights.length < 2) return null;

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return null;

  const entropy = weights.reduce((sum, weight) => {
    const p = weight / total;
    return sum - p * Math.log(p);
  }, 0);
  const dispersion = entropy / Math.log(weights.length);

  if (Math.abs(dispersion - 1) < Number.EPSILON * weights.length) return 1;
  return Math.min(1, Math.max(0, dispersion));
}
