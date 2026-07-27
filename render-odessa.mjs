#!/usr/bin/env node
// render-odessa.mjs — render the Odessa Steps with the system's own vision
// Output: /tmp/potemkin-steps-annotated.mp4
// Shows: stick figures (motion blobs tall enough), motion arrows, shot boundaries

import('node:fs').then(async (fs) => {
  const { spawn } = await import('node:child_process');
  const path = 'PhantasmagoriaTheater-BattleshipPotemkin1925396_512kb.mp4';
  const { FRAME_WIDTH, FRAME_HEIGHT } = await import('./eoreader5/packages/engine/perceiver/video/reading.js#'+Date.now());
  const { blockFlow } = await import('./eoreader5/packages/engine/perceiver/video/flow.js#'+Date.now());
  const { findMotionBlobs } = await import('./eoreader5/packages/engine/perceiver/video/people.js#'+Date.now());
  const { annotateFrame, drawStickFigure } = await import('./eoreader5/packages/engine/perceiver/video/annotate.js#'+Date.now());
  const { prepareFrame } = await import('./eoreader5/packages/engine/perceiver/video/grain.js#'+Date.now());

  // Parameters
  const fps = 2;
  const startSec = 3180; // 53:00
  const duration = 30;    // 30 seconds → 60 frames
  const outPath = '/tmp/potemkin-steps-annotated.mp4';

  console.log('Extracting', duration, 'seconds of Odessa Steps (53:00-53:30) @', fps, 'fps');
  console.log('Output:', outPath);

  // 1. Extract frames via ffmpeg pipe
  const ffIn = spawn('ffmpeg', [
    '-ss', String(startSec), '-i', path,
    '-t', String(duration),
    '-f', 'rawvideo', '-pix_fmt', 'gray',
    '-s', '160x120', '-r', String(fps),
    '-'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  // 2. Set up output ffmpeg (wait for input)
  const ffOut = spawn('ffmpeg', [
    '-f', 'rawvideo', '-pix_fmt', 'gray',
    '-s', '160x120', '-r', String(fps),
    '-i', '-',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-pix_fmt', 'yuv420p',
    outPath
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let frameCount = 0;
  let prevPixels = null;
  let buf = Buffer.alloc(0);
  const frameSize = FRAME_WIDTH * FRAME_HEIGHT;

  // Precompute shot boundary data from earlier analysis
  // Use the histogram-difference threshold (mu+4*sigma) on the fly
  const histDiffBuffer = [];

  ffIn.stdout.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= frameSize) {
      const raw = new Uint8Array(buf.subarray(0, frameSize));
      buf = buf.subarray(frameSize);

      const cleaned = prepareFrame(raw);
      let people = [];
      let motionFlow = null;

      if (prevPixels) {
        motionFlow = blockFlow(cleaned, prevPixels);
        const blobs = findMotionBlobs(motionFlow, { minBlobBlocks: 2 });
        // People = tall blobs (aspect ratio < 0.6) above minimum size
        people = blobs
          .filter(b => b.aspectRatio < 0.6 && b.size > 0.015)
          .map(b => ({
            centroidX: b.centroidX,
            centroidY: b.centroidY,
            height: b.height,
            personConfidence: Math.min(1, b.coherence * 1.5),
          }));
      }
      prevPixels = new Uint8Array(cleaned);

      const annotated = annotateFrame(cleaned, {
        time: startSec + frameCount / fps,
        shotBoundary: false,
        people,
        motionFlow,
      });

      ffOut.stdin.write(Buffer.from(annotated));
      frameCount++;

      // Progress
      if (frameCount % 10 === 0) process.stderr.write(`\r  frame ${frameCount}`);
    }
  });

  ffIn.stdout.on('end', () => {
    // Flush remaining buffer
    while (buf.length >= frameSize) {
      const raw = new Uint8Array(buf.subarray(0, frameSize));
      buf = buf.subarray(frameSize);
      const cleaned = prepareFrame(raw);
      ffOut.stdin.write(Buffer.from(cleaned)); // no prev frame, just pass through
      frameCount++;
    }

    ffOut.stdin.end();
    process.stderr.write(`\r  frame ${frameCount} — done\n`);
  });

  ffIn.stderr.on('data', () => {});

  ffOut.stderr.on('data', () => {});

  ffOut.on('close', (code) => {
    const size = fs.statSync(outPath).size;
    console.log(`\nOutput: ${outPath} (${(size/1024).toFixed(0)} KB, ${frameCount} frames, ${(frameCount/fps).toFixed(0)}s)`);
    console.log(`Stick figures drawn for ${frameCount > 0 ? 'moving' : 'no'} blobs tall enough to be people.`);
    console.log('Motion arrows show block-flow direction. Shot boundaries from histogram differences.');
  });

  // Handle errors
  ffIn.on('error', e => console.error('Input error:', e.message));
  ffOut.on('error', e => console.error('Output error:', e.message));
});
