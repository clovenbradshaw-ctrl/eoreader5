"""
Benchmark: eoreader5 mechanical retrieval vs ColBERT v2 on War and Peace.

Usage:
    source ../colbert-venv/bin/activate
    python scripts/benchmark-colbert.py [--rebuild-index]
"""
import argparse, json, os, re, sys, time, hashlib

WAR_AND_PEACE = os.path.expanduser("~/Downloads/pg2600.txt")
INDEX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "colbert-index")
PASSAGES_FILE = os.path.join(INDEX_DIR, "passages.tsv")
PASSAGES_JSON = os.path.join(INDEX_DIR, "passages.json")
RESULTS_FILE = os.path.join(INDEX_DIR, "results.json")

QUERIES = [
    "Natasha's first ball",
    "He asked her to waltz",
    "Pierre's duel with Dolokhov",
    "the creature's creation",
    "war council before Austerlitz",
]


def sentence_split(text):
    """Match JS: buildSentenceIndex regex — split on sentence boundaries."""
    # /(?<=[.!?])\s+(?=["'""''«»]?\p{Lu})/gu
    parts = re.split(r'(?<=[.!?])\s+(?=[\u201c\u201d\u2018\u2019\u00ab\u00bb]?[A-Z\u0410-\u042f\u00c0-\u00d6\u00d8-\u00de])', text)
    return [p.strip() for p in parts if p.strip()]


def load_passages(max_sentences=None):
    text = open(WAR_AND_PEACE).read().replace('\r\n', '\n').replace('\r', '\n')
    sentences = sentence_split(text)
    if max_sentences:
        sentences = sentences[:max_sentences]
    out = []
    for i, sent in enumerate(sentences):
        clean = sent.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ').strip()
        if not clean:
            continue
        out.append({"id": len(out), "text": clean, "offset": 0})
    return text, out


def build_index(passages):
    from colbert import Indexer
    from colbert.infra import Run, RunConfig, ColBERTConfig

    os.makedirs(INDEX_DIR, exist_ok=True)

    # Write passages.tsv (for ColBERT)
    with open(PASSAGES_FILE, "w") as f:
        for p in passages:
            f.write(f"{p['id']}\t{p['text']}\n")

    print(f"Indexing {len(passages)} passages with ColBERT v2 ...", flush=True)
    t0 = time.time()

    with Run().context(RunConfig(nranks=1, experiment="wp_benchmark", root=INDEX_DIR)):
        config = ColBERTConfig(
            doc_maxlen=180,
            nbits=2,
            kmeans_niters=4,
        )
        indexer = Indexer(checkpoint="colbert-ir/colbertv2.0", config=config)
        indexer.index(name="wp_benchmark.nbits=2", collection=PASSAGES_FILE, overwrite=True)

    elapsed = time.time() - t0
    print(f"  ColBERT indexing complete in {elapsed:.1f}s")
    return True


def search_colbert(searcher, query, k=3):
    """Search with ColBERT and return [(pid, score, text), ...]."""
    results = searcher.search(query, k=k)
    out = []
    for pid, rank, score in zip(*results):
        out.append({"pid": int(pid), "rank": int(rank), "score": float(score)})
    return out


def run_colbert(passages, k=3):
    from colbert import Searcher
    from colbert.infra import Run, RunConfig

    lookup = {p["id"]: p["text"] for p in passages}

    with Run().context(RunConfig(nranks=1, experiment="wp_benchmark", root=INDEX_DIR)):
        searcher = Searcher(index="wp_benchmark.nbits=2")

        for q in QUERIES:
            t0 = time.time()
            results = search_colbert(searcher, q, k=k)
            elapsed = (time.time() - t0) * 1000
            # Resolve passage text from id
            resolved = []
            for r in results:
                resolved.append({
                    **r,
                    "text": lookup.get(r["pid"], "[missing]"),
                })
            yield q, resolved, elapsed


def run_mechanical(k=3):
    """Run the JS mechanical retriever via subprocess and parse JSON output."""
    import subprocess

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "run-retrieval-json.mjs")
    result = subprocess.run(
        ["node", script, "--k", str(k), "--passages", PASSAGES_JSON],
        capture_output=True, text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env={**os.environ, "NODE_PATH": ""},
    )
    if result.returncode != 0:
        print(f"JS error: {result.stderr}", file=sys.stderr)
        return []
    data = json.loads(result.stdout)
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild-index", action="store_true", help="Force rebuild ColBERT index")
    parser.add_argument("--k", type=int, default=3)
    parser.add_argument("--max-sentences", type=int, default=5000, help="Limit corpus to first N sentences")
    args = parser.parse_args()
    k = args.k
    max_sentences = args.max_sentences

    print(f"=== Loading War and Peace (max {max_sentences} sentences) ===")
    t0 = time.time()
    text, passages = load_passages(max_sentences=max_sentences)
    print(f"  {len(passages)} sentences in {time.time() - t0:.1f}s")

    # Save passages for JS retriever
    os.makedirs(INDEX_DIR, exist_ok=True)
    with open(PASSAGES_JSON, "w") as f:
        json.dump([{"id": p["id"], "text": p["text"]} for p in passages], f)

    # --- ColBERT ---
    index_exists = os.path.exists(os.path.join(INDEX_DIR, "indexes", "wp_benchmark.nbits=2"))
    if args.rebuild_index or not index_exists:
        build_index(passages)

    print(f"\n=== ColBERT v2 (k={k}) ===")
    colbert_results = {}
    for q, results, elapsed in run_colbert(passages, k=k):
        print(f'\n--- "{q}" ({elapsed:.0f}ms) ---')
        colbert_results[q] = []
        for r in results:
            text_snippet = r["text"][:130].replace("\n", " ")
            print(f"  [{r['score']:.4f}] pid={r['pid']}  \"{text_snippet}...\"")
            colbert_results[q].append(r)

    # --- Mechanical (eoReader) ---
    print(f"\n=== Mechanical (char-trigram signal, k={k}) ===")
    mechanical_results = run_mechanical(k=k)
    for entry in mechanical_results:
        q = entry["query"]
        print(f'\n--- "{q}" ---')
        for r in entry["results"]:
            pct = r["score"]
            text_snippet = r["text"][:130].replace("\n", " ")
            print(f"  [{pct:.1%}] offset={r['offset']}  \"{text_snippet}...\"")

    # --- Save results ---
    output = {
        "corpus": "War and Peace (pg2600.txt)",
        "sentence_count": len(passages),
        "k": k,
        "colbert": {q: results for q, results in colbert_results.items()},
        "mechanical": mechanical_results,
    }
    os.makedirs(INDEX_DIR, exist_ok=True)
    with open(RESULTS_FILE, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nResults saved to {RESULTS_FILE}")


if __name__ == "__main__":
    main()
