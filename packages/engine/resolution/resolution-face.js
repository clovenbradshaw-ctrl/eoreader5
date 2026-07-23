// Ported from eoreader4.2 src/core/resolution-face.js (spec: verdict-space-taxonomy).
// The EVA resolution face: Bearing (Mode) x Determinacy (Grain) -> verdict.
// MODES/GRAINS are inlined here (the legacy core/operators.js cube is a separate,
// unported holon) as the two closed enums this grid is defined over.

import { VERDICTS } from './verdicts.js';

export const MODES = Object.freeze(['Relate', 'Differentiate', 'Generate']);
export const GRAINS = Object.freeze(['Figure', 'Pattern', 'Ground']);

export const BEARING = Object.freeze({ BINDS: 'Relate', CUTS: 'Differentiate', DOESNT_BEAR: 'Generate' });
export const DETERMINACY = GRAINS;

// The grid. Cuts x Pattern is null: productive contradiction, structurally
// exported to the log (DEF) and never a verdict — the legal count is eight, not nine.
export const RESOLUTION_FACE = Object.freeze({
  Relate: Object.freeze({
    Figure:  VERDICTS.CORROBORATED,
    Pattern: VERDICTS.CONSONANT,
    Ground:  VERDICTS.CIRCUMSTANTIAL,
  }),
  Differentiate: Object.freeze({
    Figure:  VERDICTS.CONTRADICTED,
    Pattern: null,
    Ground:  VERDICTS.UNDERMINED,
  }),
  Generate: Object.freeze({
    Figure:  VERDICTS.UNSUPPORTED,
    Pattern: VERDICTS.INDETERMINATE,
    Ground:  VERDICTS.SILENT,
  }),
});

export const DEF_EXPORT_CELL = Object.freeze({ mode: 'Differentiate', grain: 'Pattern' });

export const verdictOf = (mode, grain) => RESOLUTION_FACE[mode]?.[grain] ?? null;

const VERDICT_CELL = new Map();
for (const mode of MODES)
  for (const grain of GRAINS) {
    const v = RESOLUTION_FACE[mode][grain];
    if (v != null) VERDICT_CELL.set(v, Object.freeze({ mode, grain }));
  }
export const cellOfVerdict = (verdict) => VERDICT_CELL.get(verdict) ?? null;

// The eight legal EVA verdicts — the grid minus the one DEF-exported cell.
export const LEGAL_VERDICTS = Object.freeze(
  MODES.flatMap((mode) => GRAINS.map((grain) => RESOLUTION_FACE[mode][grain])).filter((v) => v != null)
);

// The map from generator to today's shipped subset (spec sec 4/5/6 honesty debt).
export const SHIPPED_FOLD = Object.freeze({
  [VERDICTS.CORROBORATED]:  Object.freeze({ ships: true }),
  [VERDICTS.CONTRADICTED]:  Object.freeze({ ships: true }),
  [VERDICTS.UNSUPPORTED]:   Object.freeze({ ships: true }),
  [VERDICTS.INDETERMINATE]: Object.freeze({ ships: true }),
  [VERDICTS.SILENT]:        Object.freeze({ ships: true, note: 'promoted out of UNSUPPORTED' }),
  [VERDICTS.CONSONANT]:     Object.freeze({ ships: false, foldsInto: VERDICTS.CORROBORATED }),
  [VERDICTS.CIRCUMSTANTIAL]:Object.freeze({ ships: false, foldsInto: null }),
  [VERDICTS.UNDERMINED]:    Object.freeze({ ships: false, foldsInto: VERDICTS.CONTRADICTED }),
});

// Self-check: eight legal cells, one DEF export, no drift.
{
  const legal = new Set(LEGAL_VERDICTS);
  if (legal.size !== 8)
    throw new Error(`resolution-face self-check failed: expected 8 legal EVA verdicts, got ${legal.size}`);
}
