/**
 * Lift — the mRNA reader
 *
 * Lifts raw observations into fold space.
 * Before lift: text is just text (surfaces, values, blocks)
 * After lift: text is amplitude vectors (operator, terrain, stance)
 *
 * The ribosome needs to read mRNA; lift is the mRNA reader.
 * It converts the language of nucleotides (raw text) into
 * the language of amino acids (amplitude vectors).
 *
 * Biological parallel:
 *   - Aminoacyl-tRNA synthetase = lift
 *   - It charges tRNAs with the correct amino acid
 *   - Each observation gets charged with its fold
 */

import { fold, classicalToFold } from "../../quantum/index.js";

/**
 * Lift a single text into fold space.
 *
 * @param {string} text - Raw text to lift
 * @param {object} priors - Accumulated knowledge
 * @returns {object} { fold, text, timestamp }
 */
export function liftOne(text, priors = null) {
  if (!text || text.length === 0) {
    return { fold: null, text: "", timestamp: null };
  }

  const f = fold(text, priors);

  return {
    fold: f,
    text,
    timestamp: null,
  };
}

/**
 * Lift multiple observations into fold space.
 *
 * @param {Array} observations - Raw observations (text blocks, surfaces, values)
 * @param {object} opts - { priors, onLift? }
 * @returns {Array} Lifted observations with folds
 */
export function liftAll(observations, opts = {}) {
  const { priors = null, onLift = null } = opts;
  const lifted = [];

  for (const obs of observations) {
    // Extract text from observation (handles various formats)
    const text = extractText(obs);

    if (!text || text.length < 3) continue;

    const liftedObs = liftOne(text, priors);

    // Attach fold to observation
    const entry = {
      ...obs,
      _fold: liftedObs.fold,
      _liftedAt: liftedObs.timestamp,
      _text: text,
    };

    lifted.push(entry);

    if (onLift) {
      onLift(entry);
    }
  }

  return lifted;
}

/**
 * Lift an entire observation block (surfaces + values + axes).
 *
 * @param {object} observation - Full observation with fields, surfaces, values
 * @param {object} opts - { priors }
 * @returns {object} Observation with folds attached to each field
 */
export function liftObservation(observation, opts = {}) {
  const { priors = null } = opts;
  const result = { ...observation, _liftedFields: [] };

  // Lift surfaces
  const surfaces = observation.anchors?.surfaces ?? [];
  for (const surface of surfaces) {
    if (surface.text) {
      const lifted = liftOne(surface.text, priors);
      result._liftedFields.push({
        type: "surface",
        text: surface.text,
        fold: lifted.fold,
      });
    }
  }

  // Lift field values
  for (const field of observation.fields ?? []) {
    const values = field.values ?? [];
    for (const value of values) {
      if (typeof value === "string" && value.length > 3) {
        const lifted = liftOne(value, priors);
        result._liftedFields.push({
          type: "value",
          fieldId: field.field_id,
          text: value,
          fold: lifted.fold,
        });
      }
    }

    // Lift axes
    const axes = field.axes ?? [];
    for (const axis of axes) {
      if (typeof axis === "string" && axis.length > 3) {
        const lifted = liftOne(axis, priors);
        result._liftedFields.push({
          type: "axis",
          fieldId: field.field_id,
          text: axis,
          fold: lifted.fold,
        });
      }
    }
  }

  // Composite fold: average of all field folds
  if (result._liftedFields.length > 0) {
    result._compositeFold = averageFolds(
      result._liftedFields.map(f => f.fold).filter(Boolean)
    );
  }

  return result;
}

/**
 * Lift a reading snapshot (all passages).
 *
 * @param {object} snapshot - Reading snapshot with passages
 * @param {object} opts - { priors }
 * @returns {object} Snapshot with folds attached
 */
export function liftSnapshot(snapshot, opts = {}) {
  const { priors = null } = opts;
  const result = { ...snapshot, _liftedPassages: [] };

  for (const passage of snapshot.passages ?? []) {
    const text = passage.anchors?.exact_text?.join(" ") ?? "";
    if (!text || text.length < 3) continue;

    const lifted = liftOne(text, priors);
    result._liftedPassages.push({
      passageId: passage.passage_id,
      unitId: passage.unit_id,
      text,
      fold: lifted.fold,
    });
  }

  return result;
}

// ── Helpers ──

/**
 * Extract text from various observation formats.
 */
function extractText(obs) {
  // Direct text field
  if (obs.text) return obs.text;

  // Surface text
  if (obs.anchors?.surfaces?.length > 0) {
    return obs.anchors.surfaces.map(s => s.text).filter(Boolean).join(" ");
  }

  // Field values
  if (obs.fields?.length > 0) {
    return obs.fields
      .flatMap(f => [...(f.values ?? []), ...(f.axes ?? [])])
      .filter(v => typeof v === "string")
      .join(" ");
  }

  // Block store values
  if (obs.values?.length > 0) {
    return obs.values.filter(v => typeof v === "string").join(" ");
  }

  return "";
}

/**
 * Average multiple folds into a single composite fold.
 */
function averageFolds(folds) {
  if (folds.length === 0) return null;
  if (folds.length === 1) return folds[0];

  const avgOperator = {};
  const avgTerrain = {};
  const avgStance = {};

  // Initialize
  const opKeys = Object.keys(folds[0].operator);
  const terrKeys = Object.keys(folds[0].terrain);
  const stKeys = Object.keys(folds[0].stance);

  for (const k of opKeys) avgOperator[k] = 0;
  for (const k of terrKeys) avgTerrain[k] = 0;
  for (const k of stKeys) avgStance[k] = 0;

  // Sum
  for (const f of folds) {
    for (const k of opKeys) avgOperator[k] += (f.operator[k] || 0);
    for (const k of terrKeys) avgTerrain[k] += (f.terrain[k] || 0);
    for (const k of stKeys) avgStance[k] += (f.stance[k] || 0);
  }

  // Average
  const n = folds.length;
  for (const k of opKeys) avgOperator[k] /= n;
  for (const k of terrKeys) avgTerrain[k] /= n;
  for (const k of stKeys) avgStance[k] /= n;

  // Normalize
  normalizeAmplitudes(avgOperator);
  normalizeAmplitudes(avgTerrain);
  normalizeAmplitudes(avgStance);

  return {
    operator: avgOperator,
    terrain: avgTerrain,
    stance: avgStance,
    timestamp: null,
  };
}

function normalizeAmplitudes(amplitudes) {
  let sumSquares = 0;
  for (const amp of Object.values(amplitudes)) {
    sumSquares += amp * amp;
  }

  if (sumSquares > 0) {
    const norm = Math.sqrt(sumSquares);
    for (const key of Object.keys(amplitudes)) {
      amplitudes[key] /= norm;
    }
  }
}
