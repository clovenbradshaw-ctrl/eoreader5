// build-natasha-spans.mjs — Build a grounded Natasha summary where every
// claim carries a span that resolves back into the source text by offset.

import { readFileSync, writeFileSync } from "fs";

const SRC = "/Users/mlacy/Downloads/pg2600.txt";
const wp = readFileSync(SRC, "utf-8");

// Each span is anchored by an exact quote from the text. We locate it to get
// a real offset, so the span is a pointer into the source, not a copy of it.
const SPANS = [
  {
    id: "first-appearance",
    section: "Who they are",
    anchor: "This black-eyed, wide-mouthed girl, not pretty but full of life",
    len: 300,
    claim:
      "Natasha enters the novel not as a conventional heroine but as unmediated vitality — explicitly not pretty, explicitly full of life.",
  },
  {
    id: "name-day-laugh",
    section: "Who they are",
    anchor: "“Do you see?... My doll... Mimi... You see...”",
    len: 280,
    claim:
      "Tolstoy measures her by feeling rather than accomplishment: her first sustained act in the book is laughter that disarms even the prim visitor.",
  },
  {
    id: "first-ball",
    section: "Key moments",
    anchor: "He asked her to waltz.",
    len: 400,
    claim:
      "The first ball. Her unselfconscious joy — not her beauty — is what disarms the war-weary prince.",
  },
  {
    id: "ball-contrast-helene",
    section: "Key moments",
    anchor: "bare arms and neck were not beautiful",
    len: 380,
    claim:
      "The Hélène contrast is made explicit in the ball scene itself: Hélène is 'hardened by a varnish' of being looked at; Natasha is exposed for the first time.",
  },
  {
    id: "uncle-folk-dance",
    section: "Key moments",
    anchor: "Where, how, and when had this young countess",
    len: 460,
    claim:
      "At Uncle's estate Tolstoy makes his most explicit claim about her: a French-educated countess carries something 'inimitable and unteachable' Russian.",
  },
  {
    id: "anatole-letter",
    section: "Key moments",
    anchor: "With trembling hands Natásha held that passionate love letter",
    len: 330,
    claim:
      "The seduction works because the letter is a forgery she fills with her own feeling — Dólokhov composed it, and she 'found in it an echo of all that she herself imagined she was feeling.'",
  },
  {
    id: "crisis-hunted-animal",
    section: "Key moments",
    anchor: "Natásha looked from one to the other as a hunted and wounded animal",
    len: 300,
    claim:
      "Her lowest point. The novel's cruelest image of her is not moral condemnation but an animal at bay.",
  },
  {
    id: "carts-anger",
    section: "Key moments",
    anchor: "“I consider,” Natásha suddenly almost shouted",
    len: 330,
    claim:
      "The Moscow evacuation. Her moral authority arrives first as rage, not composure — 'Are we despicable Germans?'",
  },
  {
    id: "carts-action",
    section: "Key moments",
    anchor: "“Papa! Mamma! May I see to it? May I?...”",
    len: 380,
    claim:
      "Transformation with real consequences in the world: she converts the anger into a household order that gives the carts to the wounded.",
  },
  {
    id: "deathbed-forgive",
    section: "Key moments",
    anchor: "“Forgive me!” she whispered",
    len: 420,
    claim:
      "The reconciliation. Forgiveness arrives too late for anything but grace — and Tolstoy insists on her plainness at the exact moment of her greatest beauty.",
  },
];

const resolved = SPANS.map((s) => {
  const offset = wp.indexOf(s.anchor);
  if (offset === -1) throw new Error(`ANCHOR NOT FOUND: ${s.id} — ${s.anchor}`);
  if (wp.indexOf(s.anchor, offset + 1) !== -1) {
    console.warn(`  ! ambiguous anchor (first match used): ${s.id}`);
  }
  const text = wp.slice(offset, offset + s.len);
  // Percentage through the book — gives narrative position for ordering.
  const position = +((offset / wp.length) * 100).toFixed(1);
  return { ...s, offset, length: s.len, position, text };
});

// Verify every span round-trips: re-read from source at the stored offset.
const verify = readFileSync(SRC, "utf-8");
for (const s of resolved) {
  const back = verify.slice(s.offset, s.offset + s.length);
  if (back !== s.text) throw new Error(`ROUND-TRIP FAILED: ${s.id}`);
}
console.log(`✓ ${resolved.length} spans resolved and round-trip verified against ${SRC}`);

writeFileSync(
  "natasha-spans.json",
  JSON.stringify({ source: SRC, sourceLength: wp.length, entity: "Natásha Rostóva", spans: resolved }, null, 2)
);

// Emit a readable grounded summary.
const bySection = {};
for (const s of resolved) (bySection[s.section] ??= []).push(s);

let md = `# Natasha Rostova — grounded character summary\n\n`;
md += `Source: \`${SRC}\` (${wp.length.toLocaleString()} chars)\n`;
md += `Every claim below carries a span that resolves back to the source by character offset.\n\n---\n\n`;

for (const [section, items] of Object.entries(bySection)) {
  md += `## ${section}\n\n`;
  for (const s of items.sort((a, b) => a.offset - b.offset)) {
    md += `### ${s.claim}\n\n`;
    md += `> ${s.text.trim().replace(/\n/g, "\n> ")}\n\n`;
    md += `\`${s.id}\` — offset **${s.offset.toLocaleString()}**, length ${s.length}, ${s.position}% through the book\n\n`;
  }
}
writeFileSync("natasha-grounded.md", md);
console.log("✓ wrote natasha-spans.json and natasha-grounded.md");
