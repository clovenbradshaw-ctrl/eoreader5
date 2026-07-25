import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const SERIES_OPS = new Set(["hist", "diff", "lag"]);
const SCALAR_OPS = new Set(["const", "last", "sum", "mean", "count", "add", "sub", "mul", "div", "opref"]);

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

export function evalNode(node, history) {
  switch (node.op) {
    case "hist":
      return history;
    case "diff":
      return diffSeries(evalSeries(node.of, history));
    case "lag": {
      const s = evalSeries(node.of, history);
      const k = node.k ?? 1;
      return k >= s.length ? [] : s.slice(0, s.length - k);
    }
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
      return b === 0 ? a : a / b;
    }
    case "opref":
      if (!node.program) throw new TypeError("expressions: opref node missing its inline program");
      return evalNode(node.program, history);
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

export function evaluateProgram(program, history) {
  if (isSeriesNode(program)) throw new TypeError("expressions: a program must be scalar-valued at the top");
  const value = evalNode(program, history);
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function descriptionLength(node) {
  if (node.op === "opref") return 1;
  let count = 1;
  for (const child of ["of", "a", "b"]) if (node[child]) count += descriptionLength(node[child]);
  return count;
}

export function canonicalKey(program) {
  return canonicalHashSync(program);
}

export function predictWith(program, history, { warmup } = {}) {
  const n = history.length;
  const resolvedWarmup = warmup ?? Math.max(2, Math.ceil(Math.sqrt(n) / 2));

  const centre = evaluateProgram(program, history);
  if (centre === null) return null;
  const residuals = [];
  for (let i = Math.max(1, resolvedWarmup); i < history.length; i += 1) {
    const f = evaluateProgram(program, history.slice(0, i));
    if (f === null) continue;
    residuals.push(history[i] - f);
  }
  const sd = residuals.length >= 2 ? Math.sqrt(residuals.reduce((acc, r) => acc + (r - mean(residuals)) ** 2, 0) / (residuals.length - 1)) : 0;
  return sd > 0 ? { kind: "gaussian", mean: centre, sd } : { kind: "point", value: centre };
}

export function enumeratePrograms({ maxSeriesDepth, constants, lags, maxPrograms, library = [], data } = {}) {
  const nd = data?.length ?? 0;
  maxSeriesDepth = maxSeriesDepth ?? Math.max(1, Math.floor(Math.log2(Math.max(2, nd || 10)) / 2));
  constants = constants ?? (data ? deriveConstants(data) : [0, 1]);
  lags = lags ?? (data ? deriveLags(data) : [1]);
  maxPrograms = maxPrograms ?? Math.max(32, Math.round(Math.max(1, nd || 10) * 3));
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
  for (const op of library) pushScalar({ op: "opref", id: op.id, program: op.program });

  const composed = [...scalars];
  const composedSeen = new Set(scalars.map(canonicalKey));
  const pushComposed = (node) => {
    const key = canonicalKey(node);
    if (!composedSeen.has(key)) { composedSeen.add(key); composed.push(node); }
  };
  for (const a of scalars) {
    for (const b of scalars) {
      if (canonicalKey(a) === canonicalKey(b)) continue;
      pushComposed({ op: "add", a, b });
      pushComposed({ op: "sub", a, b });
    }
  }

  return composed
    .sort((x, y) => descriptionLength(x) - descriptionLength(y) || canonicalKey(x).localeCompare(canonicalKey(y)))
    .slice(0, maxPrograms);
}

function deriveConstants(data) {
  if (!data || data.length === 0) return [0, 1];
  const mn = data.reduce((a, b) => a + b, 0) / data.length;
  const minVal = Math.min(...data);
  const maxVal = Math.max(...data);
  return [minVal, mn, maxVal].filter((v) => Number.isFinite(v));
}

function deriveLags(data) {
  if (!data || data.length < 4) return [1];
  const nd = data.length;
  return [1, Math.max(2, Math.floor(nd / 4)), Math.max(2, Math.floor(nd / 2))];
}
