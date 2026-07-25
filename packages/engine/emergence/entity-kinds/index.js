import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";
import { induceParameters, parameterProfiles, profileJaccard } from "../parameters/index.js";
import { pluralize } from "./pluralize.js";
export { pluralize } from "./pluralize.js";

export function induceEntityKinds(entityRecords, {
  minEntityCount,
  minPrevalence,
  cohesionThreshold,
  minKindSize,
  permutations,
  quantile = 0.95,
  population = "entities:anonymous",
  language = "eng",
  pluralizePriors,
} = {}) {
  const n = entityRecords.length;
  const resolvedMinEntityCount = minEntityCount ?? Math.max(3, Math.ceil(Math.sqrt(n)));
  const resolvedMinPrevalence = minPrevalence ?? 1 / Math.max(2, Math.sqrt(n));
  const resolvedMinKindSize = minKindSize ?? Math.max(2, Math.floor(Math.sqrt(n) / 3));
  const resolvedPermutations = permutations ?? Math.max(40, Math.round(n * 5));

  if (!Array.isArray(entityRecords) || entityRecords.length < resolvedMinEntityCount) {
    return [];
  }

  const computedCohesionThreshold = cohesionThreshold ?? deriveCohesionThreshold(entityRecords);

  const params = induceParameters(entityRecords, {
    minPrevalence: resolvedMinPrevalence,
    minEntityCount: resolvedMinEntityCount,
    permutations: resolvedPermutations,
    quantile,
    population,
  });
  if (params.length === 0) return [];

  const parameterKeys = params.map((p) => p.domain.attribute);

  const profiles = parameterProfiles(entityRecords, parameterKeys);
  if (profiles.size < resolvedMinEntityCount) return [];

  const entityIds = [...profiles.keys()];
  const nEntities = entityIds.length;
  const simMatrix = new Map();
  for (let i = 0; i < nEntities; i += 1) {
    for (let j = i + 1; j < nEntities; j += 1) {
      const sim = profileJaccard(profiles.get(entityIds[i]), profiles.get(entityIds[j]));
      simMatrix.set(`${i}-${j}`, sim);
    }
  }

  const entityActivation = new Map(entityRecords.map(e => {
    const total = (e.attributes || []).reduce((s, a) => s + (a.count ?? 1), 1);
    return [e.id, total];
  }));
  const sortedIds = [...entityIds].sort((a, b) =>
    (entityActivation.get(b) ?? 0) - (entityActivation.get(a) ?? 0)
  );
  const sortedIndex = sortedIds.map(id => entityIds.indexOf(id));

  const assigned = new Set();
  const kinds = [];

  for (let si = 0; si < sortedIndex.length; si += 1) {
    const seed = sortedIndex[si];
    if (assigned.has(seed)) continue;
    const cluster = [seed];
    assigned.add(seed);
    let changed = true;
    while (changed) {
      changed = false;
      let bestIdx = -1;
      let bestSim = -1;
      for (let i = 0; i < nEntities; i += 1) {
        if (assigned.has(i)) continue;
        let sum = 0;
        let count = 0;
        for (const c of cluster) {
          const key = c < i ? `${c}-${i}` : `${i}-${c}`;
          if (simMatrix.has(key)) {
            sum += simMatrix.get(key);
            count += 1;
          }
        }
        const meanSim = count > 0 ? sum / count : 0;
        if (meanSim > bestSim) {
          bestSim = meanSim;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestSim >= computedCohesionThreshold) {
        cluster.push(bestIdx);
        assigned.add(bestIdx);
        changed = true;
      }
    }
    if (cluster.length >= resolvedMinKindSize) {
      kinds.push(cluster);
    }
  }

  const unassigned = [];
  for (let i = 0; i < nEntities; i += 1) {
    if (assigned.has(i)) continue;
    unassigned.push(i);
  }
  for (const idx of unassigned) {
    let bestKind = -1;
    let bestSim = computedCohesionThreshold;
    for (let ki = 0; ki < kinds.length; ki += 1) {
      let sum = 0;
      for (const c of kinds[ki]) {
        const key = c < idx ? `${c}-${idx}` : `${idx}-${c}`;
        if (simMatrix.has(key)) {
          sum += simMatrix.get(key);
        }
      }
      const meanSim = kinds[ki].length > 0 ? sum / kinds[ki].length : 0;
      if (meanSim > bestSim) {
        bestSim = meanSim;
        bestKind = ki;
      }
    }
    if (bestKind >= 0) {
      kinds[bestKind].push(idx);
      assigned.add(idx);
    }
  }

  if (kinds.length === 0) return [];

  const entityById = new Map(entityRecords.map((e) => [e.id, e]));
  const kindRecords = [];

  for (const memberIndices of kinds) {
    const memberIds = memberIndices.map((i) => entityIds[i]);
    const memberCount = memberIds.length;

    let cohesionSum = 0;
    let cohesionCount = 0;
    for (let i = 0; i < memberIndices.length; i += 1) {
      for (let j = i + 1; j < memberIndices.length; j += 1) {
        const a = memberIndices[i];
        const b = memberIndices[j];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        cohesionSum += simMatrix.get(key) ?? 0;
        cohesionCount += 1;
      }
    }
    const cohesion = cohesionCount > 0 ? cohesionSum / cohesionCount : 0;

    const rng = createSeededRng(canonicalHashSync({
      population,
      member_count: memberCount,
      purpose: "kind-cohesion-null",
    }));
    const nullSamples = [];
    const shuffledIds = seededShuffle(entityIds, rng);
    for (let i = 0; i < resolvedPermutations; i += 1) {
      const shuffledGroup = shuffledIds.slice(0, memberCount);
      let groupSum = 0;
      let groupCount = 0;
      for (let a = 0; a < shuffledGroup.length; a += 1) {
        for (let b = a + 1; b < shuffledGroup.length; b += 1) {
          const ai = entityIds.indexOf(shuffledGroup[a]);
          const bi = entityIds.indexOf(shuffledGroup[b]);
          const key = ai < bi ? `${ai}-${bi}` : `${bi}-${ai}`;
          groupSum += simMatrix.get(key) ?? 0;
          groupCount += 1;
        }
      }
      nullSamples.push(groupCount > 0 ? groupSum / groupCount : 0);
      seededShuffle(shuffledIds, rng);
    }

    const cohesionNullResult = deriveNull({
      nullSamples,
      observedStatistic: cohesion,
      tailDirection: "greater",
      quantile,
      protocol: {
        name: "random-partition-cohesion",
        iterations: resolvedPermutations,
        statistic: "mean-pairwise-jaccard",
        scope: `${population} kind:${memberCount} members`,
      },
    });

    const kindParamRecords = [];
    const kindEntityRecords = memberIds.map((id) => entityById.get(id)).filter(Boolean);
    for (const param of params) {
      const attr = param.domain.attribute;
      const membersWithAttr = kindEntityRecords.filter((e) =>
        e.attributes && e.attributes.some((a) => a.field_id === attr)
      );
      const prevalence = membersWithAttr.length / kindEntityRecords.length;
      if (prevalence >= resolvedMinPrevalence) {
        kindParamRecords.push({
          parameter_id: param.parameter_id,
          label: param.external_name,
          value_type: param.domain.value_type,
          unit: param.unit?.unit ?? "",
          prevalence,
          null_protocol: param.null_comparison,
        });
      }
    }

    const sortedParams = [...kindParamRecords].sort((a, b) => b.prevalence - a.prevalence);
    const dominantParam = sortedParams.length > 0 ? sortedParams[0].label.toLowerCase().replace(/\s+/g, "_") : "unclassified";
    const kindId = `kind:${canonicalHashSync({ members: memberIds, params: sortedParams.map((p) => p.parameter_id), population })}`;

    const distinguishing = sortedParams.slice(0, 3).map((p) => p.parameter_id);
    const pluralizeOpts = { priors: pluralizePriors };
    let bestDistinctiveness = 0;
    let bestLabel = sortedParams.length > 0 ? pluralize(sortedParams[0].label, language, pluralizeOpts) : "Unclassified";
    for (const sp of sortedParams) {
      const popParam = params.find(p => p.parameter_id === sp.parameter_id);
      if (popParam && popParam._prevalence > 0 && popParam._prevalence < 1) {
        const distinctiveness = sp.prevalence / popParam._prevalence;
        if (distinctiveness > bestDistinctiveness) {
          bestDistinctiveness = distinctiveness;
          bestLabel = pluralize(sp.label, language, pluralizeOpts);
        }
      }
    }

    const body = {
      schema: "EntityKindCandidate@1",
      id: `entity-kind:${canonicalHashSync({ memberIds, params: sortedParams.map((p) => p.parameter_id), population })}`,
      kind_id: kindId,
      label: bestLabel,
      description: `Entities characterized by ${sortedParams.slice(0, 3).map((p) => p.label.toLowerCase()).join(", ")}`,
      member_entity_ids: memberIds,
      member_count: memberCount,
      standard_parameters: sortedParams,
      operator_chain: {
        sig: { operator: "SIG", mode: "Relate", domain: "Existence", act: "attribute-discovery", module: "parameters/index.js" },
        con: { operator: "CON", mode: "Relate", domain: "Structure", act: "entity-bonding", metric: "profileJaccard", threshold: computedCohesionThreshold },
        eva: { operator: "EVA", mode: "Relate", domain: "Interpretation", act: "cohesion-null", method: "random-partition", passed: cohesionNullResult.passed, p_value: cohesionNullResult.p_value },
        def: { operator: "DEF", mode: "Differentiate", domain: "Interpretation", act: "kind-definition", label: bestLabel },
        ins: { operator: "INS", mode: "Generate", domain: "Existence", act: "member-instantiation", member_count: memberCount },
        syn: { operator: "SYN", mode: "Generate", domain: "Structure", act: "vocabulary-synthesis", used_in: "buildKindVocabulary" },
        rec: { operator: "REC", mode: "Generate", domain: "Interpretation", act: "rule-learning", status: "not-applied" },
      },
      cohesion,
      cohesion_null: cohesionNullResult,
      distinguishing_parameters: distinguishing,
      emergence: {
        operator_epoch: CURRENT_OPERATOR_EPOCH,
        induced_by: "SYN",
        from_entities: population,
      },
    };
    const content_hash = canonicalHashSync(body);
    kindRecords.push(Object.freeze({
      ...body,
      content_hash,
      _cohesion_null_passed: cohesionNullResult.passed,
    }));
  }

  const validated = kindRecords.filter((k) => k._cohesion_null_passed);
  if (validated.length === 0) {
    kindRecords.sort((a, b) => b.cohesion - a.cohesion);
    return kindRecords.length > 0 ? [kindRecords[0]] : [];
  }

  validated.sort((a, b) => b.cohesion - a.cohesion);
  return validated;
}

function deriveCohesionThreshold(entityRecords) {
  if (!entityRecords || entityRecords.length < 2) return 0.25;
  const pairs = [];
  for (let i = 0; i < entityRecords.length && pairs.length < 500; i += 1) {
    for (let j = i + 1; j < entityRecords.length && pairs.length < 500; j += 1) {
      const attrsA = new Set((entityRecords[i].attributes || []).map(a => a.field_id));
      const attrsB = new Set((entityRecords[j].attributes || []).map(a => a.field_id));
      const intersection = [...attrsA].filter(a => attrsB.has(a)).length;
      const union = new Set([...attrsA, ...attrsB]).size;
      pairs.push(union === 0 ? 0 : intersection / union);
    }
  }
  if (pairs.length === 0) return 0.25;
  const mean = pairs.reduce((a, b) => a + b, 0) / pairs.length;
  return mean;
}

export function buildKindVocabulary(kindCandidates, { population = "entities:anonymous" } = {}) {
  const allPrevalences = kindCandidates.flatMap((k) =>
    k.standard_parameters.map((p) => p.prevalence),
  );
  allPrevalences.sort((a, b) => a - b);
  const requiredThreshold = allPrevalences.length > 0
    ? allPrevalences[Math.max(0, Math.floor(0.99 * allPrevalences.length - 1))]
    : 0.8;
  const kinds = kindCandidates.map((k) => ({
    kind_id: k.kind_id,
    label: k.label,
    description: k.description,
    standard_parameters: k.standard_parameters.map((p) => ({
      parameter_id: p.parameter_id,
      label: p.label,
      value_type: p.value_type,
      unit: p.unit || undefined,
      description: `${p.label} (prevalence: ${(p.prevalence * 100).toFixed(0)}%)`,
      required: p.prevalence >= requiredThreshold,
      prevalence: p.prevalence,
    })),
    cohesion: k.cohesion,
    distinguishing_parameters: k.distinguishing_parameters,
  }));

  const body = {
    schema: "EntityKindVocabulary@1",
    vocabulary_id: `vocab:${canonicalHashSync({ kinds, population })}`,
    operator_epoch: CURRENT_OPERATOR_EPOCH,
    kinds,
    population,
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, content_hash });
}
