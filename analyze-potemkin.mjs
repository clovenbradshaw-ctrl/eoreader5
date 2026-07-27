#!/usr/bin/env node
// analyze-potemkin.mjs — full pipeline on Battleship Potemkin
// Perceiver → holons → selective CV → structure

import('node:fs').then(async (fs) => {
  const path = process.argv[2] || 'PhantasmagoriaTheater-BattleshipPotemkin1925396_512kb.mp4';
  if (!fs.existsSync(path)) { console.error('File not found:', path); process.exit(1); }
  const sizeMB = (fs.statSync(path).size / (1024*1024)).toFixed(1);
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║   BATTLESHIP POTEMKIN — STRUCTURAL ANALYSIS   ║`);
  console.log(`  ╚══════════════════════════════════════════════╝`);
  console.log(`\n  File: ${path} (${sizeMB}MB, ~73min)`);

  // ── 1. Perceive: frames → field vectors ──
  console.time('\n  perceiver');
  const { buildVideoReading, FRAME_WIDTH, FRAME_HEIGHT, TARGET_FPS, BLOCK_SIZE } = await import('./packages/engine/perceiver/video/reading.js');
  const { analyzeFrame, selectKeyFrames } = await import('./packages/engine/perceiver/video/vision.js');
  const { streamVideoFrames } = await import('./packages/host/video.js');
  const reading = await buildVideoReading(streamVideoFrames(path, { fps: TARGET_FPS }), {
    fps: TARGET_FPS,
    onProgress: (n) => process.stderr.write(`\r  decoded ${n} frames @ ${TARGET_FPS}fps`),
  });
  process.stderr.write('\n');
  console.timeEnd('  perceiver');
  console.log(`  units: ${reading.units.length}, duration: ${(reading.axis.extent/60).toFixed(0)}min`);

  // ── 2. Holon separator on motion energy ──
  console.time('\n  holons');
  const { DEF, extremeValueNull } = await import('./packages/engine/emergence/nulls/extreme-value.js');
  const motionEnergy = reading.units.map(u => {
    const block = u.field.slice(0, 300);
    return block.reduce((a, v) => a + v, 0) / 300;
  });
  const absFloor = 1e-6, alpha = 0.05, minDur = 2, fps = TARGET_FPS;
  const energies = new Float64Array(motionEnergy);
  const times = new Float64Array(motionEnergy.map((_, i) => i / fps));
  const frameDur = 1 / fps;

  function runsFromFlags(flags, e, t, fd) {
    const runs = []; let i = 0;
    while (i < flags.length) {
      let j = i, sq = 0, cnt = 0, mx = 0;
      while (j < flags.length && flags[j] === flags[i]) { const ev = e[j]; sq += ev * ev; mx = Math.max(mx, ev); cnt++; j++; }
      const start = t[i], end = (j < t.length ? t[j] : t[t.length - 1] + fd);
      runs.push({ kind: flags[i] ? 'shot' : 'transition', start, end, dur: end - start, rms: cnt ? Math.sqrt(sq / cnt) : 0, peak: mx });
      i = j;
    }
    return runs;
  }
  function windowThreshold(eWin) {
    const logE = eWin.map(e => Math.log(Math.max(e, absFloor)));
    if (logE.length < 2) return Infinity;
    const sorted = logE.slice().sort((a, b) => b - a); const n = sorted.length, gaps = [];
    for (let i = 1; i < n; i++) gaps.push(sorted[i - 1] - sorted[i]);
    const lo = Math.max(1, Math.floor(n * 0.15)), hi = Math.min(gaps.length, Math.ceil(n * 0.85));
    let bg = -Infinity, bi = -1; for (let i = lo; i < hi; i++) if (gaps[i] > bg) { bg = gaps[i]; bi = i; } if (bi < 0) return Infinity; const idx = bi + 1;
    const f = extremeValueNull(gaps, { scale: 'log', alpha, N: gaps.length, leaveOut: bg });
    if (Number.isFinite(f) && bg > f) return Math.exp((sorted[idx - 1] + sorted[idx]) / 2);
    const f2 = extremeValueNull(gaps, { scale: 'log', alpha, N: 2, leaveOut: bg });
    if (Number.isFinite(f2) && bg > f2) return Math.exp((sorted[idx - 1] + sorted[idx]) / 2);
    return Infinity;
  }
  function coalesce(runs, md) {
    if (runs.length <= 1) return runs;
    let cur = runs.map(r => ({ ...r })), ch = true;
    while (ch && cur.length > 1) {
      ch = false; let idx = -1;
      for (let i = 0; i < cur.length; i++) if (cur[i].end - cur[i].start < md) { idx = i; break; }
      if (idx < 0) break;
      const left = cur[idx - 1], right = cur[idx + 1]; const into = (!right || (left && left.dur >= right.dur)) ? left : right;
      if (!into) break;
      const a = into, b = cur[idx]; const st = Math.min(a.start, b.start), en = Math.max(a.end, b.end), d = en - st;
      const rms = d > 0 ? Math.sqrt((a.rms * a.rms * a.dur + b.rms * b.rms * b.dur) / d) : Math.max(a.rms, b.rms);
      cur.splice(into === left ? idx - 1 : idx, 2, { kind: a.dur >= b.dur ? a.kind : b.kind, start: st, end: en, dur: d, rms, peak: Math.max(a.peak || 0, b.peak || 0) });
      ch = true;
    }
    for (const r of cur) r.dur = r.end - r.start;
    return cur;
  }

  function buildHolons(a, b, depth) {
    if (depth >= 3 || (b - a) < minDur * frameDur * 2) return [];
    const eWin = []; for (let f = 0; f < energies.length; f++) { if (times[f] < a || times[f] >= b) continue; eWin.push(energies[f]); }
    if (eWin.length < 2) return [];
    const thr = windowThreshold(eWin); const flags = eWin.map(e => e > thr ? 1 : 0);
    let runs = runsFromFlags(flags, Array.from(energies), Array.from(times), frameDur);
    runs = coalesce(runs, minDur * frameDur); if (runs.length <= 1) return [];
    return runs.map(r => { const kids = r.kind === 'shot' ? buildHolons(r.start, r.end, depth + 1) : []; return { ...r, children: kids }; });
  }

  const children = buildHolons(0, reading.units.length / fps, 0);
  const shots = children.filter(c => c.kind === 'shot');
  const transitions = children.filter(c => c.kind === 'transition');
  console.timeEnd('  holons');
  console.log(`  shots: ${shots.length}, transitions: ${transitions.length}`);
  console.log(`  avg shot length: ${(reading.axis.extent / shots.length).toFixed(1)}s`);

  // ── 3. Selective CV on key frames ──
  console.time('\n  cv');
  const keyFrameIndices = selectKeyFrames(shots, reading.units.length, fps);
  console.log(`  key frames selected: ${keyFrameIndices.length}`);

  // Get pixel data for key frames by re-streaming (selectively)
  // We store pre-computed data per unit: we already have pixel data from
  // the first pass... but we didn't save pixels (memory). So we re-stream
  // only the key frames using ffmpeg's seek capability.

  // For efficiency, let's stream through once more and collect key frames
  const keySet = new Set(keyFrameIndices);
  const keyAnalyses = new Map();
  const spawn = await import('node:child_process').then(m => m.spawn);

  // But instead of a full second pass, let's do a targeted approach:
  // for each key frame, extract that specific frame using ffmpeg seek
  let cvProcessed = 0;
  const batchSize = 50;
  for (let batch = 0; batch * batchSize < keyFrameIndices.length; batch++) {
    const batchKeys = keyFrameIndices.slice(batch * batchSize, (batch + 1) * batchSize);
    await Promise.all(batchKeys.map(idx => new Promise((resolve) => {
      const timeSec = idx / fps;
      const ffmpeg = spawn('ffmpeg', [
        '-ss', String(timeSec), '-i', path,
        '-vframes', '1', '-f', 'rawvideo', '-pix_fmt', 'gray',
        '-s', `${FRAME_WIDTH}x${FRAME_HEIGHT}`,
        '-',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const chunks = [];
      ffmpeg.stdout.on('data', c => chunks.push(c));
      ffmpeg.stdout.on('end', () => {
        if (chunks.length > 0) {
          const buf = Buffer.concat(chunks);
          if (buf.length >= FRAME_WIDTH * FRAME_HEIGHT) {
            const pixels = new Uint8Array(buf.subarray(0, FRAME_WIDTH * FRAME_HEIGHT));
            const motion = idx > 0 ? reading.units[idx].field.slice(0, 300).map(v => v) : null;
            const analysis = analyzeFrame(pixels, null, motion);
            keyAnalyses.set(idx, { ...analysis, time: timeSec, shot: shots.findIndex(s => s.start <= timeSec && s.end >= timeSec) });
            cvProcessed++;
          }
        }
        resolve();
      });
      ffmpeg.stderr.on('data', () => {});
      ffmpeg.on('error', () => resolve());
    })));

    if (batch % 5 === 0) process.stderr.write(`\r    cv: ${cvProcessed}/${keyFrameIndices.length} frames`);
  }
  process.stderr.write(`\r    cv: ${cvProcessed}/${keyFrameIndices.length} frames\n`);
  console.timeEnd('  cv');

  // ── 4. Print structure ──
  const clock = s => { const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r.toFixed(0).padStart(2, '0')}`; };

  // Identify potential intertitles from CV analysis
  const intertitles = [];
  const actionShots = [];
  for (const [idx, analysis] of keyAnalyses) {
    if (analysis.textLikeness > 0.4 || (analysis.sceneType === 'high-contrast' && analysis.composition > 0.6 && analysis.motionComplexity < 0.2)) {
      intertitles.push({ idx, ...analysis });
    }
    if (analysis.motionComplexity > 0.4) {
      actionShots.push({ idx, ...analysis });
    }
  }

  console.log(`\n  ── STRUCTURAL OVERVIEW ──`);
  console.log(`  ${shots.length} shots across ${(reading.axis.extent/60).toFixed(0)} min`);
  console.log(`  avg shot: ${(reading.axis.extent/shots.length).toFixed(1)}s`);
  console.log(`  intertitles detected: ${intertitles.length}`);
  console.log(`  high-action shots: ${actionShots.length}`);

  // Shot density over time (moving window)
  const windowMin = 5; // 5-minute sliding window
  const windowFrames = windowMin * 60 * fps;
  const density = [];
  for (let i = 0; i < shots.length; i++) {
    const start = shots[i].start;
    const windowEnd = start + windowMin * 60;
    let count = 0;
    for (let j = 0; j < shots.length; j++) {
      if (shots[j].start >= start && shots[j].start < windowEnd) count++;
    }
    density.push({ time: start, shotsPerMin: count / windowMin });
  }

  // Find the Odessa Steps sequence (accelerating cut rhythm = rising shot density)
  const peakDensity = density.reduce((a, d) => d.shotsPerMin > a.shotsPerMin ? d : a, density[0]);
  console.log(`  peak cut density: ${peakDensity.shotsPerMin.toFixed(1)} shots/min at ${clock(peakDensity.time)}`);

  // Shot length over time (identify sections by shot length patterns)
  console.log(`\n  ── SECTION ANALYSIS (by shot-length regime) ──`);
  // Group consecutive shots with similar length into sections
  let currentSection = { start: shots[0].start, end: shots[0].end, count: 1, lengths: [shots[0].dur] };
  const sections = [currentSection];
  for (let i = 1; i < shots.length; i++) {
    const s = shots[i];
    const prevAvg = currentSection.lengths.reduce((a, v) => a + v, 0) / currentSection.lengths.length;
    const changeRatio = s.dur / prevAvg;
    if (changeRatio > 2.5 || changeRatio < 0.4) {
      currentSection = { start: s.start, end: s.end, count: 1, lengths: [s.dur] };
      sections.push(currentSection);
    } else {
      currentSection.end = s.end;
      currentSection.count++;
      currentSection.lengths.push(s.dur);
    }
  }

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const avgLen = sec.lengths.reduce((a, v) => a + v, 0) / sec.lengths.length;
    const label = avgLen < 4 ? 'rapid cuts' : avgLen < 10 ? 'moderate' : avgLen < 20 ? 'slow' : 'very slow';
    const intens = intertitles.filter(it => it.time >= sec.start && it.time <= sec.end);
    const action = actionShots.filter(a => a.time >= sec.start && a.time <= sec.end);
    console.log(`  Section ${(i + 1).toString().padEnd(2)} ${clock(sec.start)}-${clock(sec.end)}  ${sec.count.toString().padEnd(3)} shots, avg ${avgLen.toFixed(1)}s [${label}]` +
      (intens.length > 0 ? `  ${intens.length} intertitles` : '') +
      (action.length > 0 ? `  ${action.length} action peaks` : ''));
  }

  // Find the historically correct act structure
  console.log(`\n  ── KNOWN ACT STRUCTURE ──`);
  console.log(`  Act I:  0:00    "Men and Maggots" (mutiny on the Potemkin)`);
  console.log(`  Act II: ~0:20   "Drama on the Quarterdeck" (Vakulinchuk's death)`);
  console.log(`  Act III:~0:35   "The Dead Man Calls" (funeral, Odessa steps)`);
  console.log(`  Act IV: ~0:45   "The Odessa Steps" (massacre)`);
  console.log(`  Act V:  ~1:00   "Meeting the Squadron" (battleship's defiance)`);

  // Compare detected structure to known acts
  console.log(`\n  ── CROSS-MODAL: SHOT DENSITY CURVE ──`);
  // A 73-minute film at 2fps: show the motion energy profile at key intervals
  const sampleInterval = Math.round(fps * 30); // every 30 seconds
  for (let i = 0; i < motionEnergy.length; i += sampleInterval) {
    const t = i / fps;
    const chunk = motionEnergy.slice(i, Math.min(i + sampleInterval, motionEnergy.length));
    const avg = chunk.reduce((a, v) => a + v, 0) / chunk.length;
    const bar = '█'.repeat(Math.round(avg * 200));
    if (avg > 0.01) process.stderr.write(`  ${clock(t)} ${bar}  ${(avg*1000).toFixed(0)}\n`);
  }
  console.log(`\n  Done.`);
});
