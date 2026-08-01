// Structured-data perceiver: tabular bytes in, field vectors out.
//
// Parses CSV, TSV, JSON arrays, and XML S3 bucket listings. Extracts
// typed columns (numeric, categorical, temporal) and frames them into
// windowed units with field vectors. Structure-neutral — the engine
// finds states, transitions, and entities.
//
// The perceiver answers: what are the rows, what is each row's field
// vector? Nothing more. State detection, event extraction, entity
// individuation — all engine territory.

import { defineFieldSpec } from "../field-spec.js";

// ── Field spec: what each row vector means ────────────────────────

export const STRUCTURED_FIELD_SPEC = defineFieldSpec({
  id: "structured@1",
  channels: [
    { name: "value", dims: 2, metric: "euclidean-standardised" },
    { name: "change", dims: 1, metric: "euclidean" },
    { name: "anomaly", dims: 1, metric: "euclidean" },
    { name: "temporal", dims: 2, metric: "cosine" },
  ],
});

// ── Parsers ───────────────────────────────────────────────────────

function parseXmlS3Listing(text) {
  // Extract Contents entries from S3 XML
  const entries = [];
  const keyRe = /<Key>([^<]+)<\/Key>/g;
  const sizeRe = /<Size>(\d+)<\/Size>/g;
  const dateRe = /<LastModified>([^<]+)<\/LastModified>/g;

  const keys = [...text.matchAll(keyRe)].map((m) => m[1]);
  const sizes = [...text.matchAll(sizeRe)].map((m) => parseInt(m[1]));
  const dates = [...text.matchAll(dateRe)].map((m) => m[1]);

  const n = Math.min(keys.length, sizes.length, dates.length);
  for (let i = 0; i < n; i++) {
    const key = keys[i];
    const parts = key.split(/[/_]/);
    entries.push({
      key,
      size: sizes[i],
      lastModified: dates[i],
      prefix: parts[0] ?? "",
      category: parts[1] ?? "",
      segments: parts.slice(2),
    });
  }
  return entries;
}

function parseCsv(text, delimiter = ",") {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
    if (vals.length < headers.length) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = vals[j];
    }
    rows.push(row);
  }
  return rows;
}

function parseJsonArray(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

// ── Column type detection ─────────────────────────────────────────

function detectColumnTypes(rows) {
  if (!rows.length) return { numeric: [], categorical: [], temporal: [] };

  const keys = Object.keys(rows[0]);
  const types = { numeric: [], categorical: [], temporal: [] };

  for (const key of keys) {
    const samples = rows.slice(0, Math.min(100, rows.length)).map((r) => r[key]);
    const defined = samples.filter((s) => s != null && s !== "");

    // Temporal: ISO dates
    const dateCount = defined.filter((s) => {
      const d = new Date(String(s));
      return !isNaN(d.getTime()) && String(s).match(/^\d{4}-\d{2}-\d{2}/);
    }).length;
    if (dateCount > defined.length * 0.7) {
      types.temporal.push(key);
      continue;
    }

    // Numeric: parse as finite number
    const numCount = defined.filter((s) => {
      const n = Number(s);
      return isFinite(n) && String(s).trim() !== "";
    }).length;
    if (numCount > defined.length * 0.7) {
      types.numeric.push(key);
      continue;
    }

    // Categorical: anything else, but skip identifier columns (near-unique per row)
    // Use all rows for cardinality since samples may undercount
    const allValues = rows.map((r) => String(r[key] ?? ""));
    const uniqueCount = new Set(allValues).size;
    if (uniqueCount < rows.length * 0.3 && uniqueCount <= 200) {
      types.categorical.push(key);
    }
  }

  return types;
}

// ── Signal extraction ─────────────────────────────────────────────

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs) {
  if (xs.length < 2) return 1;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
}

function zScore(x, m, s) {
  return s === 0 ? 0 : (x - m) / s;
}

// ── Timestamp extraction from various formats ─────────────────────

function extractTimestamp(row, temporalCols) {
  // Prefer key-embedded timestamps (actual event time) over metadata columns
  // (which may be upload/modification time).
  if (row.key) {
    const m = String(row.key).match(/(\d{4})[_-](\d{2})[_-](\d{2})[_-](\d{2})[_-](\d{2})[_-](\d{2})/);
    if (m) {
      return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
  }
  // Try segments array (from key parsing)
  if (Array.isArray(row.segments) && row.segments.length >= 6) {
    const [y, mo, d, h, mi, s] = row.segments.map(Number);
    if ([y, mo, d, h, mi, s].every((n) => isFinite(n))) {
      return new Date(y, mo - 1, d, h, mi, s);
    }
  }
  // Fall back to temporal columns (ISO dates, etc.)
  for (const col of temporalCols) {
    const val = row[col];
    if (val != null) {
      const d = new Date(String(val));
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// ── The perceiver ─────────────────────────────────────────────────

/**
 * buildStructuredReading(bytes, opts)
 *
 * Parses structured data from bytes, extracts typed columns, and produces
 * a Reading@1 with field vectors per row.
 *
 * @param {Uint8Array} bytes
 * @param {object} [opts]
 * @param {string} [opts.primaryNumeric] — column name for the primary value
 * @param {string} [opts.format] — 'auto', 'csv', 'tsv', 'json', 's3-xml'
 * @returns {object} Reading@1
 */
export function buildStructuredReading(bytes, opts = {}) {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const trimmed = text.trim();

  // Detect format
  let format = opts.format ?? "auto";
  if (format === "auto") {
    if (trimmed.startsWith("<?xml") || trimmed.includes("<ListBucketResult")) {
      format = "s3-xml";
    } else if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      format = "json";
    } else {
      format = "csv";
    }
  }

  // Parse
  let rows;
  if (format === "s3-xml") {
    rows = parseXmlS3Listing(text);
  } else if (format === "json") {
    rows = parseJsonArray(text);
  } else if (format === "tsv") {
    rows = parseCsv(text, "\t");
  } else {
    rows = parseCsv(text, ",");
  }

  if (!rows.length) {
    return {
      schema: "Reading@1",
      medium: "structured",
      axis: { kind: "index", unit: "row", extent: 0 },
      units: [],
      field_spec: STRUCTURED_FIELD_SPEC,
      segments_proposed: [],
      sightings: [],
      discard: [{ kind: "empty-input", reason: "no rows parsed", recoverable: false }],
      perceiver: { id: "structured-field-vectors", version: "0.1.0" },
      content_hash: null,
      column_types: { numeric: [], categorical: [], temporal: [] },
      categories: {},
    };
  }

  const colTypes = detectColumnTypes(rows);

  // Determine primary numeric column
  const primaryNumeric = opts.primaryNumeric ?? colTypes.numeric[0];

  // Extract values and timestamps
  const values = [];
  const timestamps = [];
  const categoricalValues = {};

  for (const row of rows) {
    const v = primaryNumeric ? Number(row[primaryNumeric]) : null;
    values.push(isFinite(v) ? v : null);
    timestamps.push(extractTimestamp(row, colTypes.temporal));

    for (const cat of colTypes.categorical) {
      if (!categoricalValues[cat]) categoricalValues[cat] = new Set();
      if (row[cat] != null) categoricalValues[cat].add(String(row[cat]));
    }
  }

  const categories = {};
  for (const [cat, set] of Object.entries(categoricalValues)) {
    categories[cat] = [...set];
  }

  // Compute statistics for normalization
  const cleanValues = values.filter((v) => v !== null);
  const m = mean(cleanValues);
  const s = std(cleanValues);

  // If we have timestamps, sort by time and use time axis
  let sorted = null;
  if (timestamps.some((t) => t != null)) {
    const indexed = rows.map((row, i) => ({ row, value: values[i], ts: timestamps[i], idx: i }));
    indexed.sort((a, b) => {
      if (a.ts && b.ts) return a.ts - b.ts;
      if (a.ts) return -1;
      if (b.ts) return 1;
      return a.idx - b.idx;
    });
    sorted = indexed;
  }

  // Build units (field vectors per row)
  const entries = sorted ?? rows.map((row, i) => ({ row, value: values[i], ts: timestamps[i], idx: i }));
  const units = [];
  let prevValue = null;

  for (let i = 0; i < entries.length; i++) {
    const { value, ts, idx } = entries[i];
    const vNorm = value !== null ? zScore(value, m, s) : 0;
    const absNorm = value !== null ? value / (m || 1) : 0;

    const change = value !== null && prevValue !== null
      ? (value - prevValue) / (s || 1)
      : 0;

    const anomaly = value !== null ? Math.abs(zScore(value, m, s)) : 0;

    // Temporal: hour-of-day as circular encoding
    const hour = ts ? ts.getUTCHours() : 0;
    const hourSin = Math.sin((2 * Math.PI * hour) / 24);
    const hourCos = Math.cos((2 * Math.PI * hour) / 24);

    const field = [
      vNorm, absNorm,          // value channel (2 dims)
      change,                   // change channel (1 dim)
      anomaly,                  // anomaly channel (1 dim)
      hourSin, hourCos,        // temporal channel (2 dims)
    ];

    const pos = ts ? ts.getTime() / 1000 : idx;

    units.push({
      pos,
      span: 1,
      field,
      idx,
      rawValue: value,
      rawTimestamp: ts ? ts.toISOString() : null,
      categorical: colTypes.categorical.reduce((acc, cat) => {
        acc[cat] = entries[i].row[cat];
        return acc;
      }, {}),
    });

    prevValue = value;
  }

  const axisExtent = units.length > 0 ? units[units.length - 1].pos - units[0].pos : 0;

  return {
    schema: "Reading@1",
    medium: "structured",
    axis: { kind: "position", unit: "row", extent: axisExtent || units.length },
    units,
    field_spec: STRUCTURED_FIELD_SPEC,
    segments_proposed: [],
    sightings: [],
    discard: [],
    perceiver: { id: "structured-field-vectors", version: "0.1.0", params: { format, primaryNumeric } },
    content_hash: null,
    column_types: colTypes,
    categories,
    stats: { mean: m, std: s, count: cleanValues.length },
  };
}
