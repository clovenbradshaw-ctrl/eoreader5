// Typed numeric-program IR, evaluator, canonicalization, and a bounded
// enumerator (spec "EO Emergent Mathematics for Predictive Competency"
// sections 14 "search for mathematical programs", 15 "canonicalization", and
// the Section 29 kernel). This is the Phase 2 substrate: it exposes exactly
// what is being explored (typed enumerative search) and hands every candidate
// to the same competency evaluation as everything else. It decides nothing on
// its own — no promotion, no ambient time or randomness.
//
// A program maps a numeric history (number[]) to a one-step-ahead point
// forecast. Nodes are either series-valued or scalar-valued; the top node MUST
// be scalar. The reducible seed operators of Section 29.4 (last, sum, mean,
// finite difference) are ordinary compositions here, not opaque calls.
//
//   series-valued : hist | diff(series) | lag(series, k)
//   scalar-valued : const c | last(series) | sum(series) | mean(series)
//                 | count(series) | add|sub|mul|div(scalar, scalar)
//
// `div` is protected: a zero denominator yields the numerator unchanged
// (Section 29.3 "protected division") rather than NaN/Infinity.

import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const SERIES_OPS = new Set(["hist", "diff", "lag"]);
const SCALAR_OPS = new Set(["const", "last", "sum", "mean", "count", "add", "sub", "mul", "div"]);

/** Is a node series-valued (vs scalar-valued)? Throws on an unknown op. */
export function isSeriesNode(node) {
  if (!node || typeof node !== "object" || typeof node.op !== "string") throw new TypeError("expressions: node must be an object with an op");
  if (SERIES_OPS.has(node.op)) return true;
  if (SCALAR_OPS.has(node.op)) return false;
  throw new TypeError(`expressions: unknown op ${node.op}`);
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function diffSeries(xs) {
  const out = [];
  for (let i = 1; i < xs.length; i += 1) out.push(xs[i] - xs[i - 1]);
  return out;
}

/**
 * Evaluate a program node against a history. Series nodes return number[];
 * scalar nodes return a number. Empty-series aggregates return 0 (an honest
 * neutral element) so bounded search never crashes on a short window.
 */
export function evalNode(node, history) {
  switch (node.op) {
    // ---- series-valued ----
    case "hist":
      return history;
    case "diff":
      return diffSeries(evalSeries(node.of, history));
    case "lag": {
      const s = evalSeries(node.of, history);
      const k = node.k ?? 1;
      // Drop the last k elements: the "lagged" view available one step back.
      return k >= s.length ? [] : s.slice(0, s.length - k);
    }
    // ---- scalar-valued ----
    case "const":
      return node.value;
    case "last": {
      const s = evalSeries(node.of, history);
      return s.length ? s[s.length - 1] : 0;
    }
    case "sum":
      return evalSeries(node.of, history).reduce((a, b) => a + b, 0);
    case "mean": {
      const s = evalSeries(node.of, history);
      return s.length ? mean(s) : 0;
    }
    case "count":
      return evalSeries(node.of, history).length;
    case "add":
      return evalScalar(node.a, history) + evalScalar(node.b, history);
    case "sub":
      return evalScalar(node.a, history) - evalScalar(node.b, history);
    case "mul":
      return evalScalar(node.a, history) * evalScalar(node.b, history);
    case "div": {
      const a = evalScalar(node.a, history);
      const b = evalScalar(node.b, history);
      return b === 0 ? a : a / b; // protected division (Section 29.3)
    }
    default:
      throw new TypeError(`expressions: unknown op ${node.op}`);
  }
}

function evalSeries(node, history) {
  if (!isSeriesNode(node)) throw new TypeError(`expressions: expected a series node, got scalar op ${node.op}`);
  return evalNode(node, history);
}
function evalScalar(node, history) {
  if (isSeriesNode(node)) throw new TypeError(`expressions: expected a scalar node, got series op ${node.op}`);
  return evalNode(node, history);
}

/** Evaluate a whole program (top node must be scalar) to its point forecast. */
export function evaluateProgram(program, history) {
  if (isSeriesNode(program)) throw new TypeError("expressions: a program must be scalar-valued at the top");
  const value = evalNode(program, history);
  if (typeof value !== "number" || !Number.isFinite(value)) return null; // undefined forecast for this history
  return value;
}

/** Description length: node count (proxy for spec 13.5 DescriptionLength). */
export function descriptionLength(node) {
  let count = 1;
  for (const child of ["of", "a", "b"]) if (node[child]) count += descriptionLength(node[child]);
  return count;
}

/** Canonical, order-stable key for equivalence-class dedup (spec section 15). */
export function canonicalKey(program) {
  return canonicalHashSync(program);
}

/**
 * Turn a program into a predictive distribution over the next value. The
 * central value is the program's forecast from the full history; the spread is
 * the stdev of the program's OWN one-step residuals walked over the history
 * (an honest, data-derived sd — never a hand-set constant). When the residual
 * spread is not usable the program degrades to a point prediction.
 */
export function predictWith(program, history, { warmup = 2 } = {}) {
  const centre = evaluateProgram(program, history);
  if (centre === null) return null;
  const residuals = [];
  for (let i = Math.max(1, warmup); i < history.length; i += 1) {
    const f = evaluateProgram(program, history.slice(0, i));
    if (f === null) continue;
    residuals.push(history[i] - f);
  }
  const sd = residuals.length >= 2 ? Math.sqrt(residuals.reduce((acc, r) => acc + (r - mean(residuals)) ** 2, 0) / (residuals.length - 1)) : 0;
  return sd > 0 ? { kind: "gaussian", mean: centre, sd } : { kind: "point", value: centre };
}

/**
 * Bounded typed enumeration of scalar programs (spec section 14.2: the grammar
 * excludes anything that cannot produce the target type). Returns a
 * deduplicated, canonically-keyed list ordered by description length then key,
 * so the search is deterministic and replayable (section 14.4).
 *
 * @param {object} [opts]
 * @param {number} [opts.maxSeriesDepth=2] - nesting depth for series builders.
 * @param {number[]} [opts.constants=[0, 1]] - constant leaves permitted.
 * @param {number[]} [opts.lags=[1]] - lag offsets permitted.
 * @param {number} [opts.maxPrograms=256] - hard cap on returned programs.
 */
export function enumeratePrograms({ maxSeriesDepth = 2, constants = [0, 1], lags = [1], maxPrograms = 256 } = {}) {
  // Series builders, bounded in depth.
  const series = [];
  const seen = new Set();
  const pushSeries = (node) => {
    const key = canonicalKey(node);
    if (!seen.has(key)) { seen.add(key); series.push(node); }
  };
  pushSeries({ op: "hist" });
  let frontier = [{ op: "hist" }];
  for (let depth = 1; depth < maxSeriesDepth; depth += 1) {
    const next = [];
    for (const s of frontier) {
      const diffNode = { op: "diff", of: s };
      pushSeries(diffNode); next.push(diffNode);
      for (const k of lags) {
        const lagNode = { op: "lag", k, of: s };
        pushSeries(lagNode); next.push(lagNode);
      }
    }
    frontier = next;
  }

  // Scalar reducers over each series.
  const scalars = [];
  const scalarSeen = new Set();
  const pushScalar = (node) => {
    const key = canonicalKey(node);
    if (!scalarSeen.has(key)) { scalarSeen.add(key); scalars.push(node); }
  };
  for (const c of constants) pushScalar({ op: "const", value: c });
  for (const s of series) {
    pushScalar({ op: "last", of: s });
    pushScalar({ op: "mean", of: s });
    pushScalar({ op: "sum", of: s });
  }

  // One layer of binary composition (add/sub) over the scalar pool.
  const composed = [...scalars];
  const composedSeen = new Set(scalars.map(canonicalKey));
  const pushComposed = (node) => {
    const key = canonicalKey(node);
    if (!composedSeen.has(key)) { composedSeen.add(key); composed.push(node); }
  };
  for (const a of scalars) {
    for (const b of scalars) {
      if (canonicalKey(a) === canonicalKey(b)) continue; // add(x,x)/sub(x,x) are trivial
      pushComposed({ op: "add", a, b });
      pushComposed({ op: "sub", a, b });
    }
  }

  return composed
    .sort((x, y) => descriptionLength(x) - descriptionLength(y) || canonicalKey(x).localeCompare(canonicalKey(y)))
    .slice(0, maxPrograms);
}
