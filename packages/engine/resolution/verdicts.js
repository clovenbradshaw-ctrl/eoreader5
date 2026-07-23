// Ported from eoreader4.2 src/core/verdicts.js — the verdict vocabulary (spec
// section: verdict-space-taxonomy). A pure enum; the leaf every resolution
// function in this holon reads through.

export const VERDICTS = Object.freeze({
  CORROBORATED:   'corroborated',
  CONSONANT:      'consonant',       // reserved — see resolution-face.js
  CIRCUMSTANTIAL: 'circumstantial',  // reserved — see resolution-face.js
  CONTRADICTED:   'contradicted',
  UNDERMINED:     'undermined',      // reserved — see resolution-face.js
  UNSUPPORTED:    'unsupported',
  INDETERMINATE:  'indeterminate',
  SILENT:         'silent',
  OFF_DIAGONAL:   'off_diagonal',
});
