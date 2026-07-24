// Level-3 calculus induction: SYN assembling a coherent vocabulary, EVA judging
// it across sources (spec "EO Emergent Mathematics for Predictive Competency"
// section 16 "Inducing a Calculus", section 11.4 "Level 3 — calculus
// candidate"). A fitted formula is not automatically new mathematics (§16.1):
// EO calls a structure a calculus candidate only when it provides reusable
// rules for constructing and transforming a FAMILY of models, not one series.
//
// Level 1 (../operators) and Level 2 (../kinds) both demonstrate transfer
// across a held-out TIME tail of one series. A calculus is the genuine
// escalation invariant 7.6 also names: transfer across held-out SOURCES — a
// family of series the vocabulary was never shown (§16.3 step 10).
//
// The algorithm, mapped onto §16.3's steps, reuses existing machinery wherever
// possible rather than inventing new mechanism:
//
//   1-3 (cluster by structural similarity, identify subgraphs, propose
//        reusable operators): run ../operators/induceOperators independently
//        per PROPOSE series, then group every promoted OperatorCandidate by
//        canonicalKey. Because enumeratePrograms is series-independent for a
//        fixed enumeration config, "the same structure recurred" is exact set
//        membership, not a fuzzy similarity metric.
//   4    (formation/transformation rules): inherited verbatim from
//        enumeratePrograms' grammar and induceOperators' own promotion gate —
//        not re-derived here.
//   5    (synthesize a minimal description of the family): the support-
//        qualified vocabulary itself IS that minimal description.
//   6-8  (positive/negative examples; executor/checker; regenerate): satisfied
//        by reuse (evalNode/evaluateProgram IS the executor/checker; the
//        vocabulary members already regenerate by construction).
//   9    (propose useful NEW programs) — opt-in via `composeExtensions`.
//        Composes vocabulary members through the existing add/sub grammar
//        (enumeratePrograms with the vocabulary as `library`), filters to
//        genuine cross-vocabulary forms (>=2 distinct members referenced),
//        and gates each through the SAME statistical machinery as step 10
//        (cross-series permutation null, relative effect-size floor) plus one
//        more bar: it must beat the best single member's own holdout gain —
//        "useful NEW," not merely "also transfers."
//
//        This is provably near-unreachable with the current grammar, not just
//        empirically rare — confirmed across three independently-designed
//        vocabularies (redundant near-identical members, a richer/more
//        diverse vocabulary, a low-signal-to-noise fixture meant to leave
//        room for correction), where NOT ONE composed candidate ever beat its
//        best member, but the reason is structural: a vocabulary member is
//        REQUIRED to be a full-scale competent point predictor of the target
//        (support-qualified membership requires positive reference_gain
//        against the reference baseline — section 16.2's "successful
//        expression"). Composing two such full-scale predictors via `add`
//        roughly DOUBLES an already-accurate signal (catastrophic overshoot);
//        via `sub` it collapses toward ZERO — the wrong output scale entirely
//        whenever the target itself isn't near zero. Neither failure is
//        fixture-specific: it follows necessarily from what "vocabulary
//        member" is guaranteed to mean. Only a scale-preserving combinator
//        (e.g. a weighted average) — absent from the current composition
//        grammar, which composes only via add/sub — could plausibly exploit
//        complementary, anti-correlated member errors. `proposed_extensions`
//        is therefore honestly expected to stay empty under this grammar. The
//        gate is implemented in full (including a Bonferroni multiple-testing
//        correction, see induceExtensions) so a richer grammar — a later,
//        separate change — would be recognized and promoted correctly
//        without touching this logic again.
//   10   (evaluate on held-out tasks): the genuinely new logic below — a
//        cross-series transfer statistic, its own permutation null, and a
//        relative effect-size floor.
//   11   (compare against the uncompressed library): reported as a diagnostic.
//   12   (export a versioned candidate with failures): a sealed
//        CalculusCandidate, or null with the caller left to log which gate
//        refused it (see scripts/induce-calculus-demo.mjs).
//
// Working principle carried over from ../kinds, made explicit: every gate
// answers a narrower question than it sounds like it does. The permutation
// null (step 10) answers "is this distinguishable from chance"; the relative
// effect-size floor answers the DIFFERENT question "is it big enough to
// matter." Calculus induction has MORE surface for a false positive than kinds
// did (support/recurrence AND cross-series transfer both have to hold), so
// both gates are required, not just the null.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { evaluateProgramCompetency } from "../programs/index.js";
import { induceOperators } from "../operators/index.js";
import { canonicalKey, enumeratePrograms } from "../expressions/index.js";

/** Every `opref` operator id referenced anywhere inside a program tree (section 16.4's dependency graph is built from these). */
function collectOprefIds(node) {
  if (!node || typeof node !== "object") return [];
  const here = node.op === "opref" && typeof node.id === "string" ? [node.id] : [];
  const nested = ["of", "a", "b", "program"].flatMap((child) => (node[child] ? collectOprefIds(node[child]) : []));
  return [...here, ...nested];
}

/** Reference competency gain of a program on a whole series (no internal split — the series is either entirely fit or entirely held-out). */
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

/**
 * Deterministic propose/holdout split over SOURCES (not time). Sorts ids so
 * caller ordering never biases the split, then seeds a shuffle from a
 * canonical hash of the id set — replayable, no ambient randomness.
 */
function splitFamily(seriesFamily, proposeFraction) {
  const sorted = [...seriesFamily].sort((a, b) => a.id.localeCompare(b.id));
  const rng = createSeededRng(canonicalHashSync({ ids: sorted.map((s) => s.id), purpose: "calculus-family-split" }));
  const shuffled = seededShuffle(sorted, rng);
  const proposeCount = Math.round(proposeFraction * shuffled.length);
  return { propose: shuffled.slice(0, proposeCount), holdout: shuffled.slice(proposeCount) };
}

/**
 * For each holdout series, the MEAN of every vocabulary member's competency
 * gain over the reference. This was originally a max-over-members statistic
 * ("closure: the calculus offers several transformations, apply whichever
 * fits") — that framing was wrong and the empirical battery caught it: with a
 * diverse-enough vocabulary and a weak reference (global-mean, easily beaten
 * by almost any momentum-style predictor on almost any non-stationary
 * series), max-over-members can look like transfer by opportunistic
 * cherry-picking even when members flatly DISAGREE in sign across sources —
 * a family of mutually unrelated series produced a "vocabulary" whose members
 * helped hugely on one holdout series and hurt hugely on another, and the max
 * statistic laundered that disagreement into an apparently strong positive
 * aggregate. The mean is not gameable that way: members that disagree in sign
 * across sources pull the aggregate toward (or past) zero, which is the
 * honest signal that the "vocabulary" is not a coherent package. `vocabulary`
 * is an array of {program} entries; nothing here fixes a "winner," so a
 * permutation null can reuse this unchanged on shuffled data.
 */
function vocabStatPerSeries(holdoutSeries, vocabulary, referenceBaseline, warmup, tag) {
  return holdoutSeries.map((series, i) => {
    const gains = vocabulary.map((member, m) => referenceGain(series, member.canonical_program, referenceBaseline, warmup, `${tag}:${i}:${m}`).gain);
    return meanOf(gains);
  });
}
function meanOf(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Section 16.3 step 9: compose NEW cross-vocabulary programs from an
 * already-promoted vocabulary and gate each through the exact same
 * statistical machinery as the vocabulary's own step-10 transfer claim, plus
 * one more bar the members themselves never had to clear: beating the best
 * single member's own holdout gain. Reuses the calculus's own
 * already-committed holdout series and reference baseline — no re-splitting.
 *
 * Multiple-testing correction (section 20.1): this evaluates N independent
 * candidates against the SAME per-candidate null, so an uncorrected
 * quantile=0.95 gate lets the family-wise false-positive rate climb with N —
 * the same shape of gap as every prior module in this session (a null
 * answers "not chance for THIS one test," not "not chance across every test I
 * happened to run"). The per-candidate quantile is Bonferroni-corrected by
 * the actual count of cross-vocabulary candidates considered — N is counted
 * from the real enumeration, never a hand-set constant — so the effective
 * family-wise rate stays at the caller's requested `quantile` regardless of
 * how large the composed-program search space turns out to be.
 */
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
    if (beats_best_member_by <= 0) continue; // section 16.3 step 9's actual bar: useful NEW, not merely also-transfers

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

/**
 * Induce a Level-3 calculus candidate from a family of series.
 *
 * @param {{id: string, series: number[]}[]} seriesFamily
 * @param {object} [opts]
 * @param {number} [opts.proposeFraction=0.6]
 * @param {number} [opts.minProposeSeries=3]
 * @param {number} [opts.minHoldoutSeries=2]
 * @param {number} [opts.minVocabularySize=2] - hard cardinality gate (section 16.2).
 * @param {number} [opts.minSupportFraction=0.5] - fraction of propose series that must
 *   independently promote the same canonicalKey; a documented convention (like
 *   quantile=0.95 elsewhere) whose resolved absolute count scales with family size.
 * @param {object} [opts.operatorOptions={}] - forwarded to induceOperators per propose series.
 * @param {string} [opts.referenceBaselineId="baseline:global-mean"]
 * @param {number} [opts.holdoutWarmup=4]
 * @param {number} [opts.shuffles=40]
 * @param {number} [opts.quantile=0.95]
 * @param {number} [opts.minRelativeEffect=0.05]
 * @param {number} [opts.seasonalPeriod]
 * @param {string} [opts.population="family:anonymous"]
 * @param {boolean} [opts.composeExtensions=false] - section 16.3 step 9: after a
 *   calculus is found, compose NEW cross-vocabulary programs and gate each
 *   through the same transfer null + effect-size floor, plus a bar the
 *   vocabulary members themselves don't face: beating the best single
 *   member's own holdout gain. Off by default so existing callers/results are
 *   unaffected; `proposed_extensions` is always present on the record
 *   (empty when off, or when nothing clears every gate).
 * @param {number} [opts.extensionMaxPrograms=512] - enumeration cap for step 9.
 * @returns {object|null} a sealed CalculusCandidate, or null if no admissible calculus is found.
 */
export function induceCalculus(seriesFamily, {
  proposeFraction = 0.6,
  minProposeSeries = 3,
  minHoldoutSeries = 2,
  minVocabularySize = 2,
  minSupportFraction = 0.5,
  operatorOptions = {},
  referenceBaselineId = "baseline:global-mean",
  holdoutWarmup = 4,
  shuffles = 40,
  quantile = 0.95,
  minRelativeEffect = 0.05,
  seasonalPeriod,
  population = "family:anonymous",
  composeExtensions = false,
  extensionMaxPrograms = 512,
} = {}) {
  if (!Array.isArray(seriesFamily) || seriesFamily.length < minProposeSeries + minHoldoutSeries) {
    throw new TypeError(`calculus: seriesFamily must have at least ${minProposeSeries + minHoldoutSeries} series`);
  }
  for (const s of seriesFamily) {
    if (typeof s.id !== "string" || !s.id || !Array.isArray(s.series)) throw new TypeError("calculus: every family entry needs a non-empty id and a series array");
  }
  const ids = seriesFamily.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new TypeError("calculus: series ids must be unique");

  const { propose, holdout } = splitFamily(seriesFamily, proposeFraction);
  if (propose.length < minProposeSeries || holdout.length < minHoldoutSeries) {
    throw new TypeError("calculus: the propose/holdout split did not meet the requested minimums — adjust proposeFraction or provide more series");
  }

  const baselines = defaultNumericBaselines({ window: 3, seasonalPeriod });
  const referenceBaseline = baselines.find((b) => b.id === referenceBaselineId);
  if (!referenceBaseline) throw new TypeError(`calculus: unknown reference baseline ${referenceBaselineId}`);

  // Steps 1-3: induce operators per propose series, cluster by canonicalKey.
  const groups = new Map(); // key -> { canonical_program, entries: [{operator, seriesId}] }
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
  const requiredSupport = Math.ceil(minSupportFraction * proposeCount);
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

  // Step 4: minimum vocabulary gate (section 16.2 — "more than one successful expression").
  if (vocabulary.length < minVocabularySize) return null;

  const holdoutSeries = holdout.map((h) => h.series);
  const holdoutIds = holdout.map((h) => h.id);

  // Step 10: cross-series transfer statistic on the real (unshuffled) holdout series.
  const perSeriesGain = vocabStatPerSeries(holdoutSeries, vocabulary, referenceBaseline, holdoutWarmup, "real");
  const aggregate_transfer_gain = meanOf(perSeriesGain);

  // Reference scale for the effect-size floor: the reference baseline's own
  // mean loss across the holdout series (never a hand-set absolute number).
  const referenceLosses = holdoutSeries.map((series, i) => referenceGain(series, vocabulary[0].canonical_program, referenceBaseline, holdoutWarmup, `scale:${i}`).referenceLoss);
  const reference_scale = meanOf(referenceLosses);

  // Cross-series permutation null: shuffle each holdout series (destroying its
  // temporal order) and re-select the argmax member fresh each iteration — the
  // real-data winner is never fixed into the null, which would leak.
  const rng = createSeededRng(canonicalHashSync({ holdoutIds, vocabularyKeys: vocabulary.map((v) => v.program_key), purpose: "calculus-transfer-null" }));
  const nullSamples = [];
  for (let i = 0; i < shuffles; i += 1) {
    const shuffledHoldout = holdoutSeries.map((series) => seededShuffle(series, rng));
    nullSamples.push(meanOf(vocabStatPerSeries(shuffledHoldout, vocabulary, referenceBaseline, holdoutWarmup, `null:${i}`)));
  }
  const transfer_null = deriveNull({
    nullSamples,
    observedStatistic: aggregate_transfer_gain,
    tailDirection: "greater",
    quantile,
    protocol: { name: "cross-series-shuffle", iterations: shuffles, statistic: "mean best-of-vocabulary competency gain", scope: "temporal-order-per-holdout-series" },
  });
  if (!transfer_null.passed) return null;

  // Relative effect-size floor (same idiom as ../kinds, added for the same
  // reason): the permutation null answers "distinguishable from chance," not
  // "big enough to matter."
  const relative_effect = reference_scale > 0 ? aggregate_transfer_gain / reference_scale : 0;
  if (relative_effect < minRelativeEffect) return null;

  // Diagnostic-only: same statistic against every promoted operator (not just
  // support-qualified ones), for auditability — never gates promotion.
  const uncompressedPool = allGroups.map((g) => ({ canonical_program: g.canonical_program }));
  const vs_uncompressed_pool = uncompressedPool.length
    ? { aggregate_transfer_gain: meanOf(vocabStatPerSeries(holdoutSeries, uncompressedPool, referenceBaseline, holdoutWarmup, "pool")) }
    : null;

  // A vocabulary member's canonical_program may itself contain `opref` nodes
  // referencing an operator promoted DURING that member's own per-series
  // induction (the REC->INS re-entry inside ../operators). Walk each member's
  // program tree and classify every such reference: internal if it points at
  // another vocabulary member (the dependency_graph §16.4 wants), external
  // (an "imported primitive," section 16.2 item 1) if it points at an operator
  // that never met the support threshold. Left empty only when no member
  // genuinely has such a reference — never a placeholder.
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

  // Computed once, reused both for the record's vocabulary field and for
  // step 9's "beats best member" bar below.
  const vocabularyWithTransfer = vocabulary.map((v, i) => {
    const per_series = holdoutIds.map((id, j) => ({ series_id: id, gain: referenceGain(holdoutSeries[j], v.canonical_program, referenceBaseline, holdoutWarmup, `member:${i}:${j}`).gain }));
    return { ...v, holdout_transfer: { per_series, mean_gain: meanOf(per_series.map((p) => p.gain)) } };
  });
  const bestMemberGain = Math.max(...vocabularyWithTransfer.map((v) => v.holdout_transfer.mean_gain));

  // Step 9 (opt-in): compose NEW cross-vocabulary programs and gate each
  // through the same transfer-null/effect-size machinery as the vocabulary
  // itself, plus the "beats the best member" bar — see the module header for
  // the empirical finding behind why this is honestly expected to stay empty
  // for a vocabulary of already-individually-competent members.
  const proposed_extensions = composeExtensions
    ? induceExtensions({
        vocabulary: vocabularyWithTransfer,
        bestMemberGain,
        holdoutSeries,
        holdoutIds,
        referenceBaseline,
        holdoutWarmup,
        shuffles,
        quantile,
        minRelativeEffect,
        extensionMaxPrograms,
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
    split: { seed_purpose: "calculus-family-split", propose_fraction: proposeFraction, propose_count: propose.length, holdout_count: holdout.length },
    min_support_fraction: minSupportFraction,
    reference_baseline_id: referenceBaselineId,
    aggregate_transfer_gain,
    reference_scale,
    relative_effect,
    transfer_null,
    vs_uncompressed_pool,
    vs_foil_bundle: null, // optional secondary diagnostic; not computed in v1
    lens: { target_type: "number", horizon: { kind: "walk-forward", h: 1 }, scoring_rule: "crps", baseline_ids: baselines.map((b) => b.id), population },
    novelty_status: "candidate_novel",
    status: "experimental",
    emergence: { operator_epoch: CURRENT_OPERATOR_EPOCH, synthesized_by: "SYN", validated_by: "EVA", member_count: vocabulary.length },
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, id: `calculus:${content_hash}`, content_hash });
}

// Exported for direct unit testing of the promotion mechanics in isolation
// (matching ../operators' behavioralFingerprint precedent) — real vocabularies
// built by induceCalculus itself are provably unlikely to ever exercise the
// success path, per the module header, so the gating logic needs coverage
// that does not depend on a realistic induceOperators-derived fixture.
export { induceExtensions };
