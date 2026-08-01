// motivation/gaps.test.js — gap-navigation system.
//
// Tests that gaps are enumerable, navigable, and severity-graded by reader
// orientation. The key invariants:
//
// 1. A structural gap (missing coref prior) is always severe.
// 2. A truth-seeking reader sees MORE gaps (tierDemand gaps) than a neutral reader.
// 3. Every navigable gap has at least one action.
// 4. unresolvedClaims triages entries by resolution + tier demand.
// 5. gapSummary provides correct statistics.
// 6. The tierDemand gap is the architectural truth-seeking gap: ENGINE-resolved
//    but reader demands MODEL.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  navigableGap,
  navigableGaps,
  gapSeverity,
  gapActions,
  unresolvedClaims,
  gapSummary,
} from "./gaps.js";
import { createReaderOrientation } from "./index.js";

// ── navigableGap ─────────────────────────────────────────────────────────────

test("structural gap (descriptor_aliases_unresolved) is always severe", () => {
  const gap = navigableGap({
    reason: "descriptor_aliases_unresolved",
    referent: "creature",
    tier: "model",
    needsWitness: true,
  });
  assert(gap.structural, "missing coref prior is a structural gap");
  assert(gap.needsExternal, "needs external witness data");
  assert(gap.severity > 0.7, `structural gap should be severe, got ${gap.severity}`);
  assert(gap.actions.length > 0, "every gap must have at least one action");
});

test("scoped gap (surface_scope_unresolved) is moderate severity", () => {
  const gap = navigableGap({
    reason: "surface_scope_unresolved",
    surface: "the monster",
    unresolved: [],
  });
  assert(gap.structural);
  assert(!gap.needsExternal, "scoped resolution is a local probe, not external");
  assert(gap.severity > 0.3 && gap.severity < 0.9, `scoped gap severity ${gap.severity}`);
});

test("tier_demand_not_met is reader-driven, severity scales with demand", () => {
  const neutral = navigableGap({
    reason: "tier_demand_not_met",
    readerDriven: true,
  }, createReaderOrientation());

  const ts = createReaderOrientation();
  ts.tierDemand = 1.0;
  const truthSeeker = navigableGap({
    reason: "tier_demand_not_met",
    readerDriven: true,
  }, ts);

  assert(!neutral.structural, "tier demand gap is reader-driven, not structural");
  assert(truthSeeker.severity > neutral.severity,
    `truth-seeker should find tier gaps more severe: ${truthSeeker.severity} > ${neutral.severity}`);
});

test("every known gap type produces at least one action", () => {
  const gapTypes = [
    "descriptor_aliases_unresolved",
    "surface_scope_unresolved",
    "narrator_span_unresolved",
    "tier_demand_not_met",
    "pronoun_semantic_unresolved",
    "model_tier_boundary",
    "presence_boundary_gap",
    "co_occurring_surface",
  ];
  const tsOrientation = createReaderOrientation();
  tsOrientation.tierDemand = 1.0;

  for (const reason of gapTypes) {
    const gap = navigableGap({ reason, tier: "model", needsWitness: false }, tsOrientation);
    assert(gap.actions.length > 0, `gap type "${reason}" must have actions`);
    assert(typeof gap.recommendedAction === "string",
      `gap type "${reason}" must have a recommended action`);
  }
});

test("unknown gap type defaults to seek_witness", () => {
  const gap = navigableGap({ reason: "some_future_gap_type", detail: "unknown" });
  assert.equal(gap.recommendedAction, "seek_witness");
  assert(gap.needsExternal);
});

// ── navigableGaps — entry set → gap set ──────────────────────────────────────

test("entries with gaps produce navigable gaps", () => {
  const entries = [
    {
      gaps: [{ reason: "descriptor_aliases_unresolved", referent: "creature" }],
      tier: "model",
    },
  ];
  const result = navigableGaps(entries);
  assert.equal(result.length, 1);
  assert.equal(result[0].reason, "descriptor_aliases_unresolved");
});

test("truth-seeking reader sees tierDemand gaps on ENGINE entries", () => {
  const tsOrientation = createReaderOrientation();
  tsOrientation.tierDemand = 0.9;

  const entries = [
    {
      tier: "engine",
      grounded: true,
      provenance: ["source"],
      resolution: "name-alias",
    },
  ];
  const neutralGaps = navigableGaps(entries); // neutral orientation
  const truthGaps = navigableGaps(entries, tsOrientation);

  assert(neutralGaps.length < truthGaps.length,
    `truth-seeker should see MORE gaps: ${truthGaps.length} vs ${neutralGaps.length}`);
  assert(truthGaps.some((g) => g.reason === "tier_demand_not_met"),
    "truth-seeker gaps should include tier_demand_not_met");
});

test("neutral reader does not see tierDemand gaps", () => {
  const entries = [
    { tier: "engine", grounded: true, provenance: ["source"], resolution: "structural" },
    { tier: "model", needsWitness: true },
  ];
  const result = navigableGaps(entries);
  // Only the MODEL-tier entry should produce a gap
  assert(result.every((g) => g.reason !== "tier_demand_not_met"),
    "neutral reader should not see tierDemand gaps");
});

// ── gapSeverity ──────────────────────────────────────────────────────────────

test("descriptor_aliases_unresolved severity >= 0.8", () => {
  assert(gapSeverity({ reason: "descriptor_aliases_unresolved" }) >= 0.8);
});

test("pronoun_semantic_unresolved severity >= 0.8", () => {
  assert(gapSeverity({ reason: "pronoun_semantic_unresolved" }) >= 0.8);
});

test("tier_demand_not_met severity is 0 for demand=0.5", () => {
  const neutral = createReaderOrientation();
  neutral.tierDemand = 0.5;
  assert.equal(gapSeverity({ reason: "tier_demand_not_met" }, neutral), 0.0);
});

test("tier_demand_not_met severity is 1 for demand=1.0", () => {
  const ts = createReaderOrientation();
  ts.tierDemand = 1.0;
  assert.equal(gapSeverity({ reason: "tier_demand_not_met" }, ts), 1.0);
});

test("structural gaps severity increases with demand", () => {
  const lo = createReaderOrientation();
  lo.tierDemand = 0.5;
  const hi = createReaderOrientation();
  hi.tierDemand = 1.0;
  assert(gapSeverity({ reason: "descriptor_aliases_unresolved" }, hi) >
         gapSeverity({ reason: "descriptor_aliases_unresolved" }, lo));
});

// ── gapActions ───────────────────────────────────────────────────────────────

test("descriptor_aliases_unresolved → seek_witness action", () => {
  const actions = gapActions({ reason: "descriptor_aliases_unresolved", needsWitness: true });
  assert(actions.some((a) => a.action === "seek_witness"));
  assert(actions.some((a) => a.action === "defer"), "defer is always available");
});

test("surface_scope_unresolved → probe action", () => {
  const actions = gapActions({ reason: "surface_scope_unresolved" });
  assert(actions.some((a) => a.action === "probe"));
});

test("defer is always available as last resort", () => {
  const allTypes = [
    "descriptor_aliases_unresolved",
    "pronoun_semantic_unresolved",
    "tier_demand_not_met",
    "presence_boundary_gap",
  ];
  for (const reason of allTypes) {
    const actions = gapActions({ reason });
    assert(actions.some((a) => a.action === "defer"),
      `gap type "${reason}" must include defer`);
  }
});

test("seek_witness cost is 'necessary' for truth-seeker", () => {
  const tsOrientation = createReaderOrientation();
  tsOrientation.tierDemand = 1.0;
  const actions = gapActions({ reason: "descriptor_aliases_unresolved", needsWitness: true }, tsOrientation);
  const sw = actions.find((a) => a.action === "seek_witness");
  assert.equal(sw.cost, "necessary");
});

test("accept_engine cost is 'surrender' for truth-seeker", () => {
  const tsOrientation = createReaderOrientation();
  tsOrientation.tierDemand = 1.0;
  const actions = gapActions({ reason: "tier_demand_not_met" }, tsOrientation);
  const accept = actions.find((a) => a.action === "accept_engine");
  assert(accept, "accept_engine should be available for tier_demand_not_met");
  assert.equal(accept.cost, "surrender");
});

// ── unresolvedClaims — triage ────────────────────────────────────────────────

test("entries with gaps go to unresolved", () => {
  const entries = [
    { isGap: true, gaps: [{ reason: "descriptor_aliases_unresolved" }] },
    { grounded: true, provenance: ["source"], tier: "engine" },
  ];
  const result = unresolvedClaims(entries);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.resolved.length, 1);
});

test("ENGINE entries become unverifiable for truth-seeker", () => {
  const tsOrientation = createReaderOrientation();
  tsOrientation.tierDemand = 0.9;

  const entries = [
    { tier: "engine", grounded: true, provenance: ["source"], resolution: "name-alias" },
    { isGap: true, gaps: [{ reason: "descriptor_aliases_unresolved" }] },
  ];
  const result = unresolvedClaims(entries, tsOrientation);
  assert.equal(result.unverifiable.length, 1, "ENGINE-resolved entry should be unverifiable");
  assert(result.unverifiable[0].tierDemandGap);
});

test("neutral reader has no unverifiable entries", () => {
  const entries = [
    { tier: "engine", grounded: true, provenance: ["source"] },
    { tier: "model", needsWitness: true },
  ];
  const result = unresolvedClaims(entries);
  assert.equal(result.unverifiable.length, 0);
  assert.equal(result.resolved.length, 1);
});

// ── gapSummary ───────────────────────────────────────────────────────────────

test("gapSummary aggregates correctly", () => {
  const gaps = [
    navigableGap({ reason: "descriptor_aliases_unresolved" }),
    navigableGap({ reason: "tier_demand_not_met", readerDriven: true }),
    navigableGap({ reason: "presence_boundary_gap" }),
  ];
  const s = gapSummary(gaps);
  assert.equal(s.total, 3);
  assert.equal(s.structural, 2);
  assert.equal(s.readerDriven, 1);
  assert(s.meanSeverity > 0);
  // Both descriptor_aliases_unresolved and tier_demand_not_met have
  // defaultAction "seek_witness" → needsExternal: true
  assert.equal(s.needsExternal, 2);
  assert(s.blocking >= 1); // descriptor_aliases_unresolved is blocking
});

test("empty gap set → zero summary", () => {
  const s = gapSummary([]);
  assert.equal(s.total, 0);
  assert.equal(s.meanSeverity, 0);
  assert.equal(s.blocking, 0);
});

// ── Invariants ───────────────────────────────────────────────────────────────

test("INVARIANT: a gap with no witness-channel data cannot be resolved by more reading", () => {
  const gap = navigableGap({
    reason: "descriptor_aliases_unresolved",
    referent: "creature",
    tier: "model",
    needsWitness: true,
  });
  assert(gap.needsExternal,
    "emanon alias resolution requires witness data — more text cannot help");
});

test("INVARIANT: tierDemand gap IS the architectural truth-seeking impulse", () => {
  // A reader with tierDemand = 1.0 sees ENGINE-resolved entries as
  // unverifiable. This is not a bug — the reader's demand for MODEL-tier
  // evidence turns every ENGINE-resolution into a gap. The gap IS the
  // truth-seeking: the reader refuses second-hand authority.
  const tsOrientation = createReaderOrientation();
  tsOrientation.tierDemand = 1.0;

  const entries = [
    { tier: "engine", grounded: true, provenance: ["source"], resolution: "name-alias" },
  ];
  const result = unresolvedClaims(entries, tsOrientation);
  assert.equal(result.unverifiable.length, 1);
  assert.equal(result.resolved.length, 0,
    "truth-seeker resolves nothing at ENGINE tier — everything is unverifiable");
});

test("INVARIANT: severity never exceeds 1.0 and never below 0", () => {
  const allTypes = [
    "descriptor_aliases_unresolved", "surface_scope_unresolved",
    "narrator_span_unresolved", "tier_demand_not_met",
    "pronoun_semantic_unresolved", "model_tier_boundary",
    "presence_boundary_gap", "co_occurring_surface",
  ];
  for (const reason of allTypes) {
    const ts = createReaderOrientation();
    ts.tierDemand = 1.0;
    const sev = gapSeverity({ reason }, ts);
    assert(sev >= 0 && sev <= 1, `severity for "${reason}" should be [0,1], got ${sev}`);
  }
});
