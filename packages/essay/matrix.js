import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

function normalizeEntity(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(city|county|state|town|village|borough|township|district|bureau|department|office|commission|authority|agency)\s+(of\s+)?/i, '');
}

function entityKey(name) {
  return normalizeEntity(name);
}

function quantitiesConflict(a, b) {
  if (a.length === 0 || b.length === 0) return false;
  for (const qa of a) {
    if (!Number.isFinite(qa.value)) continue;
    for (const qb of b) {
      if (!Number.isFinite(qb.value)) continue;
      if (qa.value === 0 && qb.value === 0) continue;
      const maxVal = Math.max(Math.abs(qa.value), Math.abs(qb.value));
      if (maxVal > 0 && Math.abs(qa.value - qb.value) / maxVal > 0.05) {
        return true;
      }
    }
  }
  return false;
}

function computeConflict(propositions) {
  const withQuantities = propositions.filter(p => p.quantities.length > 0);
  if (withQuantities.length < 2) return null;

  const sources = [...new Set(withQuantities.flatMap(p => p.source_evidence.map(e => e.source_id)))];
  if (sources.length < 2) return null;

  const bySource = new Map();
  for (const p of withQuantities) {
    for (const ev of p.source_evidence) {
      if (!bySource.has(ev.source_id)) bySource.set(ev.source_id, []);
      bySource.get(ev.source_id).push(p);
    }
  }

  const sourceList = [...bySource.keys()];
  for (let i = 0; i < sourceList.length; i++) {
    for (let j = i + 1; j < sourceList.length; j++) {
      const propsA = bySource.get(sourceList[i]);
      const propsB = bySource.get(sourceList[j]);
      for (const pa of propsA) {
        for (const pb of propsB) {
          if (pa.entities.some(e => pb.entities.includes(e)) && quantitiesConflict(pa.quantities, pb.quantities)) {
            const maxVal = Math.max(
              ...pa.quantities.map(q => Math.abs(q.value || 0)),
              ...pb.quantities.map(q => Math.abs(q.value || 0))
            );
            const delta = Math.abs((pa.quantities[0]?.value ?? 0) - (pb.quantities[0]?.value ?? 0));
            return {
              source_a: sourceList[i],
              source_b: sourceList[j],
              delta,
              delta_pct: maxVal > 0 ? delta / maxVal : 0,
            };
          }
        }
      }
    }
  }
  return null;
}

export function assembleMatrix(propositions, { total_sources } = {}) {
  const entityGroups = new Map();

  for (const prop of propositions) {
    const key = prop.entities.length > 0
      ? prop.entities.map(entityKey).join('+')
      : prop.proposition_id;

    if (!entityGroups.has(key)) {
      entityGroups.set(key, {
        entity_label: prop.entities[0] ?? '(abstract)',
        entity_keys: prop.entities.map(entityKey),
        propositions: [],
        sources: new Set(),
        has_conflict: false,
      });
    }

    const group = entityGroups.get(key);
    group.propositions.push(prop);
    for (const ev of prop.source_evidence) {
      group.sources.add(ev.source_id);
    }
  }

  const sources = new Set();
  const rows = [];

  for (const [, group] of entityGroups) {
    const conflict = computeConflict(group.propositions);
    if (conflict) group.has_conflict = true;

    const sourceList = [...group.sources];
    for (const src of sourceList) sources.add(src);

    const evidenceBySource = new Map();
    for (const prop of group.propositions) {
      for (const ev of prop.source_evidence) {
        if (!evidenceBySource.has(ev.source_id)) {
          evidenceBySource.set(ev.source_id, []);
        }
        evidenceBySource.get(ev.source_id).push({
          proposition_id: prop.proposition_id,
          span_text: ev.span_text,
          span_raw: ev.span_raw ?? null,
          confidence: prop.confidence,
          quantities: prop.quantities,
          time: prop.time,
          anchor: ev.anchor,
        });
      }
    }

    const coverage = sourceList.length / (total_sources ?? sourceList.length);
    const avgConfidence = group.propositions.reduce((s, p) => s + (p.confidence ?? 0.5), 0) / group.propositions.length;

    rows.push({
      row_id: id('mrow', { entity: group.entity_label, sources: sourceList }),
      entity_label: group.entity_label,
      entity_keys: group.entity_keys,
      evidence_by_source: Object.fromEntries(evidenceBySource),
      sources: sourceList,
      coverage,
      confidence: avgConfidence,
      conflict,
      has_conflict: group.has_conflict,
      proposition_ids: group.propositions.map(p => p.proposition_id),
    });
  }

  rows.sort((a, b) => {
    const scoreA = a.coverage * a.confidence * (a.has_conflict ? 1.2 : 1);
    const scoreB = b.coverage * b.confidence * (b.has_conflict ? 1.2 : 1);
    return scoreB - scoreA;
  });

  const sourceCoverage = {};
  for (const src of sources) {
    const rowsWithEvidence = rows.filter(r => r.sources.includes(src));
    sourceCoverage[src] = {
      source_id: src,
      rows_with_evidence: rowsWithEvidence.length,
      total_rows: rows.length,
      coverage: rows.length > 0 ? rowsWithEvidence.length / rows.length : 0,
      avg_confidence: rowsWithEvidence.length > 0
        ? rowsWithEvidence.reduce((s, r) => s + r.confidence, 0) / rowsWithEvidence.length
        : 0,
    };
  }

  return Object.freeze({
    matrix_id: id('matrix', { row_count: rows.length, source_count: sources.size }),
    rows,
    sources: [...sources],
    source_coverage: sourceCoverage,
    total_sources: sources.size,
    total_rows: rows.length,
    conflict_count: rows.filter(r => r.has_conflict).length,
  });
}
