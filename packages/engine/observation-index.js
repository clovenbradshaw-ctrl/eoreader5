import { canonicalHashSync } from "@eoreader/spec/canonical-json";
import { validateObservationEnvelope } from "@eoreader/spec";

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

export function blockContentHash(block) {
  return canonicalHashSync({ schema: block.schema, block_id: block.block_id, value_type: block.value_type, shape: block.shape, axis_order: block.axis_order ?? [], values: block.values, missing: block.missing ?? [], loss: block.loss ?? [] });
}

export function verifyObservationBundle(envelope, blocks = []) {
  validateObservationEnvelope(envelope);
  const byId = new Map(blocks.map((block) => [block.block_id, block]));
  for (const field of envelope.fields) {
    const block = byId.get(field.block_id);
    if (!block) {
      if (blocks.length === 0) continue;
      throw new TypeError(`ObservationBundle: missing resolved block ${field.block_id}`);
    }
    if (block.schema !== "ObservationBlock@1") throw new TypeError(`ObservationBundle: ${field.block_id} schema must be ObservationBlock@1`);
    if (block.content_hash !== blockContentHash(block)) throw new TypeError(`ObservationBundle: ${field.block_id} content_hash mismatch`);
  }
  if (blocks.length > 0) {
    const blocksHash = canonicalHashSync(blocks.map((block) => ({ block_id: block.block_id, content_hash: block.content_hash })));
    if (envelope.blocks_hash !== blocksHash) throw new TypeError("ObservationBundle: envelope blocks_hash mismatch");
  }
  return { envelope, blocks };
}

export function materializeObservationIndex(observations = [], blockStore = new Map()) {
  const fields = new Map();
  const axes = new Map();
  const values = [];
  for (const envelope of observations) {
    for (const axis of envelope.axes ?? []) axes.set(axis.axis_id, { ...axis, source_id: envelope.source_id });
    for (const field of envelope.fields ?? []) {
      const block = blockStore.get(field.block_id);
      const record = { ...field, source_id: envelope.source_id, block };
      fields.set(field.field_id, record);
      (block?.values ?? []).forEach((value, index) => values.push({
        value_id: id("value", { block_id: field.block_id, index }),
        source_id: envelope.source_id,
        field_id: field.field_id,
        block_id: field.block_id,
        index,
        value,
        selector: block?.selectors?.[index] ?? envelope.anchors?.selectors?.[field.field_id]?.[index] ?? null,
        axes: field.axes ?? [],
      }));
    }
  }
  return { fields, axes, values };
}
