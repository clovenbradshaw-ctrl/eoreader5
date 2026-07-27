// The modality-blind field-spec interface.
//
// Audio, video and text each declare what their field vector means:
//
//   AUDIO_FIELD_SPEC  chroma(12) · timbre(13) · moments(5)
//   VIDEO_FIELD_SPEC  motion(300) · histogram(16) · centroid(2) · moments(3)
//   TEXT_FIELD_SPEC   char-3gram(128) · wordlen(2)
//   EOT field spec    figures(n) · moments(2) · operators(9)
//
// Before this module each spec was an inert object: a list of channel
// names and widths that nothing read. Every consumer that needed a
// channel sliced the vector with a hardcoded offset — `u.field.slice(0,
// 300)` for video motion energy, and so on — which means the spec and
// the code that depends on it could drift apart silently, and any
// formula wanting to work across modalities had to branch on medium.
//
// A FieldSpec here is executable: it knows its own offsets, can slice a
// vector into named channels, and carries the metric each channel
// should be compared under. That is what lets curl, divergence, current
// density and red shift run over any modality without asking which one
// they are looking at.

const METRICS = Object.freeze(['cosine', 'angular', 'euclidean', 'euclidean-standardised']);

// Which metrics actually satisfy the triangle inequality.
//
// This distinction is load-bearing, not pedantry. Cosine distance
// (1 − cos θ) is NOT a metric: it fails d(a,c) ≤ d(a,b) + d(b,c). Any
// quantity defined as displacement-over-path-length — the coherence in
// trajectory/field-shift.js, and the spatial coherence it mirrors in
// perceiver/video/physics.js — is only bounded by 1 when the underlying
// distance is a true metric. Under plain cosine it can exceed 1, at
// which point it no longer means "fraction of the path that was
// progress" and must not be read as one.
//
// Angular distance (θ/π) is the metric form of the same comparison:
// same ordering, same zero, but triangle-safe. Use it wherever a ratio
// of distances needs to stay interpretable.
const TRUE_METRICS = Object.freeze(new Set(['angular', 'euclidean', 'euclidean-standardised']));

export function isTrueMetric(metric) {
  return TRUE_METRICS.has(metric);
}

export function specIsMetric(spec) {
  return normalizeFieldSpec(spec).channels.every((c) => isTrueMetric(c.metric));
}

// ── Definition ───────────────────────────────────────────────────

export function defineFieldSpec({ channels, id = null }) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new TypeError('defineFieldSpec: at least one channel is required');
  }
  let offset = 0;
  const seen = new Set();
  const resolved = channels.map((c) => {
    if (!c || typeof c.name !== 'string' || c.name.length === 0) {
      throw new TypeError('defineFieldSpec: every channel needs a name');
    }
    if (seen.has(c.name)) throw new Error(`defineFieldSpec: duplicate channel "${c.name}"`);
    seen.add(c.name);
    if (!Number.isInteger(c.dims) || c.dims < 1) {
      throw new RangeError(`defineFieldSpec: channel "${c.name}" needs a positive integer dims`);
    }
    const metric = c.metric ?? 'euclidean';
    if (!METRICS.includes(metric)) {
      throw new Error(`defineFieldSpec: channel "${c.name}" has unknown metric "${metric}"`);
    }
    const entry = Object.freeze({ name: c.name, dims: c.dims, metric, offset });
    offset += c.dims;
    return entry;
  });
  return Object.freeze({
    id,
    channels: Object.freeze(resolved),
    dims: offset,
  });
}

// Accept the frozen literals the perceivers already export (which have
// `channels` but no offsets) as well as specs built here.
export function normalizeFieldSpec(spec) {
  if (!spec || !Array.isArray(spec.channels)) {
    throw new TypeError('normalizeFieldSpec: not a field spec');
  }
  if (Number.isInteger(spec.dims) && spec.channels.every((c) => Number.isInteger(c.offset))) {
    return spec;
  }
  return defineFieldSpec({ channels: spec.channels, id: spec.id ?? null });
}

export function fieldSpecDims(spec) {
  return normalizeFieldSpec(spec).dims;
}

export function channelNames(spec) {
  return normalizeFieldSpec(spec).channels.map((c) => c.name);
}

export function getChannel(spec, name) {
  const found = normalizeFieldSpec(spec).channels.find((c) => c.name === name);
  if (!found) throw new Error(`field spec has no channel "${name}"`);
  return found;
}

// ── Validation ───────────────────────────────────────────────────
//
// The check that was missing everywhere: does this vector actually
// match the spec it claims to follow? A video reading whose field is
// 320 long against a spec summing to 321 produced silent nonsense.
export function validateFieldVector(vector, spec, { label = 'field' } = {}) {
  const s = normalizeFieldSpec(spec);
  if (vector.length !== s.dims) {
    return Object.freeze({
      valid: false,
      reason: 'dims-mismatch',
      expected: s.dims,
      actual: vector.length,
      label,
    });
  }
  let nonFinite = 0;
  for (let i = 0; i < vector.length; i++) if (!Number.isFinite(vector[i])) nonFinite++;
  return Object.freeze({
    valid: nonFinite === 0,
    reason: nonFinite > 0 ? 'non-finite' : null,
    nonFinite,
    expected: s.dims,
    actual: vector.length,
    label,
  });
}

// ── Slicing ──────────────────────────────────────────────────────

export function sliceChannel(vector, spec, name) {
  const c = getChannel(spec, name);
  if (vector.length < c.offset + c.dims) {
    throw new RangeError(`vector of length ${vector.length} is too short for channel "${name}"`);
  }
  return vector.slice(c.offset, c.offset + c.dims);
}

export function splitChannels(vector, spec) {
  const s = normalizeFieldSpec(spec);
  const out = {};
  for (const c of s.channels) out[c.name] = vector.slice(c.offset, c.offset + c.dims);
  return out;
}

// ── Metrics ──────────────────────────────────────────────────────
//
// One cosine distance, used everywhere. emergence/trajectory computes
// the same quantity over relation-signature Maps; this is the array
// form, and trajectory/field-shift.js proves the two agree.
export function cosineDistance(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 1e-12 ? 1 - dot / denom : 0;
}

// Angular distance θ/π ∈ [0,1]: the metric form of the cosine
// comparison. Same ordering as cosineDistance, but it obeys the
// triangle inequality, so ratios built from it stay bounded.
export function angularDistance(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!(denom > 1e-12)) return 0;
  const cos = Math.max(-1, Math.min(1, dot / denom));
  return Math.acos(cos) / Math.PI;
}

export function euclideanDistance(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

// Standardised euclidean needs per-dimension scale. Callers that have a
// corpus pass `scale`; without it this degrades to plain euclidean and
// says so rather than pretending to standardise.
export function standardisedEuclideanDistance(a, b, scale = null) {
  if (!scale) return euclideanDistance(a, b);
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const s = scale[i] > 1e-12 ? scale[i] : 1;
    sum += ((a[i] - b[i]) / s) ** 2;
  }
  return Math.sqrt(sum);
}

export function channelDistance(a, b, spec, name, { scale = null } = {}) {
  const c = getChannel(spec, name);
  const ca = sliceChannel(a, spec, name);
  const cb = sliceChannel(b, spec, name);
  switch (c.metric) {
    case 'cosine': return cosineDistance(ca, cb);
    case 'angular': return angularDistance(ca, cb);
    case 'euclidean-standardised': return standardisedEuclideanDistance(ca, cb, scale?.[name] ?? null);
    default: return euclideanDistance(ca, cb);
  }
}

// Distance between two field vectors: the mean of the per-channel
// distances under each channel's own declared metric. Channels are
// weighted equally by default, so a 300-dim motion channel does not
// drown a 2-dim centroid channel purely by being wider — the failure
// mode of concatenating everything and taking one euclidean norm.
export function fieldDistance(a, b, spec, { weights = null, scale = null } = {}) {
  const s = normalizeFieldSpec(spec);
  let sum = 0;
  let wsum = 0;
  const per = {};
  for (const c of s.channels) {
    const d = channelDistance(a, b, s, c.name, { scale });
    const w = weights?.[c.name] ?? 1;
    per[c.name] = d;
    sum += d * w;
    wsum += w;
  }
  return { distance: wsum > 0 ? sum / wsum : 0, channels: per };
}

// ── Canonical specs ──────────────────────────────────────────────
//
// The EOT operator log's field spec — the one text was missing. An EOT
// log is a sequence of moments, each with a score, an order, the
// figures active in it, and the operators asserted over it. That is a
// field vector in exactly the sense audio and video mean it, so the
// same physics runs over it.
//
// Figure and operator widths depend on the log, so this is a factory
// rather than a frozen literal.
export const EOT_OPERATORS = Object.freeze(['NUL', 'SIG', 'INS', 'SEG', 'CON', 'SYN', 'DEF', 'EVA', 'REC']);

export function eotFieldSpec({ figures, operators = EOT_OPERATORS }) {
  if (!Array.isArray(figures) || figures.length === 0) {
    throw new TypeError('eotFieldSpec: the log must name at least one figure');
  }
  return Object.freeze({
    ...defineFieldSpec({
      id: 'eot-operator-log',
      channels: [
        // Which figures are active in this moment — the text analogue
        // of video's motion-per-block and audio's chroma-per-pitch.
        { name: 'figures', dims: figures.length, metric: 'cosine' },
        // Moment score and normalised order along the narrative axis.
        { name: 'moments', dims: 2, metric: 'euclidean-standardised' },
        // Operator frequencies over the 3x3 vocabulary.
        { name: 'operators', dims: operators.length, metric: 'cosine' },
      ],
    }),
    figures: Object.freeze([...figures]),
    operators: Object.freeze([...operators]),
  });
}

// Build EOT field vectors from parsed moments.
//   moments: [{ score, order, figures: [name], operators: [code] }]
export function eotFieldVectors(moments, spec) {
  const figureIndex = new Map(spec.figures.map((f, i) => [f, i]));
  const opIndex = new Map(spec.operators.map((o, i) => [o, i]));
  const scores = moments.map((m) => m.score).filter(Number.isFinite);
  const maxScore = scores.length ? Math.max(...scores) : 1;
  const maxOrder = Math.max(1, ...moments.map((m) => m.order ?? 0));

  return moments.map((m, idx) => {
    const vec = new Float64Array(spec.dims);
    const figs = getChannelWindow(spec, 'figures');
    for (const f of m.figures ?? []) {
      const i = figureIndex.get(f);
      if (i !== undefined) vec[figs.offset + i] = 1;
    }
    const mom = getChannelWindow(spec, 'moments');
    vec[mom.offset] = maxScore > 0 ? (m.score ?? 0) / maxScore : 0;
    vec[mom.offset + 1] = (m.order ?? idx) / maxOrder;
    const ops = getChannelWindow(spec, 'operators');
    for (const o of m.operators ?? []) {
      const i = opIndex.get(o);
      if (i !== undefined) vec[ops.offset + i] += 1;
    }
    return vec;
  });
}

function getChannelWindow(spec, name) {
  return getChannel(spec, name);
}
