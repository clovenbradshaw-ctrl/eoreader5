import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { entityFold } from "../packages/engine/emergence/summary/entity-fold.js";

const text = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const packet = entityFold(text, "Natasha Rostova", { title: "Natasha Rostova", sceneCount: 12, withEchoes: false });

const textLen = text.length;
console.log("=== Selected spans ===");
for (const s of packet.spans) {
  const pct = ((s.offset / textLen) * 100).toFixed(1);
  const excerpt = text.slice(s.offset, s.offset + 150).replace(/\n/g, " ").slice(0, 150);
  console.log(`${pct}%  score=${s.score?.toFixed(4)}  nl=${s.nonLexicalBoost?.toFixed(3)}  vc=${s.verbClass ?? "?"}  "${excerpt}"`);
}

console.log("\n=== Golden anchors ===");
const anchors = [
  ["first-appearance", 3.0, "This black-eyed, wide-mouthed girl"],
  ["first-ball", 37.2, "He asked her to waltz."],
  ["uncle-folk-dance", 41.6, "Where, how, and when had this young countess"],
  ["anatole-letter", 46.9, "With trembling hands Natásha held that passionate love letter"],
  ["crisis", 48.2, "Natásha looked from one to the other as a hunted and wounded animal"],
  ["carts-anger", 70.5, "I consider, Natásha suddenly almost shouted"],
  ["carts-action", 70.6, "Papa! Mamma! May I see to it? May I?..."],
  ["deathbed", 75.4, "Forgive me! she whispered"],
];
for (const [id, pct, anchor] of anchors) {
  const at = text.indexOf(anchor);
  const excerpt = text.slice(at, at + 150).replace(/\n/g, " ").slice(0, 150);
  console.log(`${pct}%  ${id}  at=${at}  "${excerpt}"`);
}
