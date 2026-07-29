# WCXB eval harness

An offline scorer that adopts **WCXB** (Foley, 2026 — *A Multi-Type Web
Content Extraction Benchmark*, arXiv:2605.21097, CC-BY-4.0) as an evaluation
target for EOReader5, and reinterprets its `without[]` annotations against the
engine's typed-discard ledger.

## Why WCXB, and why here

WCXB is 2,008 annotated pages / 1,613 domains stratified across seven page
types (Article, Service, Product, Collection, Forum, Listing, Documentation).
Its finding is that the field converges on articles (F1 ≈ 0.93) and diverges
sharply off them (collections/listings/products in the ~0.41–0.84 band) — and
that this is an *architectural* gap, not a tuning one. That band is exactly
where civic documents live (dockets, permit listings, meeting indexes,
procurement tables), so it is the band EOReader5 cares about most.

Each page's ground truth carries two snippet sets:

- `with[]` — 3–8 word snippets a correct extraction **must include**;
- `without[]` — snippets from boilerplate a correct extraction **must exclude**.

## The eoreader-native twist: `without[]` as typed-discard

Every system on the WCXB leaderboard is scored on F1 against `main_content`,
which means every one of them *throws the boilerplate away*. EOReader5 does
not: the cookie banner, the nav, the related-article cards are **retained and
typed** on the semantic ledger (a `SEG` + typed discard), never a citable span
(see `docs/architecture.md` §3.3 and the corpus-role firewall).

So this harness scores `without[]` two ways:

- `without_leakage` — classic: did a forbidden snippet leak into rendered
  output? (lower is better)
- `typed_discard_rate` — eoreader-native: is each forbidden snippet **retained
  in a non-citable typed unit *and* absent from rendered output**? (higher is
  better)

A classic extract-and-drop system scores `without_leakage = 0` but
`typed_discard_rate = 0` — it satisfied the benchmark by discarding evidence
EOReader5 is required to keep. That gap is the point of the fourth metric.

## Boundary compliance

- `packages/engine` is **not** touched. The engine never decodes HTML; the app
  owns HTML → `ObservationEnvelope` (`docs/architecture.md`, `priors-boundary.md`).
- The harness runs under the network-disabled conformance gate: it reads only
  the committed `sample/` and never fetches WCXB at test time.
- `sample/*.target.json` are **synthetic** fixtures in WCXB's v2.0 ground-truth
  shape (flagged `"synthetic": true`), authored so the scorer is verifiable
  offline. They are not the CC-BY dataset.

## Files

| File | Role |
| --- | --- |
| `scorer.js` | Pure metric: with-recall, without-leakage, snippet-F1, `typed_discard_rate`, and per-page-type `aggregate()`. No engine dependency. |
| `bundle-adapter.js` | Maps a `project()` bundle → `{rendered, retained_typed}`. The single integration seam to the (not-yet-built) read path. |
| `load.js` | Offline loader for `sample/` (or a materialized full split). |
| `sample/` | Synthetic Article / Collection / Listing fixtures. |
| `../scripts/wcxb-convert.mjs` | Dev-time converter from a real CC-BY WCXB checkout → normalized targets. Never run by conformance. |
| `../invariants/wcxb-harness.test.js` | The offline conformance tests. |

## Running

```
cd packages/conformance && npm test          # includes the WCXB harness
```

## Materializing the full benchmark

```
git clone https://github.com/Murrough-Foley/web-content-extraction-benchmark wcxb-data
node scripts/wcxb-convert.mjs --in wcxb-data --split dev --out /tmp/wcxb-dev
```

Attribute Murrough Foley (CC-BY-4.0). The converter emits only normalized
`with[]`/`without[]`/`page_type` targets — never HTML or raw `main_content`,
since the engine must never see either.

## Open gate

Scoring a **real** engine reading end-to-end is a `todo` test in
`../invariants/wcxb-harness.test.js`, blocked on the engine's
HTML→fold→typed-discard read path. When that lands, `bundle-adapter.js` is the
one place to bind it.
