import { canonicalHashSync } from "../canonical-json/index.js";
import { CURRENT_OPERATOR_EPOCH, isCurrentOperator } from "../operators/epoch.js";

const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const EVENT_ID_RE = /^event:sha256:[0-9a-f]{64}$/;
const PRIOR_ID_RE = /^prior:sha256:[0-9a-f]{64}$/;

function fail(name, message) {
  throw new TypeError(`${name}: ${message}`);
}
function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(name, "expected object");
  return value;
}
function string(value, name, field) {
  if (typeof value !== "string" || value.length === 0) fail(name, `expected non-empty ${field}`);
}
function array(value, name, field) {
  if (!Array.isArray(value)) fail(name, `expected array ${field}`);
}
function hash(value, name, field) {
  if (typeof value !== "string" || !HASH_RE.test(value)) fail(name, `expected canonical sha256 ${field}`);
}

export function validateObservationEnvelope(value, name = "ObservationEnvelope") {
  const v = object(value, name);
  if (v.schema !== "ObservationEnvelope@1") fail(name, "schema must be ObservationEnvelope@1");
  string(v.source_id, name, "source_id");
  string(v.source_media_type, name, "source_media_type");
  object(v.decoder, name); string(v.decoder.id, name, "decoder.id"); string(v.decoder.version, name, "decoder.version");
  array(v.axes, name, "axes"); array(v.fields, name, "fields"); object(v.anchors, name); string(v.anchors.scheme, name, "anchors.scheme");
  hash(v.source_content_hash, name, "source_content_hash"); hash(v.blocks_hash, name, "blocks_hash");
  for (const axis of v.axes) { object(axis, name); string(axis.axis_id, name, "axis_id"); string(axis.topology, name, "topology"); }
  for (const field of v.fields) { object(field, name); string(field.field_id, name, "field_id"); string(field.value_type, name, "value_type"); string(field.block_id, name, "block_id"); }
  return v;
}

export function validatePriorSnapshot(value, name = "PriorSnapshot") {
  const v = object(value, name);
  string(v.schema_version ?? v.schema, name, "schema_version"); string(v.prior_id, name, "prior_id"); string(v.operator_epoch, name, "operator_epoch");
  if (!PRIOR_ID_RE.test(v.prior_id)) fail(name, "prior_id must be prior:sha256:<64 hex>");
  if (v.operator_epoch !== CURRENT_OPERATOR_EPOCH) fail(name, `operator_epoch must be ${CURRENT_OPERATOR_EPOCH}`);
  string(v.ledger_head, name, "ledger_head"); string(v.basis_id, name, "basis_id"); hash(v.content_hash, name, "content_hash");
  return v;
}

export function validateSemanticEvent(value, name = "SemanticEvent") {
  const v = object(value, name);
  if (v.schema_version !== "SemanticEvent@1") fail(name, "schema_version must be SemanticEvent@1");
  string(v.event_id, name, "event_id");
  if (!EVENT_ID_RE.test(v.event_id)) fail(name, "event_id must be event:sha256:<64 hex>");
  string(v.operator_epoch, name, "operator_epoch");
  if (v.operator_epoch !== CURRENT_OPERATOR_EPOCH) fail(name, `operator_epoch must be ${CURRENT_OPERATOR_EPOCH}`);
  if (!isCurrentOperator(v.op)) fail(name, `invalid operator ${v.op}`);
  array(v.inputs, name, "inputs");
  object(v.provenance, name); array(v.provenance.depends_on, name, "provenance.depends_on");
  object(v.authority, name); string(v.authority.actor_id, name, "authority.actor_id"); object(v.authority.grant, name);
  const { event_id, ...body } = v;
  const expected = `event:${canonicalHashSync(body)}`;
  if (event_id !== expected) fail(name, "event_id does not match canonical event content");
  return v;
}

export function validateEffectResult(value, name = "EffectResult") {
  const v = object(value, name);
  string(v.effect_id, name, "effect_id"); string(v.producer, name, "producer"); string(v.version, name, "version");
  hash(v.configuration_hash, name, "configuration_hash"); hash(v.content_hash, name, "content_hash");
  return v;
}

export function validateCommand(value, name = "Command") {
  const v = object(value, name); string(v.type, name, "type");
  const allowed = new Set(["observation.admit", "effect.result.admit", "hypothesis.accept", "hypothesis.compete", "hypothesis.hold", "hypothesis.supersede", "referent.merge", "referent.split", "referent.same_as", "discovery.advance", "discovery.resume"]);
  if (!allowed.has(v.type)) fail(name, `unknown command type ${v.type}`);
  if (v.inputs !== undefined) array(v.inputs, name, "inputs");
  if (v.type === "observation.admit") validateObservationEnvelope(v.payload?.envelope ?? v.payload);
  if (v.type === "effect.result.admit") validateEffectResult(v.payload);
  return v;
}

export function validateReadingSnapshot(value, name = "ReadingSnapshot") {
  const v = object(value, name);
  if (v.schema_version !== "ReadingSnapshot@1") fail(name, "schema_version must be ReadingSnapshot@1");
  for (const field of ["reading_id", "engine_version", "operator_epoch", "prior_id", "frame_id", "lens_id", "semantic_head"]) string(v[field], name, field);
  array(v.units, name, "units");
  return v;
}
