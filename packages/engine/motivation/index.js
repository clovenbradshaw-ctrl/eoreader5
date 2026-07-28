// motivation/index.js — Reader drives and orientation.
//
// An engine can only compute identity and provenance from text. Salience —
// what matters — is reader-dependent and computable from no text at all
// (reaction/index.js header, three independent failed attempts). This module
// is the engine's model of the reader: not what the reader claims to be, but
// what their observed behaviour reveals.
//
// A reader who probes, verifies, demands witnesses, and faces gaps is a
// truth-seeker. A reader who dwells long, re-reads, follows figures through
// the narrative is a completion-seeker. A reader who scrubs, skips, and
// abandons rapidly is a novelty-seeker. These are not labels; they are the
// weights on the cube's axes that bias every organ downstream.
//
// The orientation is deterministic given the reaction log. The engine has no
// clock and reads no ambient state; everything here is a pure function of the
// log and the entry being evaluated.
//
// TIER DEMAND — the architectural move that makes truth-seeking inevitable:
//   A reader orientation carries `tierDemand`, the minimum resolution tier
//   the reader will accept. A truth-seeker demands MODEL-tier evidence
//   (needsWitness === true); ENGINE-tier structural resolution is
//   insufficient. This is the engine honouring the reader's demand for
//   direct experience, not second-hand authority.
//
//   tierDemand is not a toggle. It is a weight in [0, 1] that biases the
//   tier boundary: at 0.0 the reader accepts ENGINE-tier, at 1.0 the reader
//   demands MODEL-tier witnesses for everything that crosses the boundary.
//   The engine reports gaps for anything below the demand, turning "this is
//   structurally resolved" into "this is structurally resolved but the
//   reader demands a witness." The gap IS the truth-seeking.

// ── Drive types ───────────────────────────────────────────────────────────────

const DRIVE_IDS = ["seek_truth", "seek_completion", "seek_novelty"];

// Truth-seeking reaction kinds — the reader is actively probing, verifying,
// demanding witnesses, and confronting gaps rather than passively consuming.
const TRUTH_KINDS = new Set([
  "probe", "verify", "demand_witness", "face_gap",
]);

// Completion-seeking — deep engagement, dwelling, re-reading, following.
const COMPLETION_KINDS = new Set([
  "dwell", "reread", "follow-figure", "decollapse",
]);

// Novelty-seeking — rapid exploration, skipping, scrubbing.
const NOVELTY_KINDS = new Set([
  "skip", "scrub", "abandon",
]);

// Disengagement counts NEGATIVELY toward completion (a reader who dwells on
// one passage and abandons ten is not a completion-seeker). Neutral reactions
// (query, span-select) are informative but don't strongly signal any drive.
const DISENGAGEMENT_KINDS = new Set([
  "skip", "abandon",
]);

// ── ReaderOrientation ─────────────────────────────────────────────────────────

/**
 * createReaderOrientation() -> ReaderOrientation
 *
 * Fresh orientation: neutral on all drives. Every reader starts here until
 * their reaction log reveals what they actually care about.
 */
export function createReaderOrientation() {
  return {
    schema: "ReaderOrientation@1",
    drive: Object.freeze({ seek_truth: 0.5, seek_completion: 0.5, seek_novelty: 0.5 }),
    // The tier the reader demands. At 0 the reader accepts ENGINE-tier
    // structural resolution; at 1 the reader demands MODEL-tier witness
    // evidence for every claim that crosses the boundary.
    tierDemand: 0.5,
    // How many truth-seeking reactions have been observed (denominator
    // for deriving orientation from log).
    evidence: { total_reactions: 0, truth_reactions: 0, completion_reactions: 0, novelty_reactions: 0 },
    lastUpdatedAt: null,
  };
}

/**
 * readerOrientationFromLog(log) -> ReaderOrientation
 *
 * Derive a reader's motivational orientation from their accumulated reaction
 * log. The engine does not INFER the reader's intent — it reads their observed
 * behaviour. A reader who probes, verifies, and demands witnesses IS a
 * truth-seeker, regardless of what they claim.
 *
 * The orientation is deterministic: the same log always produces the same
 * orientation, so replay is byte-identical.
 *
 * Evidence accumulates: more reactions = stronger signal. A reader with 3
 * reactions is less confidently profiled than one with 300.
 */
export function readerOrientationFromLog(log) {
  const orientation = createReaderOrientation();
  const counts = {
    truth: 0, completion: 0, novelty: 0, disengagement: 0, total: 0,
  };

  for (const reaction of log.reactions) {
    counts.total++;
    let scored = false;
    if (TRUTH_KINDS.has(reaction.kind)) { counts.truth++; scored = true; }
    if (COMPLETION_KINDS.has(reaction.kind)) { counts.completion++; scored = true; }
    if (NOVELTY_KINDS.has(reaction.kind)) { counts.novelty++; scored = true; }
    if (DISENGAGEMENT_KINDS.has(reaction.kind)) { counts.disengagement++; }
    // query and span-select count toward engagement volume but are drive-neutral
  }

  orientation.evidence.total_reactions = counts.total;
  orientation.evidence.truth_reactions = counts.truth;
  orientation.evidence.completion_reactions = counts.completion;
  orientation.evidence.novelty_reactions = counts.novelty;

  // Completion is damped by disengagement — a reader who skips constantly
  // cannot have high completion drive, regardless of dwell time.
  const completionPenalty = counts.total > 0 ? counts.disengagement / counts.total : 0;

  if (counts.total > 0) {
    // Each drive is the proportion of relevant reactions among drive-signaling
    // reactions only. Neutral reactions (query, span-select) contribute to
    // confidence but NOT to proportions — a reader who only queries is not a
    // non-truth-seeker, they simply haven't revealed a drive yet.
    const driveTotal = counts.truth + counts.completion + counts.novelty;
    // More reactions → evidence moves away from neutral toward observed behaviour.
    const sigmoid = (x, n) => {
      // Smooth toward observed proportion as evidence accumulates. With 0
      // evidence, stay at neutral (0.5). With many reactions, approach the
      // observed proportion. Weight is asymptotically 1 - 1/(n+1).
      const weight = 1 - 1 / (n + 1);
      return 0.5 + weight * (x - 0.5);
    };

    // Proportions over drive-signaling reactions only (avoid diluting signal
    // with neutral reactions like query/span-select).
    const truthProp = driveTotal > 0 ? counts.truth / driveTotal : 0.5;
    const completionRaw = driveTotal > 0 ? counts.completion / driveTotal : 0.5;
    const completionProp = Math.max(0, completionRaw - completionPenalty * 0.5);
    const noveltyProp = driveTotal > 0 ? counts.novelty / driveTotal : 0.5;

    // Confidence weight: total is engagement volume; driveTotal is signal.
    // Use driveTotal for sigmoid weight so neutral reactions don't dilute
    // confidence, and total for the engagement count in evidence.
    orientation.drive = Object.freeze({
      seek_truth: clamp(sigmoid(truthProp, driveTotal), 0, 1),
      seek_completion: clamp(sigmoid(completionProp, driveTotal), 0, 1),
      seek_novelty: clamp(sigmoid(noveltyProp, driveTotal), 0, 1),
    });

    // tierDemand: a truth-seeker demands MODEL-tier witnesses. The demand is
    // the seek_truth drive directly — at 0.5 the reader is neutral ("ENGINE
    // is fine for now"), at 1.0 the reader demands witness evidence for
    // everything that crosses the tier boundary.
    orientation.tierDemand = clamp(orientation.drive.seek_truth, 0, 1);
  }

  orientation.lastUpdatedAt = counts.total;
  return orientation;
}

// ── Motivational bias ─────────────────────────────────────────────────────────

/**
 * motivationalBias(entry, orientation) -> { score, reason }
 *
 * How much this reader cares about an entry (a fold span, a surface, a gap),
 * given their orientation. Pure function: entry + orientation → bias.
 *
 * A truth-seeker biases toward:
 *   - Gaps and unresolved claims (model-tier gaps ARE the interesting part)
 *   - Passages with high uncertainty / low confidence
 *   - Claims where the tierDemand isn't met
 *
 * A completion-seeker biases toward:
 *   - Complete, grounded passages
 *   - High-confidence structural resolution
 *   - Full-span coverage (nothing left unread)
 *
 * A novelty-seeker biases toward:
 *   - High-surprise passages
 *   - Rapidly changing content
 *   - New entities/relations
 */
export function motivationalBias(entry, orientation) {
  const d = orientation?.drive ?? { seek_truth: 0.5, seek_completion: 0.5, seek_novelty: 0.5 };
  const reasons = [];
  let bias = 0;

  // Truth-seeking: care about gaps, uncertainty, and unresolved MODEL-tier claims.
  if (entry.isGap || entry.gaps?.length > 0) {
    const gapBonus = d.seek_truth;
    bias += gapBonus;
    reasons.push(`truth-seeker: gaps are interesting (+${gapBonus.toFixed(2)})`);
  }
  if (entry.needsWitness || entry.tier === "model") {
    const witnessBonus = d.seek_truth * 0.8;
    bias += witnessBonus;
    reasons.push(`truth-seeker: needs witness (+${witnessBonus.toFixed(2)})`);
  }
  if (entry.tierDemandGap) {
    // This entry is resolved at ENGINE tier but the reader demands MODEL tier.
    // This IS the architectural truth-seeking gap — the engine reports it
    // rather than silently accepting ENGINE resolution.
    const demandGapBonus = d.seek_truth * 1.2;
    bias += demandGapBonus;
    reasons.push(`truth-seeker: tier demand not met (+${demandGapBonus.toFixed(2)})`);
  }

  // Completion-seeking: care about grounded, complete passages.
  if (entry.grounded && !entry.isGap) {
    const completionBonus = d.seek_completion * 0.6;
    bias += completionBonus;
    reasons.push(`completion-seeker: grounded passage (+${completionBonus.toFixed(2)})`);
  }
  if (entry.provenance?.length > 0) {
    const provBonus = d.seek_completion * 0.4;
    bias += provBonus;
    reasons.push(`completion-seeker: provenance available (+${provBonus.toFixed(2)})`);
  }

  // Novelty-seeking: care about surprise, change, new entities.
  if (entry.surprise !== undefined && entry.surprise > 0.3) {
    const surpriseBonus = d.seek_novelty * entry.surprise;
    bias += surpriseBonus;
    reasons.push(`novelty-seeker: surprise (+${surpriseBonus.toFixed(2)})`);
  }
  if (entry.isNew || entry.firstSeen) {
    const noveltyBonus = d.seek_novelty * 0.5;
    bias += noveltyBonus;
    reasons.push(`novelty-seeker: new entity (+${noveltyBonus.toFixed(2)})`);
  }

  return {
    bias: clamp(bias, 0, 1),
    reasons,
    orientation: { ...d },
  };
}

/**
 * tierDemandGap(entry, orientation) -> { gap, severity }
 *
 * Check whether the reader's tier demand is met for this entry. If the entry
 * was resolved at ENGINE tier but the reader demands MODEL-tier evidence,
 * return a gap describing what's missing.
 */
export function tierDemandGap(entry, orientation) {
  const demand = orientation?.tierDemand ?? 0.5;
  if (demand <= 0.5) return null; // Reader is fine with ENGINE tier.

  const entryTier = entry.tier ?? (entry.needsWitness ? "model" : "engine");
  if (entryTier === "model" || entry.needsWitness) return null; // Already at MODEL tier.

  // The entry is structurally resolved but the reader demands a witness.
  const severity = (demand - 0.5) * 2; // 0-1, 0 at demand==0.5, 1 at demand==1.0
  return {
    reason: "tier_demand_not_met",
    detail: `resolved at ENGINE tier but reader demands MODEL-tier witness (tierDemand=${demand.toFixed(2)})`,
    severity,
    entry_tier: "engine",
    demanded_tier: "model",
    actionable: true,
    resolution: "provide per-text coref prior, witness-channel evidence, or reader prior",
  };
}

/**
 * drivesSummary(orientation) -> summary string
 *
 * Human-readable summary of the reader's motivational profile.
 */
export function drivesSummary(orientation) {
  const d = orientation?.drive ?? createReaderOrientation().drive;
  const dominant = DRIVE_IDS.reduce((a, b) => (d[a] > d[b] ? a : b), DRIVE_IDS[0]);
  const names = {
    seek_truth: "truth-seeking",
    seek_completion: "completion-seeking",
    seek_novelty: "novelty-seeking",
  };
  const tierLabel = orientation?.tierDemand != null
    ? ` (tierDemand=${orientation.tierDemand.toFixed(2)})`
    : "";
  return `${names[dominant]}${tierLabel}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
