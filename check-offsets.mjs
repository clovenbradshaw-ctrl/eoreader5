import { readFileSync } from "fs";
import { entityFold } from "./packages/engine/emergence/summary/entity-fold.js";

const SRC = "/Users/mlacy/Downloads/pg2600.txt";
const wp = readFileSync(SRC, "utf-8");
const packet = entityFold(wp, "Natasha Rostova", { title: "Natasha Rostova" });

// frameText normalizes line endings; offsets index that normalized string.
const norm = wp.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

let ok = 0, bad = 0, nul = 0;
for (const s of packet.spans) {
  if (s.offset == null) { nul++; console.log(`[${s.idx}] offset=null`); continue; }
  const at = norm.slice(s.offset, s.offset + 2000).trim();
  const match = at.startsWith(s.text.slice(0, 60));
  if (match) { ok++; } else { bad++; }
  console.log(
    `[${s.idx}] offset=${String(s.offset).padStart(9)} ${((s.offset / norm.length) * 100).toFixed(1).padStart(5)}%  ${match ? "RESOLVES" : "MISMATCH"}  ${JSON.stringify(s.text.slice(0, 50))}`
  );
}
console.log(`\nresolves=${ok}  mismatch=${bad}  null=${nul}  total=${packet.spans.length}`);
