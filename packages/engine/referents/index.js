// Referent candidate/merge/split semantics (spec section 3.1, P0 work item).
//
// A referent is not an entity or label. Identity emerges from the event
// history, never from a mutable lookup table keyed by surface string.
// These functions are pure: given the same event list they return the same
// projection, and they never mutate their inputs.

/**
 * Project the current set of referents and their surfaces from a list of
 * referent-lifecycle events. Each event is one of:
 *   { type: "admit",  referent_id, surface, provenance }
 *   { type: "same_as", referent_id, target_id, provenance }   // alias proposal
 *   { type: "merge",   into_id, from_ids: [...], provenance }
 *   { type: "split",   from_id, into_ids: [...], surfaces: { [id]: [...] }, provenance }
 *
 * Same-string surfaces MUST NOT auto-merge: two "admit" events with an
 * identical surface but different referent_id remain distinct referents
 * unless an explicit merge event unifies them.
 */
export function projectReferents(events) {
  const referents = new Map(); // referent_id -> { id, surfaces: Set, admitted_by: [], merged_into: null }

  function ensure(id) {
    if (!referents.has(id)) {
      referents.set(id, { id, surfaces: new Set(), admittedBy: [], mergedInto: null });
    }
    return referents.get(id);
  }

  function resolve(id) {
    let current = ensure(id);
    const seen = new Set();
    while (current.mergedInto && !seen.has(current.id)) {
      seen.add(current.id);
      current = ensure(current.mergedInto);
    }
    return current;
  }

  for (const event of events) {
    switch (event.type) {
      case "admit": {
        const referent = resolve(event.referent_id);
        referent.surfaces.add(event.surface);
        referent.admittedBy.push({ provenance: event.provenance ?? null });
        break;
      }
      case "same_as": {
        // A same_as proposal records a candidate equivalence; it does not by
        // itself unify identity. Only an explicit merge event does that.
        const referent = resolve(event.referent_id);
        referent.candidateEquivalents ??= new Set();
        referent.candidateEquivalents.add(event.target_id);
        break;
      }
      case "merge": {
        const target = resolve(event.into_id);
        for (const fromId of event.from_ids) {
          const source = resolve(fromId);
          if (source.id === target.id) continue;
          for (const surface of source.surfaces) target.surfaces.add(surface);
          source.mergedInto = target.id;
        }
        break;
      }
      case "split": {
        const source = resolve(event.from_id);
        for (const intoId of event.into_ids) {
          const child = ensure(intoId);
          for (const surface of event.surfaces?.[intoId] ?? []) {
            child.surfaces.add(surface);
          }
        }
        // The source referent's own history (its admitted surfaces) is
        // preserved, not deleted: a split does not erase prior observations.
        break;
      }
      default:
        throw new Error(`projectReferents: unknown event type "${event.type}"`);
    }
  }

  const result = new Map();
  for (const [id, referent] of referents) {
    if (referent.mergedInto) continue; // superseded; resolve() finds the survivor
    result.set(id, {
      id: referent.id,
      surfaces: [...referent.surfaces],
    });
  }
  return result;
}

export {
  INDIVIDUATION_TYPES,
  classifyIndividuationType,
  individuateReferent,
  applyNameBind,
  applyFrameDemotion,
  applySubjectReentry,
} from "./individuation.js";

export { couplingDispersion } from "./dispersion.js";

export {
  operatorCandidateToReferentArgs,
  individuateOperatorCandidate,
} from "./operator-adapter.js";

/** Two admit events with the same surface do NOT imply the same referent. */
export function surfacesIndicateSameReferent(events, surfaceA, surfaceB) {
  const projection = projectReferents(events);
  for (const referent of projection.values()) {
    if (referent.surfaces.includes(surfaceA) && referent.surfaces.includes(surfaceB)) {
      return true;
    }
  }
  return false;
}
