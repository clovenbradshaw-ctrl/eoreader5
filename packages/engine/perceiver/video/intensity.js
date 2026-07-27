// Intensity-driven adaptive resolution: frame rate and block size
// scale with the physics fields. Calm → coarse + slow. Action → fine + fast.
// Like human vision: experience time dilates with intensity.
//
// Unlike selectResolution in adaptive.js (which tries to find the natural
// block size from edge statistics — fails on noisy source like 1925 film),
// this module adapts based on the MOTION FIELDS of the previous frames.
// The system watches the flow and adjusts its own resolution accordingly.

import { FRAME_WIDTH, FRAME_HEIGHT } from './reading.js';

const BLOCK_SIZES = [4, 8, 12, 16, 20, 24];
const FRAME_RATES = [1, 2, 5, 10, 15, 24];

// Default starting resolution
export const DEFAULT_BLOCK = 8;
export const DEFAULT_FPS = 2;

// Map intensity to resolution index
function intensityToIndex(intensity, levels) {
  // intensity in [0, 1], maps to [0, levels.length-1]
  const idx = Math.round(intensity * (levels.length - 1));
  return Math.max(0, Math.min(levels.length - 1, idx));
}

// Compute intensity from physics fields
export function computeIntensity(physics) {
  if (!physics) return 0;

  // Current density is the primary signal (mass movement)
  const current = Math.min(1, physics.currentDensity / 5000);

  // Curl adds weight for rotational/complex motion
  const curl = Math.min(1, Math.abs(physics.curl) * 2);

  // Rotational + expansive energy captures overall activity
  const action = Math.min(1, (physics.rotationalEnergy + physics.expansiveEnergy) / 1500);

  // Gradient captures motion boundaries (edges of moving objects)
  const grad = Math.min(1, physics.gradient * 3);

  // Weighted combination
  const intensity = current * 0.4 + curl * 0.25 + action * 0.25 + grad * 0.1;

  return Math.min(1, intensity);
}

// Compute resolution for NEXT frame based on current physics
export function computeNextResolution(currentPhysics, { prevBlockSize = DEFAULT_BLOCK, prevFps = DEFAULT_FPS } = {}) {
  const intensity = computeIntensity(currentPhysics);

  // Map intensity to block size (high intensity = smaller blocks = more detail)
  const blockIdx = intensityToIndex(1 - intensity, BLOCK_SIZES); // invert: high intensity → small blocks
  const blockSize = intensity < 0.1 ? Math.max(prevBlockSize, 16) : // calm: stay coarse
                    intensity > 0.8 ? Math.min(prevBlockSize, 8) :  // intense: go fine
                    BLOCK_SIZES[blockIdx];

  // Map intensity to frame rate (high intensity = more fps)
  const fpsIdx = intensityToIndex(intensity, FRAME_RATES);
  const fps = intensity > 0.9 ? 24 :  // MAXIMUM intensity: full frame rate
              intensity > 0.7 ? 15 :
              intensity > 0.5 ? 10 :
              intensity > 0.3 ? 5 :
              intensity > 0.1 ? 2 : 1;

  const cols = Math.floor(FRAME_WIDTH / blockSize);
  const rows = Math.floor(FRAME_HEIGHT / blockSize);

  return {
    blockSize,
    cols,
    rows,
    fps,
    intensity,
    // Human-readable description
    description: intensity < 0.1 ? 'calm — coarse + slow' :
                 intensity < 0.3 ? 'ambient — moderate' :
                 intensity < 0.5 ? 'building — watching closely' :
                 intensity < 0.7 ? 'active — focused' :
                 intensity < 0.9 ? 'intense — tracking details' :
                 'MAXIMUM — full perception',
    // Experience time dilation (1 = normal, 2 = feels twice as long)
    timeDilation: 1 + intensity * 2,
  };
}

// Run a full scene analysis: track intensity over time and adapt resolution
export function analyzeIntensityProfile(frames, physicsPerFrame) {
  const profile = [];

  for (let i = 0; i < physicsPerFrame.length; i++) {
    const physics = physicsPerFrame[i];
    const prevRes = i > 0 ? profile[i - 1].resolution : null;

    const resolution = computeNextResolution(physics, {
      prevBlockSize: prevRes?.blockSize || DEFAULT_BLOCK,
      prevFps: prevRes?.fps || DEFAULT_FPS,
    });

    profile.push({
      frame: frames[i],
      physics,
      resolution,
    });
  }

  // Find the most intense moment
  const maxIntensity = profile.reduce((a, p) => p.resolution.intensity > a.resolution.intensity ? p : a, profile[0]);

  return {
    profile,
    peak: maxIntensity,
    avgIntensity: profile.reduce((a, p) => a + p.resolution.intensity, 0) / profile.length,
    // Effective frame count (what you'd get if every frame was at the rate it needed)
    effectiveFrames: profile.reduce((a, p) => a + p.resolution.fps, 0) / profile.length,
    // Time dilation: how long the experience felt vs clock time
    averageDilation: profile.reduce((a, p) => a + p.resolution.timeDilation, 0) / profile.length,
  };
}
