import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  advisoryClassifyTerrain,
  advisoryClassifyStance,
  advisoryClassifyOperator,
  scoreCoordinate,
  focusBias,
  isDiagonal,
  coherence,
  DIAGONAL_CELLS,
  TERRAINS,
  STANCES,
} from "./index.js";

test("advisoryClassifyTerrain returns one of the 9 terrains", () => {
  for (const t of TERRAINS) assert.ok(TERRAINS.includes(t));
  assert.equal(advisoryClassifyTerrain("who was Caesar"), "Entity");
  assert.equal(advisoryClassifyTerrain("the empire was large"), "Network");
  assert.equal(advisoryClassifyTerrain("I feel fear"), "Atmosphere");
  assert.equal(advisoryClassifyTerrain("nothing here"), "Void");
  assert.equal(advisoryClassifyTerrain("random unrelated text"), "Field");
});

test("advisoryClassifyStance returns one of the 9 stances", () => {
  assert.equal(advisoryClassifyStance("describe what happened"), "Tracing");
  assert.equal(advisoryClassifyStance("break down the argument"), "Dissecting");
  assert.equal(advisoryClassifyStance("why did this happen"), "Unraveling");
  assert.equal(advisoryClassifyStance("help me understand"), "Tending");
  assert.equal(advisoryClassifyStance("connect these ideas"), "Binding");
  assert.equal(advisoryClassifyStance("create something new"), "Making");
  assert.equal(advisoryClassifyStance("organize the data"), "Composing");
  assert.equal(advisoryClassifyStance("tell me about it"), "Tracing");
});

test("advisoryClassifyOperator returns one of the 9 operator codes", () => {
  assert.equal(advisoryClassifyOperator("remove the old data"), "NUL");
  assert.equal(advisoryClassifyOperator("segment this text"), "SEG");
  assert.equal(advisoryClassifyOperator("define the term"), "DEF");
  assert.equal(advisoryClassifyOperator("show me the results"), "SIG");
  assert.equal(advisoryClassifyOperator("connect these points"), "CON");
  assert.equal(advisoryClassifyOperator("evaluate the performance"), "EVA");
  assert.equal(advisoryClassifyOperator("build a new model"), "INS");
  assert.equal(advisoryClassifyOperator("merge these datasets"), "SYN");
  assert.equal(advisoryClassifyOperator("record the findings"), "REC");
});

test("classify returns full coordinate", () => {
  const coord = classify("who was Caesar and what did he do");
  assert.equal(coord.terrain, "Entity");
  assert.ok(coord.operator);
  assert.ok(coord.stance);
});

test("isDiagonal identifies diagonal cells", () => {
  assert.equal(isDiagonal(DIAGONAL_CELLS[0]), true);
  assert.equal(isDiagonal({ operator: "NUL", terrain: "Void", stance: "Clearing" }), true);
  assert.equal(isDiagonal({ operator: "NUL", terrain: "Entity", stance: "Clearing" }), false);
  assert.equal(isDiagonal(null), false);
  assert.equal(isDiagonal({}), false);
});

test("coherence returns true for empty or same-diagonal cells", () => {
  assert.equal(coherence([]), true);
  assert.equal(coherence(null), true);
  assert.equal(coherence([
    { operator: "NUL", terrain: "Void", stance: "Clearing" },
    { operator: "NUL", terrain: "Void", stance: "Clearing" },
  ]), true);
  assert.equal(coherence([
    { operator: "NUL", terrain: "Void", stance: "Clearing" },
    { operator: "SIG", terrain: "Entity", stance: "Tracing" },
  ]), false);
});

test("scoreCoordinate rewards matching terrain, operator, stance, and diagonal", () => {
  const cell = { operator: "SIG", terrain: "Entity", stance: "Tracing" };
  const focus = { operator: "SIG", terrain: "Entity", stance: "Tracing" };
  const score = scoreCoordinate(cell, focus);
  // terrain(3) + operator(2) + stance(1) + diagonal(2) = 8
  assert.equal(score, 8);
});

test("focusBias returns bias amount matching entry coord to focus", () => {
  const entry = { coord: { operator: "SIG", terrain: "Entity", stance: "Tracing" } };
  const focus = { operator: "SIG", terrain: "Entity", stance: "Tracing" };
  assert.equal(focusBias(entry, focus), 8);
  assert.equal(focusBias(entry, { operator: "DEF", terrain: "Void", stance: "Clearing" }), 0);
  assert.equal(focusBias({ coord: null }, focus), 0);
  assert.equal(focusBias({}, focus), 0);
});
