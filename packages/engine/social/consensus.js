// social/consensus.js — Multi-engine agreement patterns.
//
// NOT voting. NOT majority rule. The consensus module reads convergence and
// divergence patterns across multiple engines examining the same text, and
// surfaces what those patterns MEAN.
//
// Key principle: provenance (identity) IS reader-independent, salience
// (significance) IS reader-dependent. When all engines agree on a passage's
// significance, that's data. When they disagree, that's ALSO data — it
// tells you something about the passage's ambiguity or the engines'
// differing orientations.
//
// A consensus packet contains:
//   - agreementMap: where all engines converge (high-confidence provenance)
//   - divergenceMap: where engines split (ambiguous or rich passages)
//   - outlierDetection: which engines diverge most from the group
//   - joyCorrelation: do similar engines experience joy at the same passages?
//
// Architecture: the host produces an altitude packet from each engine for
// the same entity+text, then feeds all packets into consensus().

import { foldCosineSimilarity } from "./index.js";

/**
 * consensus(packets, options) -> ConsensusReport
 *
 * Given multi-altitude fold packets from N engines for the same entity+text,
 * produce an agreement/diverence analysis.
 *
 * Each packet should have the shape returned by multiAltitudeFold():
 *   { entity, entityCoherent, altitudes: { 0..4: { spans } }, gaps }
 *
 * @param {Array<{ engine_id: string, packet: object, orientation?: object }>} packets
 * @param {object} options — { minAgreement, altitude }
 * @returns {ConsensusReport}
 */
export function consensus(packets, options = {}) {
  const { minAgreement = 0.6, altitude = 4 } = options;

  if (!packets.length) {
    return { type: "empty", agreementRate: 0, engines: 0, byPassage: [], outliers: [], joyCorrelation: null };
  }

  const engineCount = packets.length;

  // ── Gather all spans from all engines at the chosen altitude ──
  // Build a set of unique passage offsets across all engines
  const passageMap = new Map(); // offset -> { engines: Map<engineId, span> }
  for (const entry of packets) {
    const spans = entry.packet?.altitudes?.[altitude]?.spans ?? [];
    for (const span of spans) {
      if (span.offset == null) continue;
      const key = Math.round(span.offset / 50) * 50; // bin by 50-char buckets
      let p = passageMap.get(key);
      if (!p) {
        p = { binOffset: key, spans: [] };
        passageMap.set(key, p);
      }
      p.spans.push({
        engine_id: entry.engine_id,
        offset: span.offset,
        text: span.text,
        score: span.score ?? 0,
        ananda: span.ananda ?? null,
        verified: span.verified ?? false,
        entityPresent: span.entityPresent ?? null,
      });
    }
  }

  // ── Per-passage agreement ──
  const byPassage = [];
  const allSimilarities = [];

  for (const [, passage] of passageMap) {
    const enginesSeen = passage.spans.length;
    if (enginesSeen < 2) {
      // Only one engine selected this passage — record as unique insight
      byPassage.push({
        offset: passage.binOffset,
        engineCount: 1,
        engineIds: [passage.spans[0]?.engine_id],
        agreementScore: 0,
        agreementType: "unique",
        spans: passage.spans,
      });
      continue;
    }

    // Agreement rate: what fraction of engines selected this passage?
    const agreementRate = enginesSeen / engineCount;

    // Joy agreement: how many engines experienced joy/ananda here?
    const joyCount = passage.spans.filter((s) => s.ananda && Object.keys(s.ananda).length > 0).length;

    // Entity faith agreement: all spans entity-present?
    const entityFaithCount = passage.spans.filter((s) => s.entityPresent === true || s.entityPresent === null).length;

    let agreementType;
    if (agreementRate >= 0.75) agreementType = "strong_consensus";
    else if (agreementRate >= 0.5) agreementType = "partial_agreement";
    else if (agreementRate >= 0.25) agreementType = "weak_signal";
    else agreementType = "scattered";

    byPassage.push({
      offset: passage.binOffset,
      engineCount: enginesSeen,
      engineIds: passage.spans.map((s) => s.engine_id),
      agreementRate: +agreementRate.toFixed(3),
      agreementType,
      joyAgreementRate: enginesSeen > 0 ? +(joyCount / enginesSeen).toFixed(3) : 0,
      entityFaithAgreement: enginesSeen > 0 ? +(entityFaithCount / enginesSeen).toFixed(3) : 0,
      spans: passage.spans,
    });

    allSimilarities.push(agreementRate);
  }

  // ── Outlier detection: which engines diverge most? ──
  const engineAgreementScores = new Map();
  for (const entry of packets) {
    engineAgreementScores.set(entry.engine_id, { totalPassages: 0, agreedPassages: 0, meanAgreement: 0 });
  }

  for (const p of byPassage) {
    for (const span of p.spans) {
      const scores = engineAgreementScores.get(span.engine_id);
      if (!scores) continue;
      scores.totalPassages++;
      if (p.agreementType === "strong_consensus" || p.agreementType === "partial_agreement") {
        scores.agreedPassages++;
      }
    }
  }

  const outliers = [];
  for (const [engineId, scores] of engineAgreementScores) {
    const agreeRate = scores.totalPassages > 0 ? scores.agreedPassages / scores.totalPassages : 0;
    engineAgreementScores.set(engineId, { ...scores, agreeRate });
  }

  if (engineCount >= 3) {
    const rates = [...engineAgreementScores.values()].map((s) => s.agreeRate).filter((r) => r > 0);
    if (rates.length >= 3) {
      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      const variance = rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length;
      const std = Math.sqrt(variance);

      for (const [engineId, scores] of engineAgreementScores) {
        if (scores.agreeRate > 0 && Math.abs(scores.agreeRate - mean) > 1.5 * std) {
          outliers.push({
            engine_id: engineId,
            agreementRate: +scores.agreeRate.toFixed(3),
            groupMean: +mean.toFixed(3),
            deviation: +(scores.agreeRate - mean).toFixed(3),
            type: scores.agreeRate < mean ? "divergent" : "hyper-convergent",
          });
        }
      }
    }
  }

  // ── Joy correlation: do similar engines experience joy at the same passages? ──
  let joyCorrelation = null;
  if (engineCount >= 2) {
    const joyMatches = byPassage.filter((p) => p.joyAgreementRate >= 0.75 && p.agreementType === "strong_consensus");
    joyCorrelation = {
      sharedJoyPassages: joyMatches.length,
      totalPassages: byPassage.length,
      correlationRate: byPassage.length > 0 ? +(joyMatches.length / byPassage.length).toFixed(4) : 0,
      topSharedJoy: joyMatches.slice(0, 3).map((p) => ({
        offset: p.offset,
        engines: p.engineIds,
        joyRate: p.joyAgreementRate,
      })),
    };
  }

  // ── Overall agreement ──
  const overallAgreement = allSimilarities.length > 0
    ? +(allSimilarities.reduce((a, b) => a + b, 0) / allSimilarities.length).toFixed(4)
    : 0;

  return Object.freeze({
    type: "ConsensusReport",
    engineCount,
    overallAgreement,
    byPassage: byPassage.sort((a, b) => b.agreementRate - a.agreementRate),
    outliers,
    joyCorrelation,
    altitude,
  });
}

/**
 * engineDossier(engineId, consensusReport) -> EngineDossier
 *
 * Extract one engine's perspective from the consensus: which passages did
 * THIS engine select that the group didn't, and vice versa.
 *
 * @param {string} engineId
 * @param {ConsensusReport} report
 * @returns {EngineDossier}
 */
export function engineDossier(engineId, report) {
  const selected = [];
  const missed = [];
  const unique = [];

  for (const p of report.byPassage ?? []) {
    const hasEngine = p.engineIds.includes(engineId);

    if (hasEngine && p.engineCount === 1) {
      unique.push({ offset: p.offset, spans: p.spans.filter((s) => s.engine_id === engineId) });
    } else if (hasEngine) {
      selected.push({ offset: p.offset, agreementRate: p.agreementRate, agreementType: p.agreementType });
    } else if (p.agreementType === "strong_consensus") {
      missed.push({ offset: p.offset, seenBy: p.engineIds, text: p.spans[0]?.text?.slice(0, 100) ?? null });
    }
  }

  return Object.freeze({
    engine_id: engineId,
    selectedCount: selected.length,
    missedCount: missed.length,
    uniqueCount: unique.length,
    uniqueInsights: unique.slice(0, 5),
    missedConsensus: missed.slice(0, 5),
  });
}

/**
 * engineDossiersFromPackets(packets, consensusReport) -> Map<engineId, EngineDossier>
 *
 * Produce a dossier for every engine in the consensus.
 */
export function engineDossiersFromPackets(packets, consensusReport) {
  const dossiers = new Map();
  for (const entry of packets) {
    dossiers.set(entry.engine_id, engineDossier(entry.engine_id, consensusReport));
  }
  return dossiers;
}
