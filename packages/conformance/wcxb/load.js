// Offline loader for the committed WCXB sample.
//
// Reads only from ./sample (bundled with the repo); performs no network I/O,
// so it is safe under the network-disabled conformance gate. To score the full
// 2,008-page benchmark, materialize it with scripts/wcxb-convert.mjs against a
// local CC-BY checkout and point loadTargets() at that output directory.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(HERE, "sample");

/**
 * Load normalized WCXB targets (`*.target.json`) from `dir`.
 * @param {string} [dir] directory of `*.target.json` files (default: ./sample)
 * @returns {Array<{file_id: string, page_type: string, with: string[], without: string[]}>}
 */
export function loadTargets(dir = SAMPLE_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".target.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

export { SAMPLE_DIR };
