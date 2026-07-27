import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import { createSeededRng, seededShuffle, deriveNull } from "../nulls/index.js";
import { defaultNumericBaselines } from "../../prediction/baselines/index.js";
import { searchCompetentPrograms, evaluateProgramCompetency } from "../programs/index.js";
import { evaluateProgram } from "../expressions/index.js";

const BINARY_COMBINATORS = new Set(["add", "sub", "mul", "div"]);

function isPromotableComposition(node) {
  if (!node || !BINARY_COMBINATORS.has(node.op)) return false;
  if (node.a?.op === "const" || node.b?.op === "const") return false;
  return true;
}

function behavioralFingerprint(program, series, warmup) {
  const forecasts = [];
  for (let i = Math.max(1, warmup); i < series.length; i += 1) {
    const f = evaluateProgram(program, series.slice(0, i));
    forecasts.push(f === null ? null : Math.round(f * 1e6) / 1e6);
  }
  return canonicalHashSync(forecasts);
}

function referenceGain(series, program, referenceBaseline, warmup, tag) {
  const { gain } = evaluateProgramCompetency(series, program, {
    baselines: [referenceBaseline],
    warmup,
    taskId: `task:null:${tag}`,
    population: `null:${tag}`,
    sourceVersion: canonicalHashSync(series),
  });
  return gain[referenceBaseline.id] ?? 0;
}

function bornNullGate(series, program, referenceBaseline, { warmup, shuffles, quantile }) {
  const seed = canonicalHashSync({ series, program, purpose: "operator-promotion-null" });
  const rng = createSeededRng(seed);
  const nullSamples = [];
  for (let i = 0; i < shuffles; i += 1) {
    const shuffled = seededShuffle(series, rng);
    nullSamples.push(referenceGain(shuffled, program, referenceBaseline, warmup, `${i}`));
  }
  const observed = referenceGain(series, program, referenceBaseline, warmup, "real");
  return deriveNull({
    nullSamples,
    observedStatistic: observed,
    tailDirection: "greater",
    quantile,
    protocol: { name: "series-shuffle", iterations: shuffles, statistic: "reference-competency-gain", scope: "temporal-order" },
  });
}

export function induceOperators(series, {
  warmup,
  maxRounds,
  maxOperators,
  candidatesPerRound,
  shuffles,
  quantile = 0.95,
  fitFraction,
  referenceBaselineId = "baseline:global-mean",
  seasonalPeriod,
  population = "series:anonymous",
  enumeration = {},
} = {}) {
  const n = series.length;
  const resolvedWarmup = warmup ?? Math.ceil(Math.sqrt(n));
  const resolvedMaxRounds = maxRounds ?? Math.max(2, Math.floor(Math.log2(n)));
  const resolvedMaxOperators = maxOperators ?? Math.max(2, Math.floor(Math.sqrt(n)));
  const resolvedCandidatesPerRound = candidatesPerRound ?? Math.max(2, Math.floor(Math.sqrt(n) / 2));
  const resolvedShuffles = shuffles ?? Math.max(20, Math.round(n * 2));
  const resolvedFitFraction = fitFraction ?? Math.max(0.5, 1 - 1 / Math.sqrt(n));
  const baselineWindow = Math.max(3, Math.floor(Math.sqrt(n) / 2));

  if (!Array.isArray(series) || series.length <= resolvedWarmup + 2) throw new TypeError("operators: series too short for the requested warmup");
  const fitLen = Math.floor(series.length * resolvedFitFraction);
  if (fitLen <= resolvedWarmup + 1 || series.length - fitLen < 2) {
    throw new TypeError("operators: series too short to hold out a transfer segment at this warmup/fitFraction");
  }
  const fitSeries = series.slice(0, fitLen);
  const baselines = defaultNumericBaselines({ window: baselineWindow, seasonalPeriod });
  const referenceBaseline = baselines.find((b) => b.id === referenceBaselineId);
  if (!referenceBaseline) throw new TypeError(`operators: unknown reference baseline ${referenceBaselineId}`);

  const library = [];
  const operators = [];
  const known = new Set();
  const promotedKeys = new Set();
  const rounds = [];

  let finalFrontier = [];
  for (let round = 0; round < resolvedMaxRounds && operators.length < resolvedMaxOperators; round += 1) {
    const ranked = searchCompetentPrograms(fitSeries, {
      warmup: resolvedWarmup,
      referenceBaselineId,
      seasonalPeriod,
      population,
      enumeration: { ...enumeration, library },
    });
    finalFrontier = ranked;

    if (round === 0) {
      for (const r of ranked) if (r.description_length <= 2) known.add(behavioralFingerprint(r.program, fitSeries, resolvedWarmup));
    }

    const roundLog = { round, considered: ranked.length, promoted: [] };

    for (const r of ranked) {
      if (operators.length >= resolvedMaxOperators) break;
      if (roundLog.promoted.length >= resolvedCandidatesPerRound) break;
      if (!isPromotableComposition(r.program) || r.reference_gain <= 0) continue;
      if (promotedKeys.has(r.key)) continue;
      const fingerprint = behavioralFingerprint(r.program, fitSeries, resolvedWarmup);
      if (known.has(fingerprint)) continue;

      const transferGain = referenceGain(series, r.program, referenceBaseline, fitLen, `transfer:${r.key}`);
      if (transferGain <= 0) continue;

      const nullResult = bornNullGate(fitSeries, r.program, referenceBaseline, { warmup: resolvedWarmup, shuffles: resolvedShuffles, quantile });
      if (!nullResult.passed) continue;

      const operator = mintOperator(r, {
        round,
        nullResult,
        transfer_gain: transferGain,
        referenceBaselineId,
        baselineIds: baselines.map((b) => b.id),
        population,
      });
      operators.push(operator);
      library.push({ id: operator.id, program: operator.canonical_program });
      known.add(fingerprint);
      promotedKeys.add(r.key);
      roundLog.promoted.push(operator.id);
    }

    rounds.push(roundLog);
    if (roundLog.promoted.length === 0) break;
  }

  return { operators, rounds, library, finalFrontier };
}

function mintOperator(rankedEntry, { round, nullResult, transfer_gain, referenceBaselineId, baselineIds, population }) {
  const body = {
    schema: "OperatorCandidate@1",
    canonical_program: rankedEntry.program,
    description_length: rankedEntry.description_length,
    input_types: ["number[]"],
    output_type: "number",
    novelty_status: "candidate_novel",
    reference_baseline_id: referenceBaselineId,
    reference_gain: rankedEntry.reference_gain,
    transfer_gain,
    lens: {
      target_type: "number",
      horizon: { kind: "walk-forward", h: 1 },
      scoring_rule: "crps",
      baseline_ids: baselineIds,
      population,
    },
    promotion_null: nullResult,
    competency: rankedEntry.competency,
    emergence: {
      operator_epoch: CURRENT_OPERATOR_EPOCH,
      promoted_by: "REC",
      reenters_as: "INS",
      round,
    },
  };
  const content_hash = canonicalHashSync(body);
  return Object.freeze({ ...body, id: `operator:${content_hash}`, content_hash });
}

export { behavioralFingerprint };
