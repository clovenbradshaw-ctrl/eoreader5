// EO: NUL(Kind -> Kind, Clearing) -- the nine operators (Act face).
// Ported from eoreader4.2 src/core/operators.js. The vocabulary the whole
// engine speaks: Mode x Domain fixes each of the nine operators.

export const MODES = Object.freeze(['Differentiate', 'Relate', 'Generate']);
export const DOMAINS = Object.freeze(['Existence', 'Structure', 'Interpretation']);
export const GRAINS = Object.freeze(['Ground', 'Figure', 'Pattern']);

export const OPERATORS = Object.freeze({
  NUL: Object.freeze({ id: 'NUL', mode: 'Differentiate', domain: 'Existence',      label: 'hold (non-transformation)', glyph: '∅' }),
  SEG: Object.freeze({ id: 'SEG', mode: 'Differentiate', domain: 'Structure',      label: 'resplit',                   glyph: '｜' }),
  DEF: Object.freeze({ id: 'DEF', mode: 'Differentiate', domain: 'Interpretation', label: 'assert/define',             glyph: '⊢' }),
  SIG: Object.freeze({ id: 'SIG', mode: 'Relate',        domain: 'Existence',      label: 'attribute',                 glyph: '○' }),
  CON: Object.freeze({ id: 'CON', mode: 'Relate',        domain: 'Structure',      label: 'bond',                      glyph: '⋈' }),
  EVA: Object.freeze({ id: 'EVA', mode: 'Relate',        domain: 'Interpretation', label: 'evaluate',                  glyph: '⊨' }),
  INS: Object.freeze({ id: 'INS', mode: 'Generate',      domain: 'Existence',      label: 'instantiate',               glyph: '●' }),
  SYN: Object.freeze({ id: 'SYN', mode: 'Generate',      domain: 'Structure',      label: 'synthesize',                glyph: '△' }),
  REC: Object.freeze({ id: 'REC', mode: 'Generate',      domain: 'Interpretation', label: 'learn rule',                glyph: '⊛' }),
});

export const isOperator = (op) => typeof op === 'string' && op in OPERATORS;

export const glyphOf = (op) => (op && OPERATORS[op] ? OPERATORS[op].glyph : '·');

export const operatorsByMode = (mode) =>
  Object.values(OPERATORS).filter(o => o.mode === mode);

export const operatorsByDomain = (domain) =>
  Object.values(OPERATORS).filter(o => o.domain === domain);

const BY_MODE_DOMAIN = new Map(Object.values(OPERATORS).map(o => [`${o.mode}|${o.domain}`, o]));
export const operatorForMode = (mode, domain) => BY_MODE_DOMAIN.get(`${mode}|${domain}`) ?? null;

export const MODE_MANNER = Object.freeze({
  Differentiate: 'distinguishes',
  Relate: 'links',
  Generate: 'introduces',
});
export const mannerOf = (op) => (op && OPERATORS[op]) ? MODE_MANNER[OPERATORS[op].mode] : null;
