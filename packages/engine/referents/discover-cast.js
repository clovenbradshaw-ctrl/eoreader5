// discover-cast.js — who is in this document, read from the document.
//
// AGENTS.md has carried this as a designed-but-unbuilt gap: "Auto-discovery
// would mean clustering `extractSurfaces` output via `namesCorefer` into
// candidate referents, then gating each through `referents/individuation.js`'s
// mass×coupling Born-null (not asserting holon status). Not yet built." This is
// that, built.
//
// Why it has to exist. A hand-typed cast per text does not generalize: the
// Frankenstein coref prior contains exactly ONE referent, so an attribution
// check that needs to name both sides of a swap could not name Victor, and the
// real misattribution it was built to catch came back as unresolved. Curating a
// cast per book is not a plan for "any topic with enough to surf and fold."
//
// What makes this legitimate rather than a coref shortcut. The tier line is
// already drawn: structural NAME coref is ENGINE-tier; descriptor synonymy
// ("monster" ≈ "creature") and thematic resonance are MODEL-tier and stay
// injected. This module only clusters NAMES, by the structural test in
// `presence.js::namesCorefer` — containment or a shared final token. It never
// decides that a descriptor predicates a named being, and a text whose central
// figure is unnamed (Frankenstein's creature, a leitmotif) correctly yields no
// referent for it and a typed gap instead. That is the emanon case, and it must
// stay a gap.
//
// Omnimodal note: nothing here reads a name LEXICON. `rankSurfaces` separates
// names from sentence-openers by the cap/lower ratio — a physics of how names
// are written, not a list of English ones — so this works on any text in any
// language that marks names by case, and honestly finds nothing where that
// signal is absent rather than inventing something.

import { frameText } from "../emergence/summary/text-organ.js";
import { rankSurfaces } from "../perceiver/text/surfaces.js";
import { namesCorefer, diaNorm } from "../perceiver/text/presence.js";
import { individuateReferent } from "./individuation.js";

/**
 * Cluster ranked surfaces into candidate referents by structural name coref.
 *
 * "Victor" and "Victor Frankenstein" are one referent by containment;
 * "Frankenstein" joins by shared final token. The longest surface names the
 * cluster, because it is the most specific evidence of who this is.
 *
 * Single-token surfaces are folded into a multi-token cluster when they corefer
 * — but a single-token surface that matches MORE THAN ONE cluster is dropped to
 * a gap rather than assigned. "Prince" across several princes is the measured
 * failure the relationship-graph header already warns about; assigning it to
 * whichever cluster happened to come first is precisely the silent wrong answer
 * this project treats as worse than silence.
 */
export function clusterSurfaces(ranked) {
  const clusters = [];
  const gaps = [];

  // Multi-token surfaces first: they are the specific evidence, and seeding
  // from them keeps a bare surname from founding a cluster of its own.
  const multi = ranked.filter((r) => r.surface.trim().split(/\s+/).length > 1);
  const single = ranked.filter((r) => r.surface.trim().split(/\s+/).length === 1);

  for (const r of multi) {
    const hit = clusters.find((c) => c.surfaces.some((s) => namesCorefer(s.surface, r.surface)));
    if (hit) hit.surfaces.push(r);
    else clusters.push({ surfaces: [r] });
  }

  for (const r of single) {
    const matching = clusters.filter((c) => c.surfaces.some((s) => namesCorefer(s.surface, r.surface)));
    if (matching.length === 1) matching[0].surfaces.push(r);
    else if (matching.length > 1) {
      gaps.push({
        type: "ambiguous_surface",
        surface: r.surface,
        candidates: matching.map((c) => longestSurface(c)),
        reason: `"${r.surface}" corefers with more than one referent — not assigned to any`,
      });
    } else clusters.push({ surfaces: [r] });
  }

  return { clusters, gaps };
}

const longestSurface = (c) =>
  c.surfaces.reduce((a, b) => (b.surface.length > a.surface.length ? b : a)).surface;

/**
 * discoverCast(text, options) -> { cast, gaps, considered }
 *
 * `cast` entries are `{ id, surfaces, mass, frames, individuation }`.
 *
 * The Born-null gate is what keeps this from being "every capitalized word is a
 * character". Each candidate's mass (mentions) and coupling (frame spread) are
 * scored against a null built from the OTHER candidates in this same document —
 * a conditional null, not a global one. AGENTS.md is explicit that an
 * unconditional null is a units change and only a conditional null earns a
 * dimension, and the null here varies along exactly the axis a gaming strategy
 * would exploit: flooding the text with a repeated capitalized token raises the
 * null with it.
 */
export function discoverCast(text, { minFrames = 3, limit = 200, quantile = 0.75, identities = [] } = {}) {
  const frames = frameText(String(text ?? ""));
  const ranked = rankSurfaces(frames, { minFrames, limit });
  if (!ranked.length) {
    return { cast: [], considered: 0, gaps: [{ type: "no_surfaces", reason: "no name-like surfaces survived ranking — this document may name nobody" }] };
  }

  let { clusters, gaps } = clusterSurfaces(ranked);

  // Injected identities — MODEL-tier, and deliberately not derivable.
  //
  // "Victor" and "Frankenstein" are one person, and no name-structural test can
  // say so: measured, the string "Victor Frankenstein" appears ZERO times in
  // the book, so there is no bridging surface and no containment or shared-token
  // path between them. That knowledge is a witness fact, exactly like descriptor
  // synonymy, and it arrives the same way — injected.
  //
  // It also must not be applied blindly. The surname names OTHER people in the
  // same text: "Madame Frankenstein" and "M. Frankenstein" are Victor's mother
  // and father, and "Frankenstein, your son" is someone addressing the father.
  // A wholesale merge of the surname into Victor absorbs his parents — the same
  // failure relationship-graph.js documents for a bare "Prince" vocative. So an
  // identity is a declaration about SPECIFIC surfaces, never a rule about a
  // token, and a caller declaring one is asserting it on the record.
  if (identities.length) {
    const merged = [];
    for (const group of identities) {
      const want = group.map((g) => diaNorm(String(g)).toLowerCase());
      const hits = clusters.filter((c) => c.surfaces.some((s) => want.includes(diaNorm(s.surface).toLowerCase())));
      if (hits.length < 2) continue;
      const union = { surfaces: hits.flatMap((h) => h.surfaces), declared: true };
      clusters = clusters.filter((c) => !hits.includes(c));
      clusters.push(union);
      merged.push(group.join(" = "));
    }
    for (const m of merged) gaps.push({ type: "declared_identity", reason: `merged by injected identity: ${m} — a witness fact, not derived` });
  }

  // Conditional null: the distribution of the candidates themselves.
  const massSamples = clusters.map((c) => c.surfaces.reduce((n, s) => n + s.mentions, 0));
  const couplingSamples = clusters.map((c) => Math.max(...c.surfaces.map((s) => s.frames)));

  const cast = [];
  for (const c of clusters) {
    const id = longestSurface(c);
    const mass = c.surfaces.reduce((n, s) => n + s.mentions, 0);
    const coupling = Math.max(...c.surfaces.map((s) => s.frames));

    let individuation = null;
    try {
      const result = individuateReferent({
        referentId: id,
        mass,
        coupling,
        // These are NAMES by construction — rankSurfaces admitted them on the
        // cap/lower ratio, which is the structural evidence of naming.
        named: true,
        massNullSamples: massSamples,
        couplingNullSamples: couplingSamples,
        quantile,
      });
      individuation = result?.individuation_type ?? null;
    } catch (err) {
      // A gate that cannot run is a gap, never an admission.
      gaps.push({ type: "individuation_failed", referent: id, reason: err.message });
      continue;
    }

    // "field" is the engine's word for something that did not individuate — it
    // is texture, not a someone. Dropping it here is the whole point of the
    // gate; without it every recurring capitalized token joins the cast.
    if (individuation === "field") {
      gaps.push({ type: "did_not_individuate", referent: id, mass, coupling, reason: `"${id}" did not clear the Born-null gate — texture, not a referent` });
      continue;
    }

    cast.push({
      id,
      surfaces: c.surfaces.map((s) => s.surface),
      mass,
      frames: coupling,
      individuation,
    });
  }

  cast.sort((a, b) => b.frames - a.frames || b.mass - a.mass);
  return { cast, considered: clusters.length, gaps };
}

/**
 * castSurfaces(cast) -> string[]
 *
 * Flattened, diacritic-normalized surface list — the form an attribution check
 * wants when asking "can I name both sides of this swap".
 */
export function castSurfaces(cast) {
  const out = new Set();
  for (const r of cast) {
    out.add(diaNorm(r.id).toLowerCase());
    for (const s of r.surfaces) out.add(diaNorm(s).toLowerCase());
  }
  return [...out];
}
