import {
  CURRENT_OPERATOR_EPOCH,
  LEGACY_OPERATOR_MAP,
  resolveOperator,
} from "@eoreader/spec/operators";

/**
 * Normalize one eoreader4.2 operator-bearing record at the compatibility boundary.
 * The original record is never modified. Unmapped historical terms return a held
 * review artifact rather than a guessed current-epoch event.
 */
export function normalizeLegacy42OperatorRecord(record) {
  if (!record || typeof record !== "object") {
    throw new TypeError("normalizeLegacy42OperatorRecord: record must be an object");
  }
  const { operator, operator_epoch: operatorEpoch } = record;
  if (typeof operator !== "string" || typeof operatorEpoch !== "string") {
    throw new TypeError("normalizeLegacy42OperatorRecord: operator and operator_epoch are required");
  }

  const legacyEntry = LEGACY_OPERATOR_MAP[operator];
  if (legacyEntry?.status === "unmapped") {
    return {
      status: "held_for_review",
      reason: "unmapped_legacy_operator",
      original_operator: operator,
      original_operator_epoch: operatorEpoch,
      operator_epoch: CURRENT_OPERATOR_EPOCH,
      provenance: provenanceFor(record),
    };
  }

  return {
    status: "normalized",
    operator: resolveOperator(operator, operatorEpoch),
    operator_epoch: CURRENT_OPERATOR_EPOCH,
    original_operator: operator,
    original_operator_epoch: operatorEpoch,
    provenance: provenanceFor(record),
  };
}

function provenanceFor(record) {
  return {
    legacy42_id: record.legacy42_id ?? null,
    legacy42_hash: record.legacy42_hash ?? null,
  };
}
