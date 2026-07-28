// scripts/cross-text-comparative.mjs — Hard task: cross-text comparative arc
// analysis with associative memory bridging across texts.
//
// Exercises simultaneously:
//   - multiAltitudeFold (all 5 levels, 4 entities, 2 texts)
//   - buildStore / surfaceMemory (cross-text associative bridging)
//   - DiscourseState (location-biased traversal of both texts)
//   - presence.js (holons + emanon with per-text coref prior)
//   - Provenance triples: GROUNDING, FAITHFULNESS, MONOTONICITY
//   - The emanon gap contract (Creature correctly reports typed gaps)
//
// Usage: node scripts/cross-text-comparative.mjs
// Exits 0 on pass, 1 on failure with diagnostic.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { multiAltitudeFold } from "../packages/engine/emergence/summary/multi-altitude-fold.js";
import { buildStore, surface as surfaceMemory } from "../packages/engine/emergence/store/index.js";
import { frameText } from "../packages/engine/emergence/summary/text-organ.js";
import { DiscourseState } from "../packages/engine/discourse/index.js";
import * as coref from "../../eoPriors/priors/coref/pg84-frankenstein.json" with { type: "json" };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TEXTS = {
  pg2600: "/Users/mlacy/Downloads/pg2600.txt",
  pg84: "/Users/mlacy/Documents/Default Project/pg84.txt",
};

// ── Entities ──

const ENTITY_DEFS = [
  // War and Peace — holons
  {
    id: "natasha-rostova", entity: "Natasha Rostova", text: "pg2600",
    surfaces: ["Natasha", "Natásha", "Rostova", "Natasha Rostova", "Natásha Rostóva", "Natalie"],
  },
  {
    id: "pierre-bezukhov", entity: "Pierre", text: "pg2600",
    surfaces: ["Pierre", "Bezukhov", "Pierre Bezukhov", "Count Bezukhov"],
  },
  {
    id: "andrei-bolkonsky", entity: "Prince Andrew", text: "pg2600",
    surfaces: ["Andrew", "Prince Andrew", "Bolkónski", "Andrei", "Prince Bolkónski"],
  },
  // Frankenstein — emanon (coref prior required)
  {
    id: "creature", entity: "creature", text: "pg84",
    referent: true,
  },
];

// ── Helpers ──

const DIACRITICAL_MAP = {
  'á':'a','é':'e','í':'i','ó':'o','ú':'u','à':'a','è':'e','ì':'i','ò':'o','ù':'u','â':'a','ê':'e','î':'i','ô':'o','û':'u','ä':'a','ë':'e','ï':'i','ö':'o','ü':'u',
};

function diaNorm(t) {
  return String(t ?? "").toLowerCase().trim().split("").map(c => DIACRITICAL_MAP[c] ?? c).join("");
}

function flatten(t) {
  return String(t ?? "").replace(/\s+/g, " ").trim();
}

// ── Oracle: verify grounding, faithfulness, monotonicity ──

function verifyPacket(packet, text, ed) {
  const levels = Object.keys(packet.altitudes).map(Number).sort((a, b) => a - b);
  const spansByLevel = {};
  for (const l of levels) spansByLevel[l] = packet.altitudes[l]?.spans ?? [];

  const results = { grounded: 0, total: 0, faithful: 0, monoTotal: 0, monoHits: 0, gaps: packet.gaps || [] };
  const failures = [];

  // GROUNDING
  for (const l of levels) {
    for (const s of spansByLevel[l]) {
      results.total++;
      if (s.offset == null || s.offset < 0 || s.offset >= text.length) {
        failures.push(`L${l} #${s.idx}: offset ${s.offset} invalid (len ${text.length})`);
        continue;
      }
      if (s.length > 0 && !s.verified) {
        failures.push(`L${l} #${s.idx}: unverified span (offset ${s.offset})`);
        continue;
      }
      if (s.length > 0 && s.verified && flatten(s.raw) !== flatten(s.text)) {
        failures.push(`L${l} #${s.idx}: raw/text mismatch`);
        continue;
      }
      results.grounded++;
    }
  }

  // FAITHFULNESS
  for (const l of levels) {
    for (const s of spansByLevel[l]) {
      if (s.entityPresent === true || s.entityPresent === null) results.faithful++;
    }
  }

  // MONOTONICITY
  for (let i = 0; i < levels.length - 1; i++) {
    const cur = levels[i], nxt = levels[i + 1];
    results.monoTotal += spansByLevel[cur].length;
    const nxtKeys = new Set(spansByLevel[nxt].map(s => `${s.offset}:${diaNorm(s.text || "").slice(0, 80)}`));
    for (const s of spansByLevel[cur]) {
      const key = `${s.offset}:${diaNorm(s.text || "").slice(0, 80)}`;
      const byOffset = spansByLevel[nxt].some(ns => ns.offset === s.offset);
      if (nxtKeys.has(key) || byOffset) results.monoHits++;
      else failures.push(`L${cur}→L${nxt} #${s.idx}: offset ${s.offset} missing`);
    }
  }

  // No empty altitudes for coherent entities
  if (packet.entityCoherent) {
    for (const l of levels) {
      if (spansByLevel[l].length === 0) failures.push(`L${l}: empty for coherent "${ed.entity}"`);
    }
  }

  return { results, failures, levels, spansByLevel };
}

// ── Cross-text associative bridging ──

function crossTextBridges(storeA, storeB, spans, labelA, labelB, { topK = 5, minActivation = 0.001 } = {}) {
  const bridges = [];
  for (const s of (spans ?? [])) {
    if (!s.text || s.text.length < 30) continue;
    const recalled = surfaceMemory(storeB, s.text, { completion: 0.5, topEdges: 8 });
    for (const r of recalled.slice(0, 2)) {
      if (r.activation < minActivation) continue;
      const targetFrame = storeB.frames[r.order];
      bridges.push({
        source: { text: s.text.slice(0, 120), offset: s.offset, entity: labelA },
        target: { text: (targetFrame?.text ?? "").slice(0, 120), offset: targetFrame?.offset ?? null, entity: labelB },
        activation: r.activation,
      });
    }
  }
  return bridges.sort((a, b) => b.activation - a.activation).slice(0, topK);
}

// ── Main ──

function main() {
  // Load texts
  const texts = {};
  for (const [key, path] of Object.entries(TEXTS)) {
    try {
      let raw = readFileSync(path, "utf-8");
      texts[key] = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    } catch (e) {
      console.log(`SKIP: cannot read ${path}: ${e.message}`);
    }
  }

  const textNames = { pg2600: "War and Peace", pg84: "Frankenstein" };

  let totalPass = 0, totalFail = 0;
  const allPackets = [];

  // ── Phase 1: Multi-altitude folds ──
  console.log("=== Phase 1: Multi-Altitude Folds ===\n");

  for (const ed of ENTITY_DEFS) {
    const text = texts[ed.text];
    if (!text) { console.log(`SKIP ${ed.id}: text not loaded`); continue; }

    let options = {};
    if (ed.referent) {
      const ref = coref.referents?.find(r => r.id === ed.entity);
      if (ref) options.referent = ref;
    }

    const packet = multiAltitudeFold(text, ed.entity, options);
    const { results, failures, levels, spansByLevel } = verifyPacket(packet, text, ed);

    const grounded = results.total > 0 ? (results.grounded / results.total * 100).toFixed(1) : "N/A";
    const faithful = results.total > 0 ? (results.faithful / results.total * 100).toFixed(1) : "N/A";
    const mono = results.monoTotal > 0 ? (results.monoHits / results.monoTotal * 100).toFixed(1) : "N/A";

    const sceneCounts = levels.map(l => `L${l}:${spansByLevel[l]?.length ?? 0}`).join(" ");
    const pass = failures.length === 0;

    if (pass) totalPass++; else totalFail++;

    const status = pass ? "PASS" : "FAIL";
    console.log(`${status.padEnd(6)} ${ed.id.padEnd(24)} ${textNames[ed.text]}  scenes=${sceneCounts}`);
    console.log(`       ground=${grounded}%  faith=${faithful}%  mono=${mono}%  gaps=${results.gaps.length}`);
    for (const f of failures) console.log(`       ! ${f}`);
    for (const g of results.gaps) console.log(`       ✓ gap: ${g.reason ?? g}`);
    console.log();

    allPackets.push({ ed, packet, text, spansByLevel, textKey: ed.text });
  }

  // ── Phase 2: Build associative stores ──
  console.log("=== Phase 2: Associative Memory Stores ===\n");

  const stores = {};
  for (const [key, t] of Object.entries(texts)) {
    const frames = frameText(t);
    stores[key] = buildStore(frames);
    const totalEdges = [...stores[key].edges.values()].reduce((s, m) => s + m.size, 0);
    console.log(`  ${textNames[key]}: ${frames.length} frames, ${stores[key].posting.size} motifs, ${totalEdges} edges`);
  }

  // ── Phase 3: Cross-text associative bridges ──
  console.log("\n=== Phase 3: Cross-Text Associative Bridges ===\n");

  const allBridges = [];

  for (const a of allPackets) {
    for (const b of allPackets) {
      if (a.textKey === b.textKey) continue; // only cross-text

      const storeB = stores[b.textKey];
      if (!storeB) continue;

      const topLevel = Math.max(...Object.keys(a.spansByLevel).map(Number));
      const spans = a.spansByLevel[topLevel] ?? [];

      const bridges = crossTextBridges(null, storeB, spans, a.ed.entity, b.ed.entity);
      allBridges.push(...bridges);

      if (bridges.length > 0) {
        console.log(`  ${a.ed.entity} → ${b.ed.entity} (${bridges.length} bridges):`);
        for (const br of bridges.slice(0, 3)) {
          console.log(`    [${br.activation.toExponential(2)}] "${br.source.text.slice(0, 80)}..."`);
          console.log(`    ↳  "${br.target.text.slice(0, 80)}..."`);
        }
        console.log();
      }
    }
  }

  // ── Phase 4: Discourse-conditioned traversal ──
  console.log("=== Phase 4: Discourse-Conditioned Reading ===\n");

  for (const [key, t] of Object.entries(texts)) {
    const discourse = new DiscourseState();

    // Simulate reading at different locations
    const locations = [
      { loc: Math.floor(t.length * 0.2), label: "early" },
      { loc: Math.floor(t.length * 0.5), label: "middle" },
      { loc: Math.floor(t.length * 0.8), label: "late" },
    ];

    for (const { loc, label } of locations) {
      const dcDiscourse = {
        location: loc,
        locationRadius: 50000,
        motifs: new Map(),
        referents: new Map(),
      };

      // Find an entity from this text to query
      const entity = ENTITY_DEFS.find(ed => ed.text === key);
      if (!entity) continue;

      const packet = multiAltitudeFold(t, entity.entity,
        entity.referent
          ? { referent: coref.referents?.find(r => r.id === entity.entity) }
          : {}
      );
      // Also with discourse
      const packetDC = multiAltitudeFold(t, entity.entity,
        entity.referent
          ? { referent: coref.referents?.find(r => r.id === entity.entity), discourse: dcDiscourse }
          : { discourse: dcDiscourse }
      );

      const plainTop = packet.altitudes?.[0]?.spans?.[0]?.offset;
      const dcTop = packetDC.altitudes?.[0]?.spans?.[0]?.offset;

      const plainDist = plainTop != null ? Math.abs(plainTop - loc) : Infinity;
      const dcDist = dcTop != null ? Math.abs(dcTop - loc) : Infinity;

      console.log(`  ${textNames[key]} @${label} (offset ${loc}): ${entity.entity}`);
      console.log(`    plain L0 offset=${plainTop} (dist=${plainDist})`);
      console.log(`    dc    L0 offset=${dcTop} (dist=${dcDist})`);
      console.log(`    ${dcDist < plainDist ? "discourse biased closer" : dcDist === plainDist ? "same scene" : "dc farther"}`);
      console.log();
    }
  }

  // ── Summary ──
  console.log(`=== Summary ===`);
  console.log(`${totalPass} entities passed, ${totalFail} failed (out of ${ENTITY_DEFS.length})`);
  console.log(`${allBridges.length} cross-text bridges found`);

  // Cross-text echo uniqueness
  const uniqueBridges = new Set(allBridges.map(b => `${b.source.offset}:${b.target.offset}`));
  console.log(`${uniqueBridges.size} unique bridge pairs`);

  process.exit(totalFail > 0 ? 1 : 0);
}

main();
