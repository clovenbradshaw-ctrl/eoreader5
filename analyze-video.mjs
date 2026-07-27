#!/usr/bin/env node
// analyze-video.mjs — full pipeline on a video file
// Usage: node analyze-video.mjs path/to/video.mp4 [--fps 2]

import('node:fs').then(async (fs) => {
  const path = process.argv[2];
  if (!path) { console.error('Usage: node analyze-video.mjs path/to/video [--fps 2]'); process.exit(1); }

  const fpsArg = process.argv.findIndex(a => a === '--fps');
  const fps = fpsArg >= 0 ? parseInt(process.argv[fpsArg + 1]) : 2;

  if (!fs.existsSync(path)) { console.error('File not found:', path); process.exit(1); }
  const sizeMB = (fs.statSync(path).size / (1024*1024)).toFixed(1);
  console.log(`\n  Processing: ${path} (${sizeMB}MB @ ${fps}fps)`);
  console.log('  ────────────────────────────────────\n');

  // 1. Perceive: frames → field vectors (streaming, never loads full file)
  console.time('perceiver');
  const { buildVideoReading } = await import('./packages/engine/perceiver/video/reading.js');
  const { streamVideoFrames } = await import('./packages/host/video.js');
  const reading = await buildVideoReading(streamVideoFrames(path, { fps }), {
    fps,
    onProgress: (n) => process.stderr.write(`\r  decoded ${n} frames @ ${fps}fps`),
  });
  process.stderr.write('\n');
  console.timeEnd('perceiver');
  console.log(`  units: ${reading.units.length}, duration: ${reading.axis.extent.toFixed(0)}s\n`);

  // 2. Holon separator on motion-energy channel (index 0..299)
  console.time('holons');
  const { DEF, extremeValueNull } = await import('./packages/engine/emergence/nulls/extreme-value.js');
  const motionEnergy = reading.units.map(u => {
    const block = u.field.slice(0, 300);
    return block.reduce((a, v) => a + v, 0) / 300; // mean block motion per frame
  });

  const absFloor = 1e-6, alpha = 0.05, minDur = 3; // 3-frame minimum = 1.5s at 2fps
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
  function coalesce(runs, md) {
    if (runs.length <= 1) return runs; let cur = runs.map(r => ({ ...r })), ch = true;
    while (ch && cur.length > 1) { ch = false; let idx = -1; for (let i = 0; i < cur.length; i++) if (cur[i].dur < md) { idx = i; break; } if (idx < 0) break;
      const left = cur[idx - 1], right = cur[idx + 1]; const into = (!right || (left && left.dur >= right.dur)) ? left : right; if (!into) break;
      const a = into, b = cur[idx]; const st = Math.min(a.start, b.start), en = Math.max(a.end, b.end), d = en - st;
      const rms = d > 0 ? Math.sqrt((a.rms * a.rms * a.dur + b.rms * b.rms * b.dur) / d) : Math.max(a.rms, b.rms);
      cur.splice(into === left ? idx - 1 : idx, 2, { kind: a.dur >= b.dur ? a.kind : b.kind, start: st, end: en, dur: d, rms, peak: Math.max(a.peak || 0, b.peak || 0) }); ch = true;
    } for (const r of cur) r.dur = r.end - r.start; return cur;
  }
  function windowThreshold(eWin) {
    const logE = eWin.map(e => Math.log(Math.max(e, absFloor)));
    if (logE.length < 2) return Infinity; const sorted = logE.slice().sort((a, b) => b - a); const n = sorted.length, gaps = [];
    for (let i = 1; i < n; i++) gaps.push(sorted[i - 1] - sorted[i]);
    const lo = Math.max(1, Math.floor(n * 0.15)), hi = Math.min(gaps.length, Math.ceil(n * 0.85));
    let bg = -Infinity, bi = -1; for (let i = lo; i < hi; i++) if (gaps[i] > bg) { bg = gaps[i]; bi = i; } if (bi < 0) return Infinity; const idx = bi + 1;
    const f = extremeValueNull(gaps, { scale: 'log', alpha, N: gaps.length, leaveOut: bg });
    if (Number.isFinite(f) && bg > f) return Math.exp((sorted[idx - 1] + sorted[idx]) / 2);
    const f2 = extremeValueNull(gaps, { scale: 'log', alpha, N: 2, leaveOut: bg });
    if (Number.isFinite(f2) && bg > f2) return Math.exp((sorted[idx - 1] + sorted[idx]) / 2);
    return Infinity;
  }

  const build = (a, b, depth) => {
    if (depth >= 3 || (b - a) < minDur * frameDur * 2) return [];
    const eWin = []; for (let f = 0; f < energies.length; f++) { if (times[f] < a || times[f] >= b) continue; eWin.push(energies[f]); }
    if (eWin.length < 2) return [];
    const thr = windowThreshold(eWin); const flags = eWin.map(e => e > thr ? 1 : 0);
    const rs = Math.max(0, Math.floor(a * fps)), re = Math.min(energies.length, Math.ceil(b * fps) + 1);
    let runs = runsFromFlags(flags, Array.from(energies).slice(rs, re), Array.from(times).slice(rs, re), frameDur);
    runs = coalesce(runs, minDur * frameDur); if (runs.length <= 1) return [];
    return runs.map(r => { const kids = r.kind === 'shot' ? build(r.start, r.end, depth + 1) : []; return { ...r, children: kids }; });
  };

  const children = build(0, reading.units.length / fps, 0);
  const shots = children.filter(c => c.kind === 'shot');
  const transitions = children.filter(c => c.kind === 'transition');
  console.timeEnd('holons');
  console.log(`  shots: ${shots.length}, transitions: ${transitions.length}\n`);

  // 3. Print structure
  const clock = s => { const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0'); };
  console.log('  SHOT STRUCTURE:');
  for (let i = 0; i < Math.min(shots.length, 40); i++) {
    const s = shots[i];
    console.log(`    Shot ${(i + 1).toString().padEnd(3)} ${clock(s.start)} → ${clock(s.end)}  (${s.dur.toFixed(1)}s, motion=${s.peak.toFixed(4)})`);
    if (s.children && s.children.length > 0) {
      for (const c of s.children) {
        if (c.kind === 'shot') console.log(`      └ sub-shot  ${clock(c.start)} → ${clock(c.end)}  (${c.dur.toFixed(1)}s)`);
      }
    }
  }
  if (shots.length > 40) console.log(`    ... and ${shots.length - 40} more shots`);

  // 4. Cross-modal: compare shot density to audio section density (if audio exists)
  console.log('');
  console.log('  MOTION SUMMARY:');
  const motionMax = Math.max(...motionEnergy);
  const motionMean = motionEnergy.reduce((a, v) => a + v, 0) / motionEnergy.length;
  const highMotion = motionEnergy.filter(v => v > motionMean * 2).length;
  console.log(`    mean motion: ${(motionMean * 1000).toFixed(2)}/frame | peak: ${(motionMax * 1000).toFixed(2)}` +
    ` | high-motion frames: ${highMotion}/${motionEnergy.length}`);

  // Luminance range
  const lumVals = reading.units.map(u => u.field[300]); // first histogram bin ≈ very dark
  const brightVals = reading.units.map(u => u.field[315]); // last histogram bin ≈ very bright
  const avgLum = reading.units.map(u => {
    const h = u.field.slice(300, 316);
    return h.reduce((a, v, i) => a + v * (i / 16), 0);
  });
  console.log(`    luminance range: ${Math.min(...avgLum).toFixed(2)} – ${Math.max(...avgLum).toFixed(2)} (normalised)`);

  console.log('\n  Done.');
});
