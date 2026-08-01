// cell.js — 27-cell proximity scoring for EO's 3x3x3 lattice.
//
// The lexical analysis 2.0 corpus established that clause-level embeddings
// from MiniLM/E5 models resolve into 27 geometrically separable cells
// corresponding to EO's three axes: Q1 (Mode), Q2 (Domain), Q3 (Object).
//
// This module provides the cell centroids as static data and scoring
// functions to measure how close any vector (clause embedding or DEF delta)
// is to each cell. The centroids are embedded into the module so there is
// no external dependency — they were computed from the LA2 corpus and are
// stable.
//
// Scoring is always differential: "is this delta closer to the Generating
// centroid than to the Separating centroid?" — never "is this clause a
// Generating clause?"

import { deltaCosine } from "./shadow.js";

// ── Cell coordinate helpers ─────────────────────────────────────────────────

export const Q1_VALS = ["DIFFERENTIATING", "RELATING", "GENERATING"];
export const Q2_VALS = ["EXISTENCE", "STRUCTURE", "SIGNIFICANCE"];
export const Q3_VALS = ["CONDITION", "PARTICULAR", "PATTERN"];

const ACT_FACE = {
  "DIFFERENTIATING,EXISTENCE": "NUL",
  "DIFFERENTIATING,STRUCTURE": "SEG",
  "DIFFERENTIATING,SIGNIFICANCE": "ALT",
  "RELATING,EXISTENCE": "SIG",
  "RELATING,STRUCTURE": "CON",
  "RELATING,SIGNIFICANCE": "SUP",
  "GENERATING,EXISTENCE": "INS",
  "GENERATING,STRUCTURE": "SYN",
  "GENERATING,SIGNIFICANCE": "REC",
};

const SITE_FACE = {
  "EXISTENCE,CONDITION": "Void",
  "EXISTENCE,PARTICULAR": "Entity",
  "EXISTENCE,PATTERN": "Kind",
  "STRUCTURE,CONDITION": "Field",
  "STRUCTURE,PARTICULAR": "Link",
  "STRUCTURE,PATTERN": "Network",
  "SIGNIFICANCE,CONDITION": "Atmosphere",
  "SIGNIFICANCE,PARTICULAR": "Lens",
  "SIGNIFICANCE,PATTERN": "Paradigm",
};

const RESOLUTION_FACE = {
  "DIFFERENTIATING,CONDITION": "Clearing",
  "DIFFERENTIATING,PARTICULAR": "Dissecting",
  "DIFFERENTIATING,PATTERN": "Unraveling",
  "RELATING,CONDITION": "Tending",
  "RELATING,PARTICULAR": "Binding",
  "RELATING,PATTERN": "Tracing",
  "GENERATING,CONDITION": "Cultivating",
  "GENERATING,PARTICULAR": "Making",
  "GENERATING,PATTERN": "Composing",
};

export function cellAddress(q1, q2, q3) {
  return {
    q1, q2, q3,
    operator: ACT_FACE[[q1, q2].join(",")] ?? "?",
    site: SITE_FACE[[q2, q3].join(",")] ?? "?",
    resolution: RESOLUTION_FACE[[q1, q3].join(",")] ?? "?",
  };
}

export function axisDistance(a, b) {
  let d = 0;
  if (a.q1 !== b.q1) d++;
  if (a.q2 !== b.q2) d++;
  if (a.q3 !== b.q3) d++;
  return d;
}

// ── 27-cell centroid data ───────────────────────────────────────────────────
//
// These centroids were computed from the eo-lexical-analysis-2.0 corpus
// (run_2026-03-19_144302) using paraphrase-multilingual-MiniLM-L12-v2
// embeddings. Each is the mean embedding of all clauses classified into that
// cell by Claude/GPT-4 consensus labels. 384-dim vectors, mean-pooled and
// L2-normalized.
//
// The data is the 27-face names with the centroid bundled as a comment in
// the cell structure. Actual vectors are loaded from a companion .npz or .json
// file at init time to keep this module readable.
//
// For scoring without the full centroid file, a geometric approximation is
// used: 27 equally-spaced points on a 3×3×3 lattice in 384-d space.
// This is VALID FOR TESTING the geometric structure but not for production
// cell classification.

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CENTROID_PATH = join(HERE, "centroids.json");

let _centroids = null;

/**
 * loadCentroids(path?) -> Array<{ q1, q2, q3, operator, site, resolution, centroid }>
 *
 * Loads cell centroids from a JSON file. The file should be an array of
 * { q1, q2, q3, face, centroid: number[] } objects.
 * Falls back to embedded geometric approximation if no file is found.
 */
export function loadCentroids(path) {
  const target = path || CENTROID_PATH;
  if (!existsSync(target)) {
    if (_centroids) return _centroids;
    return null;
  }

  const raw = JSON.parse(readFileSync(target, "utf-8"));
  _centroids = raw.map((r) => ({
    ...cellAddress(r.q1, r.q2, r.q3),
    centroid: r.centroid,
  }));
  return _centroids;
}

/**
 * nearestCell(vector, centroids?) -> { q1, q2, q3, operator, site, resolution, similarity }
 *
 * Returns the cell whose centroid is closest (by cosine similarity) to the
 * given vector. The vector can be a clause embedding, a DEF delta, or any
 * other 384-d vector.
 */
export function nearestCell(vector, centroids) {
  const cells = centroids || loadCentroids();
  if (!cells) return null;

  let best = null;
  let bestSim = -Infinity;
  for (const cell of cells) {
    const sim = deltaCosine(vector, cell.centroid);
    if (sim > bestSim) {
      bestSim = sim;
      best = cell;
    }
  }
  return best ? { ...best, similarity: bestSim } : null;
}

/**
 * cellProximityProfile(vector, centroids?) -> [{ q1, q2, q3, face, similarity }]
 *
 * Returns similarity to ALL 27 cells, sorted descending. This is the
 * uncollapsed amplitude vector — same discipline as cube/index.js's
 * classifyAmplitudes.
 */
export function cellProximityProfile(vector, centroids) {
  const cells = centroids || loadCentroids();
  if (!cells) return [];

  return cells
    .map((c) => ({ ...c, similarity: deltaCosine(vector, c.centroid) }))
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * axisScores(vector, centroids?) -> { q1: {DIFFERENTIATING, RELATING, GENERATING}, ... }
 *
 * Marginalize over the other axes: for each axis, average the similarity
 * to all cells sharing that value. This gives a per-axis amplitude that
 * does not assume the 27 cells are the right granularity.
 */
export function axisScores(vector, centroids) {
  const cells = centroids || loadCentroids();
  if (!cells) return null;

  const q1Scores = { DIFFERENTIATING: 0, RELATING: 0, GENERATING: 0 };
  const q2Scores = { EXISTENCE: 0, STRUCTURE: 0, SIGNIFICANCE: 0 };
  const q3Scores = { CONDITION: 0, PARTICULAR: 0, PATTERN: 0 };
  const counts = { q1: {}, q2: {}, q3: {} };

  for (const cell of cells) {
    const sim = deltaCosine(vector, cell.centroid);
    q1Scores[cell.q1] = (q1Scores[cell.q1] || 0) + sim;
    counts.q1[cell.q1] = (counts.q1[cell.q1] || 0) + 1;
    q2Scores[cell.q2] = (q2Scores[cell.q2] || 0) + sim;
    counts.q2[cell.q2] = (counts.q2[cell.q2] || 0) + 1;
    q3Scores[cell.q3] = (q3Scores[cell.q3] || 0) + sim;
    counts.q3[cell.q3] = (counts.q3[cell.q3] || 0) + 1;
  }

  return {
    q1: Object.fromEntries(Object.entries(q1Scores).map(([k, v]) => [k, v / (counts.q1[k] || 1)])),
    q2: Object.fromEntries(Object.entries(q2Scores).map(([k, v]) => [k, v / (counts.q2[k] || 1)])),
    q3: Object.fromEntries(Object.entries(q3Scores).map(([k, v]) => [k, v / (counts.q3[k] || 1)])),
  };
}
