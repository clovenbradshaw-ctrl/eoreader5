// Non-LLM computer vision primitives for eoreader5.
// All deterministic, no training data, no neural networks.
// Block-matching optical flow, shape detection, scene classification.

import { FRAME_WIDTH, FRAME_HEIGHT, BLOCK_SIZE } from './reading.js';

const COLS = Math.floor(FRAME_WIDTH / BLOCK_SIZE);
const ROWS = Math.floor(FRAME_HEIGHT / BLOCK_SIZE);

// ── Block-matching optical flow ─────────────────────────────────
// For each 8×8 block in the current frame, find the best match in
// the previous frame within a search radius. Returns motion vectors
// (dx, dy) per block, plus summary statistics.
//
// ── Sign convention ─────────────────────────────────────────────
// The search asks "where did this block COME FROM", so the winning
// offset (sx, sy) points from the current position back to the
// previous one. The MOTION is the negation of that. The returned
// (dx, dy) are motion vectors — content that moved down the frame has
// dy > 0 — because every consumer reads them that way: physics.js
// treats them as a motion field F when computing ∇×F and ∇·F, and the
// directionality summary below labels dy > 0 as downward.
//
// This matters beyond tidiness. Before the negation, `downMotion`
// counted blocks whose match lay BELOW them in the previous frame,
// i.e. content that had moved UP — so the Odessa Steps reading, whose
// whole claim is that the massacre turns milling motion into sustained
// DOWNWARD flow, was measuring the opposite of what it reported.
//
// ── Edge blocks ─────────────────────────────────────────────────
// The search window is truncated at the frame border: at bx = 0 only
// sx ≥ 0 is reachable, so the recovered motion there can only be ≤ 0
// after negation. The border therefore carries a systematic inward
// bias that is an artefact of the window, not of any motion — and a
// ring of inward-pointing vectors is exactly a spurious negative
// divergence. Border blocks are marked in `valid` so the physics layer
// can exclude them rather than average the artefact in.
export function blockFlow(current, previous, { searchRadius = 4 } = {}) {
  const dx = new Int8Array(ROWS * COLS);
  const dy = new Int8Array(ROWS * COLS);
  const confidence = new Float64Array(ROWS * COLS);
  // 1 = the search window was complete in every direction.
  const valid = new Uint8Array(ROWS * COLS);
  const bestCosts = new Float64Array(ROWS * COLS);

  for (let by = 0; by < ROWS; by++) {
    for (let bx = 0; bx < COLS; bx++) {
      let bestCost = Infinity;
      let bestDx = 0, bestDy = 0;

      // Extract current block
      const block = new Uint8Array(BLOCK_SIZE * BLOCK_SIZE);
      for (let py = 0; py < BLOCK_SIZE; py++) {
        for (let px = 0; px < BLOCK_SIZE; px++) {
          const idx = (by * BLOCK_SIZE + py) * FRAME_WIDTH + (bx * BLOCK_SIZE + px);
          block[py * BLOCK_SIZE + px] = current[idx];
        }
      }

      // Search in previous frame within radius
      for (let sy = -searchRadius; sy <= searchRadius; sy++) {
        for (let sx = -searchRadius; sx <= searchRadius; sx++) {
          const refBy = by + sy;
          const refBx = bx + sx;
          if (refBy < 0 || refBy >= ROWS || refBx < 0 || refBx >= COLS) continue;

          // SAD (Sum of Absolute Differences)
          let cost = 0;
          for (let py = 0; py < BLOCK_SIZE; py++) {
            for (let px = 0; px < BLOCK_SIZE; px++) {
              const refIdx = (refBy * BLOCK_SIZE + py) * FRAME_WIDTH + (refBx * BLOCK_SIZE + px);
              const diff = Math.abs(block[py * BLOCK_SIZE + px] - previous[refIdx]);
              cost += diff;
            }
          }

          if (cost < bestCost) {
            bestCost = cost;
            bestDx = sx;
            bestDy = sy;
          }
        }
      }

      const i = by * COLS + bx;
      // Negate: the search returns where the block came FROM, the
      // caller wants where it WENT.
      dx[i] = -bestDx;
      dy[i] = -bestDy;
      // Confidence: lower cost = higher confidence
      const maxCost = BLOCK_SIZE * BLOCK_SIZE * 255;
      bestCosts[i] = bestCost;
      confidence[i] = 1 - (bestCost / maxCost);
      // Complete search window? Border blocks lose candidates on the
      // outward side and are biased inward.
      valid[i] = by >= searchRadius && by < ROWS - searchRadius
        && bx >= searchRadius && bx < COLS - searchRadius ? 1 : 0;
    }
  }

  // ── The confidence gate ──
  // The old gate was `confidence > 0.2`, i.e. SAD < 0.8 · 64 · 255 ≈
  // 13056 — a cost only reachable by a block matched against near-
  // inverted content. Real matches on 8-bit video land two orders of
  // magnitude below that, so the gate passed every block on every
  // frame and `activityFraction` was reporting mean confidence, not a
  // fraction of moving blocks.
  //
  // The threshold now comes from this frame's own cost distribution:
  // a block is confidently matched when its cost sits in the lower
  // half of the frame's costs. That is scale-free — it adapts to grain,
  // exposure and contrast instead of assuming an absolute SAD budget.
  const sortedCosts = Array.from(bestCosts).sort((a, b) => a - b);
  const medianCost = sortedCosts.length
    ? sortedCosts.length % 2
      ? sortedCosts[sortedCosts.length >> 1]
      : (sortedCosts[(sortedCosts.length >> 1) - 1] + sortedCosts[sortedCosts.length >> 1]) / 2
    : 0;

  // Summary statistics
  let meanDx = 0, meanDy = 0, weight = 0;
  let upMotion = 0, downMotion = 0, leftMotion = 0, rightMotion = 0;
  const motionMagnitudes = [];
  // Blocks that actually moved, as a genuine count.
  let movingBlocks = 0;
  let consideredBlocks = 0;

  for (let i = 0; i < dx.length; i++) {
    // Only blocks with a complete search window and a cost no worse
    // than typical contribute to the direction summary.
    if (!valid[i] || bestCosts[i] > medianCost) continue;
    consideredBlocks++;
    const c = confidence[i];
    meanDx += dx[i] * c;
    meanDy += dy[i] * c;
    weight += c;
    const mag = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
    motionMagnitudes.push(mag);
    if (mag >= 1) movingBlocks++;

    if (dy[i] < -1) upMotion += c;      // content moved up the frame
    if (dy[i] > 1) downMotion += c;     // content moved down the frame
    if (dx[i] < -1) leftMotion += c;    // content moved left
    if (dx[i] > 1) rightMotion += c;    // content moved right
  }

  const totalDir = upMotion + downMotion + leftMotion + rightMotion || 1;

  return {
    vectors: { dx, dy, confidence, valid, cost: bestCosts },
    cols: COLS,
    rows: ROWS,
    searchRadius,
    costThreshold: medianCost,
    meanDx: weight > 0 ? meanDx / weight : 0,
    meanDy: weight > 0 ? meanDy / weight : 0,
    motionMagnitude: motionMagnitudes.length
      ? motionMagnitudes.reduce((a, v) => a + v, 0) / motionMagnitudes.length
      : 0,
    directionality: {
      up: upMotion / totalDir,
      down: downMotion / totalDir,
      left: leftMotion / totalDir,
      right: rightMotion / totalDir,
      // Downward dominance: > 0.5 means motion is predominantly downward
      downwardDominance: (downMotion - upMotion) / totalDir,
      // Rightward dominance: > 0.5 means motion is predominantly rightward
      rightwardDominance: (rightMotion - leftMotion) / totalDir,
    },
    // Fraction of CONSIDERED blocks that actually moved — a real count
    // over a real denominator, not a confidence average wearing the
    // name of a fraction.
    activityFraction: consideredBlocks > 0 ? movingBlocks / consideredBlocks : 0,
    movingBlocks,
    consideredBlocks,
  };
}

// ── Intertitle detection ─────────────────────────────────────────
// Silent film intertitles have a distinctive visual signature:
// high vertical edge density in the center band, very low motion,
// high contrast (bimodal brightness histogram), centered composition.
export function detectIntertitle(pixels, prevPixels, edgeResult, compositionScore) {
  // Edge density in center band
  const centerEdge = edgeResult.centerEdgeDensity || 0;

  // Motion: very low for intertitles
  let motion = 0;
  if (prevPixels) {
    let sum = 0;
    for (let i = 0; i < pixels.length; i++) sum += Math.abs(pixels[i] - prevPixels[i]);
    motion = sum / pixels.length / 255;
  } else {
    motion = 1; // unknown
  }

  // Contrast: brightness histogram spread
  const hist = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i++) hist[pixels[i]]++;
  let darkPct = 0, brightPct = 0;
  for (let i = 0; i < 50; i++) darkPct += hist[i];
  for (let i = 200; i < 256; i++) brightPct += hist[i];
  darkPct /= pixels.length;
  brightPct /= pixels.length;
  const contrast = darkPct > 0.2 && brightPct > 0.1; // bimodal = text on background

  // Composition: centered text
  const centered = compositionScore > 0.6;

  // Score: intertitles are high edge + low motion + high contrast + centered
  const score = centerEdge * (1 - motion) * (contrast ? 1 : 0.3) * (centered ? 1 : 0.5);
  const isIntertitle = score > 0.3 && motion < 0.05 && contrast;

  return { score, isIntertitle, edge: centerEdge, motion, contrast, centered };
}

// ── Scene classifier ─────────────────────────────────────────────
// Classifies frames by visual characteristics, no ML.
export function classifyScene(pixels) {
  const dim = FRAME_WIDTH * FRAME_HEIGHT;

  // Luminance statistics
  let sum = 0, sumSq = 0;
  for (let i = 0; i < dim; i++) {
    sum += pixels[i];
    sumSq += pixels[i] * pixels[i];
  }
  const mean = sum / dim;
  const std = Math.sqrt(sumSq / dim - mean * mean);

  // Edge density estimate (horizontal differences)
  let edgeSum = 0;
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 1; x < FRAME_WIDTH; x++) {
      edgeSum += Math.abs(pixels[y * FRAME_WIDTH + x] - pixels[y * FRAME_WIDTH + x - 1]);
    }
  }
  const edgeDensity = edgeSum / (dim - FRAME_HEIGHT) / 255;

  // Histogram shape
  const hist = new Uint32Array(256);
  for (let i = 0; i < dim; i++) hist[pixels[i]]++;
  // Entropy
  let entropy = 0;
  for (let v = 0; v < 256; v++) {
    if (hist[v] > 0) {
      const p = hist[v] / dim;
      entropy -= p * Math.log2(p);
    }
  }

  // Classification
  if (mean < 40 && std < 20 && edgeDensity < 0.05) return 'dark';
  if (mean > 200 && std < 20 && edgeDensity < 0.05) return 'bright-uniform';
  if (edgeDensity > 0.15 && entropy > 6) return 'textured';      // crowd, city, detail
  if (edgeDensity < 0.05 && std > 60) return 'high-contrast';    // intertitle-like
  if (mean < 80 && edgeDensity > 0.1) return 'dim-interior';
  if (mean > 150 && edgeDensity > 0.1) return 'bright-exterior';
  return 'mixed';
}

// ── Motion history: track dominant motion direction over time ────
// For the Odessa Steps: before the massacre, motion is random/milling
// (directionality near 0). During the massacre, motion becomes
// predominantly DOWNWARD (people fleeing, baby carriage).
export function motionSignature(frameFlow) {
  const d = frameFlow.directionality;
  return {
    downward: d.downwardDominance,        // -1 to 1
    rightward: d.rightwardDominance,       // -1 to 1
    activity: frameFlow.activityFraction,  // 0 to 1
    magnitude: frameFlow.motionMagnitude,  // 0 to searchRadius
    // The directionality vector: angle of dominant motion
    angle: Math.atan2(d.down - d.up, d.right - d.left),
    // Coherence: how unified is the motion (1 = all blocks move same direction)
    coherence: Math.sqrt(
      (d.downwardDominance ** 2 + d.rightwardDominance ** 2) / 2
    ),
  };
}
