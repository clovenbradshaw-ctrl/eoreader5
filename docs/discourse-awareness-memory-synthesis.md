# Discourse Awareness & Memory Theory for eoAI

## What eoreader5 Already Has

The engine already has a sophisticated multi-layer memory and discourse architecture that is ahead of what most public AI systems describe. The key organs:

### 1. Associative Memory (emergence/store/index.js)
- Hebbian encoding at co-occurrence time (not query time)
- Sparse BAND-gated keys (idf >= floor AND df >= 2) — only distinctive AND recurring motifs wire
- Separate unigram (semantic/gist) and trigram (verbatim/episodic) stores
- One CA3 completion hop from cue to non-overlapping source
- Decay/consolidation curve (optional)
- **Status**: functional, golden-tested (2/2 engine, 2/2 correctly gapped as model-tier)

### 2. Referent-Presence System (perceiver/text/presence.js)
- Event-sourced identity via referents/projectReferents
- Never string-based matching — identity lives in the referent
- Scoped surfaces with anchor-quote resolution (durable across editions)
- Tier discipline: structural coref (names) is ENGINE; descriptor synonymy is MODEL (injected as per-text priors)
- Narrator-span first-person detection
- **Status**: foundational, test-enforced, no regressions allowed

### 3. Entity Fold (emergence/summary/entity-fold.js)
- Offset-grounded spans with verified round-trip
- Presence-based frames with stratified whole-arc selection
- `echoes` — spans carry offset-anchored recalled antecedents from the store
- `withRelations`, `referent` prior option
- **Status**: functional, golden-tested (5/21 span recall ceiling via lexical channel)

### 4. Reaction Channel (reaction/index.js)
- Append-only content-addressed log — observation of the READER, not engine inference
- salienceRanking is a zero-weight TALLY, not a model
- Exists to eventually provide the non-lexical observable the span-golden caps at 5/21
- **Status**: stub awaiting data

### 5. ConnectionMap (emergence/summary/index.js)
- Cross-packet relational/property strength accumulation
- 1 - 1/(1+n) asymptotic strengthening
- **Status**: wired but secondary to the store for cross-episode recall

### 6. Ledger (replay/index.js)
- Append-only semantic event log
- Task pencil/ink/hold lifecycle with full provenance
- **Status**: present, task genesis kernel exists

### 7. Session-Log (MCP tools/index.js)
- Layered log: layer 1 = source, layer 2 = fold/plan, layer 3 = think/answer
- Parent-chain provenance (source -> search -> fold -> think -> answer -> cite)
- Scalable via fold (INS operator) — compresses passages into token-budget-constrained summaries
- **Status**: functional for single-session discourse

## The Known Gaps (what does NOT exist yet)

1. **Multi-session discourse continuity** — no cross-session memory consolidation. The session log is per-session; the store is per-text.
2. **Discourse state machine** — no representation of "where are we in this conversation" (topic stack, floor management, turn intent tracking).
3. **Active working memory** — no real-time working memory buffer that sits between the content-addressable store and the current fold. The J-space concept from the Anthropic global workspace paper suggests this is a real thing models develop internally.
4. **Consolidation from episodic to semantic** — no mechanism for frequently-reactivated associations to become standing knowledge. The ConnectionMap is the seed of this but not yet wired as a consolidation pathway.
5. **Forgetting/decay as a first-class operation** — the store has optional decay, but decay doesn't interact with the fold's selection criteria.
6. **Cross-modal memory** — the store is text-only. The architecture.md says "think omnimodally" but the memory system isn't there yet.
7. **Reader-model coupling** — the reaction channel collects data but no reader model exists yet (by design).

## What's Publicly Known About Claude's Memory System

### From Anthropic's Research and Documentation:

**1. The Global Workspace (J-space) — July 2026**
Anthropic's most directly relevant research. Key findings:
- Claude internally maintains a small (~25 concepts) set of privileged representations (the J-space) that function as a "mental workspace"
- These representations are verbalizable, controllable, used for reasoning, and flexibly generalizable
- The J-space is causal: swapping a concept in J-space changes Claude's output
- The J-space occupies <10% of activation variance but is responsible for higher-order cognition
- Non-J-space processing handles fluent text generation, grammar, simple recall — automatically
- The J-space emerged spontaneously during training (not designed)
- Post-training shifts the J-space to adopt Claude's "point of view"
- Can be used for monitoring: catching hidden reasoning, fabrication, prompt injection awareness

*Implication for eoAI*: The engine's store/fold architecture maps surprisingly well onto the J-space/automatic-processing divide. The store IS the J-space counterpart (sparse, associative, limited-capacity); the fold's text-organ processing IS the automatic channel. But the engine lacks a real-time "what's in workspace right now" representation.

**2. Claude's Long Context Window**
- 200K token context (production)
- Uses "contextual retrieval" techniques: prefixed chunk summaries, reranking
- The context window IS the primary memory mechanism — Claude's memory is what's in the window
- No official "memory API" or persistent memory system — Anthropic hasn't shipped a productized memory layer
- Claude Code uses project files + conversation as memory; no dedicated memory store

**3. Prompt Caching / Contextual RAG**
- Anthropic docs describe "contextual RAG" patterns: embedding chunking with chunk-level summaries
- Prompt caching reduces latency for repeated context prefixes
- Recommended architecture: separate retrieval from generation, inject relevant context into the system prompt

**4. Research on Agentic Memory**
- Anthropic's research on AI agents (e.g., "agentic misalignment" work) shows models can maintain goals across turns
- Claude Code uses a plan tree / todo structure for cross-turn coherence
- No public "memory server" or "memory API" from Anthropic

### From Google DeepMind:
- **Gemini 1.5's 1M+ context window** — the extreme-context approach to memory: fit everything in
- Titans architecture (2025) — neural long-term memory module with surprise-based learning
- **RecurrentGemma** — recurrence for memory efficiency

### From OpenAI:
- **ChatGPT Memory** (shipped ~2024) — learns facts about the user across sessions, stores them as structured notes the model reads
- Custom GPTs with Knowledge — file retrieval + instructions
- **No public research on internal workspace/consciousness** comparable to Anthropic's

### From Academic Research:
- **Global Workspace Theory** (Baars 1988, Dehaene & Naccache 2001) — the neuroscience framework Anthropic's work tests
- **Working Memory Models** — phonological loop, visuospatial sketchpad, episodic buffer (Baddeley)
- **Memory-Augmented Neural Networks** — Differentiable Neural Computers (Graves et al.), Neural Turing Machines
- **Retrieval-Augmented Generation (RAG)** — Lewis et al. 2020 and all subsequent evolutions
- **Memorizing Transformers** (Wu et al. 2022) — knn-augmented attention with external memory
- **Hippocampal indexing theory** (Teyler & DiScenna 1986) — the biology behind sparse indexing
- **Complementary Learning Systems** (McClelland et al. 1995) — hippocampus for rapid binding, neocortex for slow consolidation

## Architectural Patterns Across Systems

### Pattern A: "Everything in Context" (Claude, Gemini)
- Giant context windows (200K-1M+ tokens)
- Memory = what's in the window + what RAG injects
- Simple, works well, but expensive and doesn't scale to lifelong learning

### Pattern B: External Memory Store (ChatGPT Memory, eoreader5 store)
- Structured facts/knowledge written to a persistent store
- Retrieved at query time and injected into context
- Requires explicit write/read orchestration

### Pattern C: Internal Global Workspace (Anthropic J-space)
- Emergent internal scratchpad the model uses for reasoning
- Not directly controllable by external orchestration
- Can be monitored (J-lens) and steered (J-space steering)
- Only handles higher-order cognition; fluent processing is automatic

### Pattern D: Hierarchical Consolidation (Complementary Learning Systems)
- Rapid binding of episodic memories (hippocampus analog)
- Slow extraction of semantic knowledge (neocortex analog)
- Replay during consolidation
- eoreader5's store + ConnectionMap is the closest to this

## Synthesis: What eoAI Should Build

The eoreader5 engine has already chosen Pattern B (external store) + elements of D (consolidation via ConnectionMap). The next step is to add:

### 1. Discourse-Level State Machine
A lightweight representation of conversational state:
- Current topic / focus
- Turn intent (question, answer, request, clarify, etc.)
- Open commitments / pending actions
- Active referents (which entities are "in play" in the current discourse)
- Floor management (who's speaking, who's addressed)

This is different from the entity fold — it's about the conversation's own structure, not the subject matter.

### 2. Working Memory Buffer (à la J-space)
A small, bounded set of "currently active" items that sit between the associative store and the fold:
- Top-k active motifs from the current and recent frames
- The discourse state (topic, intent, active referents)
- Direct retrieval results from the store
- Decay-based eviction
- Candidates for the fold's selection criteria

This would be a lightweight data structure (not a model call), updated on each turn.

### 3. Cross-Session Consolidation
- Session-level store merged into a long-term store after session end
- Frequently-reactivated associations from ConnectionMap promoted to standing edges
- Decayed associations pruned
- Reader-model reactions (from the reaction channel) folded into salience weights

### 4. Active Forgetting
- Not just decay, but explicit suppression of associations that proved spurious or irrelevant
- The typed gap discipline already handles this for model-tier knowledge

### 5. Omnimodal Memory
- The store's sparse code is text-only, but the principle (sparse, distinctive keys; Hebbian wiring) generalizes
- Audio leitmotifs, visual patterns, code structures — same sparse-indexing pattern

## Theoretical Foundations

### The Nameless Referent as Memory Unit
The hardest-won lesson of eoreader5 is that identity lives in the referent, never in a string. This applies to memory too:
- A recalled passage is not identified by its text but by its referent (its place in the source + the entity it concerns)
- Echoes carry offset-anchored antecedents, not copied text
- The store's motifs are unnamed — they are idf-gated forms with edges, not label-keyed entries

### The Tier Boundary as Design Constraint
- ENGINE tier = structural, verbatim, wired: the store handles this (sparse BAND-gated keys, Hebbian edges)
- MODEL tier = synonymy, thematic, witness-only: injected as priors or reported as gaps
- The memory system must enforce this boundary; the store test already does

### The Fold as Discourse Unit
The fold is the engine's fundamental discourse operation: it compresses a span of experience into a structured packet. Every memory operation (storage, retrieval, consolidation) operates on folds, not raw text.

### Monotonicity and Append-Only
The ledger never drops events. Memory consolidation does not delete — it creates new associations and marks old ones as superseded. The ledger is the ground truth; the store is a performance structure derived from it.

## Next Concrete Steps

1. **Define the DiscourseState schema** — what does the engine need to know about the conversation it's in?
2. **Wire a working memory buffer** — a bounded priority queue of active motifs/referents, updated per turn
3. **Add cross-session store merge** — buildStore() can already accept an existing store as seed; wire the session boundary
4. **Connect the reaction channel to store weighting** — once there's data, reader dwell/skip/abandon should influence edge strength
5. **Extend the store to non-text modalities** — the sparse code formula generalizes; audio-to-text motif alignment is the first use case

## References (Public)

- Gurnee et al. 2026. "Verbalizable Representations Form a Global Workspace in Language Models." Anthropic. http://transformer-circuits.pub/2026/workspace/index.html
- Baars 1988. "A Cognitive Theory of Consciousness." Cambridge University Press.
- Dehaene & Naccache 2001. "Towards a cognitive neuroscience of consciousness." Cognition.
- Baddeley 2000. "The episodic buffer: a new component of working memory?" Trends in Cognitive Sciences.
- McClelland et al. 1995. "Why there are complementary learning systems in the hippocampus and neocortex." Psychological Review.
- Teyler & DiScenna 1986. "The hippocampal memory indexing theory." Behavioral Neuroscience.
- Lewis et al. 2020. "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks." NeurIPS.
- Wu et al. 2022. "Memorizing Transformers." ICLR.
- Anthropic 2025. "Claude's extended thinking." https://www.anthropic.com/news/claude-3-7-sonnet
- Anthropic 2025. "Contextual Retrieval." https://docs.anthropic.com/en/docs/build-with-claude/contextual-rag
