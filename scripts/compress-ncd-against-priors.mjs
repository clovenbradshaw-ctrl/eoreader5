// scripts/compress-ncd-against-priors.mjs
// Normalized Compression Distance (NCD) between War and Peace and every
// full book text in the consolidated corpus. Pure gzip — no embeddings,
// no model, no semantics. Just structure.
//
// NCD(x, y) = (C(xy) - min(C(x), C(y))) / max(C(x), C(y))
// 0.0 = identical structure, 1.0+ = unrelated
//
// Usage: node scripts/compress-ncd-against-priors.mjs

import { readFileSync } from "fs";
import { readdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import zlib from "zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR = join(ROOT, "..", "eoPriors", "corpus_newconsolidated");
const TEXT_PATH = process.env.PG2600 || "/Users/mlacy/Downloads/pg2600.txt";

const ENC = new TextEncoder();
function cs(text) {
  return zlib.gzipSync(ENC.encode(text), { level: 9 }).length;
}

function ncd(ca, cb, cab) {
  return (cab - Math.min(ca, cb)) / Math.max(ca, cb);
}

const SAMPLE_BYTES = 50000; // 50KB per book

async function main() {
  console.error("Reading War and Peace...");
  const wpFull = readFileSync(TEXT_PATH, "utf8");
  const wpSample = wpFull.slice(0, Math.min(SAMPLE_BYTES, wpFull.length));
  const cWp = cs(wpSample);

  console.error("Scanning corpus...");
  const files = (await readdir(CORPUS_DIR)).filter(f => f.endsWith(".txt"));
  console.error(`Found ${files.length} books.`);

  const results = [];
  let i = 0;
  for (const file of files) {
    i++;
    const text = readFileSync(join(CORPUS_DIR, file), "utf8");
    const sample = text.slice(0, Math.min(SAMPLE_BYTES, text.length));
    const cBook = cs(sample);
    const cab = cs(wpSample + sample);
    const dist = ncd(cWp, cBook, cab);
    results.push({ file, ncd: dist, len: text.length });
    if (i % 25 === 0) console.error(`  ${i}/${files.length}`);
  }

  results.sort((a, b) => a.ncd - b.ncd);

  // Identify titles for top matches
  const pullScript = readFileSync(join(ROOT, "..", "eoPriors", "scripts", "pull-great-books-corpus.py"), "utf8");
  const lines = pullScript.split("\n");

  function lookupTitle(file) {
    const match = file.match(/pg(\d+)/);
    if (!match) return file.replace(/.*__/, "").replace(".txt", "");
    const id = match[1];
    for (const l of lines) {
      if (l.includes(`"${id}"`)) {
        const parts = l.match(/"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/);
        if (parts) return `${parts[3]} (${parts[2]})`;
      }
    }
    // Check diverse corpus
    const diverse = readFileSync(join(ROOT, "..", "eoPriors", "scripts", "pull-diverse-corpus.py"), "utf8");
    for (const l of diverse.split("\n")) {
      if (l.includes(`pg${id}`)) {
        const parts = l.match(/"([^"]+)"/);
        if (parts) return parts[1];
      }
    }
    return file.replace(/.*__/, "").replace(".txt", "");
  }

  console.log(`\nWar and Peace compressed against ${results.length} corpus books`);
  console.log("Protocol: NCD (gzip level 9), 50KB samples from each book");
  console.log("=".repeat(90));
  console.log("RANK  TITLE                                                 NCD       SIZE");
  console.log("-".repeat(90));
  for (let i = 0; i < 25; i++) {
    const r = results[i];
    const title = lookupTitle(r.file);
    console.log(`${(i+1).toString().padStart(2)}    ${title.padEnd(55)} ${r.ncd.toFixed(6)}  ${(r.len/1000).toFixed(0)}KB`);
  }

  console.log("\nBOTTOM 5:");
  for (let i = results.length - 5; i < results.length; i++) {
    const r = results[i];
    const title = lookupTitle(r.file);
    console.log(`     ${title.padEnd(55)} ${r.ncd.toFixed(6)}  ${(r.len/1000).toFixed(0)}KB`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
