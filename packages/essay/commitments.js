import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

export function createCarry({ thesis, priorClaim, threads, ledger } = {}) {
  return Object.freeze({
    thesis: thesis ?? '',
    priorClaim: priorClaim ?? '',
    threads: threads ?? [],
    ledger: ledger ?? [],
  });
}

export function capCarry(carry, { maxLedgerSize = 50 } = {}) {
  if (carry.ledger.length <= maxLedgerSize) return carry;
  const kept = carry.ledger.slice(-maxLedgerSize);
  return Object.freeze({
    ...carry,
    ledger: kept,
  });
}

export function bindCommitment({ proposition, sectionId, spanRefs }) {
  return Object.freeze({
    commitment_id: id('commit', { prop: proposition.proposition_id, section: sectionId }),
    claim: proposition.entities.length > 0
      ? `${proposition.entities.join(' ')} ${proposition.relation === 'record' ? '' : proposition.relation + ' '}${
          proposition.quantities.length > 0 ? proposition.quantities.map(q => q.raw).join(' / ') : ''
        }${proposition.time ? ' (' + proposition.time + ')' : ''}`.trim()
      : proposition.source_evidence[0]?.span_text ?? '(no claim text)',
    proposition,
    spanRefs: spanRefs ?? proposition.source_evidence.map(e => ({
      source_id: e.source_id,
      event_id: e.event_id,
      span_text: e.span_text,
      span_raw: e.span_raw ?? null,
      anchor: e.anchor,
    })),
    sectionId,
    confidence: proposition.confidence ?? 0.5,
    conflict: proposition.conflict ?? null,
    created_at: Date.now(),
  });
}

export function vetCommitment(commitment, { ledger, thesis, sectionIntent }) {
  const reasons = [];

  for (const existing of ledger) {
    if (existing.proposition.relation === commitment.proposition.relation &&
        existing.proposition.entities.some(e => commitment.proposition.entities.includes(e))) {
      if (commitment.proposition.quantities.length > 0 && existing.proposition.quantities.length > 0) {
        const maxVal = Math.max(
          ...existing.proposition.quantities.map(q => Math.abs(q.value || 0)),
          ...commitment.proposition.quantities.map(q => Math.abs(q.value || 0)),
        );
        if (maxVal > 0) {
          const delta = Math.abs(
            (existing.proposition.quantities[0]?.value ?? 0) -
            (commitment.proposition.quantities[0]?.value ?? 0)
          );
          if (delta / maxVal > 0.05) {
            reasons.push('contradicts_existing');
          }
        }
      }

      const overlap = existing.spanRefs.filter(sr =>
        commitment.spanRefs.some(cs => cs.span_text === sr.span_text)
      );
      if (overlap.length > 0) {
        reasons.push('repeats_without_new_ground');
      }
    }
  }

  if (thesis && commitment.proposition.entities.length > 0) {
    const thesisTokens = new Set(thesis.toLowerCase().split(/\s+/));
    const entityTokens = new Set(commitment.proposition.entities.flatMap(e => e.toLowerCase().split(/\s+/)));
    const contact = [...entityTokens].filter(t => thesisTokens.has(t)).length;
    if (contact === 0 && commitment.proposition.entities.length > 0) {
      reasons.push('no_thesis_contact');
    }
  }

  return Object.freeze({
    commitment_id: commitment.commitment_id,
    accepted: reasons.length === 0,
    reasons,
  });
}

export function updateCarry(carry, { sectionId, commitments, threadsPaid, threadsDeferred, threadsNew, terminalClaim }) {
  const newLedger = [...carry.ledger, ...commitments];
  const newThreads = [
    ...carry.threads.filter(t => !threadsPaid?.includes(t.id)),
    ...(threadsDeferred ?? []),
    ...(threadsNew ?? []),
  ];
  return Object.freeze({
    thesis: carry.thesis,
    priorClaim: terminalClaim ?? carry.priorClaim,
    threads: newThreads,
    ledger: newLedger,
  });
}

export function assembleCommitments(propositions, spine, matrix) {
  const commitments = [];
  const ledger = [];
  const carry = createCarry({ thesis: spine.thesis });

  for (const section of spine.sections) {
    const sectionRows = matrix.rows.filter(r =>
      (section.row_ids ?? []).includes(r.row_id)
    );

    for (const row of sectionRows) {
      for (const [src, evidenceList] of Object.entries(row.evidence_by_source)) {
        for (const evidence of evidenceList) {
          const prop = propositions.find(p => p.proposition_id === evidence.proposition_id);
          if (!prop) continue;

          const commitment = bindCommitment({
            proposition: prop,
            sectionId: section.id,
            spanRefs: [{ source_id: src, event_id: prop.source_evidence[0]?.event_id, span_text: evidence.span_text, span_raw: evidence.span_raw ?? null, anchor: evidence.anchor }],
          });

          const verdict = vetCommitment(commitment, {
            ledger,
            thesis: spine.thesis,
            sectionIntent: section.intent,
          });

          if (verdict.accepted) {
            commitments.push(commitment);
            ledger.push(commitment);
          }
        }
      }
    }
  }

  return commitments;
}
