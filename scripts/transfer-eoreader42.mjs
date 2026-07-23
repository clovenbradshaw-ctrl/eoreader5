#!/usr/bin/env node
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";

const DEFAULT_EXCLUDES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
]);

const RULES = [
  {
    repo: "eoreader5",
    reason: "pure semantic engine/spec candidate",
    patterns: [
      /^core\/(operators|cube|referents|semantic|events|frames|provenance|authority|resolution|projection|fold|enact)\//,
      /^packages\/(spec|engine|conformance)\//,
      /^schemas\//,
    ],
  },
  {
    repo: "eoreaderapp",
    reason: "app-owned sense/output/workflow/persistence/legacy route",
    patterns: [
      /^(app|ui|web|pages|routes|components|workflows|storage|stores|db|server|api)\//,
      /^(organs|sense|senses|output|outputs|adapters|renderers|legacy-launch)\//,
      /^core\/(io|files|network|models|embeddings|search|render|storage|matrix|rooms|turns)\//,
    ],
  },
  {
    repo: "eoprior",
    reason: "prior governance/build artifact source",
    patterns: [
      /^(eopriors|eoPriors|priors|prior|basis|bases|centroids|exemplars|compressors|projectors)\//,
      /^core\/(priors|basis|centroids|exemplars|compressors|projectors)\//,
    ],
  },
  {
    repo: "review",
    reason: "human classification required before transfer",
    patterns: [/.*/],
  },
];

export function buildTransferPlan(sourceRoot, { excludes = DEFAULT_EXCLUDES } = {}) {
  const root = resolve(sourceRoot);
  const files = walk(root, excludes);
  return files.map((absolutePath) => {
    const path = normalize(relative(root, absolutePath));
    const classificationPath = stripSourcePrefix(path);
    const rule = RULES.find((candidate) =>
      candidate.patterns.some((pattern) => pattern.test(classificationPath))
    );
    return {
      path,
      repo: rule.repo,
      reason: classificationPath === path ? rule.reason : `${rule.reason}; matched without src/ prefix`,
      sha256: sha256File(absolutePath),
    };
  });
}

export async function writePlan(plan, outputPath) {
  const grouped = plan.reduce((acc, item) => {
    acc[item.repo] ??= 0;
    acc[item.repo] += 1;
    return acc;
  }, {});
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ generated_by: "scripts/transfer-eoreader42.mjs", counts: grouped, files: plan }, null, 2)}\n`
  );
}

export async function applyPlan(plan, sourceRoot, targets) {
  const root = resolve(sourceRoot);
  const copied = [];
  for (const item of plan) {
    if (item.repo === "review") continue;
    const targetRoot = targets[item.repo];
    if (!targetRoot) continue;
    const destination = join(resolve(targetRoot), item.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(root, item.path), destination);
    copied.push({ ...item, destination });
  }
  return copied;
}

function walk(dir, excludes, out = []) {
  for (const entry of readdirSync(dir)) {
    if (excludes.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, excludes, out);
    else if (stat.isFile()) out.push(full);
  }
  return out.sort();
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function normalize(path) {
  return path.split(sep).join("/");
}

function stripSourcePrefix(path) {
  return path.startsWith("src/") ? path.slice(4) : path;
}

function parseArgs(argv) {
  const args = { targets: {}, apply: false, out: "transfer-plan.eoreader4.2.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--source") args.source = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--eoreader5") args.targets.eoreader5 = argv[++i];
    else if (arg === "--eoreaderapp") args.targets.eoreaderapp = argv[++i];
    else if (arg === "--eoprior") args.targets.eoprior = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.source) throw new Error("--source is required");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildTransferPlan(args.source);
  await writePlan(plan, args.out);
  if (args.apply) {
    await applyPlan(plan, args.source, args.targets);
  }
  const counts = plan.reduce((acc, item) => ({ ...acc, [item.repo]: (acc[item.repo] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ plan: args.out, counts }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
