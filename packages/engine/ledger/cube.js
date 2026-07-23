// EO: NUL·EVA(Kind -> Kind,Lens, Clearing,Binding) -- cube geometry + coherence guard.
// Ported from eoreader4.2 src/core/cube.js. The Object axis (grain) plus the
// Resolution face (stance) and Site face (terrain), the 27 diagonal cells,
// and the confabulation guard that checks an event lies on the diagonal.

import { OPERATORS, MODES, DOMAINS, GRAINS } from './operators.js';

export const STANCES = Object.freeze({
  Differentiate: Object.freeze({ Ground: 'Clearing',    Figure: 'Dissecting', Pattern: 'Unraveling' }),
  Relate:        Object.freeze({ Ground: 'Tending',     Figure: 'Binding',    Pattern: 'Tracing'    }),
  Generate:      Object.freeze({ Ground: 'Cultivating', Figure: 'Making',     Pattern: 'Composing'  }),
});

export const TERRAINS = Object.freeze({
  Existence:      Object.freeze({ Ground: 'Void',       Figure: 'Entity', Pattern: 'Kind'     }),
  Structure:      Object.freeze({ Ground: 'Field',      Figure: 'Link',   Pattern: 'Network'  }),
  Interpretation: Object.freeze({ Ground: 'Atmosphere', Figure: 'Lens',   Pattern: 'Paradigm' }),
});

export const stanceOf = (mode, grain) => STANCES[mode]?.[grain] ?? null;
export const terrainOf = (domain, grain) => TERRAINS[domain]?.[grain] ?? null;

const STANCE_GRAIN = new Map();
const TERRAIN_GRAIN = new Map();
for (const mode of MODES)
  for (const grain of GRAINS) STANCE_GRAIN.set(STANCES[mode][grain], { mode, grain });
for (const domain of DOMAINS)
  for (const grain of GRAINS) TERRAIN_GRAIN.set(TERRAINS[domain][grain], { domain, grain });

export const grainOfStance = (stance) => STANCE_GRAIN.get(stance)?.grain ?? null;
export const grainOfTerrain = (terrain) => TERRAIN_GRAIN.get(terrain)?.grain ?? null;
export const terrainInfo = (terrain) => TERRAIN_GRAIN.get(terrain) ?? null;

export const cellOf = (op, grain) => {
  const o = OPERATORS[op?.id ?? op];
  if (!o || !GRAINS.includes(grain)) return null;
  const stance = stanceOf(o.mode, grain);
  const terrain = terrainOf(o.domain, grain);
  return Object.freeze({
    key: `${o.id}_${stance}_${terrain}`,
    op: o.id, mode: o.mode, domain: o.domain, grain, stance, terrain,
  });
};

export const DIAGONAL_CELLS = Object.freeze((() => {
  const cells = {};
  for (const op of Object.keys(OPERATORS))
    for (const grain of GRAINS) {
      const c = cellOf(op, grain);
      cells[c.key] = c;
    }
  return Object.freeze(cells);
})());

const frozenVerdict = (ok, reason) => Object.freeze({ ok, reason, cell: null });

export const coherence = (event) => {
  if (!event || typeof event !== 'object') return frozenVerdict(false, 'no-event');
  const o = OPERATORS[event.op ?? event.operator];
  if (!o) return frozenVerdict(false, 'unknown-operator');

  const claims = [];
  if (event.grain != null) {
    if (!GRAINS.includes(event.grain)) return frozenVerdict(false, 'unknown-grain');
    claims.push(['grain', event.grain]);
  }
  if (event.stance != null) {
    const s = STANCE_GRAIN.get(event.stance);
    if (!s) return frozenVerdict(false, 'unknown-stance');
    if (s.mode !== o.mode)
      return frozenVerdict(false, `mode-mismatch: ${o.id} is ${o.mode}, stance ${event.stance} is ${s.mode}`);
    claims.push(['stance', s.grain]);
  }
  const terrain = event.terrain ?? event.site;
  if (terrain != null) {
    const t = TERRAIN_GRAIN.get(terrain);
    if (!t) return frozenVerdict(false, 'unknown-terrain');
    if (t.domain !== o.domain)
      return frozenVerdict(false, `domain-mismatch: ${o.id} is ${o.domain}, terrain ${terrain} is ${t.domain}`);
    claims.push(['terrain', t.grain]);
  }

  const grains = new Set(claims.map(([, g]) => g));
  if (grains.size > 1)
    return frozenVerdict(false, `grain-mismatch: ${claims.map(([k, g]) => `${k}=${g}`).join(' ')}`);

  const grain = claims.length ? claims[0][1] : null;
  const cell = grain ? cellOf(o.id, grain) : null;
  return Object.freeze({ ok: true, reason: null, operator: o.id, grain, cell });
};

export const isDiagonal = (event) => coherence(event).ok;

export const SIGNATURES = Object.freeze({
  Differentiate: Object.freeze({ mode: 'Differentiate', polarity: 'subtractive', reads: 'one',  writes: 'void', label: 'read-and-void' }),
  Relate:        Object.freeze({ mode: 'Relate',        polarity: 'connective',  reads: 'two',  writes: 'link', label: 'read-two-write-link' }),
  Generate:      Object.freeze({ mode: 'Generate',      polarity: 'additive',    reads: 'none', writes: 'new',  label: 'write-new' }),
});

export const signatureOf = (op) => {
  const o = OPERATORS[op?.id ?? op];
  return o ? SIGNATURES[o.mode] : null;
};

export const OPERATOR_ALIASES = Object.freeze({ ALT: 'DEF', SUP: 'EVA' });
export const STANCE_ALIASES = Object.freeze({});

export const aliasOperator = (op) => OPERATOR_ALIASES[op] ?? op;
export const aliasStance = (stance) => STANCE_ALIASES[stance] ?? stance;

export const aliasCellKey = (key) => {
  if (typeof key !== 'string') return key;
  const parts = key.split('_');
  if (parts.length < 1) return key;
  parts[0] = aliasOperator(parts[0]);
  if (parts.length >= 2) parts[1] = aliasStance(parts[1]);
  return parts.join('_');
};

// Self-check: every stance/terrain name is distinct and the diagonal has
// exactly 27 cells. A drift would silently admit an off-diagonal cell.
{
  const stanceNames = MODES.flatMap(m => GRAINS.map(g => STANCES[m][g]));
  const terrainNames = DOMAINS.flatMap(d => GRAINS.map(g => TERRAINS[d][g]));
  const cellCount = Object.keys(DIAGONAL_CELLS).length;
  if (new Set(stanceNames).size !== 9 || new Set(terrainNames).size !== 9 || cellCount !== 27)
    throw new Error('cube self-check failed: stances/terrains/diagonal are not a clean 9/9/27');
}
