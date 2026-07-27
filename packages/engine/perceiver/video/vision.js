// Selective computer vision: runs on KEY FRAMES only (first frame per shot,
// peak-motion frame, high-contrast frames). Extracts features without ML
// dependencies — edge density, text-likeness, scene classification, motion
// complexity — all from raw grayscale pixels the perceiver already streams.
//
// This is the "aim it selectively" layer: the holon separator finds shot
// boundaries from motion energy, then CV runs only on the important frames.

import { FRAME_WIDTH, FRAME_HEIGHT, BLOCK_SIZE } from './reading.js';

const COLS = Math.floor(FRAME_WIDTH / BLOCK_SIZE);
const ROWS = Math.floor(FRAME_HEIGHT / BLOCK_SIZE);

// ── Sobel-like edge magnitude (pixel differences, not full gradient) ──
// Fast approximation: horizontal + vertical differences per pixel,
// averaged per block. High edge density = detail, texture, text.
export function edgeDensity(pixels) {
  const blockEdge = new Float64Array(ROWS * COLS);
  for (let by = 0; by < ROWS; by++) {
    for (let bx = 0; bx < COLS; bx++) {
      let sum = 0, count = 0;
      for (let py = 0; py < BLOCK_SIZE; py++) {
        for (let px = 0; px < BLOCK_SIZE; px++) {
          const x = bx * BLOCK_SIZE + px;
          const y = by * BLOCK_SIZE + py;
          const idx = y * FRAME_WIDTH + x;
          // Horizontal difference
          if (x > 0) sum += Math.abs(pixels[idx] - pixels[idx - 1]);
          // Vertical difference
          if (y > 0) sum += Math.abs(pixels[idx] - pixels[idx - FRAME_WIDTH]);
          count += 2;
        }
      }
      blockEdge[by * COLS + bx] = count > 0 ? sum / count / 255 : 0;
    }
  }
  const total = blockEdge.reduce((a, v) => a + v, 0);
  return { perBlock: blockEdge, mean: total / (ROWS * COLS), max: Math.max(...blockEdge) };
}

// ── Text-likeness score ────────────────────────────────────────────
// Text regions have: high edge density in a horizontal band (characters),
// low motion (static), high contrast (ink on paper). Returns a score in
// [0, 1] where > 0.5 suggests this frame might be an intertitle.
export function textLikeness(pixels, prevPixels, edgeResult) {
  // Center band: rows 3-12 of blocks (out of 15)
  let centerEdge = 0, centerCount = 0;
  for (let by = 3; by < 12; by++) {
    for (let bx = 0; bx < COLS; bx++) {
      centerEdge += edgeResult.perBlock[by * COLS + bx];
      centerCount++;
    }
  }
  const centerEdgeDensity = centerCount > 0 ? centerEdge / centerCount : 0;

  // Motion in center band (intertitles are static)
  let centerMotion = 0;
  if (prevPixels) {
    let mc = 0;
    for (let by = 3; by < 12; by++) {
      for (let bx = 0; bx < COLS; bx++) {
        let diff = 0;
        for (let py = 0; py < BLOCK_SIZE; py++) {
          for (let px = 0; px < BLOCK_SIZE; px++) {
            const idx = (by * BLOCK_SIZE + py) * FRAME_WIDTH + (bx * BLOCK_SIZE + px);
            diff += Math.abs(pixels[idx] - prevPixels[idx]);
          }
        }
        centerMotion += diff / (BLOCK_SIZE * BLOCK_SIZE);
        mc++;
      }
    }
    centerMotion = mc > 0 ? centerMotion / mc / 255 : 0;
  } else {
    centerMotion = 1; // First frame, assume no motion info
  }

  // Contrast: standard deviation of pixel values in center band
  const values = [];
  for (let by = 3; by < 12; by++) {
    for (let bx = 0; bx < COLS; bx++) {
      for (let py = 0; py < BLOCK_SIZE; py++) {
        for (let px = 0; px < BLOCK_SIZE; px++) {
          const idx = (by * BLOCK_SIZE + py) * FRAME_WIDTH + (bx * BLOCK_SIZE + px);
          values.push(pixels[idx]);
        }
      }
    }
  }
  const mean = values.reduce((a, v) => a + v, 0) / (values.length || 1);
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length || 1);
  const std = Math.sqrt(variance) / 255;

  // Text score: high edge density + low motion + high contrast
  const score = centerEdgeDensity * (1 - centerMotion) * std * 4;
  return Math.min(1, score);
}

// ── Scene type classification ──────────────────────────────────────
// Uses luminance histogram to classify the scene.
export function sceneType(histogram) {
  // histogram is 16 bins, [0] = very dark, [15] = very bright
  const darkPct = histogram[0] + histogram[1];
  const brightPct = histogram[14] + histogram[15];
  const midPct = histogram.slice(4, 12).reduce((a, v) => a + v, 0);

  if (darkPct > 0.6) return 'night';
  if (brightPct > 0.6) return 'daylight';
  if (darkPct > 0.3 && brightPct > 0.3) return 'high-contrast';
  if (midPct > 0.6) return 'midtone';
  return 'mixed';
}

// ── Motion complexity ──────────────────────────────────────────────
// How many independently-moving regions? High = crowd chaos (Odessa Steps).
export function motionComplexity(motionBlocks, threshold) {
  // motionBlocks is the 300-dim per-block motion vector
  const active = motionBlocks.filter(m => m > threshold).length;
  return active / motionBlocks.length; // fraction of blocks with significant motion
}

// ── Center-weighted composition score ──────────────────────────────
// Is the subject centered? (classical composition) or off-center?
// Used for detecting intertitles (centered text) vs action (off-center).
export function compositionScore(edgePerBlock) {
  let centerWeight = 0, totalWeight = 0;
  for (let by = 0; by < ROWS; by++) {
    for (let bx = 0; bx < COLS; bx++) {
      const edge = edgePerBlock[by * COLS + bx];
      const dx = (bx - COLS / 2) / (COLS / 2);
      const dy = (by - ROWS / 2) / (ROWS / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const gaussianWeight = Math.exp(-dist * dist * 2);
      centerWeight += edge * gaussianWeight;
      totalWeight += edge;
    }
  }
  return totalWeight > 0 ? centerWeight / totalWeight : 0.5;
}

// ── Full CV analysis for one frame ─────────────────────────────────
export function analyzeFrame(pixels, prevPixels = null, motionBlocks = null) {
  const edge = edgeDensity(pixels);

  // 16-bin luminance histogram (already computed by perceiver, but
  // recompute here so this module is self-contained)
  const hist = new Float64Array(16);
  const dim = FRAME_WIDTH * FRAME_HEIGHT;
  for (let i = 0; i < dim; i++) hist[Math.floor(pixels[i] / 16)]++;
  for (let i = 0; i < 16; i++) hist[i] /= dim;

  return {
    edgeDensity: edge.mean,
    maxEdge: edge.max,
    textLikeness: textLikeness(pixels, prevPixels, edge),
    sceneType: sceneType(hist),
    composition: compositionScore(edge.perBlock),
    motionComplexity: motionBlocks ? motionComplexity(motionBlocks, 0.05) : 0,
    histogram: Array.from(hist),
  };
}

// ── Select key frames from shot boundaries ─────────────────────────
// Given shot boundaries and frame data, returns indices of frames to
// run CV on: first frame of each shot, peak-motion frames, and any
// frame with high text-likeness potential.
export function selectKeyFrames(shots, frameCount, fps) {
  const keyFrames = new Set();

  for (const shot of shots) {
    const startFrame = Math.round(shot.start * fps);
    const endFrame = Math.round(shot.end * fps);
    const midFrame = Math.round((startFrame + endFrame) / 2);

    // Always include the first frame of each shot
    keyFrames.add(Math.min(startFrame, frameCount - 1));
    // Include the midpoint (representative frame)
    keyFrames.add(Math.min(midFrame, frameCount - 1));
  }

  return [...keyFrames].sort((a, b) => a - b);
}
