#!/usr/bin/env node
// Fetch War and Peace (Project Gutenberg #2600) into data/pg2600.txt.
// The corpus is test data, not source — it is gitignored and fetched on
// demand. Set WP_PATH to point the test scripts somewhere else.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = process.env.WP_PATH ?? join(root, "data", "pg2600.txt");

if (existsSync(dest)) {
  console.log(`already present: ${dest}`);
  process.exit(0);
}

const URL = "https://www.gutenberg.org/files/2600/2600-0.txt";
console.log(`fetching ${URL} ...`);
const res = await fetch(URL);
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const text = await res.text();
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, text);
console.log(`wrote ${text.length} chars to ${dest}`);
