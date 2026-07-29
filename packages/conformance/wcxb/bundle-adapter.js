// Adapter: EOReader5 projection bundle -> WCXB `extraction` value.
//
// INTEGRATION SEAM. The engine does not yet produce a reading from an
// HTML-derived ObservationEnvelope (HTML decoding is the app's job, and the
// fold/typed-discard read path is still being built). This adapter is the one
// place that will bind the harness to that reader when it lands; until then it
// is exercised only by unit tests with hand-built bundles, and the end-to-end
// scoring test is marked `todo` in ../invariants/wcxb-harness.test.js.
//
// Contract, per docs/architecture.md §3.3 and the corpus-role firewall:
//   - CITABLE spans are what the reader chose to surface  -> `rendered`.
//   - RETAINED-but-not-citable units (typed discards: nav, cookie banner,
//     related cards) are on the ledger but never in the citable projection
//     -> `retained_typed`.
//
// The projection bundle shape is still settling (see project()/projectBundle
// in packages/engine/projection). We therefore read text through tolerant
// accessors rather than hard-coding a field, and expose the accessors so the
// binding can be corrected in exactly one spot once the reader is real.

/** Pull display text off a unit-like object without assuming one field name. */
export function spanText(unit) {
  if (unit == null) return "";
  if (typeof unit === "string") return unit;
  return String(unit.text ?? unit.surface ?? unit.value ?? "");
}

/**
 * @param {object} bundle  a project()/projectBundle() result
 * @param {object} [opts]
 * @param {(u:any)=>string} [opts.text]      text accessor (default spanText)
 * @param {(b:any)=>any[]}  [opts.rendered]  selects citable units
 *        (default: bundle.spans)
 * @param {(b:any)=>any[]}  [opts.retained]  selects retained-typed units
 *        (default: bundle.retained ?? bundle.discards ?? [])
 * @returns {{rendered: string, retained_typed: string}}
 */
export function extractionFromBundle(bundle, opts = {}) {
  const text = opts.text ?? spanText;
  const renderedUnits = (opts.rendered ?? ((b) => b?.spans ?? []))(bundle) ?? [];
  const retainedUnits =
    (opts.retained ?? ((b) => b?.retained ?? b?.discards ?? []))(bundle) ?? [];
  return {
    rendered: renderedUnits.map(text).filter(Boolean).join("\n"),
    retained_typed: retainedUnits.map(text).filter(Boolean).join("\n"),
  };
}
