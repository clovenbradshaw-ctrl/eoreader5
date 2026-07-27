// Learn the shapes of people from motion — no ML, no training data.
// The key insight: people have a characteristic gait signature that
// the system can discover autonomously by tracking motion blobs over
// time and clustering their edge/motion profiles.
//
// This is "teaching our own holons" — the structural vocabulary learns
// what a person looks like from watching them move.

import { FRAME_WIDTH, FRAME_HEIGHT, BLOCK_SIZE } from './reading.js';
import { blockFlow, motionSignature } from './flow.js';

const COLS = Math.floor(FRAME_WIDTH / BLOCK_SIZE);
const ROWS = Math.floor(FRAME_HEIGHT / BLOCK_SIZE);

// ── Motion blob tracking ────────────────────────────────────────
// Find connected regions of motion in the flow field.
// Returns a list of blobs with position, size, and motion profile.

export function findMotionBlobs(flowResult, { minBlobBlocks = 2 } = {}) {
  const { vectors } = flowResult;
  const confidence = vectors.confidence;
  const visited = new Uint8Array(ROWS * COLS);
  const blobs = [];

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const idx = y * COLS + x;
      if (visited[idx] || confidence[idx] < 0.3) continue;
      // Only consider blocks with significant motion
      if (Math.abs(vectors.dx[idx]) < 1 && Math.abs(vectors.dy[idx]) < 1) continue;

      // Flood-fill to find connected motion region
      const stack = [{ x, y }];
      const blobBlocks = [];
      visited[idx] = 1;

      while (stack.length > 0) {
        const p = stack.pop();
        blobBlocks.push(p);

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = p.x + dx, ny = p.y + dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            const nIdx = ny * COLS + nx;
            if (visited[nIdx]) continue;
            if (confidence[nIdx] < 0.3) continue;
            if (Math.abs(vectors.dx[nIdx]) < 1 && Math.abs(vectors.dy[nIdx]) < 1) continue;
            visited[nIdx] = 1;
            stack.push({ x: nx, y: ny });
          }
        }
      }

      if (blobBlocks.length >= minBlobBlocks) {
        // Compute centroid
        let cx = 0, cy = 0, totalMotion = 0;
        for (const b of blobBlocks) {
          const bidx = b.y * COLS + b.x;
          const mag = Math.sqrt(vectors.dx[bidx] ** 2 + vectors.dy[bidx] ** 2);
          cx += b.x * mag;
          cy += b.y * mag;
          totalMotion += mag;
        }
        cx /= totalMotion || 1;
        cy /= totalMotion || 1;

        // Compute bounding box
        const minX = Math.min(...blobBlocks.map(b => b.x));
        const maxX = Math.max(...blobBlocks.map(b => b.x));
        const minY = Math.min(...blobBlocks.map(b => b.y));
        const maxY = Math.max(...blobBlocks.map(b => b.y));

        // Aspect ratio and size (in normalized coordinates)
        const width = (maxX - minX + 1) / COLS;
        const height = (maxY - minY + 1) / ROWS;
        const aspectRatio = height > 0 ? width / height : 0;

        blobs.push({
          centroidX: cx / COLS,      // 0-1
          centroidY: cy / ROWS,      // 0-1
          width, height,
          aspectRatio,
          size: blobBlocks.length / (ROWS * COLS),  // fraction of frame
          blockCount: blobBlocks.length,
          blocks: blobBlocks,
          // Average flow vector for this blob
          avgDx: blobBlocks.reduce((a, b) => a + vectors.dx[b.y * COLS + b.x], 0) / blobBlocks.length,
          avgDy: blobBlocks.reduce((a, b) => a + vectors.dy[b.y * COLS + b.x], 0) / blobBlocks.length,
          coherence: blobBlocks.reduce((a, b) => a + confidence[b.y * COLS + b.x], 0) / blobBlocks.length,
        });
      }
    }
  }

  blobs.sort((a, b) => b.size - a.size);
  return blobs;
}

// ── Gait signature ──────────────────────────────────────────────
// People have a characteristic walking gait: the torso oscillates
// vertically at ~1-2 Hz, and the legs swing alternately.
// Track a blob over time and look for periodic vertical motion.

export function gaitAnalysis(blobHistory) {
  if (blobHistory.length < 4) return { isPerson: false, confidence: 0 };

  // Extract vertical centroid trajectory
  const yTrajectory = blobHistory.map(b => b.centroidY);
  const xTrajectory = blobHistory.map(b => b.centroidX);

  // Compute vertical oscillation (mean-subtracted, normalized)
  const yMean = yTrajectory.reduce((a, v) => a + v, 0) / yTrajectory.length;
  const yNorm = yTrajectory.map(v => v - yMean);

  // Autocorrelation: look for periodicity in vertical motion
  const n = yNorm.length;
  let peakCorr = 0, peakLag = 0;
  for (let lag = 2; lag < Math.floor(n / 2); lag++) {
    let corr = 0, count = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += yNorm[i] * yNorm[i + lag];
      count++;
    }
    corr /= count || 1;
    if (corr > peakCorr) { peakCorr = corr; peakLag = lag; }
  }

  // Characteristic gait: vertical oscillation with periodicity
  const verticalOscillation = Math.sqrt(yNorm.reduce((a, v) => a + v * v, 0) / n);
  const hasPeriodicity = peakCorr > 0.3 && peakLag >= 2;

  // Aspect ratio: people are taller than wide (AR < 0.5 for standing)
  const avgAspect = blobHistory.reduce((a, b) => a + b.aspectRatio, 0) / blobHistory.length;
  const isTall = avgAspect < 0.6;

  // Motion coherence: people's motion is moderately coherent
  const avgCoherence = blobHistory.reduce((a, b) => a + b.coherence, 0) / blobHistory.length;

  // Person score: tall + periodic vertical motion + moderate coherence
  let score = 0;
  if (isTall) score += 0.3;
  if (hasPeriodicity) score += 0.4;
  if (verticalOscillation > 0.02) score += 0.2;
  if (avgCoherence > 0.3 && avgCoherence < 0.8) score += 0.1;

  return {
    isPerson: score > 0.5,
    confidence: score,
    verticalOscillation,
    periodicity: peakCorr,
    periodLag: peakLag,
    aspectRatio: avgAspect,
    avgCoherence,
  };
}

// ── Person-shaped template ──────────────────────────────────────
// Once gait analysis identifies a region as "person-like," we learn
// the edge-density profile of that region. Over time, we build a
// vocabulary of what people look like (edge distribution, not pixels).

export class PersonTemplate {
  constructor() {
    this.templates = []; // { edgeProfile, aspectRatio, size }
    this.count = 0;
  }

  // Learn a person's edge-density profile from a pixel region
  learn(pixels, blob) {
    // Extract the edge-density profile of this blob's region
    const minX = Math.max(0, Math.floor(blob.centroidX * COLS - 2) * BLOCK_SIZE);
    const maxX = Math.min(FRAME_WIDTH - 1, (Math.ceil(blob.centroidX * COLS + 2)) * BLOCK_SIZE);
    const minY = Math.max(0, Math.floor(blob.centroidY * ROWS - 3) * BLOCK_SIZE);
    const maxY = Math.min(FRAME_HEIGHT - 1, (Math.ceil(blob.centroidY * ROWS + 3)) * BLOCK_SIZE);

    // Compute horizontal and vertical edge sums
    let hEdgeSum = 0, vEdgeSum = 0, totalPixels = 0;
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const idx = y * FRAME_WIDTH + x;
        if (x > minX) hEdgeSum += Math.abs(pixels[idx] - pixels[idx - 1]);
        if (y > minY) vEdgeSum += Math.abs(pixels[idx] - pixels[idx - FRAME_WIDTH]);
        totalPixels++;
      }
    }

    const profile = {
      hEdgeDensity: totalPixels > 0 ? hEdgeSum / totalPixels / 255 : 0,
      vEdgeDensity: totalPixels > 0 ? vEdgeSum / totalPixels / 255 : 0,
      totalEdge: totalPixels > 0 ? (hEdgeSum + vEdgeSum) / totalPixels / 255 : 0,
      aspectRatio: blob.aspectRatio,
      width: blob.width,
      height: blob.height,
    };

    this.templates.push(profile);
    this.count++;
  }

  // Match a blob against learned person templates
  match(blob) {
    if (this.count === 0) return { isPerson: false, confidence: 0 };

    // Find the most similar template by aspect ratio and size
    let bestSim = 0;
    for (const t of this.templates) {
      const arSim = 1 - Math.abs(t.aspectRatio - blob.aspectRatio);
      const sizeSim = 1 - Math.abs(t.size - blob.size) * 5;
      const sim = arSim * 0.6 + Math.max(0, sizeSim) * 0.4;
      if (sim > bestSim) bestSim = sim;
    }

    return {
      isPerson: bestSim > 0.6,
      confidence: bestSim,
      learnedFrom: this.count,
    };
  }

  // Get the average person template
  getAverage() {
    if (this.count === 0) return null;
    const avg = {
      hEdgeDensity: this.templates.reduce((a, t) => a + t.hEdgeDensity, 0) / this.count,
      vEdgeDensity: this.templates.reduce((a, t) => a + t.vEdgeDensity, 0) / this.count,
      totalEdge: this.templates.reduce((a, t) => a + t.totalEdge, 0) / this.count,
      aspectRatio: this.templates.reduce((a, t) => a + t.aspectRatio, 0) / this.count,
    };
    return avg;
  }
}

// ── Full person detection pipeline ──────────────────────────────
// 1. Get motion blobs from optical flow
// 2. Track blobs over time (→ gait analysis)
// 3. Match against learned person templates
// 4. Return detected people with confidence

export function detectPeople(pixels, prevPixels, personTemplates) {
  const flow = blockFlow(pixels, prevPixels);
  const blobs = findMotionBlobs(flow);

  const detected = [];
  for (const blob of blobs) {
    // First pass: aspect ratio filter (people are tall)
    if (blob.aspectRatio > 0.7) continue; // Too wide for a person

    // Second pass: match against learned templates
    const match = personTemplates.match(blob);
    if (match.confidence > 0.3) {
      detected.push({
        ...blob,
        personConfidence: match.confidence,
        learnedFrom: match.learnedFrom,
      });
    }
  }

  return {
    detected,
    blobCount: blobs.length,
    personCount: detected.length,
    flow,
  };
}

// ── Background modeling (for silhouette-based detection) ────────
// Simple running average background model — no learning needed.
// Moving silhouettes = foreground = potential people.

export class BackgroundModel {
  constructor() {
    this.background = null;  // Float64Array
    this.frameCount = 0;
  }

  update(pixels) {
    if (!this.background) {
      this.background = new Float64Array(pixels);
    } else {
      const alpha = Math.min(0.1, 1 / (this.frameCount + 1));
      for (let i = 0; i < pixels.length; i++) {
        this.background[i] = (1 - alpha) * this.background[i] + alpha * pixels[i];
      }
    }
    this.frameCount++;
  }

  foregroundMask(pixels, threshold = 30) {
    const mask = new Uint8Array(pixels.length);
    if (!this.background) return mask;
    for (let i = 0; i < pixels.length; i++) {
      mask[i] = Math.abs(pixels[i] - this.background[i]) > threshold ? 255 : 0;
    }
    return mask;
  }
}
