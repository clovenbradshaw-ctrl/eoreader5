// Row-stance fabrication firewall (docs/row-stance-templates.md; ported from
// eoreader4.2:docs/generate-row-stance-templates.md + src/weave/generate-row/
// (stance.js, tokenize.js) + src/enactor/ground/row-veto.js).
//
// This is a CONTRACT, not a generation engine: eoreader5 has no generated-
// prose surface yet (that is an eoreaderapp concern), so there is nothing
// here that renders a row. What lands now is the part that must exist
// BEFORE any gloss/blurb/caption surface ships, per the retirement gate
// (docs/eoreader5-parity-checklist.md §5 / "Retirement gate" item 2):
// the forbidden desert cell, and the fabrication/entailment vetoes that
// keep a rendered row honest about what its own trace actually supports.
//
// Deliberately NOT ported here: `stanceLegality`'s spectral shape chooser
// (buildDensity/eigenLenses over a proposition's significance activations).
// That algorithm needs the full cube/faces/stance-face apparatus (the
// terrain + stance enums and diagonal-coherence validator -- parity
// checklist §3 "fold-grid axes", still open) and real proposition data
// eoreader5 does not populate yet. Wiring it in ahead of those prerequisites
// would be unverifiable scaffolding. `LEGAL_CELLS` below hardcodes the four
// concrete cells 4.2's `legalCellFor` actually ever produces (its own
// header comment: "this caller only ever fires REC ... or CON ...  it
// structurally cannot reach SYN-Field-Cultivating regardless of the hint"),
// so the desert-cell guarantee is real and testable today without the
// spectral math.

/** The four row shapes (generate-row-stance-templates.md §2). */
export const SHAPES = Object.freeze(["readout", "cultivating", "making", "composing"]);

/**
 * The one Generating x Ground cell §3.1 forbids as a shipped address, ever:
 * a Structure-domain Cultivating cell. The row-stance chooser's own
 * Cultivating cell is `REC(Atmosphere, Cultivating)` (Significance-domain,
 * see LEGAL_CELLS.cultivating below) -- a different address on the same
 * Ground-grain row. `SYN(Field, Cultivating)` never ships.
 */
export const DESERT_CELL = Object.freeze({ op: "SYN", terrain: "Field", stance: "Cultivating" });

/** True iff `cell` is exactly the forbidden desert cell. */
export function isDesertCell(cell) {
  return !!cell && cell.op === DESERT_CELL.op && cell.terrain === DESERT_CELL.terrain && cell.stance === DESERT_CELL.stance;
}

/**
 * The concrete {op, terrain, stance} cell each shape resolves to
 * (generate-row-stance-templates.md §2's table). Frozen constants, not a
 * derivation -- see the module header for why the general `legalCellFor`
 * derivation is deferred.
 */
export const LEGAL_CELLS = Object.freeze({
  readout: Object.freeze({ op: "CON", terrain: "Link", stance: "Binding" }),
  cultivating: Object.freeze({ op: "REC", terrain: "Atmosphere", stance: "Cultivating" }),
  making: Object.freeze({ op: "REC", terrain: "Lens", stance: "Making" }),
  composing: Object.freeze({ op: "REC", terrain: "Paradigm", stance: "Composing" }),
});

/**
 * legalCellFor(shape) -> {op, terrain, stance} | null
 *
 * Returns the one legal cell for a row shape, or null for an unknown shape.
 * By construction (LEGAL_CELLS is a fixed table of four cells, none of them
 * the desert cell) this can never return DESERT_CELL -- pinned by
 * packages/conformance/invariants/stance-templates.test.js so a future
 * edit that adds a fifth entry cannot reintroduce it silently.
 */
export function legalCellFor(shape) {
  return LEGAL_CELLS[shape] ?? null;
}

// ---------------------------------------------------------------------------
// Trace-token accounting (generate-row-stance-templates.md §8, tokenize.js)
// ---------------------------------------------------------------------------

/**
 * tokenize(text) -> {text, start, end}[]
 *
 * Words and standalone punctuation, by character offset. Deliberately
 * crude -- a trace-accounting device, not a linguistic tokenizer. The
 * renderer that produces a row's spans and the veto that counts them MUST
 * share this one splitter, or trace coverage would be an artifact of two
 * tokenizers disagreeing rather than a real check.
 */
export function tokenize(text) {
  const s = String(text ?? "");
  const re = /[A-Za-z0-9$%]+(?:['’][A-Za-z]+)?|[.,;:!?()"“”]/g;
  const tokens = [];
  let m;
  while ((m = re.exec(s))) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

export function tokenCount(text) {
  return tokenize(text).length;
}

// ---------------------------------------------------------------------------
// The closed connective/ordinal lexicon (generate-row-stance-templates.md §6)
// ---------------------------------------------------------------------------

/**
 * Every non-proposition word a rendered row may use, as stable lexicon ids.
 * Closed: a renderer may cite one of these ids in a TraceRef, never an
 * invented word. Kept intentionally small -- §6's table plus §10's worked
 * examples ("First"/"then"/"is"/"is not"/"disagree"/"not established"/
 * "because") -- and additive-only: a future shape/plan may extend this set,
 * but never bypass tracing through it.
 */
export const KNOWN_CONNECTIVE_IDS = Object.freeze([
  "is",
  "is-not",
  "disagree",
  "not-established",
  "because",
  "first",
  "then",
]);

// ---------------------------------------------------------------------------
// Exactly-1 trace coverage (generate-row-stance-templates.md §8)
// ---------------------------------------------------------------------------

/**
 * checkTraceCoverage(row) -> { covered: boolean, reason: string | null }
 *
 * Every token in `row.renderedText` must map to EXACTLY ONE TraceRef in
 * `row.trace`: not zero (fabrication, §7), not more than one (two templates
 * concatenated without resolving which one owns the token), and the spans
 * must be contiguous and non-overlapping over the token stream (checked by
 * token count + walking each trace span against the tokenizer's own token
 * boundaries -- both sides use the shared `tokenize` above, per its own
 * header note).
 */
export function checkTraceCoverage(row) {
  const tokens = tokenize(row?.renderedText);
  const trace = Array.isArray(row?.trace) ? row.trace : [];
  if (trace.length !== tokens.length) {
    return { covered: false, reason: `trace has ${trace.length} entries for ${tokens.length} tokens` };
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const ref = trace[i];
    if (!ref || typeof ref.tokenStart !== "number" || typeof ref.tokenEnd !== "number") {
      return { covered: false, reason: `token ${i} has no trace pointer` };
    }
    if (ref.tokenStart !== i || ref.tokenEnd !== i + 1) {
      return { covered: false, reason: `token ${i} trace span [${ref.tokenStart}, ${ref.tokenEnd}) is not contiguous/non-overlapping` };
    }
  }
  return { covered: true, reason: null };
}

// ---------------------------------------------------------------------------
// Bidirectional entailment (generate-row-stance-templates.md §7)
// ---------------------------------------------------------------------------

/**
 * bidirectionallyEntails(row, propositions) -> boolean
 *
 *   row            { renderedText, trace } -- as a future realizeSlot would
 *                  produce (generate-row-stance-templates.md §9).
 *   propositions   the proposition records (each `{ id, ... }`) this
 *                  SPECIFIC row claims to represent.
 *
 * As-built in 4.2 (see that repo's "As built" divergence #3): there is no
 * NLI model in this codebase, nor should there be (§16's release invariant
 * -- stanceLegality/entailment never consult a model). This checks the
 * row's own trace instead of bare text:
 *
 *   forward  -- every declared proposition is traced somewhere in the row
 *               (nothing was dropped -- e.g. a dropped counter-reading that
 *               would silently promote a Cultivating survey into a false
 *               Making argument);
 *   backward -- every traced proposition-token points at a DECLARED
 *               proposition, and every non-proposition token points at a
 *               REGISTERED KNOWN_CONNECTIVE_IDS entry, never an invented
 *               hedge/connective/ordinal word.
 */
export function bidirectionallyEntails(row, propositions) {
  const declaredIds = new Set((propositions ?? []).map((p) => p.id));
  const trace = Array.isArray(row?.trace) ? row.trace : [];
  const tracedPropIds = new Set(trace.filter((t) => t.source === "proposition").map((t) => t.refId));

  for (const id of declaredIds) if (!tracedPropIds.has(id)) return false; // forward
  for (const id of tracedPropIds) if (!declaredIds.has(id)) return false; // backward: proposition side

  const known = new Set(KNOWN_CONNECTIVE_IDS);
  for (const t of trace) {
    if (t.source !== "proposition" && !known.has(t.refId)) return false; // backward: lexicon side
  }
  return true;
}

// ---------------------------------------------------------------------------
// The veto battery (generate-row-stance-templates.md §7, row-veto.js)
// ---------------------------------------------------------------------------

/**
 * The two fabrication-firewall vetoes, in the `{id, test, refuses, message}`
 * shape 4.2's veto battery uses. `test` returns true when the veto FIRES.
 */
export const ROW_VETOES = Object.freeze([
  {
    id: "row-entailment-mismatch",
    test: ({ row, propositions }) => !bidirectionallyEntails(row, propositions),
    refuses: true,
    message: "The rendered row states more, or less, than its grounded propositions establish.",
  },
  {
    id: "row-fabrication",
    test: ({ row }) => !checkTraceCoverage(row).covered,
    refuses: true,
    message: "A token in the rendered row has no trace pointer, or a trace span is not exactly one token wide.",
  },
]);

/**
 * runRowVetoes(ctx) -> { fired: [{id, message, refuses}], refuse: boolean }
 *
 * ctx = { row: {renderedText, trace}, propositions }. Same return shape as
 * eoreader4.2:src/enactor/ground/veto.js's runVetoes, so a future caller
 * that already knows that battery's contract needs nothing new.
 */
export function runRowVetoes(ctx) {
  const fired = [];
  let refuse = false;
  for (const veto of ROW_VETOES) {
    if (veto.test(ctx)) {
      fired.push({ id: veto.id, message: veto.message, refuses: !!veto.refuses });
      if (veto.refuses) refuse = true;
    }
  }
  return { fired, refuse };
}
