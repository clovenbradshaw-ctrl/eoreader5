import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;
const WORD = /\b[\p{Lu}][\p{L}'-]{2,}\b/gu;
const STOP = new Set(["The","And","But","For","With","This","That","When","Where","While","Letter","Chapter"]);

export function discoverCandidates(state, { maxCandidates = 100 } = {}) {
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
  return [...counts.entries()].map(([key, candidate]) => ({
    candidate_id: id("candidate", { key, sightings: candidate.sightings }),
    kind: "surface-recurrence",
    key,
    surface: candidate.surface,
    support: candidate.sightings.length,
    sightings: candidate.sightings,
    status: candidate.sightings.length > 1 ? "accepted" : "held",
  })).sort((a, b) => b.support - a.support || a.key.localeCompare(b.key)).slice(0, maxCandidates);
}
