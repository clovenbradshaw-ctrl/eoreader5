import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_SUBASSEMBLIES, assembleWatchmaker, defineSubassembly } from "./index.js";

test("core watchmaker assembly exposes eoreader5 as the app citation surface", () => {
  assert.deepEqual(CORE_SUBASSEMBLIES.public_citation_surface, [
    "@eoreader/spec",
    "@eoreader/engine",
    "@eoreader/engine/subassemblies",
  ]);
  assert.ok(CORE_SUBASSEMBLIES.subassemblies.some((part) => part.id === "reading-snapshot"));
});

test("subassemblies must satisfy kind-required ports", () => {
  assert.throws(
    () => defineSubassembly({ id: "bad", kind: "reading-snapshot", version: "0.1.0", inputs: [], outputs: [] }),
    /missing required port/
  );
});

test("watchmaker assembly sorts dependencies before dependents and rejects missing parts", () => {
  const a = defineSubassembly({ id: "a", kind: "operator-epoch", version: "0.1.0", outputs: ["operator-catalog"] });
  const b = defineSubassembly({ id: "b", kind: "referent-laws", version: "0.1.0", inputs: ["referent-events"], outputs: ["referent-projection"], depends_on: ["a"] });
  assert.deepEqual(assembleWatchmaker([b, a]).subassemblies.map((part) => part.id), ["a", "b"]);
  assert.throws(() => assembleWatchmaker([{ ...b, depends_on: ["missing"] }]), /depends on missing/);
});
