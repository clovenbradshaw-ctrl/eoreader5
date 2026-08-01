#!/usr/bin/env node
// scripts/kind-discovery.mjs
//
// Unified kind-discovery pipeline.  Same function at every holonic level:
//   L0 raw books → mutual recognition → L1 Kinds → converge → reify → ...
//
// Two independent clustering mechanisms converge on the same 65-book Sanskrit
// cluster (Jaccard validation in cross-ref notes).  Mutual-genre clusters by
// internal motif structure (what a book IS); stigmergy clusters by what
// passages of a reference a book recognizes (how it READS).  This pipeline
// uses mutual-genre for membership (self-contained, no reference) and
// stigmergy convergence only for consensus-passage extraction.
//
// Holonic level is structural: every entity carries { level, id, store, lens }.
// Cube coordinates are relative to level.
//
// Usage:
//   node scripts/kind-discovery.mjs \
//     --corpus-dir ../eoPriors/corpus_newconsolidated \
//     --target /Users/mlacy/Downloads/pg2600.txt \
//     --out ../eoPriors/priors/kind-discovery.json \
//     [--samples 30] [--threshold p95] [--levels 2]

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { frameText } from "../packages/engine/emergence/summary/text-organ.js";
import { buildStore, surface } from "../packages/engine/emergence/store/index.js";
import { createMedium, deposit } from "../packages/engine/emergence/stigmergy/index.js";

function parseArgs(argv) {
  const get = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
  const has = (f) => argv.includes(f);
  return {
    corpusDir: get("--corpus-dir", null),
    target: get("--target", null),
    out: get("--out", null),
    maxBooks: Number(get("--max-books", 0)) || Infinity,
    samples: Number(get("--samples", 30)),
    levels: Number(get("--levels", 1)),
    threshold: get("--threshold", "p95"),
    idfFloor: Number(get("--idf-floor", 2.0)),
    edgeSlots: Number(get("--edge-slots", 18)),
    surfaceTop: Number(get("--surface-top", 10)),
    targetFrames: Number(get("--target-frames", 0)) || 200,
    jaccard: Number(get("--jaccard", 0.15)),
    minKindSize: Number(get("--min-kind-size", 3)),
    skipMutual: has("--skip-mutual"),
    loadClusters: get("--load-clusters", null),
    clusterBy: get("--cluster-by", "mutual") || "mutual", // "mutual" | "convergence"
    depositK: Number(get("--deposit-k", 2.5)),
  };
}

function stripGutenberg(t) {
  const a = t.search(/\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  const b = t.search(/\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  return a >= 0 && b > a ? t.slice(t.indexOf("\n", a) + 1, b) : t;
}

function bookId(file) {
  return file.replace(/\.txt$/, "").replace(/^global_south_corpus__/, "").replace(/^gutenberg_corpus__/, "").slice(0, 70);
}

// ── Entity: a holon at any level ────────────────────────────────────────────

function createEntity({ level, id, frames, storeOptions = {} }) {
  if (!frames || !frames.length) return null;
  const store = buildStore(frames, storeOptions);
  return Object.freeze({ level, id, frameCount: frames.length, frames, store, lens: null });
}

// ── Mutual recognition matrix ──────────────────────────────────────────────
// Each entity samples its frames; each sample is surfaced through every other
// entity's store.  The mutual activation is the mean top-k surface activation.

function mutualRecognition(entities, options = {}) {
  const { samples = 30, surfaceTop = 10, idfFloor = 2.0 } = options;
  const n = entities.length;

  // Sample frames evenly from each entity
  const sampledFrames = entities.map((e) => {
    const all = e.frames;
    if (all.length <= samples) return all;
    const step = Math.max(1, Math.floor(all.length / samples));
    const out = [];
    for (let i = 0; i < all.length && out.length < samples; i += step) out.push(all[i]);
    return out;
  });

  const M = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    const storeI = entities[i].store;
    for (let j = 0; j < n; j++) {
      if (i === j) { M[i][j] = 999; continue; }
      let sum = 0;
      const fj = sampledFrames[j];
      for (const f of fj) {
        const results = surface(storeI, f.text, { completion: 0.5, topEdges: 6, idfFloor });
        sum += results.slice(0, surfaceTop).reduce((s, r) => s + r.activation, 0);
      }
      M[i][j] = sum / (fj.length || 1);
    }
    if ((i + 1) % 25 === 0) console.error(`    mutual: ${i + 1}/${n} rows`);
  }

  // Symmetrize: mutual = min(forward, backward)
  const mutual = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = Math.min(M[i][j], M[j][i]);
      mutual[i][j] = v;
      mutual[j][i] = v;
    }

  return { mutual, sampledFrames };
}

// ── Load pre-computed mutual-genre clusters ──────────────────────────────────
// Loads genre-matrix.json and maps member indices to current entity indices.

function loadGenreClusters(path, entities) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!data.genres_p95) throw new Error("genre-matrix.json missing genres_p95");

  const idToIdx = new Map();
  for (let i = 0; i < entities.length; i++) idToIdx.set(entities[i].id, i);

  const comps = [];
  for (const g of data.genres_p95) {
    const indices = g.books.map((id) => idToIdx.get(id)).filter((i) => i != null);
    if (indices.length >= 2) comps.push(indices);
  }
  comps.sort((a, b) => b.length - a.length);

  console.error(`  Loaded ${comps.length} clusters from ${path} (${comps.reduce((s,c)=>s+c.length,0)} books matched)`);
  return { clusters: comps, distribution: data.distribution };
}

// ── Threshold-based clustering ──────────────────────────────────────────────

function clusterByThreshold(mutual, entities, threshold) {
  const n = entities.length;
  const adj = new Map();
  for (let i = 0; i < n; i++) adj.set(i, new Set());
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (mutual[i][j] >= threshold) { adj.get(i).add(j); adj.get(j).add(i); }

  const visited = new Set();
  const comps = [];
  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    const c = [];
    const stack = [i];
    while (stack.length > 0) {
      const node = stack.pop();
      if (visited.has(node)) continue;
      visited.add(node);
      c.push(node);
      for (const nb of (adj.get(node) ?? new Set())) { if (!visited.has(nb)) stack.push(nb); }
    }
    comps.push(c);
  }
  comps.sort((a, b) => b.length - a.length);
  return comps;
}

function computeThresholds(mutual) {
  const all = [];
  const n = mutual.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      all.push(mutual[i][j]);
  all.sort((a, b) => b - a);
  const p90 = all[Math.floor(all.length * 0.1)];
  const p95 = all[Math.floor(all.length * 0.05)];
  const p99 = all[Math.floor(all.length * 0.01)];
  return { all, p90, p95, p99, max: all[0], median: all[Math.floor(all.length / 2)] };
}

// ── Consensus via stigmergy convergence ─────────────────────────────────────
// Reads a reference target through a set of entity stores; passages that
// activate many stores above natural threshold are the consensus.

function readTargetThrough(entities, targetFrames, options = {}) {
  const { idfFloor = 2.0, surfaceTop = 15, completion = 0.5, topEdges = 6, depositK = 2.5 } = options;
  const medium = createMedium({ decay: 0.05, explorationFloor: 0 });
  let m = medium;
  const entityDeposits = entities.map(() => new Map());

  for (let ei = 0; ei < entities.length; ei++) {
    const entity = entities[ei];
    const scores = [];

    for (let fi = 0; fi < targetFrames.length; fi++) {
      const frame = targetFrames[fi];
      const results = surface(entity.store, frame.text, { completion, topEdges, idfFloor });
      const totalActivation = results.slice(0, surfaceTop).reduce((s, r) => s + r.activation, 0);
      scores.push({ frameIdx: fi, offset: frame.offset, activation: totalActivation });
    }

    const acts = scores.map((s) => s.activation);
    const mean = acts.reduce((a, b) => a + b, 0) / acts.length;
    const variance = acts.reduce((s, a) => s + (a - mean) ** 2, 0) / acts.length;
    const std = Math.sqrt(variance);
    const threshold = mean + depositK * std;

    for (const s of scores) {
      if (s.activation >= threshold) {
        const { medium: m2, result } = deposit(m, {
          agentId: entity.id,
          trace: {
            entityId: entity.id,
            entityLevel: entity.level,
            frameIdx: s.frameIdx,
            offset: s.offset,
            activation: +s.activation.toFixed(4),
            textPreview: targetFrames[s.frameIdx].text.replace(/\n/g, " ").slice(0, 80),
          },
          offGradient: false,
        });
        if (result.admitted) { m = m2; entityDeposits[ei].set(s.frameIdx, s.activation); }
      }
    }
  }

  return { medium: m, entityDeposits };
}

// ── Reify: cluster → Kind entity ───────────────────────────────────────────

function reifyKind(clusterIndices, entities, targetFrames, nextLevel, options = {}) {
  const members = clusterIndices.map((i) => entities[i]);
  const signalK = options.signalK ?? 2;

  const memberDepositSets = clusterIndices.map((i) => entities[i]._deposits ?? new Set());
  if (memberDepositSets.every((s) => s.size === 0)) return null;

  // Frame-level agreement: observed vs expected
  const totalFrames = targetFrames.length;
  const avgDeposits = memberDepositSets.reduce((s, ds) => s + ds.size, 0) / members.length;
  const expectedPerFrame = (avgDeposits / totalFrames) * members.length;
  const noiseFloor = expectedPerFrame + signalK * Math.sqrt(expectedPerFrame + 0.01);

  const frameVotes = new Map();
  for (const ds of memberDepositSets) {
    for (const fi of ds) frameVotes.set(fi, (frameVotes.get(fi) ?? 0) + 1);
  }

  const consensusFrames = [...frameVotes.entries()]
    .filter(([, v]) => v >= noiseFloor)
    .sort(([, a], [, b]) => b - a)
    .map(([fi]) => targetFrames[fi]);

  if (consensusFrames.length === 0) return null;

  const kindFrames = consensusFrames.map((f, i) => ({ ...f, order: i }));
  const memberIds = members.map((m) => m.id);
  const kindId = `l${nextLevel}:${memberIds.slice(0, 3).join("+")}${memberIds.length > 3 ? `+${memberIds.length - 3}` : ""}`;

  const kindStore = buildStore(kindFrames, { idfFloor: options.idfFloor ?? 2.0, edgeSlots: options.edgeSlots ?? 18 });

  return Object.freeze({
    level: nextLevel,
    id: kindId.slice(0, 120),
    memberCount: members.length,
    memberIds,
    consensusFrameCount: consensusFrames.length,
    frames: kindFrames,
    store: kindStore,
    reifiedBy: "convergence",
  });
}

// ── Structural reification (no reference needed) ──────────────────────────
// A structural Kind captures shared associative structure of its members:
// the motifs and co-occurrence patterns that recur across member texts.
// Builds a store from sampled frames of all members — no reference required.

function reifyStructuralKind(clusterIndices, entities, nextLevel, options = {}) {
  const members = clusterIndices.map((i) => entities[i]);
  const samplesPerMember = options.samplesPerMember ?? 10;
  const minMotifs = options.minMotifs ?? 5;

  // Collect the most distinctive frames from each member: frames with most
  // motifs (richest associative content)
  const kindFrames = [];
  for (const m of members) {
    const ranked = (m.frames ?? [])
      .map((f, i) => ({ frame: f, idx: i,
        richness: f.text ? new Set(f.text.toLowerCase().match(/[a-zà-ÿ0-9'’-]+/gi)).size : 0 }))
      .sort((a, b) => b.richness - a.richness)
      .slice(0, samplesPerMember);
    for (const r of ranked) {
      kindFrames.push({
        order: kindFrames.length,
        offset: r.frame.offset,
        text: r.frame.text,
      });
    }
  }

  if (kindFrames.length < minMotifs) return null;

  const memberIds = members.map((m) => m.id);
  const kindId = `l${nextLevel}:${memberIds.slice(0, 3).join("+")}${memberIds.length > 3 ? `+${memberIds.length - 3}` : ""}`;

  const kindStore = buildStore(kindFrames, { idfFloor: options.idfFloor ?? 2.0, edgeSlots: options.edgeSlots ?? 18 });

  return Object.freeze({
    level: nextLevel,
    id: kindId.slice(0, 120),
    memberCount: members.length,
    memberIds,
    consensusFrameCount: kindFrames.length,
    frames: kindFrames,
    store: kindStore,
    reifiedBy: "structure",
  });
}

// ── Main pipeline ───────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.corpusDir || !args.out) {
    console.error("usage: kind-discovery.mjs --corpus-dir <dir> --out <file.json> [--samples N] [--levels N] [--target <text>]");
    process.exit(1);
  }

  // Load target for consensus passage extraction (optional)
  let targetFrames = null;
  if (args.target) {
    console.error("Loading target text...");
    const targetText = readFileSync(args.target, "utf-8").replace(/\r\n?/g, "\n");
    const allTargetFrames = frameText(stripGutenberg(targetText));
    const step = Math.max(1, Math.floor(allTargetFrames.length / args.targetFrames));
    targetFrames = [];
    for (let i = 0; i < allTargetFrames.length && targetFrames.length < args.targetFrames; i += step)
      targetFrames.push(allTargetFrames[i]);
    console.error(`  ${(targetText.length / 1e6).toFixed(1)}M chars, ${targetFrames.length} frames\n`);
  }

  // ── L0: read corpus ─────────────────────────────────────────────────────
  console.error("Reading corpus...");
  const files = readdirSync(args.corpusDir).filter((f) => f.endsWith(".txt")).sort();
  const n = Math.min(files.length, args.maxBooks);

  const l0Entities = [];
  for (let i = 0; i < n; i++) {
    let text;
    try { text = stripGutenberg(readFileSync(`${args.corpusDir}/${files[i]}`, "utf8")); }
    catch (e) { continue; }
    const frames = frameText(text);
    if (!frames.length) continue;
    const entity = createEntity({
      level: 0,
      id: bookId(files[i]),
      frames,
      storeOptions: { idfFloor: args.idfFloor, edgeSlots: args.edgeSlots },
    });
    if (entity) l0Entities.push(entity);
    if (l0Entities.length % 25 === 0) console.error(`  ${l0Entities.length} L0 entities`);
  }
  console.error(`  ${l0Entities.length} L0 entities\n`);

  // ── Recursive holonic fold ────────────────────────────────────────────────
  // Levels are DISCOVERED, not assigned.  The lower constrains the upper's
  // possibility space; the upper gives the lower probability.  We fold until
  // the structure stops cohering — no forced number of iterations.
  //
  // discoveredLevels[n] = { entities (the members), kinds (the next-level Kinds) }
  // n=0 is the raw corpus.  n=1 are the first Kinds that cohere from it, etc.

  const discoveredLevels = [];

  // Level 0: the raw corpus entities
  discoveredLevels.push({
    level: discoveredLevels.length,
    entities: l0Entities,
    kinds: [],
  });

  for (let fold = 0; fold < args.levels; fold++) {
    const current = discoveredLevels[fold];
    const entities = current.entities;
    console.error(`\n=== Fold ${fold}: ${entities.length} entities → Kinds ===`);

    let comps, dist;

    if (args.clusterBy === "convergence" && !targetFrames) {
      console.error(`  --cluster-by convergence requires --target`);
      process.exit(1);
    }

    if (fold === 0 && args.loadClusters && args.clusterBy === "mutual") {
      const loaded = loadGenreClusters(args.loadClusters, entities);
      comps = loaded.clusters;
      dist = loaded.distribution;
      const tVal = dist[args.threshold] ?? dist.p95;
      console.error(`  threshold=${tVal.toFixed(2)} using pre-computed clusters from ${args.loadClusters}`);
    } else if (args.clusterBy === "convergence") {
      // Cluster by convergence on reference: books that deposit on the same
      // passages form a Kind.  This is the fold-holons approach.
      dist = null;
      const { medium, entityDeposits } = readTargetThrough(entities, targetFrames, {
        idfFloor: args.idfFloor,
        surfaceTop: args.surfaceTop,
        depositK: args.depositK,
      });

      for (let i = 0; i < entities.length; i++)
        entities[i] = { ...entities[i], _deposits: entityDeposits[i] };

      console.error(`  ${medium.deposits.length} deposits (depositK=${args.depositK})`);

      // Pairwise Jaccard on deposit sets
      const depositSets = entityDeposits.map((dm) => new Set(dm.keys()));
      const pairs = [];
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const si = depositSets[i], sj = depositSets[j];
          if (si.size === 0 || sj.size === 0) continue;
          const inter = new Set([...si].filter((x) => sj.has(x)));
          const union = new Set([...si, ...sj]);
          const jac = inter.size / union.size;
          if (jac >= args.jaccard) pairs.push({ a: i, b: j, jaccard: jac });
        }
      }

      const adj = new Map();
      for (let i = 0; i < entities.length; i++) adj.set(i, new Set());
      for (const p of pairs) { adj.get(p.a).add(p.b); adj.get(p.b).add(p.a); }

      const visited = new Set();
      const rawComps = [];
      for (let i = 0; i < entities.length; i++) {
        if (visited.has(i)) continue;
        if (depositSets[i].size === 0) continue;
        const c = [];
        const stack = [i];
        while (stack.length > 0) {
          const node = stack.pop();
          if (visited.has(node)) continue;
          visited.add(node);
          c.push(node);
          for (const nb of (adj.get(node) ?? new Set())) { if (!visited.has(nb)) stack.push(nb); }
        }
        rawComps.push(c);
      }
      comps = rawComps;
      console.error(`  jaccard>=${args.jaccard}: ${pairs.length} pairs, ${comps.length} clusters`);
    } else {
      const { mutual } = mutualRecognition(entities, {
        samples: args.samples,
        surfaceTop: args.surfaceTop,
        idfFloor: args.idfFloor,
      });
      dist = computeThresholds(mutual);
      const tVal = dist[args.threshold] ?? dist.p95;
      comps = clusterByThreshold(mutual, entities, tVal);
      console.error(`  ${args.threshold}=${tVal.toFixed(2)}  raw clusters=${comps.length}`);
    }

    comps = comps.filter((c) => c.length >= args.minKindSize);
    console.error(`  filtered (>=${args.minKindSize}): ${comps.length} clusters`);
    for (const c of comps.slice(0, 5)) {
      const names = c.map((i) => entities[i].id.slice(0, 40));
      console.error(`    size ${c.length}: ${names.slice(0, 3).join(", ")}${c.length > 3 ? " ..." : ""}`);
    }

    // If no clusters cohered, the structure is flat — no higher level
    if (comps.length === 0) {
      console.error(`  No clusters cohered — stopping at fold ${fold}`);
      break;
    }

    // ── Reify Kinds from clusters ──────────────────────────────────────────
    const kindEntities = [];

    // If convergence clustering already ran readTargetThrough, deposits exist.
    // Otherwise, run it now.
    const needsRead = targetFrames && !entities.some((e) => e._deposits);

    if (needsRead) {
      console.error(`\n  Reading target through ${entities.length} entities for consensus...`);

      const { medium, entityDeposits } = readTargetThrough(entities, targetFrames, {
        idfFloor: args.idfFloor,
        surfaceTop: args.surfaceTop,
        depositK: args.depositK,
      });

      for (let i = 0; i < entities.length; i++)
        entities[i] = { ...entities[i], _deposits: entityDeposits[i] };

      console.error(`  ${medium.deposits.length} deposits (depositK=${args.depositK})`);
    }

    if (targetFrames) {
      const nextLevel = discoveredLevels.length;
      for (const comp of comps) {
        let kind = reifyKind(comp, entities, targetFrames, nextLevel, {
          idfFloor: args.idfFloor,
          edgeSlots: args.edgeSlots,
        });
        // If no reference convergence but we have the member texts, try
        // structural reification — shared internal structure IS a Kind.
        if (!kind) {
          kind = reifyStructuralKind(comp, entities, nextLevel, {
            idfFloor: args.idfFloor,
            edgeSlots: args.edgeSlots,
            samplesPerMember: args.samples,
          });
        }
        if (kind) kindEntities.push(kind);
      }

      console.error(`  ${kindEntities.length} Kind entities reified`);
      for (const k of kindEntities.slice(0, 5))
        console.error(`    ${k.id.slice(0, 50)}: ${k.memberCount} members, ${k.consensusFrameCount} frames, reifiedBy=${k.reifiedBy}`);
    }

    // The lower level records the distribution; the higher level is the new layer
    if (dist) {
      current.mutualDistribution = { max: dist.max, p99: dist.p99, p95: dist.p95, p90: dist.p90, median: dist.median };
    }
    current.kinds = kindEntities;

    discoveredLevels.push({
      level: discoveredLevels.length,
      entities: kindEntities,
      kinds: [],
    });

    if (kindEntities.length < 2) {
      console.error(`  <2 Kinds — the structure is flat; no higher holon coheres`);
      break;
    }
  }

  // ── Output ──────────────────────────────────────────────────────────────
  const levelsOut = discoveredLevels.map((l) => ({
    level: l.level,
    entityCount: l.entities.length,
    kindCount: l.kinds.length,
    entities: l.entities.map((e) => ({ id: e.id, frameCount: e.frameCount })),
    kinds: l.kinds.map((k) => ({
      id: k.id,
      memberCount: k.memberCount,
      memberIds: k.memberIds,
      consensusFrameCount: k.consensusFrameCount,
    })),
    mutualDistribution: l.mutualDistribution ?? null,
  }));

  const payload = JSON.stringify(levelsOut.map((l) => ({ level: l.level, kinds: l.kinds })));
  const hash = createHash("sha256").update(payload).digest("hex");

  const artifact = {
    schema: "KindDiscovery@1",
    version: "1.0.0",
    parameters: {
      corpus_dir: args.corpusDir.split("/").filter(Boolean).pop(),
      target: args.target?.split("/").filter(Boolean).pop() ?? null,
      books: l0Entities.length,
      samples: args.samples,
      max_levels: args.levels,
      threshold: args.threshold,
      idf_floor: args.idfFloor,
      edge_slots: args.edgeSlots,
      surface_top: args.surfaceTop,
      target_frames: targetFrames?.length ?? 0,
      min_kind_size: args.minKindSize,
      cluster_by: args.clusterBy,
      jaccard_threshold: args.jaccard,
      deposit_k: args.depositK,
      signal_k: 2,
      loaded_clusters: args.loadClusters ?? null,
    },
    // What this artifact is ABOUT, declared so consumers don't have to infer
    // scope from the filename (see eoreader-chat/priors-source.js::scopeOf).
    generated_from: {
      corpus_dir_basename: args.corpusDir.split("/").filter(Boolean).pop(),
      books: l0Entities.length,
      target: args.target?.split("/").filter(Boolean).pop() ?? null,
      target_frames: targetFrames?.length ?? 0,
      loaded_clusters: args.loadClusters ?? null,
      generator: "eoreader5/scripts/kind-discovery.mjs",
    },
    discovery_hash: hash,
    fold_count: discoveredLevels.length - 1,
    levels: levelsOut,
  };

  writeFileSync(args.out, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  console.error(`\nWrote ${args.out}\n  hash: ${hash.slice(0, 12)}`);
  console.error(`  ${discoveredLevels.length - 1} folds (${discoveredLevels.length} levels)`);
}

main();
