import { canonicalHashSync } from "@eoreader/spec/canonical-json";

const SERIES_OPS = new Set(["hist", "diff", "lag"]);

// Arithmetic (SYN):        add, sub, mul, div, pow
// Segmentation (SEG):      diff, log
// Definition (DEF):        mean, sqrt, abs
// Signaling (SIG):         const, sin, cos, pi, e
// Connection (CON):        sum, hypot
// Evaluation (EVA):        count, atan2
// Insertion (INS):         last
// Synthesis (SYN):         add, sub, mul, div, pow
// Recursion (REC):         hist, lag, opref, exp
const SCALAR_OPS = new Set([
  "const", "last", "sum", "mean", "count",
  "add", "sub", "mul", "div", "opref",
  "sqrt", "sin", "cos", "abs", "exp", "log",
  "atan2", "pow", "hypot",
  "pi", "e",
]);

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
      if (b === 0) return a; // protected division: the numerator survives a zero denominator
      if (!Number.isFinite(b)) return 0;
      const r = a / b;
      return Number.isFinite(r) ? r : 0;
    }
    case "opref":
      if (!node.program) throw new TypeError("expressions: opref node missing its inline program");
      return evalNode(node.program, history);

    // Geometry (DEF): define magnitude by extracting root
    case "sqrt": {
      const v = evalScalar(node.of, history);
      return v < 0 ? 0 : Math.sqrt(v);
    }
    // Geometry (SIG): signal periodic behavior
    case "sin":
      return Math.sin(evalScalar(node.of, history));
    case "cos":
      return Math.cos(evalScalar(node.of, history));
    // Geometry (DEF): define magnitude, strip sign
    case "abs":
      return Math.abs(evalScalar(node.of, history));
    // Geometry (EVA): evaluate angular relationship between two components
    case "atan2":
      return Math.atan2(evalScalar(node.a, history), evalScalar(node.b, history));
    // Geometry (CON): connect orthogonal components into Euclidean magnitude
    case "hypot": {
      const r = Math.hypot(evalScalar(node.a, history), evalScalar(node.b, history));
      return Number.isFinite(r) ? r : 0;
    }

    // Calculus (REC): recursive self-multiplication
    case "exp":
      return Math.exp(evalScalar(node.of, history));
    // Calculus (SEG): segment scale into orders of magnitude
    case "log": {
      const v = evalScalar(node.of, history);
      return v <= 0 ? 0 : Math.log(v);
    }
    // Calculus (SYN): synthesize exponential relationship
    case "pow": {
      const a = evalScalar(node.a, history);
      const b = evalScalar(node.b, history);
      if (a < 0 && !Number.isInteger(b)) return 0;
      const r = Math.pow(a, b);
      return Number.isFinite(r) ? r : 0;
    }

    // Constants (SIG): signal fixed mathematical anchors
    case "pi":
      return Math.PI;
    case "e":
      return Math.E;

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
  const finalSd = Number.isFinite(sd) && sd > 0 ? sd : 0;
  return finalSd > 0 ? { kind: "gaussian", mean: centre, sd: finalSd } : { kind: "point", value: centre };
}

export function enumeratePrograms({ maxSeriesDepth, constants, lags, maxPrograms, data } = {}) {
  const nd = data?.length ?? 0;
  maxSeriesDepth = maxSeriesDepth ?? Math.max(1, Math.floor(Math.log2(Math.max(2, nd || 10)) / 2));
  constants = constants ?? (data ? deriveConstants(data) : [0, 1]);
  lags = lags ?? (data ? deriveLags(data) : [1]);
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

  const seeds = [];
  const seedSeen = new Set();
  const pushSeed = (node) => {
    const key = canonicalKey(node);
    if (!seedSeen.has(key)) { seedSeen.add(key); seeds.push(node); }
  };
  for (const c of constants) pushSeed({ op: "const", value: c });
  pushSeed({ op: "pi" });
  pushSeed({ op: "e" });
  for (const s of series) {
    for (const reducer of ["last", "mean", "sum"]) {
      pushSeed({ op: reducer, of: s });
    }
  }
  return seeds;
}

// ── Evolutionary mutation engine ──
//
// Instead of enumerating all O(n²) binary compositions, each program
// undergoes 9 mutations — one per operator. Mutations change exactly
// one thing in the expression tree. Complexity builds incrementally
// over multiple induction rounds, not by enumerating everything at once.

// Operators that combine two sub-expressions
const CONNECTORS = ["add", "mul", "hypot"];       // CON: commutative connectors
const EVALUATORS = ["sub", "div", "atan2", "pow"];  // EVA: non-commutative evaluators

function canonicalJsonKey(node) {
  return JSON.stringify(node);
}

/**
 * Mutate a single program, applying one change per mutation.
 * Each mutation is grounded in one of the 9 operators.
 *
 * @param {object} program — the program tree to mutate
 * @param {Array} library — array of {id, program} promoted operators
 * @returns {Array} deduplicated set of mutant programs
 */
function mutateProgram(program, library) {
  const mutants = [];
  const seen = new Set();
  const push = (node) => {
    const key = canonicalJsonKey(node);
    if (!seen.has(key)) { seen.add(key); mutants.push(node); }
  };

  // NUL: Delete a sub-expression (simplify)
  // For a binary node, replace with a or b
  if (program.a) push(program.a);
  if (program.b) push(program.b);
  // For a unary node, replace with a seed or the inner expression
  if (program.of && !["diff", "lag"].includes(program.op)) {
    push(program.of);
  }

  // SEG: Split — replace a descendant with a child of that descendant
  if (program.a?.a) push({ ...program, a: program.a.a });
  if (program.a?.b) push({ ...program, a: program.a.b });
  if (program.b?.a) push({ ...program, b: program.b.a });
  if (program.b?.b) push({ ...program, b: program.b.b });
  if (program.of?.of) push({ ...program, of: program.of.of });

  // DEF: Wrap with sqrt or abs
  push({ op: "sqrt", of: program });
  push({ op: "abs", of: program });

  // SIG: Wrap with sin or cos
  push({ op: "sin", of: program });
  push({ op: "cos", of: program });

  // REC / SEG: Wrap with exp (recursive self-multiplication) or log (scale segmentation)
  push({ op: "exp", of: program });
  push({ op: "log", of: program });

  // EVA: Change the combinator (for binary ops)
  if (program.a && program.b) {
    for (const op of [...CONNECTORS, ...EVALUATORS]) {
      if (op !== program.op) push({ op, a: program.a, b: program.b });
    }
  }

  // CON + INS: Connect or insert by composing with library members.
  // Library members are referenced as opref nodes when available, so
  // promoted operators can trace their dependency graph.
  for (const lib of library) {
    const refNode = lib.id ? { op: "opref", id: lib.id, program: lib.program } : lib.program;
    // CON: forward order (commutative connectors)
    for (const op of CONNECTORS) {
      push({ op, a: program, b: JSON.parse(canonicalJsonKey(refNode)) });
    }
    // EVA as INS: both orders (non-commutative evaluators)
    for (const op of EVALUATORS) {
      push({ op, a: program, b: JSON.parse(canonicalJsonKey(refNode)) });
      push({ op, a: JSON.parse(canonicalJsonKey(refNode)), b: program });
    }
  }

  return mutants;
}

/**
 * Generate mutant programs from a pool of members.
 * Each member is mutated, and the mutants form the candidate pool for the
 * next induction round.
 *
 * To keep the pool tractable, CON/INS mutations only compose with the
 * TOP_K simplest members of `composeWith` — prevents O(n²) explosion while
 * still allowing new compositions to form each round.
 *
 * `composeWith` defaults to the members themselves, but the caller can pass
 * a distinct composition library (e.g. mutate fresh seeds while composing
 * them against already-promoted operators as opref nodes, so the helix can
 * re-enter: REC promotes, INS re-enters).
 *
 * @param {Array} members — array of {id?, program} to mutate
 * @param {object} [opts]
 * @param {Array} [opts.composeWith] — {id?, program} members to compose against (default: members)
 * @param {number} [opts.topK] — number of simplest composeWith members used (default 10)
 * @returns {Array} deduplicated mutant programs, sorted by description length
 */
export function mutatePrograms(members, { composeWith = members, topK = 10 } = {}) {
  const candidates = [];
  const seen = new Set();
  const push = (node) => {
    const key = canonicalJsonKey(node);
    if (!seen.has(key)) { seen.add(key); candidates.push(node); }
  };

  const byLength = (a, b) => descriptionLength(a.program) - descriptionLength(b.program) || canonicalKey(a.program).localeCompare(canonicalKey(b.program));
  const sorted = [...members].sort(byLength);
  // Only the simplest TOP_K composition members participate in CON/INS
  // mutations. Sorted by description length, then by key for determinism.
  const composeLib = [...composeWith].sort(byLength).slice(0, topK);

  for (const member of sorted) {
    const mutants = mutateProgram(member.program, composeLib);
    for (const m of mutants) push(m);
  }

  return candidates
    .filter((p) => !isSeriesNode(p))
    .sort((x, y) => descriptionLength(x) - descriptionLength(y) || canonicalKey(x).localeCompare(canonicalKey(y)));
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
