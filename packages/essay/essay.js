import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { extractPropositions, propositionFromSpan } from "./propositions.js";
import { assembleMatrix } from "./matrix.js";
import { buildSpine, renderOrder } from "./spine.js";
import { assembleCommitments, createCarry, updateCarry, capCarry } from "./commitments.js";
import {
  createLog, emitPlan, emitEnter, emitRelit, emitSpans,
  emitPropose, emitBind, emitVeto, emitAccept, emitCheckpoint,
  emitFinding, projectLog, liveView,
} from "./log.js";
import { renderSection } from "./render.js";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

export function runEssay({ projections, states, thesis, intents, options } = {}) {
  const allPropositions = [];
  const sourceIds = new Set();

  if (projections && states) {
    for (let i = 0; i < projections.length; i++) {
      const proj = projections[i];
      const state = states[i];
      const props = extractPropositions(proj, state);
      allPropositions.push(...props);
      for (const span of proj.spans ?? []) {
        sourceIds.add(span.source_id);
      }
    }
  } else if (projections) {
    for (const proj of projections) {
      const props = extractPropositions(proj, null);
      allPropositions.push(...props);
      for (const span of proj.spans ?? []) {
        sourceIds.add(span.source_id);
      }
    }
  }

  const total_sources = sourceIds.size || 1;
  const matrix = assembleMatrix(allPropositions, { total_sources });

  const spine = buildSpine({ thesis: thesis ?? '', matrix, intents });
  const order = renderOrder(spine);

  const commitments = assembleCommitments(allPropositions, spine, matrix);

  const log = createLog();
  emitPlan(log, { spine, thesis: thesis ?? '' });

  let carry = createCarry({ thesis: thesis ?? '' });
  const sections = [];

  for (const section of order) {
    emitEnter(log, { sectionId: section.id, dependencies: section.dependsOn });

    const depEvents = log.filter(e =>
      (e.kind === 'accept' || e.kind === 'bind') &&
      section.dependsOn.includes(e.section_id)
    );
    if (depEvents.length > 0) {
      emitRelit(log, { sectionId: section.id, depEvents: depEvents.map(e => e.event_id) });
    }

    const sectionCommitments = commitments.filter(c => c.sectionId === section.id);

    if (sectionCommitments.length === 0) {
      emitFinding(log, { sectionId: section.id, kind: 'empty_section', detail: 'No commitments bound to this section' });
    }

    for (const commitment of sectionCommitments) {
      emitPropose(log, { sectionId: section.id, claim: commitment.claim, proposition: commitment.proposition });
      emitBind(log, { sectionId: section.id, commitment });
    }

    const rendered = renderSection(section, commitments, { thesis: thesis ?? '' });
    const dropped = sectionCommitments.length - rendered.sentences.filter(s => !s.is_glue).length;

    emitAccept(log, {
      sectionId: section.id,
      prose: rendered.prose,
      sentences: rendered.sentences,
      modality: rendered.modality,
      dropped: Math.max(0, dropped),
      seam: null,
    });

    carry = updateCarry(carry, {
      sectionId: section.id,
      commitments: sectionCommitments,
      terminalClaim: sectionCommitments.at(-1)?.claim,
    });
    carry = capCarry(carry);

    emitCheckpoint(log, { carry, sectionId: section.id });

    sections.push({
      id: section.id,
      intent: section.intent,
      modality: rendered.modality,
      prose: rendered.prose,
      sentences: rendered.sentences,
      chart_spec: rendered.chart_spec,
      quotes: rendered.quotes,
    });
  }

  const assembled = sections.map(s => s.prose).filter(Boolean).join('\n\n');

  const sentenceToProposition = {};
  const propositionToEvent = {};
  const sourceToEssay = {};
  const essayToSource = {};

  for (const section of sections) {
    for (const sentence of section.sentences) {
      if (sentence.commitment_id && sentence.commitment_id !== 'glue') {
        const commitment = commitments.find(c => c.commitment_id === sentence.commitment_id);
        if (commitment) {
          sentenceToProposition[section.id + '::' + sentence.text.slice(0, 50)] = [commitment.proposition.proposition_id];
          propositionToEvent[commitment.proposition.proposition_id] = commitment.spanRefs.map(sr => sr.event_id);

          for (const sr of commitment.spanRefs) {
            const srcKey = sr.source_id;
            const essayKey = section.id + '::' + sentence.text.slice(0, 50);
            if (!sourceToEssay[srcKey]) sourceToEssay[srcKey] = [];
            if (!sourceToEssay[srcKey].includes(essayKey)) sourceToEssay[srcKey].push(essayKey);
            if (!essayToSource[essayKey]) essayToSource[essayKey] = [];
            if (!essayToSource[essayKey].includes(srcKey)) essayToSource[essayKey].push(srcKey);
          }
        }
      }
    }
  }

  const essay_id = id('essay', { thesis, sources: [...sourceIds] });

  return Object.freeze({
    essay_id,
    schema_version: 'EssayDocument@1',
    thesis: thesis ?? '',
    assembled,
    sections: sections.map(s => Object.freeze({
      id: s.id,
      intent: s.intent,
      modality: s.modality,
      prose: s.prose,
      sentences: s.sentences,
      chart_spec: s.chart_spec,
      quotes: s.quotes,
    })),
    matrix: {
      propositions: allPropositions,
      commitments,
      conflicts: matrix.rows.filter(r => r.has_conflict).map(r => ({
        entity: r.entity_label,
        conflict: r.conflict,
      })),
      sources: matrix.sources,
      coverage: matrix.rows.map(r => ({
        entity: r.entity_label,
        sources: r.sources,
        coverage: r.coverage,
        confidence: r.confidence,
      })),
    },
    provenance: {
      sentence_to_proposition: sentenceToProposition,
      proposition_to_event: propositionToEvent,
      event_to_observation: {},
      source_to_essay: sourceToEssay,
      essay_to_source: essayToSource,
    },
    essay_log: log,
    carry,
    live: liveView(log),
  });
}
