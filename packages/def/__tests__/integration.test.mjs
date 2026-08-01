import { createEncoder } from '../embedder.js';
import { extractSVO, verbDelta } from '../svo.js';
import { loadCentroids, nearestCell, axisScores } from '../cell.js';

const enc = await createEncoder('Xenova/all-MiniLM-L6-v2');
const centroids = await loadCentroids();

const tests = [
  'Pierre married Natasha.',
  'Andrew died from his wounds.',
  'The cat sat on the mat.',
  'Napoleon conquered Europe.',
];

for (const text of tests) {
  const clauses = extractSVO(text);
  if (!clauses.length) { console.log(`NO SVO: "${text}"`); continue; }
  const { svo, verb } = clauses[0];
  const delta = await verbDelta(enc, svo, verb, { strategy: 'mask' });
  const mag = Math.sqrt(delta.reduce((s, x) => s + x * x, 0));
  const cell = nearestCell(delta, centroids);
  const axes = axisScores(delta, centroids);
  const best = {};
  for (const a of ['q1', 'q2', 'q3']) {
    best[a] = axes[a].toSorted((x, y) => y.score - x.score)[0];
  }
  console.log(
    `"${text}"\n  delta=${mag.toFixed(3)}  cell=(${cell.q1},${cell.q2},${cell.q3})  dist=${cell.distance.toFixed(4)}` +
    `\n  q1=${best.q1.label}(${best.q1.score.toFixed(3)}) q2=${best.q2.label}(${best.q2.score.toFixed(3)}) q3=${best.q3.label}(${best.q3.score.toFixed(3)})`
  );
}
