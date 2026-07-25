import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;
const WORD = /\b[\p{Lu}][\p{L}'-]{2,}\b/gu;
const STOP = new Set(["The","And","But","For","With","This","That","When","Where","While","Letter","Chapter"]);

export function discoverCandidates(state, { maxCandidates } = {}) {
  const counts = new Map();
  for (const value of state.observationIndex?.values ?? []) {
    if (typeof value.value !== "string") continue;
    for (const [surface] of value.value.matchAll(WORD)) {
      if (STOP.has(surface)) continue;
      const key = surface.toLowerCase();
      const bucket = counts.get(key) ?? { surface, sightings: [] };
      bucket.sightings.push({ source_id: value.source_id, field_id: value.field_id, block_id: value.block_id, index: value.index, selector: value.selector, surface });
      counts.set(key, bucket);
    }
  }

  const entries = [...counts.entries()];
  const uniqueCount = entries.length;
  const resolvedMaxCandidates = maxCandidates ?? Math.min(1000, Math.max(10, Math.floor(uniqueCount / 2)));

  const freqs = entries.map(([, c]) => c.sightings.length);
  const nFreqs = freqs.length;
  const totalObs = freqs.reduce((a, b) => a + b, 0);
  const permutations = Math.max(40, Math.max(1, nFreqs) * 2);
  const rng = createSeededRng("search:recurrence-null");
  const nullSamples = [];
  for (let i = 0; i < permutations; i += 1) {
    const nullCount = new Array(nFreqs).fill(0);
    for (let j = 0; j < totalObs; j += 1) {
      nullCount[Math.floor(rng() * nFreqs)] += 1;
    }
    nullSamples.push(Math.max(...nullCount));
  }
  const sortedNull = [...nullSamples].sort((a, b) => a - b);
  const quantile = 1 - 1 / Math.max(10, nFreqs);
  const rank = quantile * (sortedNull.length - 1);
  const lowIdx = Math.floor(rank);
  const highIdx = Math.min(lowIdx + 1, sortedNull.length - 1);
  const frac = rank - lowIdx;
  const recurrenceThreshold = sortedNull[lowIdx] + (sortedNull[highIdx] - sortedNull[lowIdx]) * frac;

  return entries.map(([key, candidate]) => ({
    candidate_id: id("candidate", { key, sightings: candidate.sightings }),
    kind: "surface-recurrence",
    key,
    surface: candidate.surface,
    support: candidate.sightings.length,
    sightings: candidate.sightings,
    status: candidate.sightings.length > recurrenceThreshold ? "accepted" : "held",
  })).sort((a, b) => b.support - a.support || a.key.localeCompare(b.key)).slice(0, resolvedMaxCandidates);
}
