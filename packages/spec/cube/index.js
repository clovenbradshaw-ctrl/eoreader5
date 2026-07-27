// Cube coordinate: terrain × stance × operator.
//
// The three faces of the EO cube. Terrain is WHERE (semantic domain),
// stance is HOW (approach), operator is WHAT (act). Together they
// identify a cell in the 9×9×9 space.
//
// Ported from eoreader4.2:docs/cube.md (Site face, Resolution face)
// and eoreader4.2:src/wiki/terrains.js. The operator dimension was
// already ported (packages/spec/operators/epoch.js). This module
// adds the terrain and stance dimensions and provides the diagonal
// coherence guard (core/cube.js's isDiagonal/coherence in 4.2).

import { OPERATOR_CODES } from "../operators/epoch.js";

/** The 9 terrains (Site face, Ground column Void/Field/Atmosphere). */
export const TERRAINS = Object.freeze([
  "Void",
  "Entity",
  "Kind",
  "Field",
  "Link",
  "Network",
  "Atmosphere",
  "Lens",
  "Paradigm",
]);

/** The 9 stances (Resolution face). */
export const STANCES = Object.freeze([
  "Clearing",
  "Dissecting",
  "Unraveling",
  "Tending",
  "Binding",
  "Tracing",
  "Cultivating",
  "Making",
  "Composing",
]);

/**
 * The diagonal cells: one per mode (Existence/Structure/Interpretation).
 * On the diagonal, terrain, stance, and operator agree on the same
 * semantic region. This is what 4.2 calls the coherence guard — the
 * thing that makes omnimodality real.
 *
 * Each diagonal cell pairs an operator with its "home" terrain and stance.
 */
export const DIAGONAL_CELLS = Object.freeze([
  Object.freeze({ operator: "NUL", terrain: "Void", stance: "Clearing" }),
  Object.freeze({ operator: "SIG", terrain: "Entity", stance: "Tracing" }),
  Object.freeze({ operator: "INS", terrain: "Kind", stance: "Making" }),
  Object.freeze({ operator: "SEG", terrain: "Field", stance: "Dissecting" }),
  Object.freeze({ operator: "CON", terrain: "Link", stance: "Binding" }),
  Object.freeze({ operator: "SYN", terrain: "Network", stance: "Composing" }),
  Object.freeze({ operator: "DEF", terrain: "Lens", stance: "Unraveling" }),
  Object.freeze({ operator: "EVA", terrain: "Atmosphere", stance: "Tending" }),
  Object.freeze({ operator: "REC", terrain: "Paradigm", stance: "Cultivating" }),
]);

/**
 * isDiagonal(cell) — true iff the cell sits on the cube diagonal.
 * A cell is diagonal when its operator, terrain, and stance all agree
 * on the same region (operator maps to that terrain+stance on the
 * diagonal table).
 */
export function isDiagonal(cell) {
  if (!cell) return false;
  return DIAGONAL_CELLS.some(
    (d) => d.operator === cell.operator && d.terrain === cell.terrain && d.stance === cell.stance,
  );
}

/**
 * coherence(cells) — check that a set of cells from different faces
 * agree on a shared diagonal. Returns true iff every cell either sits
 * on the diagonal or shares the same diagonal cell as its neighbors.
 *
 * This is the structural guard: two observations from different
 * modalities (text, audio, tabular) must resolve to the same
 * diagonal region to be considered about the same thing.
 */
export function coherence(cells) {
  if (!Array.isArray(cells) || cells.length === 0) return true;
  const diagonalHits = cells.filter(isDiagonal);
  if (diagonalHits.length === 0) return true;
  const canonical = `${diagonalHits[0].operator}:${diagonalHits[0].terrain}:${diagonalHits[0].stance}`;
  return diagonalHits.every(
    (c) => `${c.operator}:${c.terrain}:${c.stance}` === canonical,
  );
}

/** True iff value is a known terrain string. */
export function isTerrain(value) {
  return TERRAINS.includes(value);
}

/** True iff value is a known stance string. */
export function isStance(value) {
  return STANCES.includes(value);
}

/**
 * diagonalFor(operator) — return the diagonal cell for an operator,
 * or null if the operator is not on the diagonal.
 */
export function diagonalFor(operator) {
  return DIAGONAL_CELLS.find((d) => d.operator === operator) ?? null;
}
