// EO: SEG·INS(Void -> Entity,Network, Dissecting,Making) -- holonic Site addressing.
// Ported from eoreader4.2 src/core/holon.js. WHICH place an operation lands on:
// a holonic path descending containment level by level, plus its stable
// FNV-1a hashId.

const SEP = '.';

const fnv1a = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const canon = (path) => String(path ?? '')
  .split(SEP).map(s => s.trim()).filter(Boolean).join(SEP);

export const holonId = (path) => fnv1a(canon(path));

export const parseHolon = (path) => {
  const c = canon(path);
  const segments = c ? c.split(SEP) : [];
  return Object.freeze({
    path: c,
    segments: Object.freeze(segments),
    depth: segments.length,
    leaf: segments[segments.length - 1] ?? null,
    parent: segments.length > 1 ? segments.slice(0, -1).join(SEP) : null,
    id: holonId(c),
  });
};

export const holonLevels = (path) => {
  const segments = canon(path).split(SEP).filter(Boolean);
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    const prefix = segments.slice(0, i + 1).join(SEP);
    out.push(Object.freeze({ segment: segments[i], path: prefix, depth: i + 1, id: holonId(prefix) }));
  }
  return Object.freeze(out);
};

export const depthOf = (path) => canon(path).split(SEP).filter(Boolean).length;
export const parentOf = (path) => parseHolon(path).parent;
export const leafOf = (path) => parseHolon(path).leaf;
export const joinHolon = (path, child) => canon([canon(path), canon(child)].filter(Boolean).join(SEP));

export const containsHolon = (ancestor, descendant) => {
  const a = canon(ancestor), d = canon(descendant);
  if (!a) return true;
  return d === a || d.startsWith(a + SEP);
};
