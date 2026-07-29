# Retrieval benchmark: associative-memory store vs. ColBERT-style late interaction

Books: pg84 (439 frames), pg2600 (3227 frames)

## pg84

### Frozen golden events (hand-verified ground truth; tier discipline check)

| event | tier | engine | colbert-maxsim | dense-cosine |
|---|---|---|---|---|
| wedding-night-verbatim | engine | hit (rank 3) | hit (rank 1) | MISS [rank 9, outside tolerance] |
| wedding-night-cue-only | model | gap (correct) [rank 74, outside tolerance] | gap (correct) [rank 67, outside tolerance] | gap (correct) [rank 35, outside tolerance] |

### Auto-derived long-range verbatim-motif recall (60 pairs, engine-tier by construction)

| system | Recall@1 | Recall@5 | Recall@10 | MRR |
|---|---|---|---|---|
| engine | 1/60 | 8/60 | 13/60 | 0.079 |
| colbert-maxsim | 1/60 | 6/60 | 10/60 | 0.073 |
| dense-cosine | 1/60 | 3/60 | 4/60 | 0.048 |

## pg2600

### Frozen golden events (hand-verified ground truth; tier discipline check)

| event | tier | engine | colbert-maxsim | dense-cosine |
|---|---|---|---|---|
| oak-transfigured | engine | hit (rank 1) | hit (rank 1) | hit (rank 4) |
| oak-epilogue-resonance | model | gap (correct) [rank 495, outside tolerance] | gap (correct) [rank 1186, outside tolerance] | gap (correct) [rank 404, outside tolerance] |

### Auto-derived long-range verbatim-motif recall (60 pairs, engine-tier by construction)

| system | Recall@1 | Recall@5 | Recall@10 | MRR |
|---|---|---|---|---|
| engine | 0/60 | 3/60 | 4/60 | 0.033 |
| colbert-maxsim | 1/60 | 2/60 | 3/60 | 0.029 |
| dense-cosine | 1/60 | 1/60 | 2/60 | 0.027 |

---
_Substitute-baseline caveat: "colbert-maxsim" is the real ColBERT late-interaction (MaxSim) algorithm run over WordLlama static token embeddings, not the pretrained ColBERTv2 checkpoint — huggingface.co (the checkpoint's only host) is blocked by this sandbox's network policy. See scripts/bench/README.md._
