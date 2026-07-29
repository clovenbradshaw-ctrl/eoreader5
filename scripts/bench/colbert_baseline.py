#!/usr/bin/env python3
"""ColBERT-style late-interaction retrieval baseline for the eoreader5
retrieval benchmark (see ../bench-retrieval-vs-colbert.mjs, which is the
entry point — this file is its worker, invoked as a subprocess).

Two systems are computed here, both over the SAME frames/events the engine
just ranked with buildStore/surface:

  maxsim  -- the actual ColBERT scoring rule: encode every token, then score
             a candidate passage by summing, over each query token, its max
             cosine similarity to any token in the candidate (late
             interaction). This is what ColBERT does differently from a
             single-vector dense retriever.
  dense   -- a vanilla dense bi-encoder baseline: mean-pool each passage's
             token embeddings into one vector, rank by cosine similarity.
             Included so "ColBERT beats/loses to X" isn't confounded with
             "any embedding beats/loses to lexical" -- this isolates what
             late interaction specifically buys you.

TOKEN EMBEDDINGS: WordLlama's `l2_supercat` static table (32000 x 256,
distilled from a real LLM's input embedding matrix, MIT licensed, ships its
weights inside the `wordllama` pip package -- no network access needed at
run time). This is NOT the real ColBERTv2 checkpoint: that checkpoint lives
only on huggingface.co, which this sandbox's network policy blocks (pypi and
npm are allowed; huggingface.co returns 403 at the proxy). We load the
weights/tokenizer files directly rather than via `WordLlama.load()` because
that helper's HF-fallback path resolution has a directory-name bug
(singular "tokenizer" vs. the package's actual "tokenizers" folder) that
makes it try to re-download a file that is already sitting on disk --
loading the two bundled files ourselves sidesteps it entirely, no patching
of third-party code required.

Consequence for reading the results: "colbert-maxsim" tests the late-
interaction ARCHITECTURE, not the fully-trained ColBERTv2 retriever. Treat
any win/loss margin accordingly -- see scripts/bench/README.md.
"""
import argparse
import json
import os
import sys

import numpy as np
from safetensors import safe_open
from tokenizers import Tokenizer

import wordllama

WL_DIR = os.path.dirname(wordllama.__file__)
WEIGHTS_PATH = os.path.join(WL_DIR, "weights", "l2_supercat_256.safetensors")
TOKENIZER_PATH = os.path.join(WL_DIR, "tokenizers", "l2_supercat_tokenizer_config.json")


def load_embeddings():
    with safe_open(WEIGHTS_PATH, framework="np", device="cpu") as f:
        emb = f.get_tensor("embedding.weight").astype(np.float32)
    norm = np.linalg.norm(emb, axis=1, keepdims=True)
    norm[norm == 0] = 1
    return emb / norm


def load_tokenizer():
    return Tokenizer.from_file(TOKENIZER_PATH)


def token_matrix(frames, tok, E):
    """Concatenate every frame's (L2-normalized) token embeddings into one
    matrix, in frame order, and record each frame's [start, end) column
    range plus its mean-pooled vector for the dense baseline."""
    blocks = []
    bounds = []  # (start, end) per frame, aligned with frames list order
    pooled = np.zeros((len(frames), E.shape[1]), dtype=np.float32)
    cursor = 0
    for i, fr in enumerate(frames):
        ids = tok.encode(fr["text"]).ids
        if not ids:
            bounds.append((cursor, cursor))
            continue
        vecs = E[ids]
        blocks.append(vecs)
        bounds.append((cursor, cursor + len(ids)))
        cursor += len(ids)
        mean = vecs.mean(axis=0)
        n = np.linalg.norm(mean)
        pooled[i] = mean / n if n > 0 else mean
    big = np.concatenate(blocks, axis=0) if blocks else np.zeros((0, E.shape[1]), dtype=np.float32)
    return big, bounds, pooled


def query_tokens(text, tok, E):
    ids = tok.encode(text).ids
    if not ids:
        return np.zeros((0, E.shape[1]), dtype=np.float32)
    return E[ids]


def maxsim_scores(Q, big, bounds, candidate_end_frame):
    """MaxSim score for every candidate frame (index < candidate_end_frame,
    a prefix -- matches the engine's own order < cueOrder-1 restriction,
    since candidates are always "everything read before the cue")."""
    if Q.shape[0] == 0 or candidate_end_frame <= 0:
        return np.full(candidate_end_frame, -np.inf, dtype=np.float32)
    col_end = bounds[candidate_end_frame - 1][1]
    if col_end == 0:
        return np.full(candidate_end_frame, -np.inf, dtype=np.float32)
    sims = Q @ big[:col_end].T  # (Tq, col_end)
    starts = np.array([bounds[i][0] for i in range(candidate_end_frame)])
    # np.maximum.reduceat over empty segments repeats the previous result;
    # guard by tracking frame token counts and masking empties to -inf.
    seg_max = np.maximum.reduceat(sims, starts, axis=1)  # (Tq, candidate_end_frame)
    lengths = np.array([b - a for a, b in bounds[:candidate_end_frame]])
    seg_max[:, lengths == 0] = -np.inf
    scores = seg_max.sum(axis=0)
    scores[lengths == 0] = -np.inf
    return scores


def dense_scores(qvec, pooled, candidate_end_frame):
    if candidate_end_frame <= 0:
        return np.full(candidate_end_frame, -np.inf, dtype=np.float32)
    return pooled[:candidate_end_frame] @ qvec


def rank_of(scores, frames, source_offset, tolerance, top_k=10):
    order = np.argsort(-scores, kind="stable")
    rank = None
    top = []
    for i, idx in enumerate(order):
        if len(top) < top_k:
            top.append({"order": int(idx), "offset": frames[idx]["offset"], "score": float(scores[idx])})
        if rank is None and abs(frames[idx]["offset"] - source_offset) <= tolerance and np.isfinite(scores[idx]):
            rank = i + 1
        if len(top) >= top_k and rank is not None:
            break
    return rank, top


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("books", nargs="+")
    args = ap.parse_args()

    E = load_embeddings()
    tok = load_tokenizer()

    for book in args.books:
        frames_path = os.path.join(args.cache_dir, f"{book}-frames.json")
        events_path = os.path.join(args.cache_dir, f"{book}-events.json")
        if not (os.path.exists(frames_path) and os.path.exists(events_path)):
            print(f"colbert_baseline: skipping {book} (no cached frames/events)", file=sys.stderr)
            continue
        frames = json.load(open(frames_path, encoding="utf-8"))
        events = json.load(open(events_path, encoding="utf-8"))

        print(f"colbert_baseline: {book} -- tokenizing {len(frames)} frames", file=sys.stderr)
        big, bounds, pooled = token_matrix(frames, tok, E)

        results = {}
        for ev in events:
            cue_order = ev["cueOrder"]
            candidate_end = max(0, cue_order - 1)  # order < cueOrder - 1  =>  indices [0, cueOrder-2] inclusive
            Q = query_tokens(frames[cue_order]["text"], tok, E)

            m_scores = maxsim_scores(Q, big, bounds, candidate_end)
            m_rank, m_top = rank_of(m_scores, frames, ev["sourceOffset"], ev["charTolerance"])

            qvec = pooled[cue_order]
            d_scores = dense_scores(qvec, pooled, candidate_end)
            d_rank, d_top = rank_of(d_scores, frames, ev["sourceOffset"], ev["charTolerance"])

            results[ev["id"]] = {
                "maxsim": {"rank": m_rank, "top10": m_top},
                "dense": {"rank": d_rank, "top10": d_top},
            }

        out_path = os.path.join(args.cache_dir, f"{book}-colbert-results.json")
        json.dump(results, open(out_path, "w", encoding="utf-8"))
        print(f"colbert_baseline: {book} -- ranked {len(events)} events -> {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
