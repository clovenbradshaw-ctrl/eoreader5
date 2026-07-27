// Born-rule adaptive resolution: DEF selects the block size per frame.
// A blank wall → coarse (4×4). A crowd → fine (16×16 or smaller).
// No hardcoded block size ever.

import { FRAME_WIDTH, FRAME_HEIGHT } from './reading.js';
import { DEF } from '../../emergence/nulls/extreme-value.js';

// Block sizes to test (in pixels)
const BLOCK_SIZES = [4, 8, 12, 16, 20, 24, 30];

export function selectResolution(pixels) {
  const candidates = [];

  for (const bs of BLOCK_SIZES) {
    const cols = Math.floor(FRAME_WIDTH / bs);
    const rows = Math.floor(FRAME_HEIGHT / bs);
    if (cols < 2 || rows < 2) continue;

    // Compute edge energy per block (horizontal + vertical differences)
    const blockEnergy = new Float64Array(cols * rows);
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        let sum = 0;
        for (let py = 0; py < bs; py++) {
          for (let px = 0; px < bs; px++) {
            const x = bx * bs + px;
            const y = by * bs + py;
            const idx = y * FRAME_WIDTH + x;
            let diff = 0;
            if (x > 0) diff += Math.abs(pixels[idx] - pixels[idx - 1]);
            if (y > 0) diff += Math.abs(pixels[idx] - pixels[idx - FRAME_WIDTH]);
            sum += diff;
          }
        }
        blockEnergy[by * cols + bx] = sum / (bs * bs * 2);
      }
    }

    // Sort descending and run DEF to find how many blocks carry real structure
    const sorted = Array.from(blockEnergy).sort((a, b) => b - a);
    const def = DEF(sorted, { alpha: 0.05, maxK: Math.min(20, sorted.length), window: sorted.length });

    // The elbow tells us how many blocks are "signal" vs "noise"
    const signalCount = def.abstain ? 0 : def.k;
    const signalRatio = sorted.length > 0 ? signalCount / sorted.length : 0;
    const gapStrength = def.abstain ? 0 : def.gap;

    candidates.push({
      blockSize: bs,
      cols, rows,
      totalBlocks: sorted.length,
      signalBlocks: signalCount,
      signalRatio,
      gapStrength,
      abstain: def.abstain,
    });
  }

  // Pick the block size where the signal ratio crosses 0.5 (half the blocks carry structure)
  // or where the gap is strongest, favoring finer resolution for complex scenes
  let best = candidates[0];

  for (const c of candidates) {
    // Prefer non-abstaining resolutions with highest signal ratio
    // that still have a reasonable number of blocks
    if (!c.abstain && c.signalRatio > 0.1 && c.signalRatio < 0.9) {
      if (c.signalRatio > best.signalRatio || (c.signalRatio === best.signalRatio && c.blockSize < best.blockSize)) {
        best = c;
      }
    }
  }

  // If all abstain (uniform frame), use coarsest resolution
  if (best.abstain) {
    best = candidates.reduce((a, c) => c.blockSize < a.blockSize ? c : a, candidates[0]);
  }

  return {
    blockSize: best.blockSize,
    cols: best.cols,
    rows: best.rows,
    totalBlocks: best.totalBlocks,
    signalBlocks: best.signalBlocks,
    signalRatio: best.signalRatio,
    gapStrength: best.gapStrength || 0,
    abstain: best.abstain || false,
    all: candidates,
  };
}

// Adaptive block-matching flow using the selected resolution
export function adaptiveFlow(current, previous) {
  const { blockSize, cols, rows } = selectResolution(current);
  const searchRadius = Math.max(2, Math.round(blockSize / 3));

  const dx = new Int8Array(rows * cols);
  const dy = new Int8Array(rows * cols);
  const confidence = new Float64Array(rows * cols);

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let bestCost = Infinity, bestDx = 0, bestDy = 0;

      // Current block
      const block = new Uint8Array(blockSize * blockSize);
      for (let py = 0; py < blockSize; py++) {
        for (let px = 0; px < blockSize; px++) {
          block[py * blockSize + px] = current[(by * blockSize + py) * FRAME_WIDTH + (bx * blockSize + px)];
        }
      }

      // Search in previous frame
      for (let sy = -searchRadius; sy <= searchRadius; sy++) {
        for (let sx = -searchRadius; sx <= searchRadius; sx++) {
          const refBy = by + sy, refBx = bx + sx;
          if (refBy < 0 || refBy >= rows || refBx < 0 || refBx >= cols) continue;

          let cost = 0;
          for (let py = 0; py < blockSize; py++) {
            for (let px = 0; px < blockSize; px++) {
              const refIdx = (refBy * blockSize + py) * FRAME_WIDTH + (refBx * blockSize + px);
              cost += Math.abs(block[py * blockSize + px] - previous[refIdx]);
            }
          }

          if (cost < bestCost) { bestCost = cost; bestDx = sx; bestDy = sy; }
        }
      }

      const idx = by * cols + bx;
      dx[idx] = bestDx;
      dy[idx] = bestDy;
      const maxCost = blockSize * blockSize * 255;
      confidence[idx] = maxCost > 0 ? 1 - (bestCost / maxCost) : 0;
    }
  }

  // Summary statistics
  let meanDx = 0, meanDy = 0, count = 0;
  for (let i = 0; i < dx.length; i++) {
    if (confidence[i] > 0.2) { meanDx += dx[i] * confidence[i]; meanDy += dy[i] * confidence[i]; count += confidence[i]; }
  }

  return {
    vectors: { dx, dy, confidence },
    meanDx: count > 0 ? meanDx / count : 0,
    meanDy: count > 0 ? meanDy / count : 0,
    motionMagnitude: Math.sqrt(meanDx ** 2 + meanDy ** 2) / (searchRadius || 1),
    blockSize, cols, rows,
    resolution: `${blockSize}×${blockSize} → ${cols}×${rows} blocks`,
  };
}
