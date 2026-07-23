import { CURRENT_OPERATOR_EPOCH } from "@eoreader/spec/operators";
import {
  HOLONIC_SCHEMA_VERSION,
  REQUIRED_PORTS,
  isSubassemblyKind,
} from "@eoreader/spec/holons";

const DEFAULT_REQUIRED_INVARIANTS = Object.freeze([
  "pure-function",
  "serializable-ports",
  "content-addressable-custody",
  "explicit-provenance",
  "no-ambient-authority",
]);

export function defineSubassembly({ id, kind, version, inputs, outputs, invariants, owns, depends_on }) {
  assertNonEmptyString(id, "id");
  assertNonEmptyString(version, "version");
  if (!isSubassemblyKind(kind)) throw new Error(`defineSubassembly: unknown kind "${kind}"`);
  const required = REQUIRED_PORTS[kind];
  assertContainsAll(inputs ?? [], required.inputs, `${id}.inputs`);
  assertContainsAll(outputs ?? [], required.outputs, `${id}.outputs`);
  const normalizedInvariants = unique([...(invariants ?? []), ...DEFAULT_REQUIRED_INVARIANTS]);
  return deepFreeze({
    schema_version: HOLONIC_SCHEMA_VERSION,
    id,
    kind,
    version,
    operator_epoch: CURRENT_OPERATOR_EPOCH,
    inputs: unique(inputs ?? []),
    outputs: unique(outputs ?? []),
    invariants: normalizedInvariants,
    owns: unique(owns ?? []),
    depends_on: unique(depends_on ?? []),
  });
}

export function assembleWatchmaker(subassemblies) {
  if (!Array.isArray(subassemblies)) throw new TypeError("assembleWatchmaker: subassemblies must be an array");
  const byId = new Map();
  for (const subassembly of subassemblies) {
    if (byId.has(subassembly.id)) throw new Error(`assembleWatchmaker: duplicate subassembly "${subassembly.id}"`);
    byId.set(subassembly.id, subassembly);
  }
  for (const subassembly of subassemblies) {
    for (const dependency of subassembly.depends_on) {
      if (!byId.has(dependency)) throw new Error(`assembleWatchmaker: "${subassembly.id}" depends on missing "${dependency}"`);
    }
  }
  return deepFreeze({
    schema_version: "eoreader5.watchmaker.v1",
    operator_epoch: CURRENT_OPERATOR_EPOCH,
    subassemblies: topoSort(subassemblies, byId),
    public_citation_surface: [
      "@eoreader/spec",
      "@eoreader/engine",
      "@eoreader/engine/subassemblies",
    ],
  });
}

export const CORE_SUBASSEMBLIES = assembleWatchmaker([
  defineSubassembly({ id: "operator-epoch", kind: "operator-epoch", version: "0.1.0", outputs: ["operator-catalog"], owns: ["operator vocabulary"] }),
  defineSubassembly({ id: "canonical-json", kind: "canonical-json", version: "0.1.0", inputs: ["serializable-artifact"], outputs: ["canonical-bytes", "content-hash"], owns: ["artifact identity"] }),
  defineSubassembly({ id: "referent-laws", kind: "referent-laws", version: "0.1.0", inputs: ["referent-events"], outputs: ["referent-projection"], depends_on: ["operator-epoch"], owns: ["referent lifecycle"] }),
  defineSubassembly({ id: "individuation-gate", kind: "individuation-gate", version: "0.1.0", inputs: ["referent-projection", "null-protocol"], outputs: ["individuation-result"], depends_on: ["referent-laws"], owns: ["Ground -> Figure promotion gate (spec section 13)"] }),
  defineSubassembly({ id: "prior-boundary", kind: "prior-boundary", version: "0.1.0", inputs: ["prior-snapshot"], outputs: ["pinned-prior-context"], depends_on: ["canonical-json"], owns: ["prior artifact membrane"] }),
  defineSubassembly({ id: "semantic-ledger", kind: "semantic-ledger", version: "0.1.0", inputs: ["semantic-events"], outputs: ["semantic-head"], depends_on: ["canonical-json", "operator-epoch", "referent-laws"], owns: ["append-only semantic event fold"] }),
  defineSubassembly({ id: "reading-snapshot", kind: "reading-snapshot", version: "0.1.0", inputs: ["semantic-head", "frame", "lens", "prior-snapshot"], outputs: ["reading-snapshot"], depends_on: ["semantic-ledger", "prior-boundary"], owns: ["external app citation artifact"] }),
  defineSubassembly({ id: "enactment-boundary", kind: "enactment-boundary", version: "0.1.0", inputs: ["candidate-surface", "reading-snapshot"], outputs: ["enactment-decision", "effect-request"], depends_on: ["reading-snapshot"], owns: ["admit/hold/veto decision seam"] }),
]);

function topoSort(items, byId) {
  const sorted = [];
  const temporary = new Set();
  const permanent = new Set();
  function visit(item) {
    if (permanent.has(item.id)) return;
    if (temporary.has(item.id)) throw new Error(`assembleWatchmaker: dependency cycle at "${item.id}"`);
    temporary.add(item.id);
    for (const dep of item.depends_on) visit(byId.get(dep));
    temporary.delete(item.id);
    permanent.add(item.id);
    sorted.push(item);
  }
  for (const item of items) visit(item);
  return sorted;
}

function assertNonEmptyString(value, name) { if (typeof value !== "string" || value.length === 0) throw new TypeError(`defineSubassembly: ${name} must be a non-empty string`); }
function assertContainsAll(actual, required, label) { for (const item of required) if (!actual.includes(item)) throw new Error(`defineSubassembly: ${label} missing required port "${item}"`); }
function unique(values) { return [...new Set(values)].sort(); }
function deepFreeze(value) { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
