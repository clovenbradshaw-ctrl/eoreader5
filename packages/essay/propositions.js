import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

const QUANTITY_PATTERN = /[$€£¥]?\s*(\d[\d,]*\.?\d*)\s*(M|B|K|trillion|billion|million|thousand|%|percent|tons?|acres?|miles?|km|sq\s*ft|persons?|people|residents?|riders?|daily|annually|yearly)?/i;
const TIME_PATTERN = /\b(20\d{2}|19\d{2})\b/;
const RELATION_VERBS = {
  state:    /\b(is|are|was|were|has|have|had|serves|contains|includes|holds|stands|represents|accounts?|comprises?)\b/i,
  change:   /\b(increased|decreased|grew|fell|rose|dropped|changed|shifted|expanded|declined|improved|worsened|doubled|halved)\b/i,
  creation: /\b(created|established|built|opened|launched|founded|constructed|proposed|approved|funded)\b/i,
  end:      /\b(closed|ended|terminated|cancelled|demolished|abandoned|removed|eliminated|defunded)\b/i,
  record:   /\b(\d[\d,]*\.?\d*)\b/,
};

const OPEN_CLASS = /^[A-Z]/;
const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','through','during',
  'before','after','above','below','between','under','again','further','then','once',
  'here','there','when','where','why','how','all','each','every','both','few','more',
  'most','other','some','such','no','nor','not','only','own','same','so','than',
  'too','very','just','because','but','and','or','if','while','that','this','these',
  'those','it','its','their','they','them','he','she','him','her','his','we','our',
  'you','your','my','me','i','who','whom','which','what','whose',
]);

function tokenize(text) {
  return text.split(/\s+/).filter(t => t.length > 2 && STOP_WORDS.has(t.replace(/[^a-zA-Z]/g, '').toLowerCase()) === false);
}

function extractEntities(text) {
  const entities = [];
  const capRe = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g;
  let match;
  while ((match = capRe.exec(text)) !== null) {
    const name = match[1];
    if (name.length > 2 && !STOP_WORDS.has(name.toLowerCase())) {
      entities.push(name);
    }
  }
  return [...new Set(entities)];
}

function extractQuantities(text) {
  const quantities = [];
  let match;
  const re = new RegExp(QUANTITY_PATTERN.source, 'gi');
  while ((match = re.exec(text)) !== null) {
    const raw = match[0].trim();
    const value = parseFloat(match[1].replace(/,/g, ''));
    const unit = match[2] || null;
    if (Number.isFinite(value)) {
      quantities.push({ value, unit, raw });
    }
  }
  return quantities;
}

function extractTime(text) {
  const match = text.match(TIME_PATTERN);
  return match ? match[1] : null;
}

function detectRelation(text) {
  if (RELATION_VERBS.change.test(text)) return 'change';
  if (RELATION_VERBS.creation.test(text)) return 'creation';
  if (RELATION_VERBS.end.test(text)) return 'end';
  if (RELATION_VERBS.record.test(text) && QUANTITY_PATTERN.test(text)) return 'record';
  if (RELATION_VERBS.state.test(text)) return 'state';
  return 'state';
}

function measureConfidence(proposition) {
  let confidence = 0.5;
  const evidenceCount = proposition.source_evidence.length;
  if (evidenceCount >= 3) confidence += 0.3;
  else if (evidenceCount === 2) confidence += 0.2;
  else confidence += 0.05;
  if (proposition.quantities.length > 0) {
    const hasStructured = proposition.source_evidence.some(e =>
      e.anchor?.selector?.format === 'csv' || e.anchor?.selector?.format === 'structured'
    );
    confidence += hasStructured ? 0.15 : 0.05;
  }
  if (proposition.entities.length > 0) confidence += 0.05;
  if (proposition.conflict) confidence -= 0.1;
  return Math.max(0, Math.min(1, confidence));
}

export function propositionFromSpan(span, { source_id, event_id, block_id, anchor } = {}) {
  const text = span.text ?? span.raw;
  const entities = extractEntities(text);
  const quantities = extractQuantities(text);
  const time = extractTime(text);
  const relation = detectRelation(text);

  const proposition = {
    proposition_id: id('prop', { text, source_id, event_id }),
    relation,
    entities,
    quantities,
    time,
    source_evidence: [{
      source_id: source_id ?? span.source_id ?? 'unknown',
      event_id: event_id ?? span.event_id ?? 'unknown',
      block_id: block_id ?? span.block_id ?? undefined,
      anchor: anchor ?? span.anchor ?? undefined,
      span_text: text,
      span_raw: span.raw ?? null,
    }],
  };
  proposition.confidence = measureConfidence(proposition);
  return Object.freeze(proposition);
}

export function extractPropositions(projection, state) {
  const propositions = [];
  const seen = new Set();

  const eventsBySource = new Map();
  if (state?.events) {
    for (const event of state.events) {
      const src = event.payload?.envelope?.source_id ?? event.payload?.source_id;
      if (src) {
        if (!eventsBySource.has(src)) eventsBySource.set(src, []);
        eventsBySource.get(src).push(event);
      }
    }
  }

  for (const span of projection.spans ?? []) {
    const text = span.text ?? span.raw;
    if (!text || text.trim().length < 5) continue;

    const key = `${span.source_id}::${text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const events = eventsBySource.get(span.source_id) ?? [];
    const event_id = events.length > 0 ? events[0].event_id : 'unknown';

    const prop = propositionFromSpan(span, {
      source_id: span.source_id,
      event_id,
      block_id: span.block_id,
      anchor: span.anchor,
    });

    propositions.push(prop);
  }

  return propositions;
}
