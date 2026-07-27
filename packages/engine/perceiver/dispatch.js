// Binary dispatch: the generalized entry point for any input. Sniffs format
// and routes to the appropriate perceiver. Never fails — anything unrecognised
// falls through to the generic binary perceiver. Ported from eoreader4.2's
// organs/in/reading-dispatch.js.
//
// The engine itself only decodes formats it can read without a codec
// dependency (WAV PCM, UTF-8 text). Compressed audio (MP3, FLAC, OGG) needs
// a decode step upstream (browser AudioContext, ffmpeg, etc.) that produces
// PCM — the engine is codec-agnostic, not codec-omniscient.

import { sniffWav, decodeWav } from './audio/wav.js';
import { buildAudioReading } from './audio/reading.js';

// A high printable-ASCII ratio indicates UTF-8/text content.
const printableRatio = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length === 0) return 0;
  let printable = 0;
  const n = Math.min(u8.length, 8192); // sample, don't scan huge buffers
  for (let i = 0; i < n; i++) {
    const b = u8[i];
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  }
  return printable / n;
};

// buildBinaryReading: the generic fallback perceiver for unrecognised bytes.
// No structure-finding — just a byte-class field vector per chunk, so
// emergence still has something to work with even for opaque formats.
export const buildBinaryReading = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunkSize = 256;
  const units = [];
  for (let start = 0; start + chunkSize <= u8.length || (start === 0 && u8.length > 0); start += chunkSize) {
    const end = Math.min(start + chunkSize, u8.length);
    const chunk = u8.subarray(start, end);
    // Byte-class histogram: control / printable / extended, normalised.
    let control = 0, printable = 0, extended = 0;
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      if (b < 0x20 || b === 0x7f) control++;
      else if (b <= 0x7e) printable++;
      else extended++;
    }
    const total = chunk.length || 1;
    units.push({
      pos: start,
      span: chunk.length,
      field: [control / total, printable / total, extended / total],
    });
    if (end >= u8.length) break;
  }
  return {
    schema: 'Reading@1',
    medium: 'binary',
    axis: { kind: 'position', unit: 'byte', extent: u8.length },
    units,
    field_spec: { channels: [{ name: 'byteClass', dims: 3, metric: 'euclidean' }] },
    segments_proposed: [],
    sightings: [],
    discard: [{ kind: 'unknown-format', reason: 'no format-specific decoder matched; generic byte-class fallback', recoverable: false }],
    perceiver: { id: 'generic-binary', version: '0.1.0' },
    content_hash: null,
  };
};

// buildTextReading: minimal text perceiver stub. Full text perception lives
// in the engine's emergence layer (parameters, entity-kinds, etc.) — this
// just gets text bytes into a Reading-shaped envelope for uniform dispatch.
export const buildTextReading = (bytes) => {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return {
    schema: 'Reading@1',
    medium: 'text',
    axis: { kind: 'position', unit: 'char', extent: text.length },
    text,
    units: [],
    field_spec: null,
    segments_proposed: [],
    sightings: [],
    discard: [],
    perceiver: { id: 'text-passthrough', version: '0.1.0' },
    content_hash: null,
  };
};

/**
 * buildReadingFromBytes(bytes, opts) — sniff format, route, return Reading@1.
 * Result never fails; always returns a Reading typed by `medium`.
 *
 * opts.sampleRate — required if bytes are raw PCM already (skips WAV sniff).
 * opts.channelData — if you already have decoded PCM, skip decoding entirely.
 */
export async function buildReadingFromBytes(bytes, opts = {}) {
  if (opts.channelData && opts.sampleRate) {
    return buildAudioReading({ channelData: opts.channelData, sampleRate: opts.sampleRate, sourceBytes: bytes });
  }

  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (sniffWav(u8)) {
    const { sampleRate, channelData } = decodeWav(u8);
    return buildAudioReading({ channelData, sampleRate, sourceBytes: u8 });
  }

  if (printableRatio(u8) >= 0.85) {
    return buildTextReading(u8);
  }

  return buildBinaryReading(u8);
}
