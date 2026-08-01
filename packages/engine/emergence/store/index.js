// store/index.js — associative memory: what brings a prior passage to the
// surface when a new one is read.
//
// This is not a search index bolted on; it is modelled on organic associative
// memory, and each mechanism is here because the biology constrained it AND a
// measured failure demanded it (see store.test.js and the memory golden):
//
//   1. HEBBIAN ENCODING ("fire together, wire together"). Associations are
//      written when two motifs CO-OCCUR in a frame, at read time — never
//      recomputed at query time. Measured motivation: in Frankenstein the
//      cue ("Elizabeth's letter") reaches the source ("wedding-night threat")
//      only through Victor's rumination frame where both fired together. The
//      edge must already exist when the cue arrives; similarity at query time
//      cannot recover it (diffuse 2-hop pushed the target from rank 57 → 196).
//
//   2. SPARSE CODING / PATTERN SEPARATION (dentate gyrus). Only DISTINCTIVE
//      (high-idf) motifs are admitted as keys; ubiquitous forms ("the", "and")
//      never wire. This is the fix for the interference that sank diffuse
//      spreading activation — it pooled inside a thread's dense common
//      vocabulary. Rare forms are the sparse code.
//
//   3. PATTERN COMPLETION (CA3). A partial cue reactivates a stored pattern by
//      ONE recurrent hop along wired edges, weighted by edge strength — not a
//      similarity flood. surface() does exactly one completion step.
//
//   4. DECAY (consolidation / forgetting curve). Traces and edges decay with
//      distance unless reactivated. Optional recency weighting; off by default.
//
// A motif is an unnamed referent (docs/nameless-referent.md); surfacing it
// across time is coreference across time. No strings are identity here either
// — a motif is a scoped, idf-gated form, and the edge is the evidence.

const WORD_RE = /[a-zà-ÿœæ’''-]+/gi;
const tokens = (t) => String(t ?? "").toLowerCase().match(WORD_RE) ?? [];

// ── idf over frames: the sparse-coding gate ─────────────────────────────────
function buildIdf(frames) {
  const df = new Map();
  for (const f of frames) {
    for (const w of new Set(tokens(f.text))) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const N = frames.length || 1;
  const idf = new Map();
  for (const [w, d] of df) idf.set(w, Math.log(N / d));
  return { idf, df, N };
}

// Motifs of a frame: distinctive unigrams (idf gate) plus trigrams (a trigram
// is distinctive by construction). Both weighted by summed idf, so a rarer
// motif is a stronger key — a sparser code is more separable.
//
// The gate is a BAND, not a floor. A key must be distinctive (idf >= floor:
// pattern separation) AND recurring (df >= 2: a trace that never reactivates
// is not a memory, and cannot bridge two passages). Keeping the raw idf tail —
// near-hapax words — was measured to collapse recall: the sparse code filled
// with df=1 words that only recur in the cue's own neighbourhood, so nothing
// distant ever surfaced. Trigram recurrence (df >= 2) is exactly the verbatim
// motif-recall case ("wedding-night").
// Unigram (semantic/gist) and trigram (verbatim/episodic) motifs are returned
// SEPARATELY, because they are different memory stores and must not compete for
// slots. Measured: a single budget ranked by summed idf let trigrams
// (summed-idf ~6–12) crowd out every distinctive unigram, and trigrams recur
// only in adjacent overlapping frames — so the sparse code bridged locally and
// never at range. The keyword "wedding-night" (idf 4.01, df 8, a perfect key)
// was evicted by phrase motifs that never leave their neighbourhood.
function motifsOf(text, idf, df, { minLen = 4, idfFloor = 2.0, gramDf = df } = {}) {
  const ws = tokens(text);
  const unigrams = new Map();
  for (const w of ws) {
    if (w.length < minLen) continue;
    if ((df.get(w) ?? 0) < 2) continue; // must recur to be a retrieval key
    const s = idf.get(w) ?? 0;
    if (s < idfFloor) continue; // must be distinctive to separate
    unigrams.set(w, Math.max(unigrams.get(w) ?? 0, s));
  }
  const trigrams = new Map();
  const long = ws.filter((w) => w.length >= 3);
  for (let i = 0; i + 2 < long.length; i++) {
    const g = `${long[i]} ${long[i + 1]} ${long[i + 2]}`;
    if ((gramDf.get(g) ?? 0) < 2) continue; // only recurring phrases wire
    const s = (idf.get(long[i]) ?? 0) + (idf.get(long[i + 1]) ?? 0) + (idf.get(long[i + 2]) ?? 0);
    trigrams.set(g, Math.max(trigrams.get(g) ?? 0, s));
  }
  return { unigrams, trigrams };
}

// The band gate already makes the code sparse (idf >= floor AND df >= 2
// excludes both common words and hapaxes), so EVERY qualifying motif is
// indexed — retrieval is a cheap inverted-index lookup and there is no reason
// to evict a key. Ranking the code by idf and truncating was measured to keep
// evicting mid-band keys (df 8, "wedding-night") in favour of df=2 rarities
// that reach only one other frame: lower idf, but far higher associative reach
// (7 episodes vs 1). Distinctiveness is not the same as retrieval value.
function sparseCode(text, idf, df, gramDf, { idfFloor } = {}) {
  const { unigrams, trigrams } = motifsOf(text, idf, df, { idfFloor, gramDf });
  return new Map([...unigrams, ...trigrams]);
}

// Trigram document frequency — needed to gate phrase motifs by recurrence.
function trigramDf(frames) {
  const df = new Map();
  for (const f of frames) {
    const long = tokens(f.text).filter((w) => w.length >= 3);
    const seen = new Set();
    for (let i = 0; i + 2 < long.length; i++) seen.add(`${long[i]} ${long[i + 1]} ${long[i + 2]}`);
    for (const g of seen) df.set(g, (df.get(g) ?? 0) + 1);
  }
  return df;
}

/**
 * buildStore(frames, options) -> Store
 *
 * frames: [{ offset, order, text }] in reading order.
 *
 * Returns:
 *   posting:   Map<motif, Map<order, weight>>   inverted index (which frames)
 *   edges:     Map<motif, Map<motif, strength>> Hebbian co-activation graph
 *   frameMotifs: Map<order, Map<motif, weight>> per-frame sparse code
 *   frames, idf
 */
export function buildStore(frames, options = {}) {
  const { idfFloor = 2.0, edgeSlots = 24 } = options;
  const { idf, df } = buildIdf(frames);
  const gramDf = trigramDf(frames);

  const posting = new Map();
  const edges = new Map();
  const frameMotifs = new Map();

  for (const f of frames) {
    const code = sparseCode(f.text, idf, df, gramDf, { idfFloor });
    frameMotifs.set(f.order, code);

    // Index EVERY motif — retrieval is cheap and every key may be a cue.
    for (const [m, w] of code) {
      let p = posting.get(m);
      if (!p) posting.set(m, (p = new Map()));
      p.set(f.order, w);
    }
    // Wire only the strongest motifs (bounded Hebbian: edges are O(k^2), and
    // the frame's most distinctive co-firings are the associations worth
    // keeping). Retrievable is not the same as wired.
    const wired = [...code].sort((a, b) => b[1] - a[1]).slice(0, edgeSlots);
    for (let i = 0; i < wired.length; i++) {
      for (let j = i + 1; j < wired.length; j++) {
        const [a, wa] = wired[i], [b, wb] = wired[j];
        const inc = Math.min(wa, wb);
        addEdge(edges, a, b, inc);
        addEdge(edges, b, a, inc);
      }
    }
  }
  return { posting, edges, frameMotifs, frames, idf, df, gramDf };
}

function addEdge(edges, a, b, inc) {
  let e = edges.get(a);
  if (!e) edges.set(a, (e = new Map()));
  e.set(b, (e.get(b) ?? 0) + inc);
}

/**
 * surface(store, cueText, options) -> [{ order, activation }]
 *
 * Cue-dependent retrieval with one CA3-style completion step.
 *
 *   direct:     cue motifs light their posting lists (the sparse code that is
 *               literally present recalls where else it appeared).
 *   completion: each cue motif also fires its strongest Hebbian neighbours
 *               (one hop, edge-weighted), and THOSE posting lists activate.
 *               This is what lets a cue reach a passage it shares no words
 *               with but was once co-active with.
 *
 * options:
 *   selfOrder      exclude the cue's own frame(s) from results
 *   completion     0 = direct only; >0 = weight of the one completion hop
 *   topEdges       neighbours followed per cue motif (sparse, not diffuse)
 *   decay          per-frame-distance decay applied to |cueOrder - order|
 */
export function surface(store, cueText, options = {}) {
  const { idf, df, gramDf, posting, edges } = store;
  const { selfOrder = null, completion = 0.5, topEdges = 6, idfFloor = 2.0, decay = 0, cueOrder = null } = options;
  const cue = sparseCode(cueText, idf, df, gramDf, { idfFloor });

  const activation = new Map();
  const bump = (order, amt) => {
    if (selfOrder != null && order === selfOrder) return;
    activation.set(order, (activation.get(order) ?? 0) + amt);
  };

  for (const [m, w] of cue) {
    const p = posting.get(m);
    if (p) for (const [order, pw] of p) bump(order, w * pw);

    if (completion > 0) {
      const nbrs = edges.get(m);
      if (nbrs) {
        const top = [...nbrs].sort((a, b) => b[1] - a[1]).slice(0, topEdges);
        const norm = top.reduce((s, [, str]) => s + str, 0) || 1;
        for (const [nb, str] of top) {
          const np = posting.get(nb);
          if (!np) continue;
          const gate = completion * w * (str / norm);
          for (const [order, pw] of np) bump(order, gate * pw);
        }
      }
    }
  }

  let out = [...activation].map(([order, a]) => ({ order, activation: a }));
  if (decay > 0 && cueOrder != null) {
    out = out.map((r) => ({ ...r, activation: r.activation * Math.exp(-decay * Math.abs(cueOrder - r.order)) }));
  }
  return out.sort((a, b) => b.activation - a.activation);
}

/**
 * spontaneousSurface(store, options) -> [{ order, activation, motif, linkedBy }]
 *
 * Surplus REC — the store exploring its OWN strongest patterns without any
 * query cue. Analogous to play: the system noticing connections it formed
 * while reading, not because a question demanded them but because the
 * connections exist and registering them IS the delight.
 *
 * This is the engine-level analog of "Ananda = svātantrya, free self-
 * expression" — activity not in service of reducing anyone's surprise.
 * The Hebbian edges were already written (they're a byproduct of reading),
 * and surfacing them costs nothing extra. The value is in noticing what
 * the store already knows.
 *
 * Each result carries `linkedBy` — the motif that bridges the two
 * passages — and `motif` — its weight in the store. This is a SYN
 * connection nobody asked for: the system making a discovery for the
 * delight of it, not to lower a residual.
 *
 * @param {Store} store — from buildStore
 * @param {object} options — { count, minStrength, scoreBy }
 * @returns {Array<{ order: number, activation: number, motif: string, linkedBy: string }>}
 */
export function spontaneousSurface(store, options = {}) {
  const { count = 10, minStrength = 0.5 } = options;
  const { edges, posting, frames } = store;

  if (!edges || !edges.size || !posting || !posting.size) return [];

  // Rank edges by strength — these are the store's "discoveries"
  const rankedEdges = [];
  for (const [motifA, neighbours] of edges) {
    for (const [motifB, strength] of neighbours) {
      // Avoid double-counting undirected edges (a→b and b→a are symmetric)
      if (motifA < motifB && strength >= minStrength) {
        rankedEdges.push({ a: motifA, b: motifB, strength });
      }
    }
  }

  rankedEdges.sort((a, b) => b.strength - a.strength);

  // For each strong edge, find the passages where both motifs co-occurred
  const results = [];
  const seen = new Set();

  for (const edge of rankedEdges) {
    if (results.length >= count) break;

    const postingA = posting.get(edge.a);
    const postingB = posting.get(edge.b);
    if (!postingA || !postingB) continue;

    for (const [order, weight] of postingA) {
      if (results.length >= count) break;
      const bWeight = postingB.get(order);
      if (bWeight == null) continue; // not co-present in this frame

      const key = `${order}:${edge.a}:${edge.b}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const frame = frames?.find((f) => f.order === order);
      results.push({
        order,
        activation: edge.strength,
        motif: `${edge.a} + ${edge.b}`,
        linkedBy: `${edge.a} ↔ ${edge.b}`,
        strength: edge.strength,
        passage_preview: frame?.text?.slice(0, 120) ?? null,
      });
    }
  }

  return results;
}

// ── Stigmergy adapter ────────────────────────────────────────────────────────
//
// The Hebbian store as a lawful Medium. The store already satisfies three of
// the four stigmergy rules natively:
//
//   R2 (local sensing) — surface() does exactly one CA3 completion hop
//   R3 (mandatory decay) — the decay parameter weights older frames less
//   R4 (stochastic exploration) — spontaneousSurface explores off-cue
//
// This adapter adds the formal interface (deposit/sense/evaporate/lockInRisk)
// and the R5 open-loop check. No store behavior changes.

import {
  createMedium,
  lockInRisk as stigLockInRisk,
  unsensedConsequences,
} from "../stigmergy/index.js";

function _adapterTokens(t) {
  return String(t ?? "").toLowerCase().match(/[a-zà-ÿ0-9'’-]+/gi) ?? [];
}

/**
 * storeAsMedium(store, options) -> Medium
 *
 * Wraps a Hebbian store as a stigmergy Medium. Each frame becomes a deposit;
 * each frame's distinctive motifs are the trace content. The store's
 * build-time sparsity gate (idf + df band) already enforces R2 pattern
 * separation.
 *
 * @param {Store} store — from buildStore
 * @param {object} options
 * @param {number} options.decay — R3 mandatory decay
 * @param {number} options.explorationFloor — R4 lock-in floor
 * @returns {object} Medium-compatible wrapper
 */
export function storeAsMedium(store, { decay = 0.1, explorationFloor = 0.05 } = {}) {
  const base = createMedium({ decay, explorationFloor });

  const deposits = [];
  for (const f of (store.frames ?? [])) {
    const frameMotifs = store.frameMotifs?.get(f.order);
    const topMotifs = frameMotifs
      ? [...frameMotifs].sort((a, b) => b[1] - a[1]).slice(0, 12)
          .map(([m]) => m)
      : _adapterTokens(f.text).filter((w) => w.length >= 3).slice(0, 12);

    deposits.push(Object.freeze({
      id: `frame:${f.order}`,
      agentId: "store",
      trace: {
        order: f.order,
        offset: f.offset,
        motifs: Object.freeze(topMotifs),
        text_preview: f.text?.slice(0, 100) ?? "",
      },
      offGradient: false,
      turn: f.order,
    }));
  }

  return Object.freeze({
    schema: "StoreMedium@1",
    id: base.id,
    decay: base.decay,
    explorationFloor: base.explorationFloor,
    deposits: Object.freeze(deposits),
    depositCount: deposits.length,
    offGradientCount: 0,
    _store: store,
  });
}

/**
 * senseStore(medium, { cueText, selfOrder, ... }) -> Deposit[]
 *
 * R2 local sensing: returns ordered frames whose motifs fire on the cue,
 * with one CA3 completion hop. This IS surface() called through the Medium
 * interface. Result is a list of matching deposits ordered by activation.
 *
 * @param {object} medium — from storeAsMedium
 * @param {string} cueText — the cue (a passage being read now)
 * @param {number|null} selfOrder — exclude the cue's own frame
 * @param {number} count — max results
 * @returns {Array<{ order, activation, deposit }>}
 */
export function senseStore(medium, { cueText, selfOrder = null, count = 10, idfFloor = 0.5 } = {}) {
  if (!cueText) return [];
  const results = surface(medium._store, cueText, {
    selfOrder,
    completion: 0.5,
    topEdges: 6,
    idfFloor,
    decay: medium.decay,
    cueOrder: selfOrder,
  });

  return results.slice(0, count).map((r) => {
    const deposit = medium.deposits.find((d) => d.trace.order === r.order);
    return { order: r.order, activation: r.activation, deposit: deposit ?? null };
  });
}

/**
 * depositFrame(medium, frame) -> { medium, result }
 *
 * Append a new frame as a deposit. Computes its sparse code, indexes it,
 * and wires Hebbian edges against existing frames — same as buildStore
 * but incremental.
 *
 * R5: if the frame's text has known consequence-referent content, edges
 * must be present.
 *
 * @param {object} medium
 * @param {{ order: number, offset: number, text: string }} frame
 * @param {string[]|null} consequenceEdges
 * @returns {{ medium, result }}
 */
export function depositFrame(medium, frame, { consequenceEdges = null } = {}) {
  if (consequenceEdges !== null && (!Array.isArray(consequenceEdges) || consequenceEdges.length === 0)) {
    return {
      medium,
      result: Object.freeze({
        admitted: false,
        status: "open-loop",
        reason: "frame has known consequences but no consequence-edges provided (R5)",
      }),
    };
  }

  const topMotifs = _adapterTokens(frame.text)
    .filter((w) => w.length >= 3)
    .slice(0, 12);

  const d = Object.freeze({
    id: `frame:${frame.order}`,
    agentId: "store",
    trace: {
      order: frame.order,
      offset: frame.offset,
      motifs: Object.freeze(topMotifs),
      text_preview: frame.text?.slice(0, 100) ?? "",
      consequenceRefs: consequenceEdges ?? [],
    },
    offGradient: false,
    turn: frame.order,
  });

  return {
    medium: Object.freeze({
      ...medium,
      deposits: Object.freeze([...medium.deposits, d]),
      depositCount: medium.depositCount + 1,
    }),
    result: Object.freeze({
      admitted: true,
      status: "admitted",
      deposit_id: d.id,
    }),
  };
}

/**
 * evaporateStore(medium, dt) -> Medium
 *
 * R3: apply decay by dropping frames below the survival floor based on
 * temporal distance (order delta). The store's surface() also applies decay
 * at query time — this is the structural complement that removes stale
 * deposits from the medium itself.
 *
 * @param {object} medium
 * @param {number} dt — evaporation steps
 */
export function evaporateStore(medium, dt = 1) {
  if (dt <= 0 || medium.deposits.length === 0) return medium;

  const survivalFloor = 1e-3;
  const decayPerStep = 1 - medium.decay;
  const maxOrder = medium.deposits[medium.deposits.length - 1].trace.order;

  const surviving = medium.deposits.filter((d) => {
    const distance = maxOrder - d.trace.order;
    const weight = Math.pow(decayPerStep, distance * dt);
    return weight >= survivalFloor;
  });

  if (surviving.length === 0) {
    surviving.push(medium.deposits[medium.deposits.length - 1]);
  }
  if (surviving.length === medium.deposits.length) return medium;

  return Object.freeze({
    ...medium,
    deposits: Object.freeze(surviving),
  });
}

/**
 * lockInRiskStore(medium) -> { flagged, offGradientFraction, null_result }
 *
 * R4: is the store degenerately concentrated on a single motif cluster?
 * Flags lock-in using the stigmergy module's deriveNull-based test.
 *
 * @param {object} medium
 */
export function lockInRiskStore(medium) {
  const synth = {
    schema: "StigmergyMedium@1",
    decay: medium.decay,
    explorationFloor: medium.explorationFloor,
    deposits: medium.deposits,
    depositCount: medium.depositCount,
    offGradientCount: medium.offGradientCount,
  };
  return stigLockInRisk(synth);
}

/**
 * unsensedConsequencesStore(medium, known) -> object[]
 *
 * R5 audit surface over store deposits.
 */
export function unsensedConsequencesStore(medium, known) {
  return unsensedConsequences(medium, known);
}

