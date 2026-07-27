#!/usr/bin/env node
// Render Odessa Steps with stick figures and motion arrows
import('node:fs').then(async (fs) => {
  const { spawn } = await import('node:child_process');

  const path = '../PhantasmagoriaTheater-BattleshipPotemkin1925396_512kb.mp4';
  const { FRAME_WIDTH, FRAME_HEIGHT } = await import('./packages/engine/perceiver/video/reading.js');
  const { blockFlow } = await import('./packages/engine/perceiver/video/flow.js');
  const { findMotionBlobs } = await import('./packages/engine/perceiver/video/people.js');
  const { annotateFrame } = await import('./packages/engine/perceiver/video/annotate.js');
  const { prepareFrame } = await import('./packages/engine/perceiver/video/grain.js');

  const fps = 2, startSec = 3180, duration = 30;
  const frameSize = FRAME_WIDTH * FRAME_HEIGHT;
  const outPath = '/tmp/potemkin-steps-annotated.mp4';
  const rawPath = '/tmp/potemkin-annotated.raw';

  // Extract frames
  const buf = await new Promise(r => {
    const ff = spawn('ffmpeg', ['-ss', String(startSec), '-i', path,
      '-t', String(duration), '-f', 'rawvideo', '-pix_fmt', 'gray',
      '-s', '160x120', '-r', String(fps), '-']);
    const c = []; ff.stdout.on('data', d => c.push(d));
    ff.on('close', () => r(Buffer.concat(c)));
    ff.stderr.on('data', () => {});
  });

  const total = Math.floor(buf.length / frameSize);
  process.stderr.write(`Frames: ${total}\n`);

  // Process
  const out = new Uint8Array(buf.length);
  let prev = null;

  for (let f = 0; f < total; f++) {
    const raw = new Uint8Array(buf.subarray(f * frameSize, (f + 1) * frameSize));
    const cleaned = prepareFrame(raw);

    let people = [], flow = null;
    if (prev) {
      flow = blockFlow(cleaned, prev);
      const blobs = findMotionBlobs(flow, { minBlobBlocks: 2 });
      people = blobs
        .filter(b => b.aspectRatio < 0.6 && b.size > 0.015)
        .map(b => ({
          centroidX: b.centroidX, centroidY: b.centroidY,
          height: b.height, personConfidence: Math.min(1, b.coherence * 1.5),
        }));
    }
    prev = new Uint8Array(cleaned);

    const annotated = annotateFrame(cleaned, {
      time: startSec + f / fps, people, motionFlow: flow,
    });
    out.set(annotated, f * frameSize);

    if ((f + 1) % 10 === 0 || f === 0) process.stderr.write(`  frame ${f + 1}/${total}\n`);
  }

  process.stderr.write('Writing raw...\n');
  fs.writeFileSync(rawPath, Buffer.from(out));

  process.stderr.write('Encoding mp4...\n');
  await new Promise(r => {
    const ff = spawn('ffmpeg', [
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '160x120',
      '-r', String(fps), '-i', rawPath,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-pix_fmt', 'yuv420p', outPath,
    ]);
    ff.stderr.on('data', () => {});
    ff.on('close', () => { r(); });
  });
  fs.unlinkSync(rawPath);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  process.stderr.write(`\nDone: ${outPath} (${kb} KB, ${total} frames)\n`);
});
