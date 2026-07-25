import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";

const PARAMETER_VALUE_TYPES = ["string", "number", "date", "entity_reference", "boolean"];

function isValueType(t) {
  return PARAMETER_VALUE_TYPES.includes(t);
}

export function induceParameters(entityRecords, {
  minPrevalence,
  minEntityCount,
  permutations,
  quantile = 0.95,
  population = "entities:anonymous",
} = {}) {
  const n = entityRecords.length;
  const resolvedMinEntityCount = minEntityCount ?? Math.max(3, Math.ceil(Math.sqrt(n)));
  const resolvedMinPrevalence = minPrevalence ?? 1 / Math.max(2, Math.sqrt(n));
  const resolvedPermutations = permutations ?? Math.max(40, n * 5);

  if (!Array.isArray(entityRecords) || entityRecords.length < resolvedMinEntityCount) {
    return [];
  }

  const attrMap = new Map();
  for (const ent of entityRecords) {
    if (!ent.attributes) continue;
    const seen = new Set();
    for (const attr of ent.attributes) {
      const key = `${attr.field_id}:${attr.value_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!attrMap.has(key)) {
        attrMap.set(key, {
          field_id: attr.field_id,
          value_type: attr.value_type,
          entityIds: new Set(),
          totalCount: 0,
        });
      }
      const entry = attrMap.get(key);
      entry.entityIds.add(ent.id);
      entry.totalCount += attr.count ?? 1;
    }
  }

  const candidates = [];
  for (const [key, entry] of attrMap) {
    const prevalence = entry.entityIds.size / n;
    if (prevalence < resolvedMinPrevalence) continue;

    const observedStatistic = entry.entityIds.size;

    const rng = createSeededRng(canonicalHashSync({
      population,
      attribute: key,
      purpose: "parameter-prevalence-null",
    }));
    const allIds = entityRecords.map(e => e.id);
    const nullSamples = [];
    for (let i = 0; i < resolvedPermutations; i += 1) {
      const shuffled = seededShuffle([...allIds], rng);
      const selected = shuffled.slice(0, observedStatistic);
      const shuffledCount = selected.filter(id => entry.entityIds.has(id)).length;
      nullSamples.push(shuffledCount);
    }

    const nullResult = deriveNull({
      nullSamples,
      observedStatistic,
      tailDirection: "greater",
      quantile,
      protocol: {
        name: "label-shuffle-attribute-prevalence",
        iterations: resolvedPermutations,
        statistic: "entity-count-with-attribute",
        scope: `${population} attribute:${key}`,
        attribute: entry.field_id,
        value_type: entry.value_type,
        entity_count: n,
      },
    });
    if (!nullResult.passed) continue;

    const label = entry.field_id
      .replace(/[_-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const body = {
      schema: "ParameterHypothesis@1",
      parameter_id: `param:${canonicalHashSync({ field: entry.field_id, population })}`,
      roles: ["boundary-bearing"],
      unit: { kind: "dimensionless" },
      domain: { attribute: entry.field_id, value_type: entry.value_type, predicate_class: entry.predicate_class },
      observed_range: { prevalence, member_count: entry.entityIds.size, total_population: n },
      uncertainty: { null_protocol: nullResult },
      member_support: [...entry.entityIds],
      ablation_delta: (1 - prevalence).toFixed(3),
      held_out_delta: "unknown",
      null_comparison: nullResult,
      stability: { passed: nullResult.passed, permutations: resolvedPermutations },
      provenance_expression: { operator_epoch: CURRENT_OPERATOR_EPOCH, induced_by: "SIG", from_population: population },
      external_name: label,
    };
    const content_hash = canonicalHashSync(body);
    candidates.push(Object.freeze({
      ...body,
      parameter_id: body.parameter_id,
      content_hash,
      _prevalence: prevalence,
      _entity_count: entry.entityIds.size,
    }));
  }

  candidates.sort((a, b) => b._prevalence - a._prevalence);
  return candidates;
}

export function parameterProfiles(entityRecords, parameterKeys) {
  const profiles = new Map();
  const keySet = new Set(parameterKeys);
  const dim = parameterKeys.length;

  for (const ent of entityRecords) {
    const vec = new Float64Array(dim);
    if (ent.attributes) {
      const seen = new Set();
      for (const attr of ent.attributes) {
        if (keySet.has(attr.field_id) && !seen.has(attr.field_id)) {
          seen.add(attr.field_id);
          const idx = parameterKeys.indexOf(attr.field_id);
          if (idx >= 0) vec[idx] = 1;
        }
      }
    }
    profiles.set(ent.id, vec);
  }
  return profiles;
}

export function profileJaccard(a, b) {
  if (a.length !== b.length) return 0;
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === 1 && b[i] === 1) intersection += 1;
    if (a[i] === 1 || b[i] === 1) union += 1;
  }
  return union === 0 ? 0 : intersection / union;
}
