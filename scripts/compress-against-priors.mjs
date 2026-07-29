// Compress War and Peace (pg2600) against all corpus priors using eo-compression protocol.
// Reads priors from eoPriors as content, compresses fresh from the full text.
//
// Usage: node scripts/compress-against-priors.mjs

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createEmbedder } from "../../eoPriors/src/embed.js";
import { loadCentroids, scoreAgainstCentroids } from "../../eoPriors/src/compress.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EOPRIORS = join(ROOT, "..", "eoPriors");

const TEXT_PATH = process.env.PG2600 || "/Users/mlacy/Downloads/pg2600.txt";

async function main() {
  // 1. Load centroids (27 phasepost cell vectors)
  console.error("Loading centroids...");
  const centroids = await loadCentroids();

  // 2. Load corpus prior per-book distributions
  console.error("Loading corpus prior (cube)...");
  const cubePrior = JSON.parse(readFileSync(join(EOPRIORS, "priors", "corpus-prior-cube.json"), "utf8"));
  const books = cubePrior.generated_from.per_book;
  const cellKeys27 = Object.keys(books[0].distribution_ppm);

  // 3. Embed War and Peace
  console.error("Warming embedder...");
  const embedder = createEmbedder();
  await embedder.warm();

  console.error("Embedding War and Peace (sampled)...");
  const wpFull = readFileSync(TEXT_PATH, "utf8");
  const SAMPLE_SIZE = 2000;
  const NUM_SAMPLES = 50;
  const step = Math.max(1, Math.floor((wpFull.length - SAMPLE_SIZE) / Math.max(1, NUM_SAMPLES - 1)));
  let sumVec = null;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const offset = Math.min(i * step, wpFull.length - SAMPLE_SIZE);
    const chunk = wpFull.slice(offset, offset + SAMPLE_SIZE);
    const vec = await embedder.embed(chunk);
    if (!sumVec) sumVec = new Float32Array(vec.length);
    for (let j = 0; j < vec.length; j++) sumVec[j] += vec[j];
  }
  let norm = 0;
  for (let j = 0; j < sumVec.length; j++) norm += sumVec[j] * sumVec[j];
  norm = Math.sqrt(norm);
  const wpVec = new Float32Array(sumVec.length);
  for (let j = 0; j < sumVec.length; j++) wpVec[j] = sumVec[j] / norm;

  // 4. Score W&P against centroids
  const wpScores = scoreAgainstCentroids(wpVec, centroids);

  console.error("\nW&P top-5 phasepost cells:");
  const sorted = Object.entries(wpScores).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted.slice(0, 5)) {
    console.error(`  ${k}: ${v.toFixed(4)}`);
  }

  // 5. Compare against each book's distribution in the cube prior
  function toVec(dist) {
    // Normalize the PPM distribution to a unit vector
    let n = 0;
    for (const k of cellKeys27) n += (dist[k] || 0) ** 2;
    n = Math.sqrt(n);
    if (n === 0) return null;
    const v = {};
    for (const k of cellKeys27) v[k] = (dist[k] || 0) / n;
    return v;
  }

  const results = [];
  for (const book of books) {
    const bookDist = toVec(book.distribution_ppm);
    if (!bookDist) continue;

    // Cosine similarity between W&P embedding scores and book's fold distribution
    let dot = 0, nWp = 0, nBk = 0;
    for (const k of cellKeys27) {
      const a = wpScores[k] || 0;
      const b = bookDist[k] || 0;
      dot += a * b;
      nWp += a * a;
      nBk += b * b;
    }
    const sim = Math.sqrt(nWp) * Math.sqrt(nBk) > 0
      ? dot / (Math.sqrt(nWp) * Math.sqrt(nBk)) : 0;

    results.push({ file: book.file, sim, spans: book.spans });
  }

  results.sort((a, b) => b.sim - a.sim);

  // 6. Output results
  console.log(`\nWar and Peace compressed against ${results.length} corpus books`);
  console.log(`Protocol: eo-compression@1.0.0 (MiniLM embed → 27 centroid cosine)`);
  console.log(`Source: English translation (pg2600) vs corpus_newconsolidated (original languages)`);
  console.log("=".repeat(80));
  console.log("RANK  FILE                                            COSINE    SPANS");
  console.log("-".repeat(80));
  for (let i = 0; i < 30; i++) {
    const r = results[i];
    console.log(`${(i+1).toString().padStart(2)}    ${r.file.padEnd(50)} ${r.sim.toFixed(6)}  ${r.spans}`);
  }

  console.log("\nBOTTOM 5:");
  for (let i = results.length - 5; i < results.length; i++) {
    const r = results[i];
    console.log(`     ${r.file.padEnd(50)} ${r.sim.toFixed(6)}  ${r.spans}`);
  }

  // 7. Look up book titles for top matches
  console.log("\n\nTop matches resolved (via pull-great-books-corpus.py & Gutenberg URLs):");
  console.log("-".repeat(80));
  const titleMap = {
    "pg59299": "War and Peace (Tolstoy, Russian)",
    "pg59300": "Anna Karenina (Tolstoy, Russian)",
    "pg59301": "Dead Souls (Gogol, Russian)",
    "pg58250": "Crime and Punishment (Dostoevsky, Russian)",
    "pg58251": "The Brothers Karamazov (Dostoevsky, Russian)",
    "pg58499": "Fear and Trembling (Kierkegaard, Danish)",
    "pg58228": "Phenomenology of Spirit (Hegel, German)",
    "pg5700": "The Prince (Machiavelli, Italian)",
    "pg8800": "Inferno (Dante, Italian)",
    "pg8801": "Purgatorio (Dante, Italian)",
    "pg8802": "Paradiso (Dante, Italian)",
    "pg12052": "Pantagruel (Rabelais, French)",
    "pg60020": "Beyond Good and Evil (Nietzsche, German)",
    "pg22367": "Works (Kafka, German)",
    "pg2000": "Don Quixote (Cervantes, Spanish)",
    "pg800": "? (Gutenberg 800)",
    "pg7000": "Kalevala (Finnish)",
    "pg4280": "? (Gutenberg 4280)",
    "pg45840": "? (Gutenberg 45840)",
  };
  for (let i = 0; i < 15; i++) {
    const r = results[i];
    let label = titleMap[Object.keys(titleMap).find(k => r.file.includes(k))] || r.file;
    console.log(`${(i+1).toString().padStart(2)}. ${label}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
