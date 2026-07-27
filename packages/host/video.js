// Host-side video I/O: ffmpeg decode/encode as subprocesses.
//
// This is the host boundary the engine's video perceiver sits behind.
// The engine (packages/engine/perceiver/video) is pure — frames in,
// features out — the same contract as audio's WAV-only policy. Codec
// work, subprocess management, and file paths all live here.

import { spawn } from 'node:child_process';
import {
  TARGET_FPS,
  FRAME_WIDTH,
  FRAME_HEIGHT,
} from '@eoreader/engine';

// Stream frames via ffmpeg, yield { frameIndex, pixels } objects — the
// exact frame shape buildVideoReading consumes.
export async function* streamVideoFrames(videoPath, { fps = TARGET_FPS, width = FRAME_WIDTH, height = FRAME_HEIGHT } = {}) {
  const frameBytes = width * height;
  const ffmpeg = spawn('ffmpeg', [
    '-i', videoPath,
    '-vf', `fps=${fps},scale=${width}:${height}`,
    '-f', 'rawvideo', '-pix_fmt', 'gray',
    '-', // stdout
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let buf = Buffer.alloc(0);
  let frameIndex = 0;

  for await (const chunk of ffmpeg.stdout) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= frameBytes) {
      const frame = buf.subarray(0, frameBytes);
      buf = buf.subarray(frameBytes);
      yield { frameIndex: frameIndex++, pixels: new Uint8Array(frame) };
    }
  }

  // Drain stderr so the process can close; ffmpeg's normal termination
  // messages are not errors.
  await new Promise((resolve) => {
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', resolve);
  });
}

// Pipe annotated grayscale frames through ffmpeg to create output video.
export function produceAnnotatedVideo(annotatedFrames, outputPath, { fps = 2, width = FRAME_WIDTH, height = FRAME_HEIGHT } = {}) {
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`,
    '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-pix_fmt', 'yuv420p',
    outputPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  for (const frame of annotatedFrames) {
    ffmpeg.stdin.write(Buffer.from(frame));
  }
  ffmpeg.stdin.end();

  return new Promise((resolve) => {
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', resolve);
  });
}
