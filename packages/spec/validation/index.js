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

const INDIVIDUATION_TYPES = new Set(["field", "emanon", "protogon", "holon"]);
const GATE_STATUSES = new Set(["field", "pending", "active"]);

export function validateNullProtocol(value, name = "NullProtocol") {
  const v = object(value, name);
  if (v.schema !== "NullProtocol@1") fail(name, "schema must be NullProtocol@1");
  if (v.null_protocol !== null) object(v.null_protocol, name);
  if (v.null_samples !== undefined) array(v.null_samples, name, "null_samples");
  if (!Number.isInteger(v.sample_count) || v.sample_count < 1) fail(name, "sample_count must be an integer >= 1");
  if (typeof v.quantile !== "number" || v.quantile <= 0 || v.quantile >= 1) fail(name, "quantile must be in (0, 1)");
  if (v.tail_direction !== "greater" && v.tail_direction !== "less") fail(name, 'tail_direction must be "greater" or "less"');
  if (typeof v.threshold !== "number") fail(name, "threshold must be a number");
  if (typeof v.observed_statistic !== "number") fail(name, "observed_statistic must be a number");
  if (typeof v.passed !== "boolean") fail(name, "passed must be a boolean");
  if (typeof v.p_value !== "number" || v.p_value < 0 || v.p_value > 1) fail(name, "p_value must be in [0, 1]");
  return v;
}

export function validateIndividuationResult(value, name = "IndividuationResult") {
  const v = object(value, name);
  if (v.schema !== "IndividuationResult@1") fail(name, "schema must be IndividuationResult@1");
  string(v.referent_id, name, "referent_id");
  if (!INDIVIDUATION_TYPES.has(v.individuation_type)) fail(name, `invalid individuation_type ${v.individuation_type}`);
  if (typeof v.mass !== "number") fail(name, "mass must be a number");
  if (typeof v.coupling !== "number") fail(name, "coupling must be a number");
  if (v.agency_signal !== null && typeof v.agency_signal !== "number") fail(name, "agency_signal must be a number or null");
  if (typeof v.named !== "boolean") fail(name, "named must be a boolean");
  validateNullProtocol(v.mass_null, `${name}.mass_null`);
  validateNullProtocol(v.coupling_null, `${name}.coupling_null`);
  if (v.boundary_stability !== null) {
    const boundary = object(v.boundary_stability, `${name}.boundary_stability`);
    if (typeof boundary.mean_observed_displacement !== "number") fail(name, "boundary_stability.mean_observed_displacement must be a number");
    if (typeof boundary.boundary_stability !== "number") fail(name, "boundary_stability.boundary_stability must be a number");
    if (typeof boundary.passed !== "boolean") fail(name, "boundary_stability.passed must be a boolean");
    validateNullProtocol(boundary.null_result, `${name}.boundary_stability.null_result`);
  }
  const gate = object(v.gate_result, `${name}.gate_result`);
  if (typeof gate.admitted !== "boolean") fail(name, "gate_result.admitted must be a boolean");
  if (!GATE_STATUSES.has(gate.status)) fail(name, `invalid gate_result.status ${gate.status}`);
  string(gate.reason, name, "gate_result.reason");
  return v;
}

export function validateReadingSnapshot(value, name = "ReadingSnapshot") {
  const v = object(value, name);
  if (v.schema_version !== "ReadingSnapshot@1") fail(name, "schema_version must be ReadingSnapshot@1");
  for (const field of ["reading_id", "engine_version", "operator_epoch", "prior_id", "frame_id", "lens_id", "semantic_head"]) string(v[field], name, field);
  array(v.units, name, "units");
  return v;
}
