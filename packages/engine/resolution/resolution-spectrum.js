// Ported from eoreader4.2 src/core/resolution-spectrum.js — the witness-channel
// axis for a coreference/identity decision, and the static taxonomy of situation
// types placed on it. The legacy `classifyResolutions(doc)` (live classification
// over a document's log + projected graph) is DROPPED here: it required
// './project.js' (projectGraph), which belongs to the unported ledger/graph
// holon, not this one. The pure taxonomy — TIER, needsWitness, SPECTRUM,
// spectrumOf — carries no such dependency and is preserved in full.

export const TIER = Object.freeze({
  RESOLVED: 'resolved',
  ENGINE:   'engine',
  MIXED:    'mixed',
  MODEL:    'model',
});

export const needsWitness = (tier) =>
  tier === TIER.MODEL ? true : tier === TIER.MIXED ? 'tail' : false;

export const SPECTRUM = Object.freeze([
  {
    type: 'name-alias', tier: TIER.RESOLVED, engineKind: 'rule',
    reason: 'a surface form contains, initialises, or is the given name of an admitted name',
    needs: '— structure settles it (head/tail/initialism alias, defeasibly)',
  },
  {
    type: 'surname-collision', tier: TIER.ENGINE, engineKind: 'learned',
    reason: 'a surname borne by ≥2 distinct full names is non-individuating — the eager tail merge is defeated',
    needs: 'the learned population statistic (the surname proved shared) — no witness',
  },
  {
    type: 'functional-veto', tier: TIER.ENGINE, engineKind: 'learned',
    reason: 'two candidates disagree on a high-functionality key (a birth date): a near-veto',
    needs: 'the LEARNED functional weight (Fellegi-Sunter m/u) + the injected conflict oracle — no witness',
  },
  {
    type: 'contested-key', tier: TIER.MIXED, engineKind: 'learned',
    reason: 'one entity, one identical name, two values of a one-valued key — the F-S indeterminate middle',
    needs: 'engine DETECTS the dispute (learned functionality); choosing the TRUE value needs an external source/witness',
  },
  {
    type: 'held-near-identity', tier: TIER.MIXED, engineKind: 'learned',
    reason: 'distinct names sharing a surname AND a discriminator (role/org) — corroboration short of identity',
    needs: 'engine DETECTS the candidate (surname + shared discriminator, corpus statistics); resolving it under a conflict needs co-attestation',
  },
  {
    type: 'entity-typing', tier: TIER.ENGINE, engineKind: 'rule',
    reason: 'the type follows from verb-selection — "acquired / reported earnings" ⇒ organisation, independent of case',
    needs: 'the injected typing bridge (verb→type); only a NOVEL predicate falls to the witness',
  },
  {
    type: 'casing-detection', tier: TIER.MIXED, engineKind: 'rule',
    reason: 'a referent recognised only because it was capitalised — fragile on a lowercased/ASR source',
    needs: 'clean lowercased text: engine (source-class gate + S1–S4); genuine ASR/OCR NOISE: the witness',
  },
  {
    type: 'pronoun-structural', tier: TIER.RESOLVED, engineKind: 'learned',
    reason: 'a pronoun with a clear field winner (recency or standing-role salience)',
    needs: '— the decaying field settles it; the coupling weight carries the residual uncertainty',
  },
  {
    type: 'pronoun-semantic', tier: TIER.MODEL,
    reason: 'two equally-salient, same-type candidates; only the trigger word’s MEANING picks (a Winograd schema)',
    needs: 'the witness channel — open-domain world-knowledge no field salience or symbolic table covers',
  },
  {
    type: 'same-name-split', tier: TIER.MIXED, engineKind: 'learned',
    reason: 'two people under one identical name — distinctness must come from somewhere other than the string',
    subcases: Object.freeze([
      { case: 'by-functional-key', tier: TIER.ENGINE, engineKind: 'learned',
        reason: 'a conflicting birth date / EIN splits them deterministically — this is literally the D4 orthogonality' },
      { case: 'by-soft-role', tier: TIER.MODEL,
        reason: 'distinguished only by incompatible real-world roles (senator vs plumber, both holdable) — world-knowledge' },
    ]),
    needs: 'engine where a functional key separates them; the witness where only soft roles do',
  },
]);

const SPECTRUM_BY_TYPE = new Map(SPECTRUM.map((s) => [s.type, s]));
export const spectrumOf = (type) => SPECTRUM_BY_TYPE.get(type) || null;
