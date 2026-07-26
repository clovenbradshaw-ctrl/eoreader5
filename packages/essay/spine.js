import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

const VALID_STATES = ['pending', 'exploring', 'consolidating', 'accepted'];

export function buildSpine({ thesis, matrix, intents }) {
  const sections = [];

  sections.push({
    id: id('sec', { kind: 'overview', thesis }),
    intent: 'establish the scope and sources of the collection',
    order: 0,
    state: 'pending',
    modality: 'text',
    source_scope: 'all',
    dependsOn: [],
    anchors: ['introduction', 'source-overview'],
  });

  const highCoverageRows = matrix.rows.filter(r => r.coverage >= 0.5);
  if (highCoverageRows.length > 0) {
    const entities = [...new Set(highCoverageRows.flatMap(r => r.entity_keys))];
    sections.push({
      id: id('sec', { kind: 'shared', entities }),
      intent: `present findings shared across sources: ${entities.slice(0, 5).join(', ')}`,
      order: 1,
      state: 'pending',
      modality: 'text',
      source_scope: 'all',
      dependsOn: [sections[0].id],
      anchors: ['shared-findings', 'cross-source'],
      row_ids: highCoverageRows.map(r => r.row_id),
    });
  }

  const structuredRows = matrix.rows.filter(r =>
    r.proposition_ids.some(pid => {
      const allProps = matrix.rows.flatMap(rr => rr.proposition_ids);
      return r.sources.some(s => {
        const evidence = r.evidence_by_source[s];
        return evidence?.some(e => e.quantities?.length > 0);
      });
    })
  );
  if (structuredRows.length > 0) {
    sections.push({
      id: id('sec', { kind: 'data' }),
      intent: 'present the quantitative picture from structured sources',
      order: 2,
      state: 'pending',
      modality: 'chart',
      source_scope: 'structured',
      dependsOn: [sections[0].id],
      anchors: ['quantities', 'data'],
      row_ids: structuredRows.map(r => r.row_id),
    });
  }

  const conflictRows = matrix.rows.filter(r => r.has_conflict);
  if (conflictRows.length > 0) {
    const entities = [...new Set(conflictRows.flatMap(r => r.entity_keys))];
    sections.push({
      id: id('sec', { kind: 'conflict', entities }),
      intent: `surface tensions and discrepancies between sources`,
      order: 3,
      state: 'pending',
      modality: 'text',
      source_scope: 'all',
      dependsOn: sections.filter(s => s.kind !== 'overview').map(s => s.id),
      anchors: ['conflicts', 'discrepancies'],
      row_ids: conflictRows.map(r => r.row_id),
    });
  }

  const lowCoverageRows = matrix.rows.filter(r => r.coverage < 0.5 && !r.has_conflict);
  if (lowCoverageRows.length > 0) {
    const bySource = new Map();
    for (const row of lowCoverageRows) {
      for (const src of row.sources) {
        if (!bySource.has(src)) bySource.set(src, []);
        bySource.get(src).push(row);
      }
    }
    for (const [src, rows] of bySource) {
      if (rows.length >= 2) {
        sections.push({
          id: id('sec', { kind: 'source-specific', src }),
          intent: `findings unique to ${src}`,
          order: sections.length,
          state: 'pending',
          modality: 'pullquote',
          source_scope: src,
          dependsOn: [sections[0].id],
          anchors: [`${src}-unique`],
          row_ids: rows.map(r => r.row_id),
        });
      }
    }
  }

  sections.push({
    id: id('sec', { kind: 'synthesis' }),
    intent: 'synthesize what the collection reveals and identify gaps',
    order: sections.length,
    state: 'pending',
    modality: 'text',
    source_scope: 'all',
    dependsOn: sections.filter(s => s.kind !== 'overview').map(s => s.id),
    anchors: ['synthesis', 'gaps', 'coverage'],
  });

    if (intents) {
    for (const intent of intents) {
      const existing = sections.find(s => s.intent === intent.intent);
      if (!existing) {
        sections.push(Object.freeze({
          id: intent._id ?? id('sec', { kind: 'custom', intent: intent.intent }),
          intent: intent.intent,
          order: sections.length,
          state: 'pending',
          modality: intent.modality ?? 'text',
          source_scope: intent.source_scope ?? 'all',
          dependsOn: intent.dependsOn ?? [sections[0].id],
          anchors: intent.anchors ?? [],
          row_ids: intent.row_ids,
        }));
      }
    }
  }

  const visited = new Set();
  const stack = new Set();
  function hasCycle(secId) {
    if (stack.has(secId)) return true;
    if (visited.has(secId)) return false;
    stack.add(secId);
    const sec = sections.find(s => s.id === secId);
    if (sec) {
      for (const dep of sec.dependsOn) {
        if (sections.some(s => s.id === dep) && hasCycle(dep)) return true;
      }
    }
    stack.delete(secId);
    visited.add(secId);
    return false;
  }
  for (const sec of sections) {
    if (hasCycle(sec.id)) {
      throw new TypeError(`Spine cycle detected involving section ${sec.id}`);
    }
  }

  for (let i = 0; i < sections.length; i++) {
    sections[i].order = i;
  }

  const ids = new Set(sections.map(s => s.id));
  for (const section of sections) {
    section.dependsOn = section.dependsOn.filter(dep => ids.has(dep));
  }

  return Object.freeze({
    spine_id: id('spine', { thesis, sections: sections.map(s => s.id) }),
    thesis,
    sections: sections.map(s => Object.freeze(s)),
  });
}

export function renderOrder(spine) {
  const done = new Set();
  const picked = new Set();
  const order = [];
  const pickable = () => spine.sections.filter(s =>
    !picked.has(s.id) && s.state === 'pending' && s.dependsOn.every(dep => done.has(dep))
  );

  let remaining = pickable();
  while (remaining.length > 0) {
    remaining.sort((a, b) => a.order - b.order);
    const next = remaining[0];
    order.push(next);
    picked.add(next.id);
    done.add(next.id);
    remaining = pickable();
  }

  const accepted = spine.sections.filter(s => s.state === 'accepted');
  for (const sec of accepted) {
    if (!order.find(o => o.id === sec.id)) {
      const idx = Math.min(sec.order, order.length);
      order.splice(idx, 0, sec);
    }
  }

  return order;
}

export function reviseSpine(spine, operation) {
  const sections = [...spine.sections];

  if (operation.type === 'reorder') {
    const { sectionId, newOrder } = operation;
    const sec = sections.find(s => s.id === sectionId);
    if (!sec || sec.state !== 'pending') return spine;
    sec.order = newOrder;
  } else if (operation.type === 'insert') {
      sections.push(Object.freeze({
        id: operation._id ?? id('sec', { kind: 'inserted', intent: operation.intent }),
        intent: operation.intent,
      order: sections.length,
      state: 'pending',
      modality: operation.modality ?? 'text',
      source_scope: operation.source_scope ?? 'all',
      dependsOn: operation.dependsOn ?? [],
      anchors: operation.anchors ?? [],
    }));
  } else if (operation.type === 'merge') {
    const { mergeeIds, intoId } = operation;
    const target = sections.find(s => s.id === intoId);
    if (!target) return spine;
    const mergees = sections.filter(s => mergeeIds.includes(s.id));
    target.dependsOn = [...new Set([
      ...target.dependsOn,
      ...mergees.flatMap(m => m.dependsOn),
    ].filter(dep => !mergeeIds.includes(dep) && dep !== intoId))];
    target.row_ids = [...new Set([
      ...(target.row_ids ?? []),
      ...mergees.flatMap(m => m.row_ids ?? []),
    ])];
    for (let i = sections.length - 1; i >= 0; i--) {
      if (mergeeIds.includes(sections[i].id)) sections.splice(i, 1);
    }
  }

  for (let i = 0; i < sections.length; i++) {
    sections[i] = { ...sections[i], order: i };
  }

  return Object.freeze({
    ...spine,
    sections: sections.map(s => Object.freeze(s)),
  });
}
