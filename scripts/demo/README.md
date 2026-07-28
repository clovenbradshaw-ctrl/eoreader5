# End-to-end demo: ingest → organs → chat

Ingests a real book, grows the engine's organs over it, and answers
questions where every answer is a verified pointer into the source. A CPU
LLM is used for one thing only: making an engine-chosen passage read like a
sentence. It never picks the evidence.

```
node scripts/demo/ingest.mjs                      # watch the organs form
node scripts/demo/chat.mjs                        # the demo question set
node scripts/demo/chat.mjs "your question here"
node --test scripts/__tests__/demo.test.mjs       # 16 tests, no LLM needed
```

Inputs (env-overridable): `EO_TEXT` (default `/home/user/eo-witness/pg84.txt`),
`EO_COREF` (default `eoPriors/priors/coref/pg84-frankenstein.json`),
`EO_REFERENT` (default `creature`), `EO_LLM_URL` (default
`http://127.0.0.1:8080`).

## The pipeline, and who decides what

```
question ─→ store.surface()     ENGINE picks the evidence (Hebbian recall)
         ─→ cue null            ENGINE decides whether to answer at all
         ─→ presence boost      ENGINE prefers frames the referent occupies
         ─→ excerpt + offset    ENGINE proves the evidence points where it says
         ─→ talker              MODEL phrases it, and may do nothing else
         ─→ veto + guards       ENGINE checks the phrasing added nothing
         ─→ answer              a grounded quote and an offset, always
```

Delete the model and every answer still stands, because the answer *is* the
evidence. That is the property the split buys.

## Measured results (Frankenstein, 438,841 chars)

Ingest is **~1.7 s**, no model involved: 439 frames · 62,866 motifs indexed ·
5,895 motifs carrying Hebbian edges · 23 surfaces admitted for `ref:creature`
through 33 explicit events, 14 of them scope-restricted · 0 typed gaps ·
8 fold spans, **8/8 offsets verified** by round-trip.

On the five demo questions: **2 answered** (offset-verified), **3 abstained**
with typed gaps. Of the two answered, the talker **copied** one verbatim and
was **rejected** on the other. That is the honest tally, and each number is
worth more than the answer count.

### The abstentions are the point

`surface()` always returns *something* — asked for the capital of France it
still lights up whichever frames share a common motif. So the top activation
is checked against a null of **frequency-matched random cues** drawn from the
text's own token stream, and below that floor the output is a typed
`below-chance-activation` gap at `TIER.MODEL`, not the best of a bad ranking.

The gap distinguishes two causes. *"what is the capital of France"* → the word
`capital` never occurs in the text. *"who created the creature"* → every
content word occurs, but Frankenstein never says "created"; it says *"infuse a
spark of being into the lifeless thing that lay at my feet."* Bridging those
is descriptor synonymy, which `AGENTS.md` places at MODEL tier, and model-tier
absences are reported as gaps. Faking one is the cardinal regression.

So a question phrased in the book's own words is answered at engine tier; a
paraphrase of the same question is refused. That asymmetry is the tier
discipline working, not a retrieval bug.

Two measured corrections are recorded in the source where they happened:
sampling the null from a **deduped vocabulary** drew mostly rare high-idf
words and pushed the floor to ~40, above which no natural question ever
scored (`lib.mjs`); and sorting by **presence alone** demoted the
activation-237 chapter-5 frame below an activation-18 one that merely
mentioned the creature more often (`lib.mjs`).

## What the CPU LLM is, and what it did

Gemma 3 270M, Q4_K_M, on 4 CPU cores via llamafile. HuggingFace is blocked by
this environment's network policy, so the weights come from a PyPI package
and the runtime from a GitHub release. The GGUF carries **no chat template**:
it is the base model, not the instruction-tuned one, and it cannot follow an
instruction at all — asked to rewrite a sentence it echoes the request back.
Base models complete *patterns*, so the talker is few-shot `FACTS:`/`ANSWER:`
pairs, which works.

It is still a 270M model, and it fails in three ways the demo reports
separately rather than averaging into "veto passed":

| guard | catches | why the veto can't |
|---|---|---|
| `isCopy` | handing the evidence straight back | a verbatim copy passes every veto trivially — it invents nothing |
| `isDegenerate` | repetition loops | the loop is fully grounded, so nothing fires |
| `ungroundedTokens` | common-noun substitution | `vetoInventedFact` works on **entities** |

The third was found by running this demo. Given *"...the accomplishment of my
**toils**"*, the talker returned *"...the accomplishment of my **labors**"* —
entity-clean, grounded-looking, veto-clean, and `labors` is not in the
evidence. `scripts/__tests__/demo.test.mjs` pins both halves: that
`ungroundedTokens` catches it, and that `veto()` currently does not. Closing
that hole in `emergence/veto` means deciding what a legitimate function-word
gloss is — a real design question with tests attached, not something to settle
as a side effect of a demo.

## Reproducing the CPU LLM

```bash
python3 -m venv venv && ./venv/bin/pip install gemma3-270m-q4-k-m-gguf
./venv/bin/python -c "import gemma3_270m_q4_k_m_gguf as m; m.assemble('gemma3-270m-q4.gguf')"
curl -L -o llamafile https://github.com/Mozilla-Ocho/llamafile/releases/download/0.9.3/llamafile-0.9.3
chmod +x llamafile
./llamafile --server -m gemma3-270m-q4.gguf -c 4096 -t 4 --host 127.0.0.1 --port 8080 --nobrowser
```

llamafile **0.9.3 or newer** — 0.8.x predates the `gemma3` architecture and
fails to load the file. Without a server the demo still runs and still
answers; only the prose degrades to the raw quote.
