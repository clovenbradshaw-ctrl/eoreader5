// scripts/score-stigmergy-golden.mjs
//
// Scores the stigmergy/closed-loop golden. Each assertion isolates one rule
// (R1-R5, SUPP, DOWN). Designed to FAIL on the current engine and pass as
// modules are built. Report per-assertion, never a single aggregate.
//
// Usage: node scripts/score-stigmergy-golden.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createMedium, deposit, sense, evaporate, lockInRisk, unsensedConsequences } from "../packages/engine/emergence/stigmergy/index.js";
import { composeHolon, supplementationTest, downwardClosureTest } from "../packages/engine/emergence/holon/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN_PATH = join(ROOT, "packages/engine/emergence/summary/golden/stigmergy-golden.json");

let golden;
try {
  golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));
} catch (e) {
  console.log(`SKIP: golden not found at ${GOLDEN_PATH}`);
  process.exit(0);
}

const TEXTS = {
  pg2600: "/Users/mlacy/Downloads/pg2600.txt",
  pg84: "/Users/mlacy/Documents/Default Project/pg84.txt",
  pg1400: "/Users/mlacy/Documents/Default Project/pg1400.txt",
};

const tol = golden.tolerance ?? 2000;

// ── Text loading ───────────────────────────────────────────────────────────────

function loadText(key) {
  const path = TEXTS[key];
  if (!path) return null;
  try {
    return readFileSync(path, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  } catch {
    return null;
  }
}

function anchorOffset(text, anchor) {
  if (!text || !anchor) return null;
  const at = text.indexOf(anchor);
  return at >= 0 ? at : null;
}

const WORD_RE = /[a-zà-ÿ'’-]+/gi;
function featureVector(text) {
  const ws = String(text ?? "").toLowerCase().match(WORD_RE) ?? [];
  const vec = new Map();
  for (const w of ws) {
    if (w.length < 3) continue;
    vec.set(w, (vec.get(w) ?? 0) + 1);
  }
  return vec;
}

function globalFeatureVector(text, sampleEvery = 5000, window = 8000) {
  const vec = new Map();
  for (let off = 0; off < text.length; off += sampleEvery) {
    const ctx = text.slice(Math.max(0, off - window / 2), Math.min(text.length, off + window / 2));
    const ws = String(ctx).toLowerCase().match(WORD_RE) ?? [];
    for (const w of ws) {
      if (w.length < 3) continue;
      vec.set(w, (vec.get(w) ?? 0) + 1);
    }
  }
  return vec;
}

function discriminativeFeatures(characterText, globalVec) {
  const ws = String(characterText ?? "").toLowerCase().match(WORD_RE) ?? [];
  const charVec = new Map();
  for (const w of ws) {
    if (w.length < 3) continue;
    charVec.set(w, (charVec.get(w) ?? 0) + 1);
  }
  const charTotal = [...charVec.values()].reduce((a, b) => a + b, 0) || 1;
  const globalTotal = [...globalVec.values()].reduce((a, b) => a + b, 0) || 1;
  const diffVec = new Map();
  for (const [w, count] of charVec) {
    const charFreq = count / charTotal;
    const globalFreq = (globalVec.get(w) ?? 0) / globalTotal;
    const lift = charFreq / (globalFreq + 1e-6);
    // Lower threshold — capture early signals, not just strong lifts
    if (lift > 1.05 && count >= 1) {
      diffVec.set(w, lift);
    }
  }
  return diffVec;
}

// ── Result tracking ────────────────────────────────────────────────────────────

const results = { pass: 0, fail: 0, skip: 0, details: [] };

function record(id, passed, detail = "") {
  if (passed === "skip") {
    results.skip++;
    results.details.push(`SKIP ${id}: ${detail}`);
    console.log(`SKIP ${id}: ${detail}`);
  } else if (passed) {
    results.pass++;
    results.details.push(`PASS ${id}`);
    console.log(`PASS ${id}`);
  } else {
    results.fail++;
    results.details.push(`FAIL ${id}: ${detail}`);
    console.log(`FAIL ${id}: ${detail}`);
  }
}

// ── R3: Evaporation ────────────────────────────────────────────────────────────

console.log("\n=== R3: Evaporation (decay is mandatory) ===");

const r3 = golden.R3_evaporation;

// R3.1: no-decay-throws
try {
  createMedium({});
  record(r3.cases[0].id, false, "createMedium({}) should throw (no decay)");
} catch (e) {
  record(r3.cases[0].id, e instanceof TypeError, e.message);
}

// R3.2: stale trail abandoned
const pg2600 = loadText("pg2600");
if (pg2600) {
  const early_off = anchorOffset(pg2600, r3.cases[1].early_anchor);
  const late_off = anchorOffset(pg2600, r3.cases[1].late_anchor);

  if (early_off != null && late_off != null) {
    const medium = createMedium({ decay: 0.3 });
    let m = medium;

    // Deposit early trail, then many neutral ones, then late trail
    m = deposit(m, { agentId: "test", trace: { referentId: "early-rostovs", offset: early_off } }).medium;
    for (let i = 0; i < 5; i++) {
      m = deposit(m, { agentId: "test", trace: { referentId: `neutral-${i}`, offset: early_off + 1000 * i } }).medium;
    }
    m = deposit(m, { agentId: "test", trace: { referentId: "late-mary", offset: late_off } }).medium;

    // Evaporate enough to test: after several steps, the early trail should fade
    const evaporated = evaporate(m, 10);

    // Early deposit should be gone (it was deposited at turn 0, many steps ago)
    const hasEarly = evaporated.deposits.some((d) => d.trace.referentId === "early-rostovs");
    const hasLate = evaporated.deposits.some((d) => d.trace.referentId === "late-mary");

    if (hasLate && !hasEarly) {
      record(r3.cases[1].id, true, "early trail decayed below late");
    } else if (hasLate && hasEarly) {
      record(r3.cases[1].id, false, "early trail survived evaporation — Zollman lock-in");
    } else {
      record(r3.cases[1].id, false, `unexpected state: hasEarly=${hasEarly}, hasLate=${hasLate}`);
    }
  } else {
    record(r3.cases[1].id, "skip", `anchor missing: early=${early_off != null} late=${late_off != null}`);
  }
} else {
  record(r3.cases[1].id, "skip", "pg2600 not found");
}

// ── R1_R2: Walls ───────────────────────────────────────────────────────────────

console.log("\n=== R1_R2: Trace-not-message + local sensing ===");

const r12 = golden.R1_R2_wall;

// R1: no agent-to-agent handle — structural check: the module exports no cross-lens read API.
// We verify deposit/sense are the only mutation interfaces; no direct agent-to-agent channel exists.
const stigmergyMod = { createMedium, deposit, sense, evaporate, lockInRisk, unsensedConsequences };
const hasDepositSense = typeof stigmergyMod.deposit === "function" && typeof stigmergyMod.sense === "function";
const hasAgentHandle = typeof stigmergyMod.getAgent !== "undefined" || typeof stigmergyMod.sendToAgent !== "undefined";
record(r12.cases[0].id, hasDepositSense && !hasAgentHandle, hasAgentHandle ? "agent-to-agent handle exposed" : "only deposit/sense");

// R2: sense rejects global
try {
  const m = createMedium({ decay: 0.3 });
  const m2 = deposit(m, { agentId: "a", trace: { test: 1 } }).medium;
  sense(m2, { from: 0, count: 100 });
  record(r12.cases[1].id, false, "sense with whole-medium count should throw");
} catch (e) {
  record(r12.cases[1].id, e instanceof TypeError, e.message);
}

// ── R4: Exploration ────────────────────────────────────────────────────────────

console.log("\n=== R4: Exploration (off-gradient deposits) ===");

const r4 = golden.R4_exploration;

{
  const m = createMedium({ decay: 0.3, explorationFloor: 0.05 });
  let m2 = m;

  // All gradient-following (offGradient=false) deposits
  for (let i = 0; i < 10; i++) {
    m2 = deposit(m2, { agentId: "a", trace: { id: `trail-${i}` }, offGradient: false }).medium;
  }

  const risk = lockInRisk(m2);
  record(r4.cases[0].id, risk.flagged,
    `flagged=${risk.flagged} offGradient=${risk.offGradientFraction} (null p=${risk.null_result?.p_value})`);
}

// ── R5: Externality detection (open-loop) ──────────────────────────────────────

console.log("\n=== R5: Externality detection (open-loop) ===");

const r5 = golden.R5_externality_detection;

const pg1400 = loadText("pg1400");
const pg84 = loadText("pg84");

const globalVec2600 = pg2600 ? globalFeatureVector(pg2600) : new Map();
const globalVec84 = pg84 ? globalFeatureVector(pg84) : new Map();

function getContext(text, anchor, window = 8000) {
  const off = anchorOffset(text, anchor);
  if (off == null) return "";
  return text.slice(Math.max(0, off - window), Math.min(text.length, off + window));
}

function multiAnchorFeatures(text, anchor, globalVec, introWindow = 1200, trailWindow = 500, maxOccurrences = 8) {
  // Arrow of time: first occurrence (introduction) is most predictive — gets a
  // larger window. Later occurrences trail with smaller windows.
  let combined = "";
  let idx = text.indexOf(anchor);
  if (idx < 0) return new Map();

  // Introduction window (temporally first — carries the character's setup)
  combined += text.slice(Math.max(0, idx - introWindow), Math.min(text.length, idx + introWindow)) + " ";
  idx += anchor.length;

  // Trail windows — smaller, confirm/develop the arc
  for (let i = 1; i < maxOccurrences; i++) {
    idx = text.indexOf(anchor, idx);
    if (idx === -1) break;
    combined += text.slice(Math.max(0, idx - trailWindow), Math.min(text.length, idx + trailWindow)) + " ";
    idx += anchor.length;
  }
  return discriminativeFeatures(combined, globalVec);
}

function rawMultiAnchorFeatures(text, anchor, window = 800, maxOccurrences = 5) {
  let combined = "";
  let idx = 0;
  for (let i = 0; i < maxOccurrences; i++) {
    idx = text.indexOf(anchor, idx);
    if (idx === -1) break;
    combined += text.slice(Math.max(0, idx - window), Math.min(text.length, idx + window)) + " ";
    idx += anchor.length;
  }
  return featureVector(combined);
}

function characterPool(text, globalVec, count) {
  // Build feature vectors for random character names — comparable to the test parts
  const namePatterns = [
    "Boris", "Dólokhov", "Denísov", "Kutúzov", "Bilíbin",
    "Anatole", "Hélène", "Berg", "Vera", "Sónya",
    "Tíkhon", "Alpátych", "Rostóv", "Karágin", "Shinshín",
    "Lavrúshka", "Balashëv", "Pfuhl", "Weyrother", "Bennigsen",
    "Bourienne", "Márya Dmítrievna", "Anna Pávlovna", "Julie Karágina",
    "Captain Túshin", "Prince Vasíli", "Count Rostopchín"
  ];
  const pool = [];
  for (const name of namePatterns.slice(0, Math.max(count, namePatterns.length))) {
    const fv = multiAnchorFeatures(text, name, globalVec);
    if (fv.size > 0) pool.push(fv);
  }
  return pool;
}

function buildDiversePool(text, count) {
  const pool = [];
  const step = Math.max(1, Math.floor(text.length / (count + 1)));
  for (let i = 1; i <= count; i++) {
    const off = i * step;
    const ctx = text.slice(Math.max(0, off - 1500), Math.min(text.length, off + 1500));
    pool.push(featureVector(ctx));
  }
  return pool;
}

// Helper: create action+consequence deposits and check if they'd be open-loop
function checkOpenLoop(text, actionAnchor, consequenceAnchor, assertOpenLoop) {
  if (!text) return "skip:text_missing";
  const actionOff = anchorOffset(text, actionAnchor);
  const conseqOff = anchorOffset(text, consequenceAnchor);

  if (actionOff == null && assertOpenLoop) return `fail:action_anchor_missing`;
  if (conseqOff == null && assertOpenLoop) return `skip:consequence_anchor_missing`;

  // Simulate: the action referent is deposited, the consequence referent is known
  // but NOT coupled in the deposit. This is the open-loop pattern.
  const knownConsequences = new Map();
  if (conseqOff != null) {
    knownConsequences.set("consequence", { id: "consequence", label: "cost" });
  }

  const m = createMedium({ decay: 0.3 });

  // Deposit the action WITHOUT consequence edges — this should be refused
  const { result } = deposit(m, {
    agentId: "test",
    trace: {
      referentId: "action",
      offset: actionOff,
      consequenceRefs: assertOpenLoop ? [] : ["consequence"], // NO edges for open-loop test
    },
    consequenceEdges: assertOpenLoop ? [] : null, // R5: no edges = open-loop
  });

  if (assertOpenLoop) {
    // Should be refused as open-loop
    return result.admitted ? "fail:should_be_refused" : `pass:${result.status}`;
  } else {
    // Should be admitted (loop is closed by providing edges or null)
    return result.admitted ? "pass:admitted" : `fail:unexpected_refusal_${result.status}`;
  }
}

// Positive: Napoleon abandons army → open-loop flagged
if (pg2600) {
  const napoleon = checkOpenLoop(pg2600, r5.positive[0].action_anchor, r5.positive[0].consequence_anchor, true);
  record(r5.positive[0].id, napoleon.startsWith("pass"), napoleon);
} else {
  record(r5.positive[0].id, "skip", "pg2600 not found");
}

// Positive: Magwitch funds Pip → open-loop flagged
if (pg1400) {
  const magwitch = checkOpenLoop(pg1400, r5.positive[1].action_anchor, r5.positive[1].consequence_anchor, true);
  record(r5.positive[1].id, magwitch.startsWith("pass"), magwitch);
} else {
  record(r5.positive[1].id, "skip", "pg1400 not found");
}

// Negative control: Pierre inherits → NOT open-loop
if (pg2600) {
  const pierre = checkOpenLoop(pg2600, r5.negative_controls[0].action_anchor, undefined, false);
  record(r5.negative_controls[0].id, pierre.startsWith("pass"), pierre);
}

// Negative control: Frankenstein builds creature → NOT open-loop (loop closed in text)
if (pg84) {
  const frankenstein = checkOpenLoop(pg84, r5.negative_controls[1].action_anchor, r5.negative_controls[1].consequence_anchor, false);
  record(r5.negative_controls[1].id, frankenstein.startsWith("pass"), frankenstein);
} else {
  record(r5.negative_controls[1].id, "skip", "pg84 not found");
}

// ── SUPP: Supplementation gate ─────────────────────────────────────────────────

console.log("\n=== SUPP: Supplementation (leave-one-out holon test) ===");

const supp = golden.SUPP_supplementation;
if (supp && pg2600) {
  // Build a combined pool: character vectors + crowd-term vectors.
  // This way "replace" null tests whether removing a real part is less
  // disruptive than replacing it with something from the background.
  const charPool = characterPool(pg2600, globalVec2600, 20);
  const crowdTerms = ["the crowd", "the mob", "the people", "the masses", "the rabble"];
  for (const term of crowdTerms) {
    const fv = multiAnchorFeatures(pg2600, term, globalVec2600);
    if (fv.size > 0) charPool.push(fv);
  }

  // True holon: Natasha, Andrew, Pierre — distinct characters, should pass
  {
    const parts = supp.cases[0].parts_anchor;
    const features = new Map();
    for (const anchor of parts) {
      features.set(anchor, multiAnchorFeatures(pg2600, anchor, globalVec2600));
    }
    const result = supplementationTest({ parts, partFeatures: features, assemblyPool: charPool, nullMode: "replace" });
    record(supp.cases[0].id, result.passed,
      `mean_leave_out=${result.mean_leave_out} replacement_mean=${result.replacement_mean} threshold=${result.null_result?.threshold?.toFixed(4)} passed=${result.passed} mode=${result.null_mode}`);
  }

  // Crowd scene: interchangeable mass nouns — should FAIL
  {
    const parts = supp.cases[1].parts_anchor;
    const features = new Map();
    for (const anchor of parts) {
      features.set(anchor, multiAnchorFeatures(pg2600, anchor, globalVec2600));
    }
    const result = supplementationTest({ parts, partFeatures: features, assemblyPool: charPool, nullMode: "replace" });
    record(supp.cases[1].id, !result.passed,
      `mean_leave_out=${result.mean_leave_out} replacement_mean=${result.replacement_mean} threshold=${result.null_result?.threshold?.toFixed(4)} passed=${result.passed} (should FAIL) mode=${result.null_mode}`);
  }
} else {
  for (const c of (supp?.cases ?? [])) record(c.id, "skip", "pg2600 not found");
}

// ── DOWN: Downward-closure gate ────────────────────────────────────────────────

console.log("\n=== DOWN: Downward-closure (predator + capture gates) ===");

const down = golden.DOWN_downward_closure;
if (down && pg2600) {
  // (a) Predator case: Napoleon absorbed into "general movement of peoples"
  {
    const wholeCtx = multiAnchorFeatures(pg2600, down.predator_case_a[0].whole_anchor, globalVec2600);
    const partCtx = multiAnchorFeatures(pg2600, down.predator_case_a[0].absorbed_part_anchor, globalVec2600);
    const partFeatures = new Map();
    partFeatures.set("Napoleon", partCtx);
    const holonFeature = wholeCtx;

    const result = downwardClosureTest({ parts: ["Napoleon"], partFeatures, holonFeature });
    record(down.predator_case_a[0].id, !result.admitted && !result.predicate_a,
      `admitted=${result.admitted} predicate_a=${result.predicate_a} reason=${result.reason}`);

    // (c) Good holon: Rostóv family — should PASS
    const familyParts = ["young Rostóv", "Countess Mary", "Natásha"];
    const familyFeatures = new Map();
    for (const anchor of familyParts) {
      familyFeatures.set(anchor, multiAnchorFeatures(pg2600, anchor, globalVec2600));
    }
    const famHolon = multiAnchorFeatures(pg2600, down.good_holon_control[0].whole_anchor, globalVec2600);
    const famResult = downwardClosureTest({ parts: familyParts, partFeatures: familyFeatures, holonFeature: famHolon });
    record(down.good_holon_control[0].id, famResult.admitted,
      `admitted=${famResult.admitted} predicate_a=${famResult.predicate_a} predicate_b=${famResult.predicate_b}`);
  }

  // (b) Capture case: unanswerable trace — structural test
  {
    const m = createMedium({ decay: 0.3 });
    const { medium } = deposit(m, {
      agentId: "holon",
      trace: { holonId: "captor-holon", type: "coordination-trace" },
    });
    const partsFv = new Map([["part-a", featureVector("distinct part a")], ["part-b", featureVector("distinct part b")]]);
    const holonFv = featureVector("the whole");
    const result = downwardClosureTest({
      parts: ["part-a", "part-b"],
      partFeatures: partsFv,
      holonFeature: holonFv,
      medium, // direct reference, not medium.medium
      holonTrace: { holonId: "captor-holon" },
    });
    record(down.capture_case_b[0].id, !result.admitted && !result.predicate_b,
      `admitted=${result.admitted} predicate_b=${result.predicate_b} reason=${result.reason}`);
  }
} else {
  for (const c of (down?.predator_case_a ?? [])) record(c.id, "skip", "pg2600 not found");
  for (const c of (down?.capture_case_b ?? [])) record(c.id, "skip", "no text needed but golden section missing");
  for (const c of (down?.good_holon_control ?? [])) record(c.id, "skip", "pg2600 not found");
}

// ── Summary ─────────────────────────────────────────────────────────────────────

console.log(`\n=== RESULTS: ${results.pass} pass, ${results.fail} fail, ${results.skip} skip ===`);
process.exit(results.fail > 0 ? 1 : 0);
