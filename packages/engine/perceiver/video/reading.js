// Video perceiver: raw frames in, field vectors out.
// No structure-finding — just frame-level features.
// Decoding is the HOST's job (@eoreader/host/video streams frames via
// ffmpeg); the engine consumes decoded { frameIndex, pixels } frames and
// stays codec-agnostic, same as audio's WAV-only policy.

export const TARGET_FPS = 2;
export const FRAME_WIDTH = 160;
export const FRAME_HEIGHT = 120;
export const BLOCK_SIZE = 8;

const COLS = Math.floor(FRAME_WIDTH / BLOCK_SIZE);   // 20
const ROWS = Math.floor(FRAME_HEIGHT / BLOCK_SIZE);   // 15
const MOTION_DIMS = COLS * ROWS;                       // 300
const HISTOGRAM_BINS = 16;
const CHANNEL_DIMS = { motion: MOTION_DIMS, histogram: HISTOGRAM_BINS, centroid: 2, moments: 3 };

export const VIDEO_FIELD_SPEC = Object.freeze({
  channels: [
    { name: 'motion', dims: CHANNEL_DIMS.motion, metric: 'euclidean' },
    { name: 'histogram', dims: CHANNEL_DIMS.histogram, metric: 'euclidean-standardised' },
    { name: 'centroid', dims: CHANNEL_DIMS.centroid, metric: 'euclidean-standardised' },
    { name: 'moments', dims: CHANNEL_DIMS.moments, metric: 'euclidean-standardised' },
  ],
});

// Per-frame field vector extraction
function extractFrameFields(frame, prevFrame) {
  const pixels = frame.pixels;
  const dim = FRAME_WIDTH * FRAME_HEIGHT;

  // 1. Motion energy per 8×8 block
  const motion = new Float64Array(MOTION_DIMS);
  let totalMotion = 0;
  let motionX = 0, motionY = 0, motionCount = 0;

  if (prevFrame) {
    const prevPixels = prevFrame.pixels;
    for (let by = 0; by < ROWS; by++) {
      for (let bx = 0; bx < COLS; bx++) {
        let sum = 0;
        for (let py = 0; py < BLOCK_SIZE; py++) {
          for (let px = 0; px < BLOCK_SIZE; px++) {
            const idx = (by * BLOCK_SIZE + py) * FRAME_WIDTH + (bx * BLOCK_SIZE + px);
            const diff = Math.abs(pixels[idx] - prevPixels[idx]);
            sum += diff;
          }
        }
        const blockMotion = sum / (BLOCK_SIZE * BLOCK_SIZE);
        motion[by * COLS + bx] = blockMotion;
        totalMotion += blockMotion;
        motionX += blockMotion * (bx / COLS);
        motionY += blockMotion * (by / ROWS);
        motionCount += blockMotion;
      }
    }
  }

  // 2. Luminance histogram (16 bins)
  const hist = new Float64Array(HISTOGRAM_BINS);
  for (let i = 0; i < dim; i++) {
    hist[Math.floor(pixels[i] / 16)]++;
  }
  for (let i = 0; i < HISTOGRAM_BINS; i++) hist[i] /= dim;

  // 3. Motion centroid and spatial moments
  const cx = motionCount > 0 ? motionX / motionCount : 0.5;
  const cy = motionCount > 0 ? motionY / motionCount : 0.5;

  // 4. Frame moments: mean brightness, brightness variance, motion fraction
  let meanBrightness = 0;
  for (let i = 0; i < dim; i++) meanBrightness += pixels[i];
  meanBrightness /= dim;

  let brightnessVar = 0;
  for (let i = 0; i < dim; i++) brightnessVar += (pixels[i] - meanBrightness) ** 2;
  brightnessVar /= dim;

  const motionFraction = dim > 0 ? totalMotion / (255 * MOTION_DIMS) : 0;

  return {
    motion,
    histogram: hist,
    centroid: Float64Array.from([cx, cy]),
    moments: Float64Array.from([meanBrightness / 255, Math.sqrt(brightnessVar) / 255, motionFraction]),
  };
}

function fieldVector(fields) {
  const parts = [fields.motion, fields.histogram, fields.centroid, fields.moments];
  const total = parts.reduce((s, a) => s + a.length, 0);
  const vec = new Float64Array(total);
  let offset = 0;
  for (const p of parts) { vec.set(p, offset); offset += p.length; }
  return vec;
}

// The perceiver: decoded frames in, Reading@1-like features out.
// `frames` is any (async) iterable of { frameIndex, pixels } — e.g. the
// stream produced host-side by @eoreader/host/video streamVideoFrames().
// Processes frames in streaming batches to handle large files; pass
// `onProgress` to observe decode progress (the engine itself never writes
// to stdio).
export async function buildVideoReading(frames, { fps = TARGET_FPS, sourceBytes = null, perceiver = {}, onProgress = null } = {}) {
  const units = [];
  let prevFrame = null;
  let frameCount = 0;

  for await (const frame of frames) {
    const fields = extractFrameFields(frame, prevFrame);
    const vec = fieldVector(fields);
    units.push({
      pos: frame.frameIndex / fps,
      span: 1 / fps,
      field: Array.from(vec),
      frameIndex: frame.frameIndex,
    });
    prevFrame = frame;
    frameCount++;

    if (onProgress && frameCount % 1000 === 0) onProgress(frameCount);
  }
  if (onProgress) onProgress(frameCount);

  const duration = frameCount > 0 ? frameCount / fps : 0;

  return {
    schema: 'Reading@1',
    medium: 'video',
    axis: { kind: 'time', unit: 's', extent: duration },
    units,
    field_spec: VIDEO_FIELD_SPEC,
    segments_proposed: [],
    sightings: [],
    discard: [
      { kind: 'frame-rate-reduction', reason: `sampled at ${fps} fps`, recoverable: false },
      { kind: 'color-discard', reason: 'grayscale only; color discarded', recoverable: true },
      { kind: 'resolution-reduction', reason: `resized to ${FRAME_WIDTH}x${FRAME_HEIGHT}`, recoverable: true },
    ],
    perceiver: { id: 'video-motion-energy', version: '0.1.0', ...perceiver, params: { fps, width: FRAME_WIDTH, height: FRAME_HEIGHT, blockSize: BLOCK_SIZE } },
    content_hash: null,
  };
}
