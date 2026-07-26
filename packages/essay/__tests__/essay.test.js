import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { propositionFromSpan, extractPropositions } from '../propositions.js';
import { assembleMatrix } from '../matrix.js';
import { buildSpine, renderOrder } from '../spine.js';
import { createCarry, bindCommitment, vetCommitment, updateCarry, assembleCommitments, capCarry } from '../commitments.js';
import { createLog, emitPlan, emitEnter, emitBind, emitAccept, emitCheckpoint, projectLog, liveView } from '../log.js';
import { renderText, renderChart, renderPullquote, renderSection } from '../render.js';
import { runEssay } from '../essay.js';

describe('propositions', () => {
  it('extracts entities, quantities, and time from a span', () => {
    const prop = propositionFromSpan(
      { text: 'Portland allocates $12M annually to transportation in 2024' },
      { source_id: 'pdf-plan', event_id: 'evt:abc' }
    );
    assert.ok(prop.proposition_id.startsWith('prop:'));
    assert.ok(prop.entities.includes('Portland'));
    assert.ok(prop.quantities.length > 0);
    assert.equal(prop.quantities[0].value, 12);
    assert.equal(prop.time, '2024');
    assert.ok(prop.source_evidence.length === 1);
    assert.equal(prop.source_evidence[0].source_id, 'pdf-plan');
  });

  it('detects relation types', () => {
    const state = propositionFromSpan({ text: 'The budget increased by 20%' });
    assert.equal(state.relation, 'change');

    const creation = propositionFromSpan({ text: 'The city built a new transit center' });
    assert.equal(creation.relation, 'creation');

    const record = propositionFromSpan({ text: 'Portland has 650000 residents' });
    assert.equal(record.relation, 'record');
  });

  it('measures confidence based on evidence count', () => {
    const single = propositionFromSpan(
      { text: 'The city has 100 parks' },
      { source_id: 'a', event_id: 'evt:1' }
    );
    assert.ok(single.confidence >= 0.4 && single.confidence <= 0.7);

    const multi = propositionFromSpan(
      { text: 'The city has 100 parks and 50 trails' },
      { source_id: 'b', event_id: 'evt:2' }
    );
    assert.ok(multi.confidence >= 0.4 && multi.confidence <= 0.8);
  });

  it('extracts propositions from a projection bundle', () => {
    const projection = {
      spans: [
        { span_id: 's1', source_id: 'pdf', field_id: 'f1', text: 'Portland budgets $12M for transit' },
        { span_id: 's2', source_id: 'csv', field_id: 'f2', text: 'Portland transit budget is $14.5M' },
      ],
    };
    const props = extractPropositions(projection);
    assert.equal(props.length, 2);
    assert.ok(props[0].entities.includes('Portland'));
    assert.ok(props[1].entities.includes('Portland'));
  });
});

describe('matrix', () => {
  it('groups propositions by entity across sources', () => {
    const props = [
      propositionFromSpan(
        { text: 'Portland budgets $12M for transit' },
        { source_id: 'pdf', event_id: 'evt:1' }
      ),
      propositionFromSpan(
        { text: 'Portland transit budget is $14.5M' },
        { source_id: 'csv', event_id: 'evt:2' }
      ),
    ];
    const matrix = assembleMatrix(props, { total_sources: 2 });
    assert.ok(matrix.total_rows >= 1);
    assert.ok(matrix.sources.includes('pdf'));
    assert.ok(matrix.sources.includes('csv'));
  });

  it('detects quantity conflicts across sources', () => {
    const props = [
      propositionFromSpan(
        { text: 'Portland budgets $12M for transit' },
        { source_id: 'pdf', event_id: 'evt:1' }
      ),
      propositionFromSpan(
        { text: 'Portland transit budget is $14.5M' },
        { source_id: 'csv', event_id: 'evt:2' }
      ),
    ];
    const matrix = assembleMatrix(props, { total_sources: 2 });
    const conflictRows = matrix.rows.filter(r => r.has_conflict);
    assert.ok(conflictRows.length >= 1, 'should detect conflict between $12M and $14.5M');
    assert.equal(matrix.conflict_count, conflictRows.length);
  });

  it('computes coverage scores', () => {
    const props = [
      propositionFromSpan(
        { text: 'Portland has 650000 residents' },
        { source_id: 'pdf', event_id: 'evt:1' }
      ),
      propositionFromSpan(
        { text: 'Portland population is 650000' },
        { source_id: 'csv', event_id: 'evt:2' }
      ),
      propositionFromSpan(
        { text: 'Portland residents report high satisfaction' },
        { source_id: 'survey', event_id: 'evt:3' }
      ),
    ];
    const matrix = assembleMatrix(props, { total_sources: 3 });
    assert.ok(matrix.total_sources === 3);
    assert.ok(Object.keys(matrix.source_coverage).length === 3);
  });

  it('sorts rows by coverage * confidence', () => {
    const props = [
      propositionFromSpan(
        { text: 'Portland budgets $12M' },
        { source_id: 'pdf', event_id: 'evt:1' }
      ),
      propositionFromSpan(
        { text: 'Portland transit budget is $14.5M' },
        { source_id: 'csv', event_id: 'evt:2' }
      ),
      propositionFromSpan(
        { text: 'Eugene has a small budget' },
        { source_id: 'pdf', event_id: 'evt:3' }
      ),
    ];
    const matrix = assembleMatrix(props, { total_sources: 2 });
    if (matrix.rows.length >= 2) {
      for (let i = 1; i < matrix.rows.length; i++) {
        const scoreA = matrix.rows[i - 1].coverage * matrix.rows[i - 1].confidence;
        const scoreB = matrix.rows[i].coverage * matrix.rows[i].confidence;
        assert.ok(scoreA >= scoreB, 'rows should be sorted by coverage*confidence descending');
      }
    }
  });
});

describe('spine', () => {
  it('builds a spine with overview and synthesis sections', () => {
    const matrix = {
      rows: [
        { row_id: 'r1', entity_label: 'Portland', entity_keys: ['portland'], sources: ['pdf', 'csv'], coverage: 0.5, confidence: 0.8, has_conflict: true, proposition_ids: ['p1'], evidence_by_source: {} },
      ],
      sources: ['pdf', 'csv'],
      total_sources: 2,
      conflict_count: 1,
    };
    const spine = buildSpine({ thesis: 'Portland transportation', matrix });
    assert.ok(spine.sections.length >= 3);
    assert.equal(spine.sections[0].intent, 'establish the scope and sources of the collection');
    assert.equal(spine.sections[spine.sections.length - 1].intent, 'synthesize what the collection reveals and identify gaps');
  });

  it('renders in dependency order', () => {
    const matrix = {
      rows: [
        { row_id: 'r1', entity_label: 'Portland', entity_keys: ['portland'], sources: ['pdf', 'csv'], coverage: 0.8, confidence: 0.9, has_conflict: false, proposition_ids: ['p1'], evidence_by_source: {} },
      ],
      sources: ['pdf', 'csv'],
      total_sources: 2,
      conflict_count: 0,
    };
    const spine = buildSpine({ thesis: 'Test', matrix });
    const order = renderOrder(spine);
    assert.ok(order.length > 0);
    const overviewIdx = order.findIndex(s => s.intent.includes('scope'));
    const synthesisIdx = order.findIndex(s => s.intent.includes('synthesize'));
    assert.ok(overviewIdx < synthesisIdx, 'overview should come before synthesis');
  });

  it('detects cycles', () => {
    const matrix = { rows: [], sources: [], total_sources: 0, conflict_count: 0 };
    const idA = 'sec:test:A';
    const idB = 'sec:test:B';
    assert.throws(() => {
      buildSpine({
        thesis: 'test',
        matrix,
        intents: [
          { intent: 'A', dependsOn: [idB], _id: idA },
          { intent: 'B', dependsOn: [idA], _id: idB },
        ],
      });
    }, /cycle/);
  });
});

describe('commitments', () => {
  it('creates a carry with default values', () => {
    const carry = createCarry();
    assert.equal(carry.thesis, '');
    assert.equal(carry.priorClaim, '');
    assert.deepEqual(carry.threads, []);
    assert.deepEqual(carry.ledger, []);
  });

  it('binds a commitment from a proposition', () => {
    const prop = propositionFromSpan(
      { text: 'Portland budgets $12M' },
      { source_id: 'pdf', event_id: 'evt:1' }
    );
    const commitment = bindCommitment({ proposition: prop, sectionId: 'sec-1' });
    assert.ok(commitment.commitment_id.startsWith('commit:'));
    assert.equal(commitment.sectionId, 'sec-1');
    assert.ok(commitment.spanRefs.length >= 1);
    assert.equal(commitment.spanRefs[0].source_id, 'pdf');
  });

  it('vets a commitment against the ledger', () => {
    const prop = propositionFromSpan(
      { text: 'Portland budgets $12M' },
      { source_id: 'pdf', event_id: 'evt:1' }
    );
    const commitment = bindCommitment({ proposition: prop, sectionId: 'sec-1' });
    const verdict = vetCommitment(commitment, { ledger: [], thesis: 'Portland transportation' });
    assert.equal(verdict.accepted, true);
    assert.deepEqual(verdict.reasons, []);
  });

  it('rejects a repeating commitment', () => {
    const prop = propositionFromSpan(
      { text: 'Portland budgets $12M' },
      { source_id: 'pdf', event_id: 'evt:1' }
    );
    const existing = bindCommitment({ proposition: prop, sectionId: 'sec-1' });
    const duplicate = bindCommitment({ proposition: prop, sectionId: 'sec-2' });
    const verdict = vetCommitment(duplicate, { ledger: [existing], thesis: 'Portland' });
    assert.equal(verdict.accepted, false);
    assert.ok(verdict.reasons.includes('repeats_without_new_ground'));
  });

  it('caps carry ledger size', () => {
    let carry = createCarry({ thesis: 'test' });
    for (let i = 0; i < 60; i++) {
      carry = updateCarry(carry, {
        sectionId: `sec-${i}`,
        commitments: [{ claim: `claim ${i}`, proposition: { proposition_id: `p${i}`, relation: 'state', entities: [], quantities: [], source_evidence: [] }, spanRefs: [], sectionId: `sec-${i}` }],
      });
    }
    assert.ok(carry.ledger.length === 60);
    const capped = capCarry(carry, { maxLedgerSize: 50 });
    assert.ok(capped.ledger.length === 50);
  });
});

describe('log', () => {
  it('creates an append-only event log', () => {
    const log = createLog();
    assert.equal(log.length, 0);
    emitPlan(log, { spine: { spine_id: 'sp:1', thesis: 'test', sections: [] }, thesis: 'test' });
    assert.equal(log.length, 1);
    assert.equal(log[0].kind, 'plan');
    assert.ok(log[0].event_id.startsWith('eevt:'));
  });

  it('tracks section lifecycle', () => {
    const log = createLog();
    emitPlan(log, { spine: { spine_id: 'sp:1', thesis: 'test', sections: [] }, thesis: 'test' });
    emitEnter(log, { sectionId: 'sec-1', dependencies: [] });
    emitBind(log, { sectionId: 'sec-1', commitment: { commitment_id: 'c1', claim: 'test claim', spanRefs: [], confidence: 0.8 } });
    emitAccept(log, { sectionId: 'sec-1', prose: 'Test prose.', sentences: [{ text: 'Test prose.', commitment_id: 'c1', is_glue: false }], modality: 'text', dropped: 0 });
    emitCheckpoint(log, { carry: { thesis: 'test', priorClaim: 'test claim', threads: [], ledger: [] }, sectionId: 'sec-1' });
    assert.equal(log.length, 5);
    const proj = projectLog(log);
    assert.equal(proj.thesis, 'test');
    assert.ok(proj.sections.length >= 1);
  });

  it('projects a live view', () => {
    const log = createLog();
    emitPlan(log, { spine: { spine_id: 'sp:1', thesis: 'test', sections: [] }, thesis: 'test' });
    emitEnter(log, { sectionId: 'sec-1', dependencies: [] });
    emitAccept(log, { sectionId: 'sec-1', prose: 'Hello world.', sentences: [], modality: 'text', dropped: 0 });
    const live = liveView(log);
    assert.equal(live.assembled, 'Hello world.');
    assert.equal(live.accepted_sections, 1);
  });
});

describe('render', () => {
  it('renders text from commitments', () => {
    const prop = propositionFromSpan(
      { text: 'Portland budgets $12M for transit' },
      { source_id: 'pdf', event_id: 'evt:1' }
    );
    const commitment = bindCommitment({ proposition: prop, sectionId: 'sec-1' });
    const text = renderText([commitment]);
    assert.ok(text.length > 0);
    assert.ok(text.includes('Portland'));
  });

  it('renders chart spec from quantity-bearing commitments', () => {
    const prop = propositionFromSpan(
      { text: 'Portland budgets $12M for transit' },
      { source_id: 'pdf', event_id: 'evt:1' }
    );
    const commitment = bindCommitment({ proposition: prop, sectionId: 'sec-1' });
    const chart = renderChart([commitment]);
    assert.equal(chart.chart_type, 'grouped_bar');
    assert.ok(chart.entities.length >= 1);
    assert.equal(chart.entities[0].bars[0].value, 12);
  });

  it('renders pullquotes', () => {
    const prop = propositionFromSpan(
      { text: 'The transit plan serves 200000 daily riders across the metro area' },
      { source_id: 'pdf', event_id: 'evt:1' }
    );
    const commitment = bindCommitment({ proposition: prop, sectionId: 'sec-1' });
    const quotes = renderPullquote([commitment]);
    assert.ok(quotes.length >= 1);
    assert.ok(quotes[0].text.length > 10);
    assert.equal(quotes[0].attribution, 'pdf');
  });

  it('renders a section by modality', () => {
    const prop = propositionFromSpan(
      { text: 'Portland budgets $12M' },
      { source_id: 'pdf', event_id: 'evt:1' }
    );
    const commitment = bindCommitment({ proposition: prop, sectionId: 'sec-1' });

    const textSection = renderSection(
      { id: 'sec-1', intent: 'test', modality: 'text' },
      [commitment]
    );
    assert.equal(textSection.modality, 'text');
    assert.ok(textSection.prose.length > 0);

    const chartSection = renderSection(
      { id: 'sec-1', intent: 'test', modality: 'chart' },
      [commitment]
    );
    assert.equal(chartSection.modality, 'chart');
    assert.ok(chartSection.chart_spec);

    const quoteSection = renderSection(
      { id: 'sec-1', intent: 'test', modality: 'pullquote' },
      [commitment]
    );
    assert.equal(quoteSection.modality, 'pullquote');
    assert.ok(quoteSection.quotes.length >= 1);
  });
});

describe('runEssay (full pipeline)', () => {
  it('produces a three-layer EssayDocument from projections', () => {
    const proj1 = {
      spans: [
        { span_id: 's1', source_id: 'transit-plan', field_id: 'f1', text: 'The City of Portland allocates $12M annually to transportation' },
        { span_id: 's2', source_id: 'transit-plan', field_id: 'f2', text: 'Portland serves 200000 daily transit riders' },
      ],
    };
    const proj2 = {
      spans: [
        { span_id: 's3', source_id: 'budget-csv', field_id: 'f3', text: 'Portland transportation budget is $14.5M for 2024' },
        { span_id: 's4', source_id: 'budget-csv', field_id: 'f4', text: 'Transit ridership grew 5% year over year' },
      ],
    };
    const proj3 = {
      spans: [
        { span_id: 's5', source_id: 'survey', field_id: 'f5', text: 'Portland residents rated transit satisfaction at 3.2 out of 5' },
        { span_id: 's6', source_id: 'survey', field_id: 'f6', text: 'Survey respondents want more bus service' },
      ],
    };

    const result = runEssay({
      projections: [proj1, proj2, proj3],
      thesis: 'Portland transportation investment shows growing commitment but gaps between sources',
    });

    assert.ok(result.essay_id.startsWith('essay:'));
    assert.equal(result.schema_version, 'EssayDocument@1');
    assert.ok(result.assembled.length > 0);
    assert.ok(result.sections.length >= 3);
    assert.ok(result.matrix.propositions.length >= 4);
    assert.ok(result.matrix.sources.length >= 3);
    assert.ok(result.essay_log.length >= 5);
    assert.ok(result.carry);

    assert.ok(result.provenance);
    assert.ok(typeof result.provenance.sentence_to_proposition === 'object');
    assert.ok(typeof result.provenance.proposition_to_event === 'object');
    assert.ok(typeof result.provenance.source_to_essay === 'object');
    assert.ok(typeof result.provenance.essay_to_source === 'object');

    assert.ok(result.live);
    assert.ok(result.live.assembled.length > 0);
  });

  it('handles single-source input', () => {
    const proj = {
      spans: [
        { span_id: 's1', source_id: 'only-source', field_id: 'f1', text: 'The city has 50 parks covering 200 acres' },
      ],
    };
    const result = runEssay({
      projections: [proj],
      thesis: 'City parks overview',
    });
    assert.ok(result.assembled.length > 0);
    assert.equal(result.matrix.sources.length, 1);
  });

  it('produces deterministic output', () => {
    const proj = {
      spans: [
        { span_id: 's1', source_id: 'src', field_id: 'f1', text: 'Portland budgets $12M' },
      ],
    };
    const opts = { thesis: 'test' };
    const r1 = runEssay({ projections: [proj], ...opts });
    const r2 = runEssay({ projections: [proj], ...opts });
    assert.equal(r1.assembled, r2.assembled);
    assert.equal(r1.essay_id, r2.essay_id);
    assert.equal(r1.matrix.propositions.length, r2.matrix.propositions.length);
  });
});
