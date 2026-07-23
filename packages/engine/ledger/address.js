// EO: SIG(Entity -> Lens, Binding) -- event to cube address.
// Ported from eoreader4.2 src/core/address.js. Derives the three-fold address
// (Act, Site, Resolution) from an event at read time; nothing is stamped on
// the event.

import { OPERATORS } from './operators.js';
import { stanceOf, terrainOf } from './cube.js';

const inferGrain = (event) => {
  if (event.grain) return event.grain;
  if (event.op === 'REC' || event.op === 'SYN' || event.op === 'CON') return 'Pattern';
  if (event.op === 'INS' || event.op === 'NUL') return 'Ground';
  return 'Figure';
};

export const eoAddressOfEvent = (event) => {
  const op = OPERATORS[event?.op];
  if (!op) return null;
  const grain = inferGrain(event);
  return Object.freeze({
    operator: op.id,
    act:        Object.freeze({ mode: op.mode,   domain: op.domain }),
    site:       Object.freeze({ domain: op.domain, grain, terrain: terrainOf(op.domain, grain) }),
    resolution: Object.freeze({ mode: op.mode,    grain, stance:  stanceOf(op.mode,   grain) }),
  });
};

export const eoNotation = (event) => {
  const a = eoAddressOfEvent(event);
  if (!a) return '?';
  return `${a.operator}(${a.site.domain.slice(0, 3)},${a.resolution.grain.slice(0, 3)})`;
};
