import test from 'node:test';
import assert from 'node:assert/strict';

import {
  curlField,
  divergenceField,
  currentDensity,
  laplacianField,
  gradientMagnitude,
  vorticity,
  findDipoles,
  potentialEnergy,
  analyzeFlowPhysics,
  physicsSeries,
} from './physics.js';

const COLS = 20;
const ROWS = 15;
const N = COLS * ROWS;

// Build a flow field from an analytic function of block coordinates.
const build = (fn) => {
  const dx = new Float64Array(N);
  const dy = new Float64Array(N);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const [u, v] = fn(x, y);
      dx[y * COLS + x] = u;
      dy[y * COLS + x] = v;
    }
  }
  return { dx, dy };
};

const asFlow = ({ dx, dy }, extra = {}) => ({
  vectors: { dx, dy, confidence: new Float64Array(N).fill(1), ...extra },
  cols: COLS,
  rows: ROWS,
});

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ≈${expected} (±${tol})`);

// ── Synthetic uniform flow → curl ≈ 0, divergence ≈ 0 ─────────────

test('uniform flow has zero curl and zero divergence', () => {
  const f = build(() => [3, -2]);
  const curl = curlField(f.dx, f.dy, COLS, ROWS);
  const div = divergenceField(f.dx, f.dy, COLS, ROWS);
  near(curl.mean, 0, 1e-12, 'uniform curl mean');
  near(div.mean, 0, 1e-12, 'uniform divergence mean');
  // Every interior block, not just the average, is exactly zero.
  assert.equal(curl.samples, (COLS - 2) * (ROWS - 2));
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) {
      near(curl.field[y * COLS + x], 0, 1e-12, `curl at ${x},${y}`);
      near(div.field[y * COLS + x], 0, 1e-12, `div at ${x},${y}`);
    }
  }
});

// ── Synthetic rotational flow → curl ≠ 0, divergence ≈ 0 ──────────
// F = (-y, x) about the grid centre. Analytically ∇×F = 2, ∇·F = 0.

test('rotational flow has constant curl and zero divergence', () => {
  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;
  const f = build((x, y) => [-(y - cy), x - cx]);
  const curl = curlField(f.dx, f.dy, COLS, ROWS);
  const div = divergenceField(f.dx, f.dy, COLS, ROWS);
  near(curl.mean, 2, 1e-12, 'rotational curl mean (∇×(-y, x) = 2)');
  near(div.mean, 0, 1e-12, 'rotational divergence mean');
  assert.ok(Math.abs(curl.mean) > 1e-6, 'curl must be non-zero for rotation');
});

test('rotation direction flips sign with the sense of rotation', () => {
  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;
  const ccw = curlField(...Object.values(build((x, y) => [-(y - cy), x - cx])), COLS, ROWS);
  const cw = curlField(...Object.values(build((x, y) => [y - cy, -(x - cx)])), COLS, ROWS);
  near(ccw.mean, -cw.mean, 1e-12, 'opposite rotations give opposite curl');
});

// ── Synthetic expanding flow → curl ≈ 0, divergence ≠ 0 ───────────
// F = (x, y) about the grid centre. Analytically ∇·F = 2, ∇×F = 0.

test('expanding flow has constant divergence and zero curl', () => {
  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;
  const f = build((x, y) => [x - cx, y - cy]);
  const curl = curlField(f.dx, f.dy, COLS, ROWS);
  const div = divergenceField(f.dx, f.dy, COLS, ROWS);
  near(div.mean, 2, 1e-12, 'expanding divergence mean (∇·(x, y) = 2)');
  near(curl.mean, 0, 1e-12, 'expanding curl mean');
});

test('contracting flow is negative divergence', () => {
  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;
  const f = build((x, y) => [-(x - cx), -(y - cy)]);
  const div = divergenceField(f.dx, f.dy, COLS, ROWS);
  near(div.mean, -2, 1e-12, 'contracting divergence mean');
});

// ── Shear: the case the old gradient formula reported as zero ─────

test('pure shear registers in the gradient magnitude', () => {
  // F = (y, 0): no divergence, non-zero curl, and a real motion boundary.
  const f = build((x, y) => [y, 0]);
  const div = divergenceField(f.dx, f.dy, COLS, ROWS);
  const grad = gradientMagnitude(f.dx, f.dy, COLS, ROWS);
  near(div.mean, 0, 1e-12, 'shear divergence');
  assert.ok(grad.mean > 0.5, `shear must show a gradient, got ${grad.mean}`);
});

// ── Laplacian ────────────────────────────────────────────────────

test('laplacian vanishes for linear flow and detects curvature', () => {
  const linear = build((x, y) => [2 * x - y, x + 3 * y]);
  near(laplacianField(linear.dx, linear.dy, COLS, ROWS).mean, 0, 1e-12, 'linear laplacian');

  // F = (x², 0) ⇒ ∇²Fx = 2 everywhere, so |∇²F| = 2.
  const quad = build((x) => [x * x, 0]);
  near(laplacianField(quad.dx, quad.dy, COLS, ROWS).mean, 2, 1e-12, 'quadratic laplacian');
});

// ── NaN propagation guard ────────────────────────────────────────

test('a NaN in the input never becomes a plausible-looking zero', () => {
  const f = build(() => [4, 4]);
  // Poison an interior block: its stencil neighbours become undefined.
  f.dx[7 * COLS + 7] = NaN;

  const div = divergenceField(f.dx, f.dy, COLS, ROWS);
  assert.ok(Number.isFinite(div.mean), 'mean stays finite');
  // The two horizontal neighbours of the poisoned block read it in their
  // central difference, so exactly those are dropped from the mean.
  assert.equal(div.dropped, 2, 'poisoned stencils are dropped, not averaged');
  assert.equal(div.samples, (COLS - 2) * (ROWS - 2) - 2);
  near(div.mean, 0, 1e-12, 'surviving blocks still report uniform flow');

  const curl = curlField(f.dx, f.dy, COLS, ROWS);
  assert.ok(Number.isFinite(curl.mean));
  assert.equal(curl.dropped, 2, 'curl drops the vertical neighbours of the NaN');
});

test('an all-NaN field reports zero samples rather than a zero mean', () => {
  const dx = new Float64Array(N).fill(NaN);
  const dy = new Float64Array(N).fill(NaN);
  const div = divergenceField(dx, dy, COLS, ROWS);
  assert.equal(div.samples, 0, 'nothing was measurable');
  assert.equal(div.mean, 0);
  const summary = analyzeFlowPhysics(asFlow({ dx, dy }));
  assert.equal(summary.samples.interior, 0, 'the summary admits it measured nothing');
  assert.equal(summary.maxDiv, null, 'extrema are null, not ±Infinity');
  assert.equal(summary.minDiv, null);
  assert.ok(Number.isFinite(summary.divergence));
  assert.ok(Number.isFinite(summary.currentDensity));
});

// ── Dimension mismatch: the actual source of the reported NaN ─────

test('a grid that does not match the data is rejected, not silently NaN', () => {
  const dx = new Float64Array(20 * 10);
  const dy = new Float64Array(20 * 10);
  assert.throws(() => divergenceField(dx, dy, COLS, ROWS), /does not match field length/);
  assert.throws(() => curlField(dx, dy, COLS, ROWS), /does not match field length/);
  assert.throws(
    () => analyzeFlowPhysics({ vectors: { dx, dy }, cols: COLS, rows: ROWS }),
    /does not match field length/,
  );
});

test('analyzeFlowPhysics infers the grid from the flow result', () => {
  const dx = new Float64Array(20 * 10).fill(1);
  const dy = new Float64Array(20 * 10).fill(0);
  const summary = analyzeFlowPhysics({ vectors: { dx, dy }, cols: 20, rows: 10 });
  assert.deepEqual(summary.grid, { cols: 20, rows: 10 });
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} is finite`);
  }
});

// ── Edge block handling ──────────────────────────────────────────

test('the border ring is never written and never counted', () => {
  const f = build((x, y) => [x, y]);
  const div = divergenceField(f.dx, f.dy, COLS, ROWS);
  for (let x = 0; x < COLS; x++) {
    assert.ok(Number.isNaN(div.field[x]), `top border ${x} left undefined`);
    assert.ok(Number.isNaN(div.field[(ROWS - 1) * COLS + x]), `bottom border ${x} left undefined`);
  }
  for (let y = 0; y < ROWS; y++) {
    assert.ok(Number.isNaN(div.field[y * COLS]), `left border ${y} left undefined`);
    assert.ok(Number.isNaN(div.field[y * COLS + COLS - 1]), `right border ${y} left undefined`);
  }
  assert.equal(div.samples, (COLS - 2) * (ROWS - 2), 'only the interior is averaged');
});

test('a validity mask excludes biased blocks and everything reading them', () => {
  const f = build(() => [1, 1]);
  // Corrupt a ring-2 block the way a truncated search window would, and
  // mark it invalid. With the mask honoured its neighbours must not be
  // contaminated; without it, they would be.
  const bad = 5 * COLS + 5;
  f.dx[bad] = 40;
  f.dy[bad] = -40;

  // Note the mean alone would NOT catch this: a central difference reads the
  // bad block with opposite sign from either side, so the two errors cancel in
  // the average even though both cells are wrong. Assert on the cells.
  const unmasked = divergenceField(f.dx, f.dy, COLS, ROWS);
  assert.ok(Math.abs(unmasked.field[bad - 1]) > 1, 'unmasked: the left neighbour is corrupted');
  assert.ok(Math.abs(unmasked.field[bad + 1]) > 1, 'unmasked: the right neighbour is corrupted');

  const mask = new Uint8Array(N).fill(1);
  mask[bad] = 0;
  const masked = divergenceField(f.dx, f.dy, COLS, ROWS, { mask });
  near(masked.mean, 0, 1e-12, 'masked: uniform flow recovered exactly');
  assert.equal(masked.dropped, 5, 'the bad block and its four stencil users are dropped');
});

test('analyzeFlowPhysics honours the flow result valid mask by default', () => {
  const f = build(() => [2, 0]);
  const valid = new Uint8Array(N).fill(1);
  // Mark the whole border invalid, as blockFlow does.
  for (let x = 0; x < COLS; x++) { valid[x] = 0; valid[(ROWS - 1) * COLS + x] = 0; }
  for (let y = 0; y < ROWS; y++) { valid[y * COLS] = 0; valid[y * COLS + COLS - 1] = 0; }
  // Give the border a wild inward bias — the artefact this guards against.
  for (let i = 0; i < N; i++) if (!valid[i]) { f.dx[i] = 60; f.dy[i] = 60; }

  const summary = analyzeFlowPhysics(asFlow(f, { valid }));
  near(summary.divergence, 0, 1e-12, 'border artefact excluded from divergence');
  near(summary.curl, 0, 1e-12, 'border artefact excluded from curl');
  // Ring 2 loses its border-touching stencils, so the usable interior shrinks.
  assert.equal(summary.samples.interior, (COLS - 4) * (ROWS - 4));
});

// ── Current density ──────────────────────────────────────────────

test('current density separates a coherent surge from milling', () => {
  const surge = build(() => [0, 3]);
  const mag = new Float64Array(N).fill(3);
  const coherent = currentDensity(surge.dx, surge.dy, mag, COLS, ROWS);
  near(coherent.coherence, 1, 1e-12, 'a uniform surge is fully coherent');

  // Alternating directions: same |J| total, but nothing net.
  const milling = build((x) => [0, x % 2 === 0 ? 3 : -3]);
  const churn = currentDensity(milling.dx, milling.dy, mag, COLS, ROWS);
  near(churn.total, coherent.total, 1e-9, 'same total motion');
  near(churn.coherence, 0, 1e-12, 'milling cancels out');
});

test('current density skips non-finite blocks instead of poisoning the total', () => {
  const f = build(() => [1, 0]);
  f.dx[10] = NaN;
  const mag = new Float64Array(N).fill(1);
  const j = currentDensity(f.dx, f.dy, mag, COLS, ROWS);
  assert.ok(Number.isFinite(j.total));
  assert.equal(j.samples, N - 1);
});

// ── vorticity / dipoles / potential energy ───────────────────────

test('vorticity requires an explicit grid width', () => {
  const f = build((x, y) => [-(y - 7), x - 9.5]);
  const curl = curlField(f.dx, f.dy, COLS, ROWS);
  const region = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }];
  const { total, samples } = vorticity(curl, region);
  assert.equal(samples, 3);
  near(total, 6, 1e-9, 'three blocks of curl 2');
  assert.throws(() => vorticity(curl.field, region), /cols. is required/);
  near(vorticity(curl.field, region, COLS).total, 6, 1e-9, 'raw field plus width still works');
});

test('vorticity ignores undefined border blocks', () => {
  const f = build(() => [1, 1]);
  const curl = curlField(f.dx, f.dy, COLS, ROWS);
  const { total, samples } = vorticity(curl, [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
  assert.equal(samples, 1, 'the border block is not counted');
  assert.equal(total, 0);
});

test('dipoles are found by direction, not by speed', () => {
  const slow = [
    { cx: 0, cy: 0, dx: 0.1, dy: 0 },
    { cx: 10, cy: 0, dx: -0.1, dy: 0 },
  ];
  assert.equal(findDipoles(slow).length, 1, 'slow opposing blobs still form a dipole');

  const sameWay = [
    { cx: 0, cy: 0, dx: 5, dy: 0 },
    { cx: 10, cy: 0, dx: 5, dy: 0 },
  ];
  assert.equal(findDipoles(sameWay).length, 0);

  const still = [
    { cx: 0, cy: 0, dx: 0, dy: 0 },
    { cx: 10, cy: 0, dx: 1, dy: 0 },
  ];
  assert.equal(findDipoles(still).length, 0, 'a zero vector has no direction to oppose');
});

test('potential energy accumulates work along a trajectory', () => {
  const traj = [
    { cx: 0, cy: 0, dx: 1, dy: 0 },
    { cx: 1, cy: 0, dx: 1, dy: 0 },
    { cx: 2, cy: 0, dx: 1, dy: 0 },
  ];
  assert.equal(potentialEnergy(traj), 2);
  assert.equal(potentialEnergy([traj[0]]), 0);
  assert.equal(potentialEnergy([]), 0);
  assert.ok(Number.isFinite(potentialEnergy([traj[0], { cx: NaN, cy: 0, dx: 1, dy: 0 }])));
});

// ── Series extraction ────────────────────────────────────────────

test('physicsSeries keeps frame indices aligned, nulling unmeasurable frames', () => {
  const uniform = analyzeFlowPhysics(asFlow(build(() => [1, 0])));
  const rotating = analyzeFlowPhysics(asFlow(build((x, y) => [-(y - 7), x - 9.5])));
  const series = physicsSeries([uniform, rotating, null], { observables: ['curl', 'divergence'] });
  assert.equal(series.curl.length, 3);
  near(series.curl[0], 0, 1e-9, 'uniform frame');
  near(series.curl[1], 2, 1e-9, 'rotating frame');
  assert.equal(series.curl[2], null, 'a missing frame stays in place as null');
});
