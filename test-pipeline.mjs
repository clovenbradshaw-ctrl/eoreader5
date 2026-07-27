import { createEOReaderEngine } from './packages/engine/runner.js';
import { createHash } from 'crypto';

console.log('=== Full Engine Pipeline Test ===');

function hex256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function makePrior() {
  return {
    schema_version: 'PriorSnapshot@1',
    prior_id: 'prior:sha256:' + hex256('prior-' + Date.now()),
    operator_epoch: 'eo-2026-07',
    ledger_head: 'led:sha256:' + hex256('ledger-' + Date.now()),
    basis_id: 'basis:genesis',
    content_hash: 'sha256:' + hex256('content-' + Date.now()),
  };
}

function makeEnvelope(text, sourceId) {
  return {
    schema: 'ObservationEnvelope@1',
    source_id: sourceId,
    source_media_type: 'text/plain',
    decoder: { id: 'raw', version: '1.0.0' },
    axes: [{ axis_id: 'surface', topology: 'linear' }],
    fields: [{
      field_id: 'text',
      value_type: 'string',
      block_id: 'blk:sha256:' + hex256(text),
    }],
    anchors: { scheme: 'text-span', surfaces: [{ text }] },
    source_content_hash: 'sha256:' + hex256(text),
    blocks_hash: 'sha256:' + hex256('blocks-' + text),
  };
}

const engine = createEOReaderEngine({
  engineVersion: '1.0.0',
  priors: null,
});

const request = {
  schema: 'RunRequest@1',
  context: {
    operator_epoch: 'eo-2026-07',
    frame_id: 'test-frame',
    lens_ids: ['lens:neutral'],
    compute_budget: {},
    token_budget: 500,
    max_units: 10,
    strict_veto: true,
  },
  prior: { snapshot: makePrior() },
  observations: [
    {
      envelope: makeEnvelope(
        'The heat equation describes how temperature changes over time in a material',
        'test-source'
      ),
      blocks: [],
    },
    {
      envelope: makeEnvelope(
        'Napoleon was a French military leader who rose to prominence during the French Revolution',
        'test-source-2'
      ),
      blocks: [],
    },
  ],
  queries: [
    { query: 'What is the heat equation?', limit: 5 },
  ],
};

console.log('Running engine...');
const events = [];
for await (const event of engine.read(request)) {
  events.push(event);
  
  // Detailed output for key events
  if (event.type === 'interference') {
    console.log('Event:', event.type);
    console.log('  interfered:', JSON.stringify(event.interfered));
  } else if (event.type === 'complete') {
    console.log('Event:', event.type);
    console.log('  transitions:', JSON.stringify(event.transitions));
    console.log('  uncertainty:', JSON.stringify(event.uncertainty));
    console.log('  satisfiesUP:', event.satisfiesUncertaintyPrinciple);
    console.log('  entanglementSize:', event.entanglementSize);
  } else if (event.type === 'query') {
    console.log('Event:', event.type);
    console.log('  folded passages:', event.folded?.passages?.length ?? 0);
    console.log('  summary length:', event.folded?.summary?.length ?? 0);
  } else {
    console.log('Event:', event.type, event.phase ?? '');
  }
}

console.log('\nTotal events:', events.length);
const eventTypes = events.map(e => e.type);
console.log('Event types:', [...new Set(eventTypes)].join(', '));

// Verify all expected phases ran
const expectedPhases = ['progress', 'semantic', 'snapshot', 'projection', 'interference', 'query', 'complete'];
const missing = expectedPhases.filter(p => !eventTypes.includes(p));
if (missing.length > 0) {
  console.log('MISSING phases:', missing.join(', '));
} else {
  console.log('All expected phases present');
}

console.log('\n=== Full pipeline test passed ===');
