/**
 * PCFG Equation Discovery — Monte Carlo search over EO primitives
 *
 * Unlike derivation-map.md (which VERIFIES known equations against the
 * system's operator algebra), this module SEARCHES for unknown equations.
 *
 * Follows arXiv 2012.00428 "Probabilistic Grammars for Equation Discovery":
 * a probabilistic context-free grammar (PCFG) defines a distribution over
 * expression trees, where rule probabilities encode an Occam/parsimony
 * prior — shallow, simple expansions are more likely than deep, ornate
 * ones. Monte Carlo sampling draws candidate trees from that prior;
 * candidates are scored by data fit combined with the grammar's own prior
 * probability (no bolted-on external MDL penalty — the parsimony bias
 * IS the grammar).
 *
 * Terminals: numeric components pulled out of a fold's amplitude vectors
 * (operator/terrain/stance dims) plus small constants.
 * Functions: arithmetic (+ - * / ^) and the system's own EO primitives
 * (gaussianKernel, project, computeUncertainty, ...) wherever their
 * signatures reduce to numeric-in/numeric-out.
 */

import { gaussianKernel } from '../quantum/index.js';

// Michaelis-Menten saturation (mirrors emergence/physics/index.js's
// michaelisMentenSaturation without pulling in that module's broader
// dependency graph — same formula: v = Vmax·[S]/(Km+[S])).
function michaelisMentenSaturation(x, vmax = 1.0, km = 0.5) {
  return vmax * x / (km + x);
}

// ── Grammar ──
//
// Each rule bucket has a probability; within a bucket, choices are
// uniform. Terminal probability is deliberately the largest single
// mass so recursion tends to bottom out fast — this IS the parsimony
// prior (shallow trees dominate the prior distribution).

const RULES = [
  { kind: 'terminal', p: 0.45 },
  { kind: 'binary', p: 0.30, ops: ['+', '-', '*', '/'] },
  { kind: 'unary', p: 0.15, ops: ['neg', 'sin', 'cos', 'exp', 'log', 'sqrt', 'abs'] },
  { kind: 'primitive', p: 0.10, ops: ['gaussianKernel', 'michaelisMenten', 'entropyOf'] },
];

const CONSTANTS = [0, 0.1, 0.5, 1, 2, 3, Math.PI, Math.E];

function weightedChoice(items, weightOf, rng) {
  const total = items.reduce((s, it) => s + weightOf(it), 0);
  let r = rng() * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// ── Fold flattening: turn a fold's amplitude dicts into named scalar vars ──

/**
 * Flatten a fold (operator/terrain/stance amplitude dicts) into a flat
 * {name: number} var map, e.g. { 'operator.SIG': 0.31, 'terrain.Field': ... }.
 * Also accepts a plain scalar var map, which passes through unchanged.
 */
export function foldToVars(foldOrVars) {
  if (!foldOrVars) return {};
  if (foldOrVars.operator && foldOrVars.terrain && foldOrVars.stance) {
    const vars = {};
    for (const [dim, v] of Object.entries(foldOrVars.operator)) vars[`operator.${dim}`] = v;
    for (const [dim, v] of Object.entries(foldOrVars.terrain)) vars[`terrain.${dim}`] = v;
    for (const [dim, v] of Object.entries(foldOrVars.stance)) vars[`stance.${dim}`] = v;
    return vars;
  }
  return foldOrVars;
}

// ── Sampler ──
//
// Returns { tree, logProb } where logProb is the sum of log-probabilities
// of every rule expansion used to build the tree (the grammar's own prior
// probability of generating this exact derivation).

/**
 * Sample a random expression tree from the PCFG.
 * @param {string[]} varNames - available variable names (terminals)
 * @param {object} opts - { maxDepth = 4, rng = Math.random }
 */
export function sampleTree(varNames, opts = {}) {
  const { maxDepth = 4, rng = Math.random } = opts;
  let logProb = 0;

  function expand(depth) {
    const forceTerminal = depth >= maxDepth || varNames.length === 0 && CONSTANTS.length === 0;
    const rule = forceTerminal
      ? RULES[0]
      : weightedChoice(RULES, r => r.p, rng);
    // probability actually paid: if forced, the effective prior contribution
    // is still that of a terminal rule for scoring purposes
    logProb += Math.log(forceTerminal ? RULES[0].p : rule.p);

    if (rule.kind === 'terminal') {
      const useVar = varNames.length > 0 && rng() < 0.6;
      if (useVar) {
        const name = varNames[Math.floor(rng() * varNames.length)];
        logProb += Math.log(1 / varNames.length);
        return { type: 'var', name };
      }
      const c = CONSTANTS[Math.floor(rng() * CONSTANTS.length)];
      logProb += Math.log(1 / CONSTANTS.length);
      return { type: 'const', value: c };
    }

    if (rule.kind === 'binary') {
      const op = rule.ops[Math.floor(rng() * rule.ops.length)];
      logProb += Math.log(1 / rule.ops.length);
      const left = expand(depth + 1);
      const right = expand(depth + 1);
      return { type: 'binary', op, left, right };
    }

    if (rule.kind === 'unary') {
      const op = rule.ops[Math.floor(rng() * rule.ops.length)];
      logProb += Math.log(1 / rule.ops.length);
      const arg = expand(depth + 1);
      return { type: 'unary', op, arg };
    }

    // primitive: EO-native functions, arity depends on op
    const op = rule.ops[Math.floor(rng() * rule.ops.length)];
    logProb += Math.log(1 / rule.ops.length);
    if (op === 'gaussianKernel') {
      const a = expand(depth + 1);
      const b = expand(depth + 1);
      return { type: 'primitive', op, args: [a, b] };
    }
    // michaelisMenten, entropyOf: unary-shaped
    const a = expand(depth + 1);
    return { type: 'primitive', op, args: [a] };
  }

  const tree = expand(0);
  return { tree, logProb };
}

// ── Evaluator ──

function safeDiv(a, b) {
  if (Math.abs(b) < 1e-9) return a / (b < 0 ? -1e-9 : 1e-9);
  return a / b;
}

/**
 * Evaluate a sampled expression tree against a var map.
 * Returns NaN for any numerically invalid expansion (caller should
 * treat NaN as a failed candidate).
 */
export function evaluateTree(tree, vars) {
  switch (tree.type) {
    case 'var':
      return vars[tree.name] ?? 0;
    case 'const':
      return tree.value;
    case 'binary': {
      const l = evaluateTree(tree.left, vars);
      const r = evaluateTree(tree.right, vars);
      switch (tree.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return safeDiv(l, r);
        default: return NaN;
      }
    }
    case 'unary': {
      const v = evaluateTree(tree.arg, vars);
      switch (tree.op) {
        case 'neg': return -v;
        case 'sin': return Math.sin(v);
        case 'cos': return Math.cos(v);
        case 'exp': return Math.exp(Math.max(-50, Math.min(50, v)));
        case 'log': return Math.log(Math.abs(v) + 1e-9);
        case 'sqrt': return Math.sqrt(Math.abs(v));
        case 'abs': return Math.abs(v);
        default: return NaN;
      }
    }
    case 'primitive': {
      if (tree.op === 'gaussianKernel') {
        const x = evaluateTree(tree.args[0], vars);
        const y = evaluateTree(tree.args[1], vars);
        return gaussianKernel(x, y);
      }
      if (tree.op === 'michaelisMenten') {
        const x = evaluateTree(tree.args[0], vars);
        return michaelisMentenSaturation(Math.abs(x));
      }
      if (tree.op === 'entropyOf') {
        // Entropy of a single scalar treated as a 2-outcome Bernoulli
        // probability (clamped) — a numeric stand-in for
        // computeUncertainty's amplitudeEntropy on scalar inputs.
        const x = Math.max(1e-6, Math.min(1 - 1e-6, Math.abs(evaluateTree(tree.args[0], vars)) % 1 || 1e-6));
        return -x * Math.log2(x) - (1 - x) * Math.log2(1 - x);
      }
      return NaN;
    }
    default:
      return NaN;
  }
}

// ── Readable string form ──

export function treeToString(tree) {
  switch (tree.type) {
    case 'var': return tree.name;
    case 'const': return Number.isInteger(tree.value) ? String(tree.value) : tree.value.toFixed(3);
    case 'binary': return `(${treeToString(tree.left)} ${tree.op} ${treeToString(tree.right)})`;
    case 'unary': return `${tree.op}(${treeToString(tree.arg)})`;
    case 'primitive': return `${tree.op}(${tree.args.map(treeToString).join(', ')})`;
    default: return '?';
  }
}

function treeSize(tree) {
  switch (tree.type) {
    case 'var': case 'const': return 1;
    case 'binary': return 1 + treeSize(tree.left) + treeSize(tree.right);
    case 'unary': return 1 + treeSize(tree.arg);
    case 'primitive': return 1 + tree.args.reduce((s, a) => s + treeSize(a), 0);
    default: return 1;
  }
}

// ── Monte Carlo search ──

/**
 * Search for an equation that fits `dataset` — an array of
 * { fold, target } or { vars, target } — over the EO-primitive PCFG.
 *
 * Score = -fitError + lambda * priorLogProb
 * fitError is normalized RMSE; priorLogProb is the grammar's own log
 * probability of the derivation (parsimony term — always <= 0, so more
 * complex/unlikely derivations subtract more from the score).
 *
 * @param {Array} dataset
 * @param {object} opts - { numSamples=3000, maxDepth=4, lambda=0.02,
 *   topK=10, rng=Math.random, extraVars=[] }
 * @returns {Array} ranked [{ expression, tree, fitError, priorLogProb, score }]
 */
export function discoverEquation(dataset, opts = {}) {
  const {
    numSamples = 3000,
    maxDepth = 4,
    lambda = 0.02,
    topK = 10,
    rng = Math.random,
    extraVars = [],
  } = opts;

  const rows = dataset.map(d => ({
    vars: d.vars ? d.vars : foldToVars(d.fold),
    target: d.target,
  }));

  const varNameSet = new Set(extraVars);
  for (const row of rows) for (const k of Object.keys(row.vars)) varNameSet.add(k);
  const varNames = [...varNameSet];

  const targetSpread = Math.max(1e-6,
    Math.max(...rows.map(r => r.target)) - Math.min(...rows.map(r => r.target)));

  const seen = new Set();
  const candidates = [];

  for (let i = 0; i < numSamples; i++) {
    const { tree, logProb } = sampleTree(varNames, { maxDepth, rng });
    const expr = treeToString(tree);
    if (seen.has(expr)) continue;
    seen.add(expr);

    let sqErr = 0;
    let valid = true;
    for (const row of rows) {
      const pred = evaluateTree(tree, row.vars);
      if (!Number.isFinite(pred)) { valid = false; break; }
      const err = (pred - row.target) / targetSpread;
      sqErr += err * err;
    }
    if (!valid) continue;

    const fitError = Math.sqrt(sqErr / rows.length);
    const score = -fitError + lambda * logProb;
    candidates.push({ expression: expr, tree, fitError, priorLogProb: logProb, size: treeSize(tree), score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, topK);
}
