export function onsetEnvelope(fluxSeries) {
  let max = 1e-9;
  for (const v of fluxSeries) if (v > max) max = v;
  return Float64Array.from(fluxSeries, (v) => v / max);
}

export function pickOnsetPeaks(envelope, { medianWindow = 8, delta = 0.05 } = {}) {
  const peaks = [];
  const n = envelope.length;
  for (let i = 1; i < n - 1; i++) {
    if (envelope[i] < envelope[i - 1] || envelope[i] < envelope[i + 1]) continue;
    const start = Math.max(0, i - medianWindow), end = Math.min(n, i + medianWindow + 1);
    const sorted = Array.from(envelope.slice(start, end)).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (envelope[i] > median + delta) peaks.push(i);
  }
  return peaks;
}

export function estimateTempo(envelope, hopSeconds, { minBpm = 40, maxBpm = 240 } = {}) {
  const n = envelope.length;
  if (n < 2) return { bpm: 0, periodSeconds: 0 };
  let mean = 0;
  for (const v of envelope) mean += v;
  mean /= n;
  const centered = Float64Array.from(envelope, (v) => v - mean);

  const minLag = Math.max(1, Math.round(60 / maxBpm / hopSeconds));
  const maxLag = Math.min(n - 1, Math.max(minLag + 1, Math.round(60 / minBpm / hopSeconds)));
  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i < n - lag; i++) score += centered[i] * centered[i + lag];
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  const periodSeconds = bestLag * hopSeconds;
  return { bpm: periodSeconds > 0 ? 60 / periodSeconds : 0, periodSeconds };
}
