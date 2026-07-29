// presence.js — referent-aware presence for the fold.
//
// The fold previously resolved "is this entity here?" with
// `norm(frame.text).includes(token)`. That is a same-string auto-merge, which
// referents/index.js explicitly forbids, and it fails on exactly the referents
// individuation.js was written to type:
//
//   holon     named, name-admitted        "Natásha Rostóva"   — substring works
//   emanon    high mass, NEVER named      Frankenstein's creature — substring fails
//   protogon  orbited but absent          Kurtz               — substring fails
//
// Measured failure on the emanon case: counting the substrings
// creature|monster|wretch|fiend|daemon|being over Frankenstein admits 119 hits
// for "being" that are almost all gerund/copula ("being able", "on being
// informed"), and admits "wretch" where it denotes Victor rather than the
// creature — one surface, two referents. 294 of 439 frames read as "present";
// after proper admission it is 170.
//
// This module admits surfaces to a referent explicitly and auditably:
//
//   1. NAME VARIANTS  — a surface corefers when one name contains the other, or
//      both end in the same token (surname). Leading shared tokens never merge
//      ("Prince Andrew" / "Prince Vasili" share an honorific, not a referent).
//      Same rule as summary/graph.js, kept consistent on purpose.
//
//   2. DEFINITE DESCRIPTIONS — NOT derived. Injected, or reported as a gap.
//
//      Two distributional derivations were tried and both failed, in ways worth
//      recording so they are not retried:
//
//        frame-level lift: admitted "the room", "the guitar" and "sonya" as
//        Natasha, because anything sharing her scenes lifts identically.
//        Association is not identity — 3069/3228 frames read as present.
//
//        sentence-level complementary distribution (aliases substitute, so they
//        should ANTI-co-occur): "monster" and "room" both score 0 co-occurrence
//        with "creature", because "creature" appears in 44 of 3361 sentences and
//        the counts are noise. No separation.
//
//      This is not a tuning failure, it is the tier boundary. Per
//      resolution/resolution-spectrum.js, deciding that monster/wretch/fiend
//      predicate one being is `pronoun-semantic`-class: TIER.MODEL, "open-domain
//      world-knowledge no field salience or symbolic table covers", needsWitness
//      === true. The engine must not fake it.
//
//      So descriptor aliases arrive as an INJECTED alias set — a reader prior in
//      the sense of emergence/reader-priors/index.js ("The prior is INJECTED...
//      the engine never computes it... This keeps the engine pure"). A reader who
//      knows Frankenstein knows the alias set; a reader who does not, cannot
//      assert it, and gets a gap instead of a wrong number.
//
// NOT handled here, and reported rather than papered over: first-person
// narration. When a referent narrates, it refers to itself as "I" and no
// surface admission recovers it. In resolution-spectrum terms that is
// `pronoun-structural` (TIER.RESOLVED — wants the decaying salience field) and
// at worst `pronoun-semantic` (TIER.MODEL — needs the witness channel). Callers
// get `gaps` describing the unresolved span rather than a silently low count.

// Single-pass deaccent. The char-by-char split/map/join form is O(n) with a
// large constant and this runs over every frame for every candidate surface, so
// it dominated the whole organ before being folded into one regex.
const DIA_RE = /[áàâäéèêëíìîïóòôöúùûü]/g;
const DIA_TO = { á:"a",à:"a",â:"a",ä:"a",é:"e",è:"e",ê:"e",ë:"e",í:"i",ì:"i",î:"i",ï:"i",ó:"o",ò:"o",ô:"o",ö:"o",ú:"u",ù:"u",û:"u",ü:"u" };
export const diaNorm = (t) => String(t ?? "").toLowerCase().trim().replace(DIA_RE, (c) => DIA_TO[c]);

// Frames are normalised once and cached on the frame object; every surface test
// then reads the cached string instead of re-normalising 2000 chars per call.
const normOf = (f) => (f._presenceNorm ??= diaNorm(f.text));

const tokensOf = (id) => diaNorm(id).split(/\s+/).filter((t) => t.length > 2);

/** Two NAMES corefer: containment, or a shared final token (surname). */
export function namesCorefer(a, b) {
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  if (!ta.length || !tb.length) return false;
  const setA = new Set(ta);
  const setB = new Set(tb);
  const subset = ta.every((t) => setB.has(t)) || tb.every((t) => setA.has(t));
  return subset || ta[ta.length - 1] === tb[tb.length - 1];
}

/** Occurrences of a whole-word surface in already-normalised text. */
function countIn(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    const before = i === 0 ? " " : hay[i - 1];
    const after = i + needle.length >= hay.length ? " " : hay[i + needle.length];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) n++;
    i = hay.indexOf(needle, i + 1);
  }
  return n;
}

/** Occurrences of a surface in a frame, using the frame's cached normalisation. */
const countSurface = (frame, surface) => countIn(normOf(frame), diaNorm(surface));

import { projectReferents } from "../../referents/index.js";

const DETERMINERS = ["the", "my", "his", "her", "their", "thy", "that", "this"];

/**
 * Definite-NP candidates: determiner + lowercase head noun, counted across
 * frames. The determiner requirement is the filter that removes gerunds.
 */
function definiteCandidates(frames, { minCount = 8 } = {}) {
  const counts = new Map();
  for (const f of frames) {
    const words = (f._presenceWords ??= normOf(f).split(/[^a-z']+/).filter(Boolean));
    for (let i = 0; i < words.length - 1; i++) {
      if (!DETERMINERS.includes(words[i])) continue;
      const head = words[i + 1];
      if (head.length < 4) continue;
      counts.set(head, (counts.get(head) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n >= minCount).map(([head, n]) => ({ head, count: n }));
}

/** Frames (by order) in which a surface occurs at least once. */
function frameSetFor(frames, surface) {
  const s = new Set();
  const needle = diaNorm(surface);
  for (const f of frames) if (countIn(normOf(f), needle) > 0) s.add(f.order);
  return s;
}

/**
 * admitSurfaces(frames, seed, options)
 *
 * Build the admitted surface set for a referent, plus the referent-lifecycle
 * events that justify each admission (DEF.admit / SYN.merge), so the decision is
 * auditable through referents/projectReferents rather than implicit.
 *
 * @returns {{ surfaces: string[], events: object[], candidates: object[], seedType: string }}
 */
export function admitSurfaces(frames, seed, options = {}) {
  const { nameSurfaces = [], aliases = null } = options;
  const referentId = `ref:${diaNorm(seed).replace(/\s+/g, "_")}`;
  const events = [{ type: "DEF.admit", referent_id: referentId, surface: seed, provenance: "seed" }];
  const surfaces = [seed];
  const gaps = [];

  // 1. Name variants — structural rule, TIER.RESOLVED, no witness needed.
  // A surface must be a plausible name to qualify: extractSurfaces returns
  // capitalised SPANS, which include chapter headers ("CHAPTER XIII\n\nWhen
  // Natásha"), and those trivially contain the seed's tokens under subset
  // matching. Reject anything with a line break or too many tokens.
  for (const s of nameSurfaces) {
    if (diaNorm(s) === diaNorm(seed)) continue;
    if (s.includes("\n") || s.split(/\s+/).length > 4) continue;
    if (namesCorefer(seed, s)) {
      surfaces.push(s);
      events.push({ type: "DEF.admit", referent_id: referentId, surface: s, provenance: "name-alias" });
    }
  }

  // 2. Descriptor aliases — injected only. See the header: deriving these is a
  // witness-channel problem and the engine refuses to guess.
  if (Array.isArray(aliases)) {
    for (const a of aliases) {
      if (surfaces.some((s) => diaNorm(s) === diaNorm(a))) continue;
      surfaces.push(a);
      events.push({
        type: "SYN.merge",
        into_id: referentId,
        from_ids: [`ref:${diaNorm(a).replace(/\s+/g, "_")}`],
        provenance: "reader-prior alias (injected, not derived)",
      });
    }
  }

  // 3. Report the unresolved remainder rather than papering over it. If the seed
  // is itself a common noun, it is probably an emanon whose alias set the engine
  // cannot recover alone.
  const seedIsName = /^[A-Z]/.test(String(seed).trim());
  if (!seedIsName && !Array.isArray(aliases)) {
    gaps.push({
      reason: "descriptor_aliases_unresolved",
      referent: seed,
      tier: "model",
      needsWitness: true,
      detail:
        "seed is a common noun (likely an emanon). Definite-description coreference is " +
        "pronoun-semantic class and cannot be settled by the engine; supply `aliases` via a reader prior.",
    });
  }

  return { referentId, surfaces, events, gaps };
}

/**
 * presenceByFrame(frames, surfaces, options) -> Map<order, count>
 *
 * Total sightings of any admitted surface, per frame. This replaces the
 * fold's substring test.
 *
 * options.narratorSpans: [{ from, to }] — character-offset ranges where the
 * referent is the FIRST-PERSON NARRATOR. Inside such a span the referent's
 * surfaces are I/me/my/myself, not any noun phrase — no surface admission can
 * recover this (the Creature narrates 40%→60% of Frankenstein and never once
 * calls himself "the creature"). Like descriptor aliases, this is injected as
 * a reader prior, never derived: knowing WHO is speaking is witness-channel
 * knowledge. First-person hits are counted at reduced weight (a pronoun is a
 * weaker sighting than a name — it also sweeps up quoted "I" from others).
 */
const FIRST_PERSON_RE = /\b(i|me|my|myself)\b/g;
const FIRST_PERSON_WEIGHT = 0.5;
const FIRST_PERSON_SURFACES = ["i", "me", "my", "myself"];

// A surface may be a plain string (global, weight 1) or a scoped record:
//   { surface, weight?, scope?: [{ from, to }] }
// Scope is where the surface points at THIS referent — "I" points at the
// Creature only inside his own narration; everywhere else it is Victor or
// Walton. One string, several referents, disambiguated by position: this is
// what "merge by referent, not by string" means operationally.
function asScoped(s) {
  return typeof s === "string" ? { surface: s, weight: 1, scope: null } : { weight: 1, scope: null, ...s };
}

const inScope = (f, scope) => !scope || scope.some((sp) => f.offset >= sp.from && f.offset < sp.to);

export function presenceByFrame(frames, surfaces, options = {}) {
  const { narratorSpans = [] } = options;
  const scoped = surfaces.map(asScoped).map((s) => ({ ...s, needle: diaNorm(s.surface) }));
  // Legacy escape hatch: bare narratorSpans become scoped first-person surfaces.
  for (const span of narratorSpans) {
    for (const p of FIRST_PERSON_SURFACES) {
      scoped.push({ surface: p, needle: p, weight: FIRST_PERSON_WEIGHT, scope: [span] });
    }
  }
  const byOrder = new Map();
  for (const f of frames) {
    const hay = normOf(f);
    let n = 0;
    for (const s of scoped) {
      if (!inScope(f, s.scope)) continue;
      n += countIn(hay, s.needle) * s.weight;
    }
    byOrder.set(f.order, n);
  }
  return byOrder;
}

/**
 * collapseWhitespace(str) -> { collapsed, map }
 * Collapses whitespace runs in `str` to a single space, recording for every
 * character emitted into `collapsed` the index in `str` it came from. This is
 * the shared collapsed-position-mapping mechanism behind whitespace-tolerant
 * span resolution: text-organ.js::locateRawSpan uses it to recover a raw
 * offset-based span through frameText/snapToSentences whitespace churn, and
 * resolveSpans (below) uses the same mapping to make anchor-quote resolution
 * tolerant of line-wrap/whitespace differences between the stored anchor and
 * the live text — two ends of the same "anchors rot when whitespace shifts"
 * problem, one mechanism.
 */
export function collapseWhitespace(str) {
  let collapsed = "";
  const map = [];
  let inWs = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (/\s/.test(ch)) {
      if (!inWs) {
        collapsed += " ";
        map.push(i);
        inWs = true;
      }
    } else {
      collapsed += ch;
      map.push(i);
      inWs = false;
    }
  }
  return { collapsed, map };
}

/** Find `anchor` in `text`, tolerating whitespace/line-wrap differences. */
function locateAnchor(text, collapsedText, anchor) {
  if (!anchor) return -1;
  const exact = text.indexOf(anchor);
  if (exact !== -1) return exact;
  const { collapsed: needle } = collapseWhitespace(anchor);
  if (!needle) return -1;
  const idx = collapsedText.collapsed.indexOf(needle);
  return idx === -1 ? -1 : collapsedText.map[idx];
}

/**
 * resolveSpans(text, spans) — turn durable anchors into offsets.
 * A prior stores { fromAnchor, toAnchor } quote strings (robust across
 * editions/whitespace churn); offsets are derived at apply time. Resolution
 * tries an exact substring match first, then falls back to whitespace-
 * flexible matching (via collapseWhitespace) so a line-wrap or spacing
 * difference between the stored anchor and the live text doesn't rot the
 * anchor. A span whose anchor still doesn't resolve is dropped and reported,
 * never guessed.
 */
export function resolveSpans(text, spans = []) {
  const resolved = [];
  const unresolved = [];
  let collapsedText = null;
  for (const sp of spans) {
    if (typeof sp.from === "number" && typeof sp.to === "number") {
      resolved.push({ from: sp.from, to: sp.to });
      continue;
    }
    collapsedText ??= collapseWhitespace(text);
    const from = locateAnchor(text, collapsedText, sp.fromAnchor);
    const to = sp.toAnchor ? locateAnchor(text, collapsedText, sp.toAnchor) : text.length;
    if (from === -1 || to === -1 || to <= from) unresolved.push(sp);
    else resolved.push({ from, to });
  }
  return { resolved, unresolved };
}

/**
 * admitReferent(frames, prior, options) — the referent-centric admission.
 *
 * The unit of identity is the REFERENT, not any string. The prior (a per-text
 * coref artifact, eoPriors-style) declares which surfaces point at the
 * referent and WHERE:
 *
 *   {
 *     id: "creature", individuation: "emanon", display: "the Creature",
 *     name?: "Natásha",                       // holons: seed for structural variants
 *     surfaces: [{ surface, weight?, scope? (anchor spans) }],
 *     narratorSpans: [{ fromAnchor, toAnchor }],  // referent speaks as "I" here
 *   }
 *
 * Everything is admitted as referent-lifecycle EVENTS and projected through
 * referents/projectReferents, so the merge decision is event-sourced and
 * auditable — never an implicit string equality. Same-string surfaces of OTHER
 * referents stay distinct because scope keeps them apart, which is the organ's
 * own rule ("Same-string surfaces MUST NOT auto-merge").
 */
export function admitReferent(frames, prior, options = {}) {
  const { nameSurfaces = [], fullText = "" } = options;
  const gaps = [];
  const referentId = `ref:${diaNorm(prior.id ?? prior.name ?? "unknown").replace(/\s+/g, "_")}`;
  const events = [];
  const scoped = [];

  // 0. The referent's own seed handle is always a surface. For a holon this
  // is subsumed by the name path; for an emanon ("creature") the seed is a
  // common noun that genuinely occurs in the text and must count even before
  // any prior enriches it — otherwise an unenriched emanon silently reads as
  // absent everywhere, which is the exact failure this module exists to stop.
  const seedHandle = prior.name ?? prior.id ?? null;
  if (seedHandle && !prior.name) {
    events.push({ type: "DEF.admit", referent_id: referentId, surface: seedHandle, provenance: "seed" });
    scoped.push({ surface: seedHandle, weight: 1, scope: null });
  }

  // 1. Name path (holons) — structural variants, TIER.RESOLVED.
  if (prior.name) {
    events.push({ type: "DEF.admit", referent_id: referentId, surface: prior.name, provenance: "prior:name" });
    scoped.push({ surface: prior.name, weight: 1, scope: null });
    for (const s of nameSurfaces) {
      if (diaNorm(s) === diaNorm(prior.name)) continue;
      if (s.includes("\n") || s.split(/\s+/).length > 4) continue;
      if (namesCorefer(prior.name, s)) {
        events.push({ type: "DEF.admit", referent_id: referentId, surface: s, provenance: "name-alias" });
        scoped.push({ surface: s, weight: 1, scope: null });
      }
    }
  }

  // 2. Declared surfaces — the per-text prior's descriptor set, each with its
  // own scope. Admitted as SYN.merge: the prior asserts these point at the
  // same referent (witness-channel knowledge the engine cannot derive).
  for (const raw of prior.surfaces ?? []) {
    const s = asScoped(raw);
    let scope = null;
    if (s.scope) {
      const { resolved, unresolved } = resolveSpans(fullText, s.scope);
      scope = resolved.length ? resolved : null;
      if (unresolved.length) gaps.push({ reason: "surface_scope_unresolved", surface: s.surface, unresolved });
    }
    events.push({
      type: "SYN.merge", into_id: referentId, from_ids: [`ref:${diaNorm(s.surface).replace(/\s+/g, "_")}`],
      provenance: "text-prior surface",
    });
    events.push({ type: "DEF.admit", referent_id: referentId, surface: s.surface, provenance: "text-prior" });
    scoped.push({ surface: s.surface, weight: s.weight, scope });
  }

  // 3. Narrator spans — inside them the referent IS the first person.
  const { resolved: narr, unresolved: narrBad } = resolveSpans(fullText, prior.narratorSpans ?? []);
  for (const span of narr) {
    for (const p of FIRST_PERSON_SURFACES) {
      events.push({
        type: "DEF.admit", referent_id: referentId, surface: `${p}@${span.from}-${span.to}`,
        provenance: "narrator-span first person",
      });
      scoped.push({ surface: p, weight: FIRST_PERSON_WEIGHT, scope: [span] });
    }
  }
  if (narrBad.length) gaps.push({ reason: "narrator_span_unresolved", unresolved: narrBad });

  // 4. Unnamed referent with no declared surfaces: model-tier gap, unchanged.
  if (!prior.name && !(prior.surfaces?.length)) {
    gaps.push({
      reason: "descriptor_aliases_unresolved", referent: prior.id, tier: "model", needsWitness: true,
      detail: "emanon with no per-text coref prior; supply one (eoPriors coref artifact).",
    });
  }

  // Project the event log through the referents organ — the projection is the
  // audit trail proving every surface reached the referent via an explicit event.
  const projection = projectReferents(events.filter((e) => e.type !== "SYN.merge" || e.from_ids));

  return { referentId, surfaces: scoped, events, projection, gaps };
}

/**
 * Observables the individuation gate consumes: mass (sightings) and coupling
 * (how many OTHER surfaces share the referent's frames), plus the named bit.
 */
export function presenceObservables(frames, surfaces, otherSurfaces = []) {
  const presence = presenceByFrame(frames, surfaces);
  let mass = 0;
  const occupied = new Set();
  for (const [order, n] of presence) if (n > 0) { mass += n; occupied.add(order); }
  let coupling = 0;
  for (const other of otherSurfaces) {
    const needle = diaNorm(other);
    for (const f of frames) {
      if (occupied.has(f.order) && countIn(normOf(f), needle) > 0) { coupling++; break; }
    }
  }
  return { mass, coupling, occupiedFrames: occupied.size, presence };
}
