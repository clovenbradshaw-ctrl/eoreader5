/**
 * Text surface extractor — minimal, no NLP.
 *
 * Identifies candidate entity names by their only modality-specific signal:
 * capitalization. Multi-word capitalized sequences are treated as surfaces.
 *
 * The extractor does NOT normalize, classify, or cluster. It doesn't use
 * stop-lists, dictionaries, or regex patterns beyond the capitalization
 * pattern. It's the text analog of the audio perceiver's frame extraction:
 * raw signal in, candidate surfaces out. The engine handles everything else.
 */

const CAP_SEQ = /\b[\p{Lu}][\p{L}]+(?:\s+[\p{Lu}][\p{L}]+)*\b/gu;

export function extractSurfaces(text) {
  const out = [];
  let m;
  CAP_SEQ.lastIndex = 0;
  while ((m = CAP_SEQ.exec(text || ""))) {
    const s = m[0].trim();
    if (s.length >= 2) out.push(s);
  }
  return [...new Set(out)];
}

/**
 * Build per-chunk entity records for the entity-kinds pipeline.
 * Returns Map<chunkId, entityName[]>.
 */
export function buildSurfaceMap(chunkTexts) {
  const map = new Map();
  for (const [chunkId, text] of Object.entries(chunkTexts)) {
    map.set(chunkId, extractSurfaces(text));
  }
  return map;
}

export function buildEntityRecords(surfaceMap) {
  const entityChunks = new Map(); // entity -> Set<chunkId>
  const entityCoocs = new Map();  // entity -> Map<cooc, count>

  for (const [chunkId, surfaces] of surfaceMap) {
    for (const s of surfaces) {
      const chunks = entityChunks.get(s) ?? new Set();
      chunks.add(chunkId);
      entityChunks.set(s, chunks);
    }
    // Co-occurrence within chunk
    const unique = [...new Set(surfaces)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i], b = unique[j];
        const m1 = entityCoocs.get(a) ?? new Map();
        const m2 = entityCoocs.get(b) ?? new Map();
        m1.set(b, (m1.get(b) ?? 0) + 1);
        m2.set(a, (m2.get(a) ?? 0) + 1);
        entityCoocs.set(a, m1);
        entityCoocs.set(b, m2);
      }
    }
  }

  const records = [];
  for (const [name, chunks] of entityChunks) {
    const coocs = entityCoocs.get(name) ?? new Map();
    const attrs = [];
    // Co-occurrence attributes
    for (const [cooc, count] of coocs) {
      if (count >= 2) attrs.push({ field_id: `cooc:${cooc}`, value_type: "string", count });
    }
    const words = name.split(/\s+/);
    if (words.length >= 2) attrs.push({ field_id: "multiword", value_type: "string", count: 1 });
    if (attrs.length > 0) {
      records.push({ id: name, name, attributes: attrs });
    }
  }
  return records;
}
