import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

function splitSentences(text) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

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

export function renderText(commitments, { thesis, sectionIntent } = {}) {
  if (commitments.length === 0) return '';

  const sorted = [...commitments].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5));
  const sentences = [];

  for (const commitment of sorted) {
    const prop = commitment.proposition;
    const sources = [...new Set(commitment.spanRefs.map(sr => sr.source_id))];
    const attr = attributionPhrase(sources.length, sources);
    const conflict = conflictPhrase(prop.conflict);

    let sentence = '';

    if (prop.quantities.length > 0 && prop.entities.length > 0) {
      const qtyText = prop.quantities.map(q => q.raw).join(' and ');
      const timeText = prop.time ? ` in ${prop.time}` : '';
      sentence = `${attr ? attr + ', ' : ''}${prop.entities.join(' and ')} ${prop.relation === 'record' ? 'records' : prop.relation + 's'} ${qtyText}${timeText}.${conflict ? ' However, sources disagree' + conflict + '.' : ''}`;
    } else if (prop.entities.length > 0) {
      const witness = commitment.spanRefs[0]?.span_text ?? '';
      if (witness && witness.length > 10 && witness.length < 200) {
        sentence = `${attr ? attr + ': ' : ''}${witness}${witness.endsWith('.') ? '' : '.'}`;
      } else {
        sentence = `${attr ? attr + ', ' : ''}${prop.entities.join(' and ')} ${prop.relation}s.${conflict ? ' However, sources disagree' + conflict + '.' : ''}`;
      }
    } else {
      const witness = commitment.spanRefs[0]?.span_text ?? '';
      if (witness && witness.length > 10) {
        sentence = witness.endsWith('.') ? witness : witness + '.';
      } else {
        continue;
      }
    }

    sentences.push({ text: sentence, commitment_id: commitment.commitment_id, is_glue: false });
  }

  const transitions = [];
  for (let i = 1; i < sentences.length; i++) {
    const prev = sentences[i - 1];
    const curr = sentences[i];
    const prevSources = new Set(sorted[i - 1].spanRefs.map(sr => sr.source_id));
    const currSources = new Set(sorted[i].spanRefs.map(sr => sr.source_id));
    const shared = [...prevSources].filter(s => currSources.has(s));

    if (shared.length === 0 && prevSources.size > 0 && currSources.size > 0) {
      const fromSrc = [...prevSources][0];
      const toSrc = [...currSources][0];
      transitions.push({ index: i, text: `Looking beyond ${fromSrc}, ${toSrc} reveals a different picture.` });
    } else if (sorted[i - 1].conflict && !sorted[i].conflict) {
      transitions.push({ index: i, text: 'Despite this discrepancy, other findings are consistent.' });
    }
  }

  for (let j = transitions.length - 1; j >= 0; j--) {
    const t = transitions[j];
    sentences.splice(t.index, 0, { text: t.text, commitment_id: 'glue', is_glue: true });
  }

  return sentences.map(s => s.text).join(' ');
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
  const sentences = splitSentences(prose).map(text => {
    const matching = sectionCommitments.find(c => prose.includes(c.claim.slice(0, 30)));
    return {
      text,
      commitment_id: matching?.commitment_id ?? 'glue',
      is_glue: !matching,
    };
  });
  return { prose, modality: 'text', sentences };
}
