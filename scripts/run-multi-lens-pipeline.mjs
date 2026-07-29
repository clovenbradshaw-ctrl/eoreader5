// scripts/run-multi-lens-pipeline.mjs
//
// Five walled lenses independently read War and Peace, depositing
// uncollapsed amplitude traces into a SHARED stigmergy medium.
// Each lens then SENSES the medium (R2: local neighborhood only)
// and discovers traces other lenses deposited — independent agreement
// witnessed, never optimized toward.
//
// The store's spontaneousSurface() then surfaces Hebbian connections
// formed during reading — surplus, joy, connections nobody asked for.
//
// This demonstrates: agents learning from each other without messaging,
// coordination through trace deposition, and joy as discovered connection.

import { readFileSync } from "fs";
import { classifyAmplitudes } from "../packages/engine/cube/index.js";
import { createMedium, deposit, sense, evaporate } from "../packages/engine/emergence/stigmergy/index.js";
import { buildStore, spontaneousSurface } from "../packages/engine/emergence/store/index.js";

const TEXT_PATH = process.env.PG2600 || "/Users/mlacy/Downloads/pg2600.txt";
const text = readFileSync(TEXT_PATH, "utf-8").replace(/\r\n?/g, "\n");

const PAS_LEN = 3000, PAS_HOP = 1500;
const passages = [];
for (let off = 0; off < text.length; off += PAS_HOP) {
  const pas = text.slice(off, Math.min(text.length, off + PAS_LEN));
  if (pas.replace(/\s/g, "").length < 100) continue;
  passages.push({ offset: off, text: pas });
}

console.log(`War and Peace: ${(text.length/1e6).toFixed(1)}M chars, ${passages.length} passages\n`);

// ── Five lenses ──────────────────────────────────────────────────────────

const LENSES = [
  {
    id: "character-care",
    terrain: { Entity: 3, Atmosphere: 1 },
    stance: { Tending: 3, Binding: 2 },
    operator: { EVA: 2, SIG: 1 },
    description: "sees who tends to whom, who binds to whom",
  },
  {
    id: "philosophical",
    terrain: { Paradigm: 3, Lens: 1 },
    stance: { Unraveling: 3, Cultivating: 2 },
    operator: { REC: 3, SYN: 2 },
    description: "sees paradigms shift, worldviews recontextualized",
  },
  {
    id: "emotional-growth",
    terrain: { Atmosphere: 3, Entity: 1 },
    stance: { Cultivating: 3, Tending: 2 },
    operator: { REC: 2, EVA: 1 },
    description: "sees emotional transformation, feeling deepening",
  },
  {
    id: "structural-power",
    terrain: { Network: 3, Link: 2 },
    stance: { Binding: 2, Tracing: 1, Composing: 1 },
    operator: { CON: 2, DEF: 1 },
    description: "sees power structures, connections, institutions",
  },
  {
    id: "existential-void",
    terrain: { Void: 3, Paradigm: 2 },
    stance: { Clearing: 2, Unraveling: 2 },
    operator: { NUL: 3, REC: 1 },
    description: "sees absence, annihilation, what disappears",
  },
];

function lensScore(amps, lens) {
  let score = 0;
  for (const { label, amplitude } of (amps.terrain || [])) {
    score += amplitude * (lens.terrain[label] ?? 0.1);
  }
  for (const { label, amplitude } of (amps.stance || [])) {
    score += amplitude * (lens.stance[label] ?? 0.1);
  }
  for (const { label, score: opScore } of (amps.operator || [])) {
    score += Math.log1p(opScore) * (lens.operator[label] ?? 0.1) * 0.1;
  }
  return score;
}

// ── Shared medium ────────────────────────────────────────────────────────

const medium = createMedium({ decay: 0.1, explorationFloor: 0.05 });
let m = medium;

const lensDeposits = [];
const allScores = [];

// Each lens reads ALL passages independently, deposits top 30% into shared medium
for (const lens of LENSES) {
  const deposits = [];
  const scored = [];

  for (let i = 0; i < passages.length; i++) {
    const amps = classifyAmplitudes(passages[i].text);
    const score = lensScore(amps, lens);
    scored.push({ idx: i, offset: passages[i].offset, score });
  }

  // Top 30% threshold
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const threshold = sorted[Math.floor(sorted.length * 0.3)]?.score ?? 0;

  let seq = 0;
  for (const s of scored) {
    if (s.score > threshold) {
      const amps = classifyAmplitudes(passages[s.idx].text);
      const { medium: m2, result } = deposit(m, {
        agentId: lens.id,
        trace: {
          lensId: lens.id,
          passageIdx: s.idx,
          offset: s.offset,
          score: +s.score.toFixed(4),
          topTerrain: amps.terrain[0]?.label ?? "Field",
          topStance: amps.stance[0]?.label ?? "Tracing",
          topOperator: amps.operator[0]?.label ?? "SIG",
          textPreview: passages[s.idx].text.slice(0, 80).replace(/\n/g, " "),
        },
        offGradient: false,
      });
      if (result.admitted) {
        m = m2;
        deposits.push({ idx: s.idx, offset: s.offset, score: s.score, fullText: passages[s.idx].text });
        seq++;
      }
    }
  }

  lensDeposits.push({ lens: lens.id, count: deposits.length, deposits });
  allScores.push({ lens: lens.id, scored });

  console.log(`${lens.id}: ${deposits.length} deposits (threshold=${threshold.toFixed(3)}) — ${lens.description}`);
}

console.log(`\nShared medium: ${m.deposits.length} total deposits from ${LENSES.length} lenses\n`);

// ── Learning: each lens senses the medium ─────────────────────────────────

console.log("=== Each lens senses what OTHER lenses deposited ===\n");

for (let li = 0; li < LENSES.length; li++) {
  const lens = LENSES[li];

  // Sense a window positioned to see the MIDDLE of the deposit sequence
  // where multiple lenses have already deposited (not just the first lens)
  const winStart = Math.floor(li * m.deposits.length / (LENSES.length + 1));
  try {
    const window = sense(m, { from: winStart, count: 50 });
    const othersTraces = window.filter(d => d.agentId !== lens.id);

    // How many different lenses' traces did this lens discover?
    const discoveredLenses = new Set(othersTraces.map(d => d.agentId));

    // How many of those other-lens traces are on passages THIS lens also deposited?
    const myDepositIdxs = new Set(lensDeposits[li].deposits.map(d => d.idx));
    const agreements = othersTraces.filter(d => myDepositIdxs.has(d.trace.passageIdx));

    console.log(`${lens.id}: sensed ${othersTraces.length} other-lens traces`);
    console.log(`  discovered lenses: [${[...discoveredLenses].join(", ")}]`);
    console.log(`  agreements with own deposits: ${agreements.length} — these are independent confirmations`);
    if (agreements.length > 0) {
      const first = agreements[0];
      console.log(`  example: lens "${first.agentId}" also deposited on "${first.trace.textPreview}..."`);
    }
    console.log();
  } catch (e) {
    console.log(`${lens.id}: sense error — ${e.message}\n`);
  }
}

// ── Convergence across all lens pairs ─────────────────────────────────────

console.log("=== Pairwise convergence (all lens pairs) ===\n");

const depositSets = lensDeposits.map(ld => new Set(ld.deposits.map(d => d.idx)));

for (let i = 0; i < LENSES.length; i++) {
  for (let j = i + 1; j < LENSES.length; j++) {
    const setI = depositSets[i];
    const setJ = depositSets[j];
    const intersection = new Set([...setI].filter(x => setJ.has(x)));
    const union = new Set([...setI, ...setJ]);
    const jaccard = intersection.size / union.size;

    console.log(`  ${LENSES[i].id} ↔ ${LENSES[j].id}:`);
    console.log(`    intersect=${intersection.size}  union=${union.size}  jaccard=${jaccard.toFixed(3)}  divergence=${((1-jaccard)*100).toFixed(0)}%`);
  }
}

// ── Multi-lens consensus ──────────────────────────────────────────────────

console.log("\n=== Multi-lens consensus (passages seen by 3+ lenses) ===\n");

const passageVotes = new Map();
for (const ld of lensDeposits) {
  for (const d of ld.deposits) {
    const entry = passageVotes.get(d.idx) || { count: 0, lenses: [], offset: d.offset };
    entry.count++;
    entry.lenses.push(ld.lens);
    passageVotes.set(d.idx, entry);
  }
}

const consensusPassages = [...passageVotes.entries()]
  .filter(([, v]) => v.count >= 3)
  .sort(([, a], [, b]) => b.count - a.count);

console.log(`Passages seen by ≥3 lenses: ${consensusPassages.length}`);
console.log(`Passages seen by all 5 lenses: ${[...passageVotes.values()].filter(v => v.count === 5).length}\n`);

console.log("Top 5 consensus passages (most lenses independently agreed):\n");
for (let i = 0; i < Math.min(5, consensusPassages.length); i++) {
  const [idx, info] = consensusPassages[i];
  const passage = passages[idx];
  const preview = passage.text.replace(/\n/g, " ").slice(0, 120).trim();
  console.log(`#${i+1}   offset=${passage.offset}  votes=${info.count}/5  lenses=[${info.lenses.join(", ")}]`);
  console.log(`      "${preview}..."\n`);
}

// ── Joy: spontaneousSurface ───────────────────────────────────────────────

console.log("=== Joy: spontaneousSurface — connections nobody asked for ===\n");

// Build a Hebbian store from the consensus passages — use FULL text
// so the store can form meaningful Hebbian edges across themes
const convergedFrames = consensusPassages.slice(0, 150).map(([idx, info], order) => ({
  order,
  offset: passages[idx].offset,
  text: passages[idx].text, // FULL passage text for meaningful motif extraction
  lensCount: info.count,
}));

const sstore = buildStore(convergedFrames, { idfFloor: 0.8, edgeSlots: 18 });
const discoveries = spontaneousSurface(sstore, { count: 8, minStrength: 0.3 });

if (discoveries.length === 0) {
  console.log("  (no strong spontaneous connections found with current parameters)");
  console.log("  This is expected — joy is rare and not guaranteed.\n");
} else {
  console.log(`  ${discoveries.length} spontaneous connections surfaced:\n`);
  for (const d of discoveries) {
    console.log(`  motif: ${d.motif}  strength=${d.strength.toFixed(3)}`);
    console.log(`  linked by: ${d.linkedBy}`);
    if (d.passage_preview) {
      console.log(`  passage: "${d.passage_preview}..."`);
    }
    console.log();
  }
}

// ── Evaporation ──────────────────────────────────────────────────────────

const evap = evaporate(m, 2);
console.log(`After evaporation (dt=2): ${evap.deposits.length} deposits remain (from ${m.deposits.length})`);
console.log(`  R3 decay ensures the first strong trail doesn't become permanent.\n`);
