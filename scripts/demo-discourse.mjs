import { readFileSync } from "fs";
import { buildSentenceIndex, RetrievalSession } from "../packages/engine/retrieval/index.js";
import { DiscourseState } from "../packages/engine/discourse/index.js";
import { fold } from "../packages/engine/quantum/index.js";

const text = readFileSync("/Users/mlacy/Downloads/pg2600.txt", "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
console.log("=== Indexing ===");
const index = buildSentenceIndex(text);
console.log(`  ${index.length} sentences\n`);

const session = new RetrievalSession();
const discourse = new DiscourseState();

async function turn(query, intent) {
  console.log(`\n--- Turn ${discourse.turnCount + 1}: "${query}" (${intent}) ---`);

  const ctx = discourse.getContext();
  if (ctx) {
    const loc = ctx.location != null ? ` @${ctx.location}` : "";
    console.log(`  Context: ${ctx.nActive} motifs, location${loc}` +
      (ctx.topMotifs.length ? `, top: ${ctx.topMotifs.map((m) => `${m.id}[${m.activation}](${m.face})`).join(", ")}` : ""));
  }

  const results = session.query(index, query, { limit: 3, minScore: 0.05, context: ctx });
  console.log(`  Results: ${results.length}`);
  for (const r of results.slice(0, 2)) {
    console.log(`    [${(r.score * 100).toFixed(1)}%] offset=${r.offset}  "${r.text.slice(0, 110).replace(/\n/g, " ")}..."`);
  }

  // REC
  const top = results[0];
  if (top) {
    discourse.update(fold(top.text), 0.5, [], intent, results.slice(0, 3), query);
    discourse.pushTopic(query, fold(top.text));
  } else {
    discourse.update(fold(query), 0.1, [], intent, [], query);
  }

  const s = discourse.summary();
  console.log(`  State: ${s.motifsActive} motifs/${s.totalMotifs} total, ${s.referents} refs, locAct=${s.locationActivation}`);
}

// ── Test pronoun channeling ──────────────────────────────────────────────────

await turn("Natasha's first ball", "query");
await turn("Who was she with?", "detail");     // "she" channels Natasha referent
await turn("Did he propose?", "verify");         // "he" channels Andrei? or whoever's active
await turn("What happened to them?", "explore");  // "them" channels both
await turn("her mother", "detail");              // "her" channels Natasha

console.log("\n\n=== Final state ===");
console.log(JSON.stringify(discourse.summary(), null, 2));
