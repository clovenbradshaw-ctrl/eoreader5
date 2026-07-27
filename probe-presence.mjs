import { readFileSync } from "fs";
import { frameText, extractSurfaces } from "./packages/engine/emergence/summary/text-organ.js";
import { admitSurfaces, presenceByFrame } from "./packages/engine/perceiver/text/presence.js";

function run(label, src, seed, aliases) {
  const text = readFileSync(src, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const frames = frameText(text);
  const names = [...new Set(extractSurfaces(text))];
  const { surfaces, events, gaps } = admitSurfaces(frames, seed, { nameSurfaces: names, aliases });
  const presence = presenceByFrame(frames, surfaces);
  let occ = 0, mass = 0;
  for (const n of presence.values()) if (n > 0) { occ++; mass += n; }
  console.log(`\n===== ${label}  seed="${seed}" =====`);
  console.log(`  surfaces (${surfaces.length}): ${surfaces.slice(0, 10).join(" | ")}`);
  console.log(`  frames occupied: ${occ}/${frames.length}   sightings: ${mass}`);
  if (gaps.length) for (const g of gaps) console.log(`  GAP: ${g.reason} tier=${g.tier} needsWitness=${g.needsWitness}`);
}
run("W&P / Natasha (holon)", "/Users/mlacy/Downloads/pg2600.txt", "Natásha", null);
run("Frankenstein / Creature — no prior", "/Users/mlacy/Documents/Default Project/pg84.txt", "creature", null);
run("Frankenstein / Creature — reader prior", "/Users/mlacy/Documents/Default Project/pg84.txt", "creature",
    ["the monster", "the wretch", "the fiend", "the daemon", "the demon", "the being"]);
