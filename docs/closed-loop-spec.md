# Closed-Loop Specification

Every item below is the same shape: **close the loop so consequence returns to the decider.** Externality, capture, frozen priors, fake walls, forced convergence, counterfeit joy are all one failure — a loop that doesn't close, a consequence with no path home.

---

## 1. READER-PRIORS: learn locally, not by fiat

**Module:** `packages/engine/emergence/reader-priors/index.js` (line 160–201)

**Problem:** `priorConfidenceBoost` uses six hardcoded constants (0.2, 0.1, 0.1, 0.05, 0.05, cap 0.3) — a frozen prior imposed from one center. This is monocentric governance failure. The reader's actual reading history (reaction log, orientation trajectory, resonance events) carries more signal than any preset constant and is completely unused.

**Fix:** Replace the magic constants with nulls-over-reader-history:
- `familiarity * 0.2` → `familiarity * derivedWeight` where `derivedWeight` is read from the reader's actual confidence calibration (how often assertions at this familiarity level were correct against subsequent evidence)
- `frame.get * 0.1` → `frame.get * frameCalibration` where `frameCalibration` decays toward the reader's observed frame-use frequency
- Hard cap `0.3` → soft ceiling derived from the reader's actual max boost over N previous assertions
- Each constant replaced by a null (no prior belief) until the reader's history provides evidence, then asymptotically approaches the observed value

**Test:** `packages/engine/emergence/reader-priors/reader-priors.test.js` — does not exist. Create it with:
1. Fresh reader (no history) → all boosts start at 0 (null prior)
2. Reader with 50 assertions at high familiarity → boost converges toward observed calibration
3. Reader with contradictory history → boost softens toward midpoint (evidence of unreliability)
4. Frame calibration: reader who uses Marxist frame 80% of the time gets higher boost for Marxist assertions

---

## 2. REAL WALLS: lenses as walled-off computation, not string labels

**Modules:** `packages/engine/projection/`, `packages/engine/quantum/`, lens threading through fold

**Problem:** Lenses currently individuate by string (`lens_id`, `frame` labels threaded through projection). This is pretense-of-separation — the walls are asserted in comments and specs, not erected in execution. A system that performs many perspectives while secretly computing one launders a monoculture as a marketplace, which is worse than one honest lens.

**Fix:**
- Each lens must carry a content-addressed state root — a hash of its full computation history (discourse state head, store head, reaction log head) that proves it was computed independently
- `lens_id` becomes a content address, not a label string
- Cross-lens agreement is only counted as convergence if the two lenses' state roots differ (proving they were computed from genuinely different starting states)
- The projection module must verify state-root independence before accepting a cross-lens witness event

**Test:** Verify that two lenses with identical state roots do NOT produce a convergence event (they're the same lens in disguise).

---

## 3. UNFORCED CONVERGENCE: witness-only, never optimizer-facing

**Modules:** `packages/engine/discourse/resonance.js` (`ConvergenceWitness`), `packages/engine/social/witness-exchange.js` (`CrossEngineWitness`)

**Problem:** The ConvergenceWitness exists (built in this session) but convergence scores are not yet firewalled from optimization. If `convergence_rate` ever feeds a gradient or a ranking, the independence that makes convergence meaningful is corrupted — optimizing for agreement produces manufactured agreement.

**Fix:**
- `ConvergenceWitness.witness()` and `CrossEngineWitness.witness()` must be marked `@audit-surface-only` in their JSDoc
- A conformance test must verify that no convergence summary field reaches any optimizer input path (no convergence feeds `multiAltitudeFold` ranking, no convergence feeds `computeMotivationField`, no convergence feeds `spine` scoring)
- The convergence witness output may only appear in the `ananda` witness annotation on spans (post-selection), in the consensus report (post-hoc), and in CharterEvents (governance audit)
- Add `conformance/invariants/convergence-firewall.test.js`

---

## 4. PROVENANCE OF CONSEQUENCE: no referent sheds what it damages

**Problem:** The engine tracks provenance of claims (every span carries `offset`, `verified`, `raw`) but not provenance of consequences. A fold that omits an entity at a key passage produces downstream gaps with no link back to the fold that caused them. This is an externality: the cost (missing entity) lands on the gap report with no event connecting it to its cause.

**Fix:**
- Every gap in a fold packet must carry a `caused_by` field: which module/decision produced the gap (admission failure? frame boundary? missing prior?), with a content address pointing to the causal event
- `gaps` in the packet become traceable through the same provenance chain as `spans`
- The `entityPresent` field already on spans allows this — extend to record WHY `entityPresent` is false: `{ reason: "frame_boundary_gap" | "missing_prior" | "emanon_no_alias", caused_by: event_id }`

---

## 5. RULE-MAKING CENTERS = RULE-BEARING CENTERS (anti-capture)

**Modules:** `packages/engine/social/commons.js`, `packages/engine/emergence/reader-priors/index.js`

**Problem:** In the CommonsCharter, rules can be changed by any member via `changeRule()`. But the member who changes the rule may not be the one who bears its consequences. This is the governance equivalent of the externalized cost — the decider and the bearer are decoupled. At the reader-priors level, the frozen constants are the same failure: a single frozen center (the module author) sets belief parameters for every reader.

**Fix:**
- `changeRule()` must record which members would be affected by the rule change (derived from `memberState`) AND which members voted for it
- Rule changes that disproportionately affect members who didn't vote for them produce a `violation_observed` of type `regulatory_capture`
- At the reader-priors level: replace `priorConfidenceBoost`'s global constants with per-reader calibration derived from that reader's own history (see item 1)

---

## 6. JOY AS FLOURISHING-THROUGH-COMMONS, never as KPI

**Modules:** `packages/engine/discourse/resonance.js`, `packages/engine/emergence/summary/multi-altitude-fold.js` (ananda witness), `packages/engine/emergence/store/index.js` (spontaneousSurface)

**Problem:** Joy is currently witnessed (ananda annotation on spans, resonance events in discourse) but there is no firewall preventing joy scores from being fed to an optimizer. If a model were trained to maximize `joy_score`, it would produce counterfeit joy — the wireheader in the dark room by another door.

**Fix:**
- All joy-producing functions (`computeResonanceScore`, `mintResonanceEvent`, `isSavoredSurprise`, `spontaneousSurface`) must be documented as `@audit-surface-only`
- Conformance test: verify no joy score enters the relevance ranking path in `multiAltitudeFold` (the ananda witness layer must be strictly post-selection)
- `ConvergenceWitness` firewall (item 3) covers this as well
- The `ananda` field on spans must be documented as "witnessed, not ranked" — it is read by humans and governance events, never by the engine's own optimization

---

## First concrete task

**Replace `priorConfidenceBoost` constants with nulls-over-reader-history and add `reader-priors.test.js`.** This is the highest compliance-gained-per-unit-work. It brings the interpretive layer (reader priors) under the same law the perceptual layer (presence, store, fold) already holds: parameters derived from observation, not asserted by fiat.

### Task breakdown:

1. Add `readerHistory` parameter to `priorConfidenceBoost(prior, assertion, readerHistory)` — an object with:
   - `assertionCount` — total assertions made by this reader
   - `familiarityCalibration` — observed boost for assertions at this familiarity level
   - `frameUsageFrequency` — Map<frameId, fractionOfAssertions>
   - `maxObservedBoost` — highest boost ever validated in this reader's history

2. Replace each constant with a derived value:
   - `0.2` → `readerHistory.familiarityCalibration ?? 0` (null → 0, no prior belief)
   - `0.1` (frame) → `readerHistory.frameUsageFrequency.get(frame) ?? 0`
   - `0.1` (experience) → same pattern
   - `0.05` (structural, channel) → scaled by observed reliability
   - `0.3` (cap) → `Math.min(readerHistory.maxObservedBoost ?? 0.3, derived)`

3. Add `reader-priors.test.js`:
   - Fresh reader: all boosts are 0
   - Reader with established history: boosts reflect observed calibration
   - Contradictory history: boosts soften toward midpoint
   - Frame calibration tracks actual usage

4. Update `lens-assertion/index.js` to pass reader history through to `priorConfidenceBoost`

---

## The through-line

Every item in this spec is one shape: a loop that currently doesn't close, a consequence with no path back to its source. The fix is always the same — thread provenance through the gap, make the decider bear the consequence, let the reader's own history determine what they can trust. No new architecture. The existing provenance machinery pointed at the costs it currently lets escape.
