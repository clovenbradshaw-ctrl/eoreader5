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
export function blockFlow(current, previous, { searchRadius = 4 } = {}) {
  const dx = new Int8Array(ROWS * COLS);
  const dy = new Int8Array(ROWS * COLS);
  const confidence = new Float64Array(ROWS * COLS);

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

      dx[by * COLS + bx] = bestDx;
      dy[by * COLS + bx] = bestDy;
      // Confidence: lower cost = higher confidence
      const maxCost = BLOCK_SIZE * BLOCK_SIZE * 255;
      confidence[by * COLS + bx] = 1 - (bestCost / maxCost);
    }
  }

  // Summary statistics
  let meanDx = 0, meanDy = 0, count = 0;
  let upMotion = 0, downMotion = 0, leftMotion = 0, rightMotion = 0;
  const motionMagnitudes = [];

  for (let i = 0; i < dx.length; i++) {
    if (confidence[i] > 0.2) {
      meanDx += dx[i] * confidence[i];
      meanDy += dy[i] * confidence[i];
      count += confidence[i];
      const mag = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      motionMagnitudes.push(mag);

      if (dy[i] < -1) upMotion += confidence[i];     // Moving up
      if (dy[i] > 1) downMotion += confidence[i];    // Moving down
      if (dx[i] < -1) leftMotion += confidence[i];   // Moving left
      if (dx[i] > 1) rightMotion += confidence[i];   // Moving right
    }
  }

  const totalDir = upMotion + downMotion + leftMotion + rightMotion || 1;

  return {
    vectors: { dx, dy, confidence },
    meanDx: count > 0 ? meanDx / count : 0,
    meanDy: count > 0 ? meanDy / count : 0,
    motionMagnitude: count > 0 ? motionMagnitudes.reduce((a, v) => a + v, 0) / motionMagnitudes.length : 0,
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
    // Fraction of blocks with meaningful motion
    activityFraction: count / (ROWS * COLS),
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
