#!/usr/bin/env node
// wcxb-convert — dev-time only. Turns a local WCXB (Foley, 2026) checkout into
// normalized target files the conformance harness can score offline.
//
// This is NOT part of packages/engine and is NOT run by the conformance gate.
// It uses node:fs and node:crypto only — no network. Fetch the CC-BY-4.0
// dataset yourself first (it is not vendored into this repo):
//
//   git clone https://github.com/Murrough-Foley/web-content-extraction-benchmark
//   # or: huggingface.co/datasets/murrough-foley/web-content-extraction-benchmark
//   # arXiv:2605.21097 — dataset is CC-BY-4.0, attribute Murrough Foley.
//
// WCXB v2.0 ground-truth layout (per the dataset card):
//   <root>/wcxb/{dev,test}/ground-truth/<file_id>.json
//   <root>/wcxb/{dev,test}/html/<file_id>.html
// Each ground-truth JSON has: schema_version, url, file_id,
//   _internal.page_type.{primary,confidence},
//   ground_truth.{title,author,publish_date,main_content,with[],without[]}.
//
// We emit one normalized `<file_id>.target.json` per page (the fields the
// scorer needs), matching packages/conformance/wcxb/sample/*.target.json.
// We deliberately do NOT emit the raw main_content or HTML: the engine never
// sees HTML (docs/architecture.md), and the app owns decoding to an
// ObservationEnvelope. The harness scores extraction against with[]/without[].
//
// Usage:
//   node scripts/wcxb-convert.mjs --in <wcxb-root> --split dev --out <dir>

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

function parseArgs(argv) {
  const args = { split: "dev" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (key) args[key] = argv[i + 1];
  }
  if (!args.in || !args.out) {
    console.error("usage: node scripts/wcxb-convert.mjs --in <wcxb-root> --split <dev|test> --out <dir>");
    process.exit(2);
  }
  return args;
}

function normalize(raw, fallbackId) {
  const gt = raw.ground_truth ?? {};
  const pageType = raw._internal?.page_type?.primary ?? "Unknown";
  return {
    schema_version: "wcxb-normalized@1",
    synthetic: false,
    source: "WCXB (Foley 2026, arXiv:2605.21097), CC-BY-4.0",
    file_id: raw.file_id ?? fallbackId,
    url: raw.url ?? null,
    page_type: pageType,
    title: gt.title ?? null,
    author: gt.author ?? null,
    publish_date: gt.publish_date ?? null,
    with: Array.isArray(gt.with) ? gt.with : [],
    without: Array.isArray(gt.without) ? gt.without : [],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const gtDir = join(args.in, "wcxb", args.split, "ground-truth");
  mkdirSync(args.out, { recursive: true });

  const files = readdirSync(gtDir).filter((f) => f.endsWith(".json"));
  let count = 0;
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(gtDir, f), "utf8"));
    const fileId = basename(f, ".json");
    const normalized = normalize(raw, fileId);
    writeFileSync(
      join(args.out, `${fileId}.target.json`),
      JSON.stringify(normalized, null, 2) + "\n",
    );
    count += 1;
  }
  console.log(`wrote ${count} normalized targets from ${args.split} to ${args.out}`);
}

main();
