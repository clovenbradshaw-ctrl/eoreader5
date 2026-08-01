import { loadCentroids, nearestCell, axisScores } from "../cell.js";
import { createEncoder } from "../embedder.js";
import { extractSVO, verbDelta } from "../svo.js";

const centroids = await loadCentroids();
const enc = await createEncoder("Xenova/all-MiniLM-L6-v2");

const tests = ["Pierre married Natasha.", "Andrew died.", "Napoleon conquered Europe."];
for (const text of tests) {
  const clauses = extractSVO(text);
  if (!clauses.length) { console.log("NO SVO:", text); continue; }
  const clause = clauses[0];
  const delta = await verbDelta(clause.text, clause.subject, clause.verb, clause.object, { encoder: enc });
  const mag = Math.sqrt(delta.reduce((s, x) => s + x * x, 0));
  const cell = nearestCell(delta, centroids);
  const axes = axisScores(delta, centroids);
  const best = {};
  for (const a of ["q1", "q2", "q3"]) {
    const entries = Object.entries(axes[a]);
    entries.sort((x, y) => y[1] - x[1]);
    best[a] = entries[0];
  }
  console.log(text + "  delta=" + mag.toFixed(3) + "  cell=" + cell.q1 + "," + cell.q2 + "," + cell.q3 + "(" + cell.operator + ")  sim=" + cell.similarity.toFixed(4) + "  q1=" + best.q1[0] + "(" + best.q1[1].toFixed(3) + ") q2=" + best.q2[0] + "(" + best.q2[1].toFixed(3) + ") q3=" + best.q3[0] + "(" + best.q3[1].toFixed(3) + ")");
}
console.log("DONE");
