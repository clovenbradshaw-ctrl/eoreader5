import test from 'node:test';
import assert from 'node:assert/strict';

import { blockFlow, motionSignature, classifyScene } from './flow.js';
import { analyzeFlowPhysics, divergenceField } from './physics.js';
import { FRAME_WIDTH, FRAME_HEIGHT, BLOCK_SIZE } from './reading.js';

const COLS = Math.floor(FRAME_WIDTH / BLOCK_SIZE);
const ROWS = Math.floor(FRAME_HEIGHT / BLOCK_SIZE);

// A frame of deterministic pseudo-texture: every block is distinguishable,
// so block matching has a unique correct answer to find.
function texture(seed = 1) {
  const px = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT);
  let h = seed >>> 0;
  for (let i = 0; i < px.length; i++) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    px[i] = h >>> 24;
  }
  return px;
}

// Shift a frame by (sx, sy) PIXELS, so content moves right/down for
// positive values. Out-of-frame area is filled from the source modulo
// the dimensions, keeping every block matchable.
function shift(src, sx, sy) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 0; x < FRAME_WIDTH; x++) {
      const srcX = ((x - sx) % FRAME_WIDTH + FRAME_WIDTH) % FRAME_WIDTH;
      const srcY = ((y - sy) % FRAME_HEIGHT + FRAME_HEIGHT) % FRAME_HEIGHT;
      out[y * FRAME_WIDTH + x] = src[srcY * FRAME_WIDTH + srcX];
    }
  }
  return out;
}

// Mean motion over blocks with a complete search window.
function interiorMean(flow) {
  let sx = 0, sy = 0, n = 0;
  const { dx, dy, valid } = flow.vectors;
  for (let i = 0; i < dx.length; i++) {
    if (!valid[i]) continue;
    sx += dx[i]; sy += dy[i]; n++;
  }
  return { dx: sx / n, dy: sy / n, n };
}

test('content moving down the frame yields positive dy', () => {
  const prev = texture();
  // Two blocks down = 16 pixels down.
  const curr = shift(prev, 0, 2 * BLOCK_SIZE);
  const flow = blockFlow(curr, prev);
  const mean = interiorMean(flow);
  assert.ok(mean.dy > 1.5, `expected dy ≈ +2 (downward), got ${mean.dy}`);
  assert.ok(Math.abs(mean.dx) < 0.5, `expected no horizontal motion, got ${mean.dx}`);
});

test('content moving up the frame yields negative dy', () => {
  const prev = texture();
  const curr = shift(prev, 0, -2 * BLOCK_SIZE);
  const mean = interiorMean(blockFlow(curr, prev));
  assert.ok(mean.dy < -1.5, `expected dy ≈ -2 (upward), got ${mean.dy}`);
});

test('content moving right yields positive dx', () => {
  const prev = texture();
  const curr = shift(prev, 3 * BLOCK_SIZE, 0);
  const mean = interiorMean(blockFlow(curr, prev));
  assert.ok(mean.dx > 2.5, `expected dx ≈ +3 (rightward), got ${mean.dx}`);
});

test('downwardDominance is positive for downward motion', () => {
  // This is the reading the Odessa Steps analysis rests on: the massacre
  // turns milling motion into sustained DOWNWARD flow. Before the sign
  // fix this summary reported the opposite of the motion on screen.
  const prev = texture();
  const curr = shift(prev, 0, 2 * BLOCK_SIZE);
  const flow = blockFlow(curr, prev);
  assert.ok(
    flow.directionality.downwardDominance > 0.5,
    `downward motion must read as downward dominance, got ${flow.directionality.downwardDominance}`,
  );
  assert.ok(motionSignature(flow).downward > 0.5);
});

test('upward motion reads as negative downward dominance', () => {
  const prev = texture();
  const curr = shift(prev, 0, -2 * BLOCK_SIZE);
  const flow = blockFlow(curr, prev);
  assert.ok(flow.directionality.downwardDominance < -0.5);
});

test('an identical frame pair reports no motion and no activity', () => {
  const frame = texture();
  const flow = blockFlow(frame, frame);
  const mean = interiorMean(flow);
  assert.ok(Math.abs(mean.dx) < 1e-9);
  assert.ok(Math.abs(mean.dy) < 1e-9);
  assert.equal(flow.activityFraction, 0, 'nothing moved, so no block is active');
});

test('activityFraction is a genuine fraction of moving blocks', () => {
  const prev = texture();
  const curr = shift(prev, 0, 2 * BLOCK_SIZE);
  const flow = blockFlow(curr, prev);
  assert.ok(flow.activityFraction > 0.9, `everything moved, got ${flow.activityFraction}`);
  assert.ok(flow.activityFraction <= 1);
  assert.equal(flow.movingBlocks / flow.consideredBlocks, flow.activityFraction);
});

test('the border ring is marked invalid, the interior valid', () => {
  const prev = texture();
  const flow = blockFlow(shift(prev, 0, BLOCK_SIZE), prev, { searchRadius: 4 });
  const { valid } = flow.vectors;
  assert.equal(valid[0], 0, 'top-left corner has a truncated window');
  assert.equal(valid[COLS - 1], 0);
  assert.equal(valid[(ROWS - 1) * COLS], 0);
  assert.equal(valid[Math.floor(ROWS / 2) * COLS + Math.floor(COLS / 2)], 1, 'centre is complete');

  let validCount = 0;
  for (const v of valid) validCount += v;
  assert.equal(validCount, (COLS - 8) * (ROWS - 8), 'searchRadius 4 costs 4 blocks on each side');
});

test('blockFlow reports its own grid, so physics need not assume one', () => {
  const prev = texture();
  const flow = blockFlow(shift(prev, BLOCK_SIZE, 0), prev);
  assert.equal(flow.cols, COLS);
  assert.equal(flow.rows, ROWS);
  const summary = analyzeFlowPhysics(flow);
  assert.deepEqual(summary.grid, { cols: COLS, rows: ROWS });
});

test('a uniform pan produces no divergence once edge blocks are excluded', () => {
  // A pure translation has zero divergence and zero curl analytically.
  // The border, whose search window is truncated, does not know that —
  // excluding it is what makes the measurement match the physics.
  const prev = texture();
  const flow = blockFlow(shift(prev, 2 * BLOCK_SIZE, 0), prev);
  const summary = analyzeFlowPhysics(flow);
  assert.ok(Math.abs(summary.divergence) < 0.2, `pan divergence ${summary.divergence} should vanish`);
  assert.ok(Math.abs(summary.curl) < 0.2, `pan curl ${summary.curl} should vanish`);
});

test('ignoring the valid mask lets the border artefact into the physics', () => {
  // The counter-test for the one above: the mask is load-bearing, not
  // decorative. With the border included the same pure translation
  // shows a divergence it does not physically have.
  const prev = texture();
  const flow = blockFlow(shift(prev, 3 * BLOCK_SIZE, 0), prev);
  const masked = analyzeFlowPhysics(flow);
  const unmasked = analyzeFlowPhysics(flow, { mask: null });
  assert.ok(
    Math.abs(unmasked.divergence) > Math.abs(masked.divergence),
    `border blocks must add spurious divergence: masked ${masked.divergence}, unmasked ${unmasked.divergence}`,
  );
});

test('divergence of a real expanding flow survives the edge mask', () => {
  // Sanity check in the other direction: masking must not suppress a
  // divergence that is genuinely there.
  const dx = new Float64Array(COLS * ROWS);
  const dy = new Float64Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      dx[y * COLS + x] = x - (COLS - 1) / 2;
      dy[y * COLS + x] = y - (ROWS - 1) / 2;
    }
  }
  const valid = new Uint8Array(COLS * ROWS).fill(1);
  for (let x = 0; x < COLS; x++) { valid[x] = 0; valid[(ROWS - 1) * COLS + x] = 0; }
  for (let y = 0; y < ROWS; y++) { valid[y * COLS] = 0; valid[y * COLS + COLS - 1] = 0; }
  const div = divergenceField(dx, dy, COLS, ROWS, { mask: valid });
  assert.ok(Math.abs(div.mean - 2) < 1e-9, `expanding flow keeps ∇·F = 2, got ${div.mean}`);
});

test('classifyScene separates dark, bright and textured frames', () => {
  assert.equal(classifyScene(new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT)), 'dark');
  assert.equal(classifyScene(new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT).fill(255)), 'bright-uniform');
  assert.equal(classifyScene(texture()), 'textured');
});
