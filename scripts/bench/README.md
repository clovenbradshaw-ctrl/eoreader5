# Retrieval benchmark: associative-memory store vs. ColBERT-style late interaction

Entry point: `node scripts/bench-retrieval-vs-colbert.mjs [pg84] [pg2600]` (run
from the repo root; defaults to both books). It needs the two source texts —
see `EO_PG84_PATH`/`EO_PG2600_PATH` in that file, same convention as
`scripts/score-memory-golden.mjs`. Python side needs
`pip install -r scripts/bench/requirements.txt`.

## What this tests

Our retrieval organ is `packages/engine/emergence/store` (`buildStore` /
`surface`): Hebbian sparse-code associative memory (see that file's header
for the biology). It is not a general document search index — it models
*"what prior passage does this new passage bring to mind"* inside one text.
ColBERT is the standard comparison point because it's the canonical
architecture for the alternative approach: dense, per-token semantic
matching (late interaction / MaxSim) instead of sparse lexical co-occurrence.

The benchmark runs both retrievers over the **same frames** (the engine's own
`frameText` windows) and the **same query→target pairs**, two ways:

1. **Frozen `memory-golden.json` events** (4, hand-verified) — the acceptance
   test for *tier discipline*. Two events are `engine`-tier (verbatim/wired
   recall the store should hit) and two are deliberately `model`-tier (pure
   thematic/synonymy resonance — e.g. "union" never literally co-occurs with
   the threat passage; the two oak passages share no phrasing). The engine
   must **gap** those, never fake them (see `docs/nameless-referent.md` and
   the "Tier discipline" section of `AGENTS.md`). This is the case where a
   semantic retriever is *expected* to behave differently from ours — and
   where "ColBERT recalls it, we don't" is not automatically a loss for us:
   surfacing an un-evidenced thematic link is exactly the failure mode this
   engine is built to refuse.
2. **Auto-derived long-range verbatim-motif pairs** (mined mechanically from
   `store.posting` — every idf/df-gated motif that recurs, earliest ↔ latest
   occurrence, filtered to pairs far enough apart that they aren't just
   adjacent-frame overlap). These are `engine`-tier by construction, so they
   give Recall@1/5/10 and MRR at a much larger N than the 4 frozen events
   allow, without touching or diluting the frozen golden.

## Why "ColBERT-style" and not ColBERT

This sandbox's outbound network policy allows `pypi.org`/`files.pythonhosted.org`
(and a few other package registries) but blocks `huggingface.co` — the
*only* host for the real `colbert-ir/colbertv2.0` checkpoint. There is no
mirror of that checkpoint on an allowed host. So `colbert-maxsim` here is the
real ColBERT **algorithm** (late interaction: encode every token, score a
candidate by summing each query token's max cosine similarity to any
candidate token) run over **WordLlama's `l2_supercat` static token
embeddings** — a real, pretrained (distilled from an LLM's input embedding
table), MIT-licensed table that ships its weights inside the `wordllama` pip
package, so it needs no network access at run time. It is *not* contextual
(no BERT forward pass; a token gets the same vector regardless of sentence),
and it was never fine-tuned for retrieval the way ColBERTv2 was trained on
MS MARCO.

Practical effect: read a `colbert-maxsim` win as "late interaction over
decent embeddings can do this," and a loss as "this needed either context or
retrieval fine-tuning that this substitute doesn't have" — not as a verdict
on ColBERTv2 itself. `dense-cosine` (mean-pooled cosine over the same token
table) rides along as a second baseline so a `colbert-maxsim` win isn't
confounded with "any embedding beats lexical retrieval" — it isolates what
late interaction specifically buys over a single pooled vector.

`scripts/bench/colbert_baseline.py` loads the bundled weights/tokenizer
files directly (`wordllama/weights/l2_supercat_256.safetensors` +
`wordllama/tokenizers/l2_supercat_tokenizer_config.json`) rather than calling
`WordLlama.load()`: that helper's local-file lookup checks a `tokenizer/`
(singular) directory while the package actually ships `tokenizers/`
(plural), so it always falls through to a network fetch even though the file
it wants is already on disk. Loading the two files ourselves sidesteps the
bug without patching third-party code.

## Reading the output

`scripts/bench-retrieval-vs-colbert.mjs` prints a report and writes it to
`scripts/bench/RESULTS.md`. Per book: a table of the 4 frozen events (hit /
miss / gap / **leak**, per system — a `LEAK` on a model-tier event is a
faithfulness failure, not a recall win), then Recall@1/5/10 + MRR over the
auto-derived motif pairs for `engine`, `colbert-maxsim`, and `dense-cosine`.

`RESULTS.md` in this directory is the last real run recorded in this
sandbox (both texts available, see the file for exact frame/event counts) —
treat it the same way `AGENTS.md` treats the other frozen-golden scores: a
number to trust and extend, not to re-derive by guessing.
