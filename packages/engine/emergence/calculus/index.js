import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { evaluateProgramCompetency } from "../programs/index.js";
import { induceOperators } from "../operators/index.js";
import { canonicalKey, enumeratePrograms } from "../expressions/index.js";

function collectOprefIds(node) {
  if (!node || typeof node !== "object") return [];
  const here = node.op === "opref" && typeof node.id === "string" ? [node.id] : [];
  const nested = ["of", "a", "b", "program"].flatMap((child) => (node[child] ? collectOprefIds(node[child]) : []));
  return [...here, ...nested];
}

function referenceGain(series, program, referenceBaseline, warmup, tag) {
  const { gain, competency } = evaluateProgramCompetency(series, program, {
    baselines: [referenceBaseline],
    warmup,
    taskId: `task:calculus:${tag}`,
    population: `calculus:${tag}`,
    sourceVersion: canonicalHashSync(series),
  });
  return { gain: gain[referenceBaseline.id] ?? 0, referenceLoss: competency.baseline_losses[referenceBaseline.id] / Math.max(1, competency.observations) };
}

function splitFamily(seriesFamily, proposeFraction) {
  const sorted = [...seriesFamily].sort((a, b) => a.id.localeCompare(b.id));
  const rng = createSeededRng(canonicalHashSync({ ids: sorted.map((s) => s.id), purpose: "calculus-family-split" }));
  const shuffled = seededShuffle(sorted, rng);
  const proposeCount = Math.round(proposeFraction * shuffled.length);
  return { propose: shuffled.slice(0, proposeCount), holdout: shuffled.slice(proposeCount) };
}

function vocabStatPerSeries(holdoutSeries, vocabulary, referenceBaseline, warmup, tag) {
  return holdoutSeries.map((series, i) => {
    const gains = vocabulary.map((member, m) => referenceGain(series, member.canonical_program, referenceBaseline, warmup, `${tag}:${i}:${m}`).gain);
    return meanOf(gains);
  });
}
function meanOf(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function induceExtensions({ vocabulary, bestMemberGain, holdoutSeries, holdoutIds, referenceBaseline, holdoutWarmup, shuffles, quantile, minRelativeEffect, extensionMaxPrograms }) {
  const library = vocabulary.map((v) => ({ id: v.operator_id, program: v.canonical_program }));
  const candidates = enumeratePrograms({ library, maxPrograms: extensionMaxPrograms });
  const memberIds = new Set(vocabulary.map((v) => v.operator_id));
  const crossVocabulary = candidates.filter((program) => {
    const referenced = new Set(collectOprefIds(program).filter((id) => memberIds.has(id)));
    return referenced.size >= 2;
  });
  const correctedQuantile = crossVocabulary.length > 0 ? 1 - (1 - quantile) / crossVocabulary.length : quantile;

  const promoted = [];
  for (const program of crossVocabulary) {
    const perSeriesGain = holdoutSeries.map((series, i) => referenceGain(series, program, referenceBaseline, holdoutWarmup, `ext:real:${i}`).gain);
    const aggregate_transfer_gain = meanOf(perSeriesGain);
    const beats_best_member_by = aggregate_transfer_gain - bestMemberGain;
    if (beats_best_member_by <= 0) continue;

    const rng = createSeededRng(canonicalHashSync({ holdoutIds, programKey: canonicalKey(program), purpose: "calculus-extension-null" }));
    const nullSamples = [];
    for (let i = 0; i < shuffles; i += 1) {
      const shuffledHoldout = holdoutSeries.map((series) => seededShuffle(series, rng));
      nullSamples.push(meanOf(shuffledHoldout.map((series, j) => referenceGain(series, program, referenceBaseline, holdoutWarmup, `ext:null:${i}:${j}`).gain)));
    }
    const transfer_null = deriveNull({
      nullSamples,
      observedStatistic: aggregate_transfer_gain,
      tailDirection: "greater",
      quantile: correctedQuantile,
      protocol: {
        name: "cross-series-shuffle",
        iterations: shuffles,
        statistic: "composed-program competency gain",
        scope: "temporal-order-per-holdout-series",
        multiple_testing_correction: { method: "bonferroni", candidates_tested: crossVocabulary.length, base_quantile: quantile, corrected_quantile: correctedQuantile },
      },
    });
    if (!transfer_null.passed) continue;

    const referenceLosses = holdoutSeries.map((series, i) => referenceGain(series, program, referenceBaseline, holdoutWarmup, `ext:scale:${i}`).referenceLoss);
    const reference_scale = meanOf(referenceLosses);
    const relative_effect = reference_scale > 0 ? aggregate_transfer_gain / reference_scale : 0;
    if (relative_effect < minRelativeEffect) continue;

    const member_operator_ids = [...new Set(collectOprefIds(program).filter((id) => memberIds.has(id)))];
    promoted.push({
      canonical_program: program,
      program_key: canonicalKey(program),
      member_operator_ids,
      aggregate_transfer_gain,
      relative_effect,
      beats_best_member_by,
      transfer_null,
      emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, promoted_by: "REC", reenters_as: "INS" },
    });
  }
  return promoted;
}

export function induceCalculus(seriesFamily, {
  proposeFraction,
  minProposeSeries,
  minHoldoutSeries,
  minVocabularySize,
  minSupportFraction,
  operatorOptions = {},
  referenceBaselineId = "baseline:global-mean",
  holdoutWarmup,
  shuffles,
  quantile = 0.95,
  minRelativeEffect,
  seasonalPeriod,
  population = "family:anonymous",
  composeExtensions = false,
  extensionMaxPrograms,
} = {}) {
  const nFamily = seriesFamily.length;
  const totalSeriesLen = seriesFamily.length > 0
    ? seriesFamily.reduce((sum, s) => sum + s.series.length, 0)
    : 0;
  const avgSeriesLen = nFamily > 0 ? totalSeriesLen / nFamily : 0;
  const resolvedProposeFraction = proposeFraction ?? Math.max(0.5, 1 - 1 / Math.sqrt(nFamily));
  const resolvedMinProposeSeries = minProposeSeries ?? Math.max(2, Math.floor(Math.sqrt(nFamily) / 3));
  const resolvedMinHoldoutSeries = minHoldoutSeries ?? Math.max(1, Math.floor(Math.sqrt(nFamily) / 4));
  const resolvedMinVocabularySize = minVocabularySize ?? Math.max(2, Math.floor(Math.sqrt(nFamily)));
  const resolvedMinSupportFraction = minSupportFraction ?? 1 / Math.sqrt(nFamily);
  const resolvedHoldoutWarmup = holdoutWarmup ?? Math.ceil(Math.sqrt(Math.max(1, avgSeriesLen)));
  const resolvedShuffles = shuffles ?? Math.max(20, Math.round(Math.max(1, avgSeriesLen) * 2));
  const resolvedMinRelativeEffect = minRelativeEffect ?? 1 / Math.sqrt(Math.max(1, avgSeriesLen));
  const resolvedExtensionMaxPrograms = extensionMaxPrograms ?? Math.max(64, Math.round(Math.max(1, avgSeriesLen) * 4));

  if (!Array.isArray(seriesFamily) || seriesFamily.length < resolvedMinProposeSeries + resolvedMinHoldoutSeries) {
    throw new TypeError(`calculus: seriesFamily must have at least ${resolvedMinProposeSeries + resolvedMinHoldoutSeries} series`);
  }
  for (const s of seriesFamily) {
    if (typeof s.id !== "string" || !s.id || !Array.isArray(s.series)) throw new TypeError("calculus: every family entry needs a non-empty id and a series array");
  }
  const ids = seriesFamily.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new TypeError("calculus: series ids must be unique");

  const { propose, holdout } = splitFamily(seriesFamily, resolvedProposeFraction);
  if (propose.length < resolvedMinProposeSeries || holdout.length < resolvedMinHoldoutSeries) {
    throw new TypeError("calculus: the propose/holdout split did not meet the requested minimums — adjust the proposal or provide more series");
  }

  const baselines = defaultNumericBaselines({ window: Math.max(3, Math.floor(Math.sqrt(avgSeriesLen) / 2)), seasonalPeriod });
  const referenceBaseline = baselines.find((b) => b.id === referenceBaselineId);
  if (!referenceBaseline) throw new TypeError(`calculus: unknown reference baseline ${referenceBaselineId}`);

  const groups = new Map();
  const skipped = [];
  for (const { id, series } of propose) {
    let result;
    try {
      result = induceOperators(series, { ...operatorOptions, referenceBaselineId, seasonalPeriod, population: `${population}:${id}` });
    } catch (err) {
      skipped.push({ seriesId: id, reason: err.message });
      continue;
    }
    for (const operator of result.operators) {
      const key = canonicalKey(operator.canonical_program);
      if (!groups.has(key)) groups.set(key, { canonical_program: operator.canonical_program, entries: [] });
      groups.get(key).entries.push({ operator, seriesId: id });
    }
  }

  const proposeCount = propose.length;
  const requiredSupport = Math.ceil(resolvedMinSupportFraction * proposeCount);
  const allGroups = [...groups.entries()].map(([key, g]) => ({ key, ...g, support: g.entries.length }));
  const vocabulary = allGroups
    .filter((g) => g.support >= requiredSupport)
    .sort((a, b) => b.support - a.support || a.key.localeCompare(b.key))
    .map((g) => ({
      operator_id: g.entries[0].operator.id,
      canonical_program: g.canonical_program,
      program_key: g.key,
      input_types: ["number[]"],
      output_type: "number",
      support: { count: g.support, fraction: g.support / proposeCount, propose_series_ids: g.entries.map((e) => e.seriesId) },
    }));

  if (vocabulary.length < resolvedMinVocabularySize) return null;

  const holdoutSeries = holdout.map((h) => h.series);
  const holdoutIds = holdout.map((h) => h.id);

  const perSeriesGain = vocabStatPerSeries(holdoutSeries, vocabulary, referenceBaseline, resolvedHoldoutWarmup, "real");
  const aggregate_transfer_gain = meanOf(perSeriesGain);

  const referenceLosses = holdoutSeries.map((series, i) => referenceGain(series, vocabulary[0].canonical_program, referenceBaseline, resolvedHoldoutWarmup, `scale:${i}`).referenceLoss);
  const reference_scale = meanOf(referenceLosses);

  const rng = createSeededRng(canonicalHashSync({ holdoutIds, vocabularyKeys: vocabulary.map((v) => v.program_key), purpose: "calculus-transfer-null" }));
  const nullSamples = [];
  for (let i = 0; i < resolvedShuffles; i += 1) {
    const shuffledHoldout = holdoutSeries.map((series) => seededShuffle(series, rng));
    nullSamples.push(meanOf(vocabStatPerSeries(shuffledHoldout, vocabulary, referenceBaseline, resolvedHoldoutWarmup, `null:${i}`)));
  }
  const transfer_null = deriveNull({
    nullSamples,
    observedStatistic: aggregate_transfer_gain,
    tailDirection: "greater",
    quantile,
    protocol: { name: "cross-series-shuffle", iterations: resolvedShuffles, statistic: "mean best-of-vocabulary competency gain", scope: "temporal-order-per-holdout-series" },
  });
  if (!transfer_null.passed) return null;

  const relative_effect = reference_scale > 0 ? aggregate_transfer_gain / reference_scale : 0;
  if (relative_effect < resolvedMinRelativeEffect) return null;

  const uncompressedPool = allGroups.map((g) => ({ canonical_program: g.canonical_program }));
  const vs_uncompressed_pool = uncompressedPool.length
    ? { aggregate_transfer_gain: meanOf(vocabStatPerSeries(holdoutSeries, uncompressedPool, referenceBaseline, resolvedHoldoutWarmup, "pool")) }
    : null;

  const vocabularyOperatorIds = new Set(vocabulary.map((v) => v.operator_id));
  const edges = [];
  const importedPrimitives = new Set();
  for (const v of vocabulary) {
    for (const oprefId of collectOprefIds(v.canonical_program)) {
      const internal = vocabularyOperatorIds.has(oprefId);
      edges.push({ from: v.operator_id, to: oprefId, internal });
      if (!internal) importedPrimitives.add(oprefId);
    }
  }
  const dependency_graph = {
    edges,
    imported_primitives: [...importedPrimitives],
  };

  const vocabularyWithTransfer = vocabulary.map((v, i) => {
    const per_series = holdoutIds.map((id, j) => ({ series_id: id, gain: referenceGain(holdoutSeries[j], v.canonical_program, referenceBaseline, resolvedHoldoutWarmup, `member:${i}:${j}`).gain }));
    return { ...v, holdout_transfer: { per_series, mean_gain: meanOf(per_series.map((p) => p.gain)) } };
  });
  const bestMemberGain = Math.max(...vocabularyWithTransfer.map((v) => v.holdout_transfer.mean_gain));

  const proposed_extensions = composeExtensions
    ? induceExtensions({
        vocabulary: vocabularyWithTransfer,
        bestMemberGain,
        holdoutSeries,
        holdoutIds,
        referenceBaseline,
        holdoutWarmup: resolvedHoldoutWarmup,
        shuffles: resolvedShuffles,
        quantile,
        minRelativeEffect: resolvedMinRelativeEffect,
        extensionMaxPrograms: resolvedExtensionMaxPrograms,
      })
    : [];

  const body = {
    schema: "CalculusCandidate@1",
    vocabulary: vocabularyWithTransfer,
    proposed_extensions,
    dependency_graph,
    closure_domain: { description: "scalar numeric one-step-ahead programs over the shared typed IR (emergence/expressions)", input_types: ["number[]"], output_type: "number" },
    propose_series_ids: propose.map((s) => s.id),
    holdout_series_ids: holdoutIds,
    split: { seed_purpose: "calculus-family-split", propose_fraction: resolvedProposeFraction, propose_count: propose.length, holdout_count: holdout.length },
    min_support_fraction: resolvedMinSupportFraction,
    reference_baseline_id: referenceBaselineId,
    aggregate_transfer_gain,
    reference_scale,
    relative_effect,
    transfer_null,
    vs_uncompressed_pool,
    vs_foil_bundle: null,
    lens: { target_type: "number", horizon: { kind: "walk-forward", h: 1 }, scoring_rule: "crps", baseline_ids: baselines.map((b) => b.id), population },
    novelty_status: "candidate_novel",
    status: "experimental",
    emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, synthesized_by: "SYN", validated_by: "EVA", member_count: vocabulary.length },
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, id: `calculus:${content_hash}`, content_hash });
}

export { induceExtensions };
