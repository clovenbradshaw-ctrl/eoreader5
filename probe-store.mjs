// probe-store.mjs — score the store organ against the frozen memory golden.
import { readFileSync } from "fs";
import { frameText } from "./packages/engine/emergence/summary/text-organ.js";
import { buildStore, surface } from "./packages/engine/emergence/store/index.js";

const GOLDEN = JSON.parse(readFileSync(
  "./packages/engine/emergence/summary/golden/memory-golden.json", "utf-8"));
const TEXTS = {
  pg2600: "/Users/mlacy/Downloads/pg2600.txt",
  pg84: "/Users/mlacy/Documents/Default Project/pg84.txt",
};
const cache = {};
const load = (k) => (cache[k] ??= (() => {
  const text = readFileSync(TEXTS[k], "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = frameText(text);
  return { text, frames, store: buildStore(frames) };
})());

const findFlexible = (text, anchor) => {
  const re = new RegExp(anchor.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  return text.search(re);
};
const frameAt = (frames, at) => { let best = null; for (const f of frames) if (f.offset <= at) best = f; return best; };

const rt = GOLDEN.rankTolerance, ct = GOLDEN.charTolerance;
let pass = 0, applicable = 0;

for (const ev of GOLDEN.events) {
  const { text, frames, store } = load(ev.text);
  const cueAt = findFlexible(text, ev.cueAnchor);
  const srcAt = findFlexible(text, ev.sourceAnchor);
  if (cueAt < 0 || srcAt < 0) { console.log(`SKIP ${ev.id}: anchor missing (cue=${cueAt} src=${srcAt})`); continue; }
  const cueFrame = frameAt(frames, cueAt);
  const srcFrame = frameAt(frames, srcAt);

  // Only prior frames may surface (memory is of the past).
  const ranked = surface(store, cueFrame.text, { selfOrder: cueFrame.order, cueOrder: cueFrame.order })
    .filter((r) => r.order < cueFrame.order - 1);
  const rank = ranked.findIndex((r) => Math.abs(frames[r.order]?.offset - srcFrame.offset) <= ct) + 1;
  const hit = rank >= 1 && rank <= rt;

  const cuePct = (cueAt / text.length) * 100, srcPct = (srcAt / text.length) * 100;
  if (ev.tier === "engine") { applicable++; if (hit) pass++; }

  const verdict = ev.tier === "model"
    ? (hit ? "LEAK (should gap)" : "GAP ok")
    : (hit ? "HIT " : "MISS");
  console.log(`${verdict.padEnd(16)} ${ev.id.padEnd(26)} tier=${ev.tier.padEnd(6)} cue@${cuePct.toFixed(1)}% src@${srcPct.toFixed(1)}%  rank ${rank || ">list"}`);
}
console.log(`\nengine-tier recall: ${pass}/${applicable}`);
