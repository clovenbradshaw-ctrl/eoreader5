import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

const EVENT_KINDS = [
  'plan', 'enter', 'relit', 'spans', 'propose', 'bind', 'veto',
  'thread-open', 'thread-pay', 'thread-defer', 'revise', 'accept',
  'checkpoint', 'finding',
];

export function createLog() {
  return [];
}

export function emitPlan(log, { spine, thesis }) {
  const event = freezeEvent({
    kind: 'plan',
    t: log.length,
    op: 'DEF',
    spine_id: spine.spine_id,
    thesis,
    sections: spine.sections.map(s => ({ id: s.id, intent: s.intent, order: s.order })),
  });
  log.push(event);
  return event;
}

export function emitEnter(log, { sectionId, dependencies }) {
  const event = freezeEvent({
    kind: 'enter',
    t: log.length,
    op: 'SEG',
    section_id: sectionId,
    dependencies,
  });
  log.push(event);
  return event;
}

export function emitRelit(log, { sectionId, depEvents }) {
  const event = freezeEvent({
    kind: 'relit',
    t: log.length,
    op: 'SIG',
    section_id: sectionId,
    dep_events: depEvents,
  });
  log.push(event);
  return event;
}

export function emitSpans(log, { sectionId, spans }) {
  const event = freezeEvent({
    kind: 'spans',
    t: log.length,
    op: 'SIG',
    section_id: sectionId,
    span_count: spans.length,
    span_ids: spans.map(s => s.span_id ?? s.id ?? canonicalHashSync(s)),
  });
  log.push(event);
  return event;
}

export function emitPropose(log, { sectionId, claim, proposition }) {
  const event = freezeEvent({
    kind: 'propose',
    t: log.length,
    op: 'INS',
    section_id: sectionId,
    claim,
    proposition_id: proposition?.proposition_id,
  });
  log.push(event);
  return event;
}

export function emitBind(log, { sectionId, commitment }) {
  const event = freezeEvent({
    kind: 'bind',
    t: log.length,
    op: 'SYN',
    section_id: sectionId,
    commitment_id: commitment.commitment_id,
    claim: commitment.claim,
    span_refs: commitment.spanRefs,
    confidence: commitment.confidence,
  });
  log.push(event);
  return event;
}

export function emitVeto(log, { sectionId, commitment, reasons }) {
  const event = freezeEvent({
    kind: 'veto',
    t: log.length,
    op: 'EVA',
    section_id: sectionId,
    commitment_id: commitment.commitment_id,
    reasons,
  });
  log.push(event);
  return event;
}

export function emitThreadOpen(log, { sectionId, thread }) {
  const event = freezeEvent({
    kind: 'thread-open',
    t: log.length,
    op: 'INS',
    section_id: sectionId,
    thread_id: thread.id,
    text: thread.text,
    due_by: thread.dueBy,
  });
  log.push(event);
  return event;
}

export function emitThreadPay(log, { sectionId, threadId }) {
  const event = freezeEvent({
    kind: 'thread-pay',
    t: log.length,
    op: 'REC',
    section_id: sectionId,
    thread_id: threadId,
  });
  log.push(event);
  return event;
}

export function emitThreadDefer(log, { sectionId, threadId, newDueBy }) {
  const event = freezeEvent({
    kind: 'thread-defer',
    t: log.length,
    op: 'EVA',
    section_id: sectionId,
    thread_id: threadId,
    new_due_by: newDueBy,
  });
  log.push(event);
  return event;
}

export function emitRevise(log, { sectionId, operation }) {
  const event = freezeEvent({
    kind: 'revise',
    t: log.length,
    op: 'REC',
    section_id: sectionId,
    operation,
  });
  log.push(event);
  return event;
}

export function emitAccept(log, { sectionId, prose, sentences, modality, dropped, seam }) {
  const event = freezeEvent({
    kind: 'accept',
    t: log.length,
    op: 'DEF',
    section_id: sectionId,
    prose,
    sentences: sentences.map(s => ({
      text: s.text,
      commitment_id: s.commitment_id,
      is_glue: s.is_glue,
    })),
    modality,
    dropped,
    seam,
  });
  log.push(event);
  return event;
}

export function emitCheckpoint(log, { carry, sectionId }) {
  const event = freezeEvent({
    kind: 'checkpoint',
    t: log.length,
    op: 'NUL',
    section_id: sectionId,
    thesis: carry.thesis,
    prior_claim: carry.priorClaim,
    ledger_size: carry.ledger.length,
    threads_open: carry.threads.length,
  });
  log.push(event);
  return event;
}

export function emitFinding(log, { sectionId, kind, detail }) {
  const event = freezeEvent({
    kind: 'finding',
    t: log.length,
    op: 'EVA',
    section_id: sectionId,
    finding_kind: kind,
    detail,
  });
  log.push(event);
  return event;
}

function freezeEvent(event) {
  const event_id = id('eevt', { kind: event.kind, t: event.t, body: event });
  return Object.freeze({ ...event, event_id });
}

export function projectLog(log) {
  const sections = new Map();
  const events = [...log];
  let thesis = '';

  for (const event of events) {
    if (event.kind === 'plan') {
      thesis = event.thesis;
      continue;
    }
    if (event.kind === 'enter') {
      sections.set(event.section_id, { id: event.section_id, state: 'exploring', commitments: [], vetoed: [], prose: '' });
    }
    if (event.kind === 'bind') {
      const sec = sections.get(event.section_id);
      if (sec) sec.commitments.push({ commitment_id: event.commitment_id, claim: event.claim, confidence: event.confidence });
    }
    if (event.kind === 'veto') {
      const sec = sections.get(event.section_id);
      if (sec) sec.vetoed.push({ commitment_id: event.commitment_id, reasons: event.reasons });
    }
    if (event.kind === 'accept') {
      const sec = sections.get(event.section_id);
      if (sec) {
        sec.state = 'accepted';
        sec.prose = event.prose;
        sec.sentences = event.sentences;
        sec.modality = event.modality;
        sec.dropped = event.dropped;
      }
    }
  }

  return {
    thesis: events.find(e => e.kind === 'plan')?.thesis ?? '',
    sections: [...sections.values()],
    events,
  };
}

export function liveView(log) {
  const proj = projectLog(log);
  const accepted = proj.sections.filter(s => s.state === 'accepted');
  const exploring = proj.sections.filter(s => s.state === 'exploring');
  const totalCommitments = accepted.reduce((s, sec) => s + (sec.commitments?.length ?? 0), 0);
  const totalVetoed = exploring.reduce((s, sec) => s + (sec.vetoed?.length ?? 0), 0);

  return Object.freeze({
    thesis: proj.thesis,
    accepted_sections: accepted.length,
    exploring_sections: exploring.length,
    total_commitments: totalCommitments,
    total_vetoed: totalVetoed,
    assembled: accepted.map(s => s.prose).filter(Boolean).join('\n\n'),
    events: log.length,
  });
}
