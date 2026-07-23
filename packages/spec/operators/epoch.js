// Canonical operator epoch declaration (spec section 4, P0 decision).
//
// See docs/operator-epoch.md for rationale. This module is the single
// source of truth every schema, engine reducer, and compatibility importer
// MUST reference — normalization of a historical term MUST happen only at
// a compatibility/import boundary, never silently in the engine.

/** The current canonical operator epoch id. Stamped onto every event, reading, and prior snapshot. */
export const CURRENT_OPERATOR_EPOCH = "eo-2026-07";

/**
 * The 3x3 closed operator vocabulary for CURRENT_OPERATOR_EPOCH.
 * Rows: mode. Columns: act.
 */
export const OPERATORS = Object.freeze({
  Existence: Object.freeze({ Differentiate: "NUL", Relate: "SIG", Generate: "INS" }),
  Structure: Object.freeze({ Differentiate: "SEG", Relate: "CON", Generate: "SYN" }),
  Interpretation: Object.freeze({ Differentiate: "DEF", Relate: "EVA", Generate: "REC" }),
});

export const OPERATOR_CODES = Object.freeze(
  Object.values(OPERATORS).flatMap((row) => Object.values(row))
);

/**
 * Historical/older vocabulary -> current-epoch mapping, or explicit null for
 * intentionally unmapped terms. Every historical name MUST appear here;
 * absence is a spec bug, not "not applicable".
 *
 * Status:
 *  - "mapped": known 1:1 replacement in CURRENT_OPERATOR_EPOCH.
 *  - "unmapped": term is retained for provenance only; no safe automatic
 *    replacement is known yet. Import of a record carrying this term MUST
 *    be held for human review, never silently coerced.
 */
export const LEGACY_OPERATOR_MAP = Object.freeze({
  ALT: Object.freeze({ status: "mapped", to: "DEF", epoch: "eo-legacy-pre-2026" }),
  SUP: Object.freeze({ status: "mapped", to: "EVA", epoch: "eo-legacy-pre-2026" }),
  DES: Object.freeze({ status: "unmapped", to: null, epoch: "eo-legacy-pre-2026" }),
});

export function isCurrentOperator(code) {
  return OPERATOR_CODES.includes(code);
}

/**
 * Resolve a possibly-historical operator code against a stated epoch.
 * Throws rather than guessing when the epoch/term pair is unknown.
 */
export function resolveOperator(code, epoch) {
  if (epoch === CURRENT_OPERATOR_EPOCH) {
    if (!isCurrentOperator(code)) {
      throw new Error(`resolveOperator: "${code}" is not in epoch ${epoch}`);
    }
    return code;
  }
  const entry = LEGACY_OPERATOR_MAP[code];
  if (!entry) {
    throw new Error(`resolveOperator: unknown operator "${code}" for epoch "${epoch}"`);
  }
  if (entry.status === "unmapped") {
    throw new Error(
      `resolveOperator: "${code}" (epoch ${epoch}) is intentionally unmapped and requires human review`
    );
  }
  return entry.to;
}
