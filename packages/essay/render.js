const PARA_BREAK = /\n\s*\n+/;

function attributionPhrase(sourceCount, sourceIds) {
  if (sourceCount >= 3) return 'Across multiple sources';
  if (sourceCount === 2) return `According to ${sourceIds[0]} and ${sourceIds[1]}`;
  if (sourceCount === 1) return `According to ${sourceIds[0]}`;
  return '';
}

function conflictPhrase(conflict) {
  if (!conflict) return '';
  const delta = Number.isFinite(conflict.delta_pct)
    ? `${Math.round(conflict.delta_pct * 100)}%`
    : 'different';
  return ` (${conflict.source_a} and ${conflict.source_b} differ by ${delta})`;
}

// Detect paragraph boundaries directly in the source text rather than
// imposing a fixed spacing rule. A paragraph break is wherever the source
// had one (blank line between verses, chapters, scenes) — never a hardcoded
// count of sentences.
function splitParagraphs(text) {
  if (!text) return [''];
  const parts = text.split(PARA_BREAK);
  return parts.map(p => p.trim()).filter(Boolean);
}

export function renderText(commitments, { thesis, sectionIntent } = {}) {
  if (commitments.length === 0) return '';

  const sorted = [...commitments].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5));
  const paragraphGroups = [];
  const commitmentGroupCounts = [];
  let currentGroup = [];

  function flushGroup() {
    if (currentGroup.length > 0) {
      paragraphGroups.push(currentGroup.join(' '));
      currentGroup = [];
    }
  }

  function addToGroup(sentence) {
    const hasBreak = PARA_BREAK.test(sentence);
    if (hasBreak) {
      const segments = splitParagraphs(sentence);
      for (let si = 0; si < segments.length; si++) {
        if (si > 0) flushGroup();
        currentGroup.push(segments[si]);
      }
    } else {
      currentGroup.push(sentence);
    }
  }

  for (const commitment of sorted) {
    const before = paragraphGroups.length + (currentGroup.length > 0 ? 1 : 0);
    const prop = commitment.proposition;
    const sources = [...new Set(commitment.spanRefs.map(sr => sr.source_id))];
    const attr = attributionPhrase(sources.length, sources);
    const conflict = conflictPhrase(prop.conflict);

    let sentence = '';

    if (prop.quantities.length > 0 && prop.entities.length > 0) {
      const qtyText = prop.quantities.map(q => q.raw).join(' and ');
      const timeText = prop.time ? ` in ${prop.time}` : '';
      sentence = `${attr ? attr + ', ' : ''}${prop.entities.join(' and ')} ${prop.relation === 'record' ? 'records' : prop.relation + 's'} ${qtyText}${timeText}.${conflict ? ' However, sources disagree' + conflict + '.' : ''}`;
      addToGroup(sentence);
    } else if (prop.entities.length > 0) {
      const witness = commitment.spanRefs[0]?.span_raw ?? commitment.spanRefs[0]?.span_text ?? '';
      if (witness && witness.length > 10) {
        sentence = `${attr ? attr + ': ' : ''}${witness}${witness.endsWith('.') ? '' : '.'}`;
        addToGroup(sentence);
      } else {
        sentence = `${attr ? attr + ', ' : ''}${prop.entities.join(' and ')} ${prop.relation}s.${conflict ? ' However, sources disagree' + conflict + '.' : ''}`;
        addToGroup(sentence);
      }
    } else {
      const witness = commitment.spanRefs[0]?.span_raw ?? commitment.spanRefs[0]?.span_text ?? '';
      if (witness && witness.length > 10) {
        sentence = witness.endsWith('.') ? witness : witness + '.';
        addToGroup(sentence);
      } else {
        continue;
      }
    }
    const after = paragraphGroups.length + (currentGroup.length > 0 ? 1 : 0);
    commitmentGroupCounts.push(after - before);
  }

  flushGroup();

  // Transitions between paragraph groups emerge naturally wherever the
  // source changes — each becomes the first sentence of the new paragraph,
  // bridging the reader between sources rather than hanging in isolation.
  const groupSource = (gIdx) => {
    for (let ci = 0; ci < sorted.length; ci++) {
      const groupsForCommitment = commitmentGroupCounts[ci];
      if (gIdx < groupsForCommitment) return sorted[ci].spanRefs.map(sr => sr.source_id);
      gIdx -= groupsForCommitment;
    }
    return [];
  };

  for (let gi = 1; gi < paragraphGroups.length; gi++) {
    const prevSrcs = new Set(groupSource(gi - 1));
    const currSrcs = new Set(groupSource(gi));
    const shared = [...prevSrcs].filter(s => currSrcs.has(s));

    if (shared.length === 0 && prevSrcs.size > 0 && currSrcs.size > 0) {
      const fromSrc = [...prevSrcs][0];
      const toSrc = [...currSrcs][0];
      paragraphGroups[gi] =
        `Looking beyond ${fromSrc}, ${toSrc} reveals a different picture. ${paragraphGroups[gi]}`;
    }
  }

  // Conflict-to-no-conflict transitions across paragraph boundaries
  for (let ci = 1; ci < sorted.length; ci++) {
    if (sorted[ci - 1].conflict && !sorted[ci].conflict) {
      let groupStart = 0;
      for (let pc = 0; pc < ci; pc++) groupStart += commitmentGroupCounts[pc];
      if (groupStart < paragraphGroups.length) {
        paragraphGroups[groupStart] =
          `Despite this discrepancy, other findings are consistent. ${paragraphGroups[groupStart]}`;
      }
    }
  }

  return paragraphGroups.join('\n\n');
}

export function renderChart(commitments, { thesis } = {}) {
  const dataPoints = [];
  for (const commitment of commitments) {
    const prop = commitment.proposition;
    if (prop.quantities.length === 0) continue;

    for (const sr of commitment.spanRefs) {
      for (const qty of prop.quantities) {
        if (Number.isFinite(qty.value)) {
          dataPoints.push({
            entity: prop.entities[0] ?? '(unknown)',
            source: sr.source_id,
            value: qty.value,
            unit: qty.unit,
            raw: qty.raw,
            time: prop.time,
            commitment_id: commitment.commitment_id,
          });
        }
      }
    }
  }

  const byEntity = new Map();
  for (const dp of dataPoints) {
    if (!byEntity.has(dp.entity)) byEntity.set(dp.entity, []);
    byEntity.get(dp.entity).push(dp);
  }

  const chartSpec = {
    chart_type: 'grouped_bar',
    title: thesis ?? 'Cross-source comparison',
    x_axis: 'entity',
    y_axis: 'value',
    series: 'source',
    entities: [],
  };

  for (const [entity, points] of byEntity) {
    const sources = new Map();
    for (const p of points) {
      if (!sources.has(p.source)) sources.set(p.source, []);
      sources.get(p.source).push(p);
    }
    chartSpec.entities.push({
      label: entity,
      bars: [...sources.entries()].map(([src, ps]) => ({
        source: src,
        value: ps[0].value,
        unit: ps[0].unit,
        raw: ps[0].raw,
      })),
    });
  }

  return Object.freeze(chartSpec);
}

export function renderPullquote(commitments, { maxQuotes = 5 } = {}) {
  const sorted = [...commitments].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5));
  const quotes = [];

  for (const commitment of sorted) {
    if (quotes.length >= maxQuotes) break;

    for (const sr of commitment.spanRefs) {
      const text = sr.span_text;
      if (!text || text.length < 15) continue;

      quotes.push(Object.freeze({
        text,
        attribution: sr.source_id,
        commitment_id: commitment.commitment_id,
        confidence: commitment.confidence,
        anchor: sr.anchor,
      }));
      break;
    }
  }

  return quotes;
}

export function renderSection(section, commitments, { thesis } = {}) {
  const sectionCommitments = commitments.filter(c => c.sectionId === section.id);

  if (section.modality === 'chart') {
    const chartSpec = renderChart(sectionCommitments, { thesis });
    const sentences = [{
      text: `[Chart: ${chartSpec.title}]`,
      commitment_id: 'chart',
      is_glue: false,
    }];
    return { prose: JSON.stringify(chartSpec, null, 2), modality: 'chart', chart_spec: chartSpec, sentences };
  }

  if (section.modality === 'pullquote') {
    const quotes = renderPullquote(sectionCommitments);
    const prose = quotes.map(q => `"${q.text}" — ${q.attribution}`).join('\n\n');
    const sentences = quotes.map(q => ({
      text: `"${q.text}" — ${q.attribution}`,
      commitment_id: q.commitment_id,
      is_glue: false,
    }));
    return { prose, modality: 'pullquote', quotes, sentences };
  }

  const prose = renderText(sectionCommitments, { thesis, sectionIntent: section.intent });
  const paragraphs = splitParagraphs(prose);
  const sentences = [];
  for (const para of paragraphs) {
    const sents = para
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const text of sents) {
      const matching = sectionCommitments.find(c => prose.includes(c.claim.slice(0, 30)));
      sentences.push({
        text,
        commitment_id: matching?.commitment_id ?? 'glue',
        is_glue: !matching,
      });
    }
  }
  return { prose, modality: 'text', sentences };
}
