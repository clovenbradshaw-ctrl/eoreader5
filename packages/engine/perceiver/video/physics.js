// Physics analogs from optical flow vector fields.
// Every quantity computed from the flow already in flow.js:14.
// No new data — just new math on the same vectors.
//
// ── Conventions this module depends on ───────────────────────────
//
//  * (fdx, fdy) is a MOTION field: where the content went, in block
//    units per frame, +x right and +y down (image coordinates).
//    blockFlow() normalises to this convention; see flow.js.
//  * Finite differences are central, so they are only defined on the
//    INTERIOR of the grid — the one-block border has no left/right or
//    up/down neighbour. Border cells are never written and never
//    counted in any mean or energy. This is not cosmetic: block
//    matching truncates its search window at the frame edge, so
//    border vectors carry a systematic inward bias (flow.js marks
//    them in `vectors.valid`). Averaging them in manufactures
//    divergence that is an artefact of the search window, not motion.
//  * Every reduction is NaN-safe and reports how many samples it
//    actually used. The previous version divided by the full grid
//    and ended each reduction with `|| 0`, which silently turned a
//    NaN mean into a plausible-looking 0.0 — the worst failure mode
//    available, since it is indistinguishable from "no motion".

// ── Grid inference ────────────────────────────────────────────────
// Callers used to be trusted to pass matching (cols, rows); when they
// did not — a differently sized frame, a cropped grid — the finite
// differences read past the end of the typed array, got `undefined`,
// and produced NaN. Dimensions are now validated against the data.
function resolveGrid(fields, cols, rows) {
  const len = fields[0].length;
  for (const f of fields) {
    if (f.length !== len) {
      throw new RangeError(`flow component length mismatch: ${f.length} vs ${len}`);
    }
  }
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new RangeError(`invalid grid ${cols}x${rows}`);
  }
  if (cols * rows !== len) {
    throw new RangeError(`grid ${cols}x${rows} = ${cols * rows} does not match field length ${len}`);
  }
  return { cols, rows };
}

// A cell is usable if it is finite and (when a mask is supplied) marked
// valid. `mask` is any array-like where a falsy entry means "do not
// trust this block" — flow.js emits exactly that as `vectors.valid`.
function usable(v, mask, i) {
  return Number.isFinite(v) && (!mask || mask[i]);
}

// Mean over the interior only, skipping non-finite and masked cells.
// Returns the sample count so a caller can tell "0.0 from 234 blocks"
// apart from "0.0 because everything was dropped".
function interiorMean(field, cols, rows, mask, border = 1) {
  let sum = 0;
  let n = 0;
  let dropped = 0;
  for (let y = border; y < rows - border; y++) {
    for (let x = border; x < cols - border; x++) {
      const i = y * cols + x;
      const v = field[i];
      if (usable(v, mask, i)) { sum += v; n++; } else { dropped++; }
    }
  }
  return { mean: n > 0 ? sum / n : 0, samples: n, dropped };
}

// Σ(v²) over the interior — the "energy" of a derived field.
function interiorEnergy(field, cols, rows, mask, border = 1) {
  let sum = 0;
  let n = 0;
  for (let y = border; y < rows - border; y++) {
    for (let x = border; x < cols - border; x++) {
      const i = y * cols + x;
      const v = field[i];
      if (usable(v, mask, i)) { sum += v * v; n++; }
    }
  }
  return { energy: sum, samples: n };
}

// Min/max over the interior. Empty interior yields nulls rather than
// ±Infinity, so a caller cannot mistake "no data" for "extreme value".
function interiorExtrema(field, cols, rows, mask, border = 1) {
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (let y = border; y < rows - border; y++) {
    for (let x = border; x < cols - border; x++) {
      const i = y * cols + x;
      const v = field[i];
      if (!usable(v, mask, i)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      n++;
    }
  }
  return n > 0 ? { min, max } : { min: null, max: null };
}

// A derived field is only defined where its whole finite-difference
// stencil is usable. This propagates the mask outward by one ring so
// downstream reductions never average a half-computed cell.
function stencilOk(mask, cols, i, needsTwoRing = false) {
  if (!mask) return true;
  const r = needsTwoRing ? 2 : 1;
  return Boolean(mask[i] && mask[i - r] && mask[i + r] && mask[i - r * cols] && mask[i + r * cols]);
}

// ── Curl ∇×F = ∂Fy/∂x − ∂Fx/∂y ──────────────────────────────
// Measures rotation in the motion field. A person walking has
// rotating limbs; a crowd milling has local curl; flowing water
// has none. Positive = clockwise on screen (+x right, +y down),
// which is counterclockwise in ordinary maths axes.
export function curlField(fdx, fdy, cols, rows, { mask = null } = {}) {
  resolveGrid([fdx, fdy], cols, rows);
  const curl = new Float64Array(cols * rows).fill(NaN);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      if (!stencilOk(mask, cols, i)) continue;
      // ∂Fy/∂x ≈ (Fy[x+1] - Fy[x-1]) / 2
      const dFy_dx = (fdy[i + 1] - fdy[i - 1]) / 2;
      // ∂Fx/∂y ≈ (Fx[y+1] - Fx[y-1]) / 2
      const dFx_dy = (fdx[i + cols] - fdx[i - cols]) / 2;
      curl[i] = dFy_dx - dFx_dy;
    }
  }
  const { mean, samples, dropped } = interiorMean(curl, cols, rows, mask);
  return { field: curl, mean, samples, dropped, cols, rows };
}

// ── Divergence ∇·F = ∂Fx/∂x + ∂Fy/∂y ─────────────────────────
// Measures expansion (+) or contraction (-). Crowd scattering =
// positive divergence. Crowd converging = negative divergence.
export function divergenceField(fdx, fdy, cols, rows, { mask = null } = {}) {
  resolveGrid([fdx, fdy], cols, rows);
  const div = new Float64Array(cols * rows).fill(NaN);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      if (!stencilOk(mask, cols, i)) continue;
      const dFx_dx = (fdx[i + 1] - fdx[i - 1]) / 2;
      const dFy_dy = (fdy[i + cols] - fdy[i - cols]) / 2;
      div[i] = dFx_dx + dFy_dy;
    }
  }
  const { mean, samples, dropped } = interiorMean(div, cols, rows, mask);
  return { field: div, mean, samples, dropped, cols, rows };
}

// ── Current density J = ρv ────────────────────────────────────
// ρ = motion magnitude (density of moving stuff), v = direction.
// High J = lots of stuff moving fast in one direction.
//
// This is defined on every cell (no stencil), so it uses the whole
// grid minus masked/non-finite blocks. `total` is the Σ|J| the old
// version returned; `net` is the vector sum, which is what actually
// distinguishes a coherent surge from milling that cancels out.
export function currentDensity(fdx, fdy, magnitude, cols, rows, { mask = null } = {}) {
  resolveGrid([fdx, fdy, magnitude], cols, rows);
  const n = cols * rows;
  const Jx = new Float64Array(n).fill(NaN);
  const Jy = new Float64Array(n).fill(NaN);
  let total = 0;
  let netX = 0;
  let netY = 0;
  let samples = 0;
  for (let i = 0; i < n; i++) {
    if (!usable(fdx[i], mask, i) || !Number.isFinite(fdy[i]) || !Number.isFinite(magnitude[i])) continue;
    const jx = magnitude[i] * fdx[i];
    const jy = magnitude[i] * fdy[i];
    Jx[i] = jx;
    Jy[i] = jy;
    total += Math.abs(jx) + Math.abs(jy);
    netX += jx;
    netY += jy;
    samples++;
  }
  return {
    Jx,
    Jy,
    total,
    net: Math.hypot(netX, netY),
    netX,
    netY,
    // Coherence in [0,1]: 1 = every block pushes the same way,
    // 0 = the field cancels itself out completely.
    coherence: total > 0 ? Math.hypot(netX, netY) / total : 0,
    samples,
    cols,
    rows,
  };
}

// ── Potential energy U = -∫F·dr (line integral of flow) ───────
// Accumulated work along a trajectory. High = forced motion.
export function potentialEnergy(trajectory) {
  if (!trajectory || trajectory.length < 2) return 0;
  let work = 0;
  for (let i = 1; i < trajectory.length; i++) {
    const dx = trajectory[i].cx - trajectory[i - 1].cx;
    const dy = trajectory[i].cy - trajectory[i - 1].cy;
    const fx = trajectory[i].dx || 0;
    const fy = trajectory[i].dy || 0;
    const step = fx * dx + fy * dy;
    if (Number.isFinite(step)) work += step;
  }
  return work;
}

// ── Vorticity: integral of curl over area ─────────────────────
// Total rotation in a region. High = eddy / rotational flow.
// `cols` used to be hardcoded to 20, which silently indexed the
// wrong cells for any other grid; it is now required alongside the
// field (curlField's return object carries it).
export function vorticity(curl, regionBlocks, cols) {
  const field = ArrayBuffer.isView(curl) || Array.isArray(curl) ? curl : curl?.field;
  const width = cols ?? (ArrayBuffer.isView(curl) || Array.isArray(curl) ? undefined : curl?.cols);
  if (!field) throw new TypeError('vorticity: pass a curl field or a curlField() result');
  if (!Number.isInteger(width)) throw new TypeError('vorticity: `cols` is required (grid width)');
  let total = 0;
  let samples = 0;
  for (const b of regionBlocks) {
    const v = field[b.y * width + b.x];
    if (Number.isFinite(v)) { total += v; samples++; }
  }
  return { total, samples };
}

// ── Dipole moment: two opposite-motion blobs ──────────────────
// Finds pairs of blobs moving in opposite directions (e.g.,
// two people walking toward each other, or arms swinging).
// The threshold is on the COSINE between the two motion vectors, so
// it does not silently become magnitude-dependent: the old raw dot
// product meant two slow blobs never registered and two fast ones
// always did.
export function findDipoles(blobs, { cosineThreshold = -0.5 } = {}) {
  const dipoles = [];
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i];
      const b = blobs[j];
      const dot = a.dx * b.dx + a.dy * b.dy;
      const norm = Math.hypot(a.dx, a.dy) * Math.hypot(b.dx, b.dy);
      if (!(norm > 0)) continue;
      const cos = dot / norm;
      if (cos < cosineThreshold) {
        const sep = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        dipoles.push({ a: i, b: j, separation: sep, cos, dot });
      }
    }
  }
  return dipoles.sort((p, q) => q.separation - p.separation);
}

// ── Laplacian ∇²F = ∂²F/∂x² + ∂²F/∂y² ───────────────────────
// Second derivative of flow. High = abrupt change (boundaries,
// edges of moving objects, shot transitions).
//
// For a VECTOR field the Laplacian is per component, and each
// component needs both second derivatives. The previous version
// computed ∂²Fx/∂x² + ∂²Fy/∂y² — a mix of two different components'
// partials that is not the Laplacian of anything. It happened to
// vanish for uniform and linear flow, which is why it looked right.
// `field` is now the magnitude |∇²F|; `x`/`y` carry the components.
export function laplacianField(fdx, fdy, cols, rows, { mask = null } = {}) {
  resolveGrid([fdx, fdy], cols, rows);
  const n = cols * rows;
  const lapX = new Float64Array(n).fill(NaN);
  const lapY = new Float64Array(n).fill(NaN);
  const mag = new Float64Array(n).fill(NaN);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      if (!stencilOk(mask, cols, i)) continue;
      const lx = fdx[i + 1] - 2 * fdx[i] + fdx[i - 1] + fdx[i + cols] - 2 * fdx[i] + fdx[i - cols];
      const ly = fdy[i + 1] - 2 * fdy[i] + fdy[i - 1] + fdy[i + cols] - 2 * fdy[i] + fdy[i - cols];
      lapX[i] = lx;
      lapY[i] = ly;
      mag[i] = Math.hypot(lx, ly);
    }
  }
  const { mean, samples, dropped } = interiorMean(mag, cols, rows, mask);
  return { field: mag, x: lapX, y: lapY, mean, samples, dropped, cols, rows };
}

// ── Gradient magnitude |∇F| ───────────────────────────────────
// First derivative magnitude. High = motion boundaries.
//
// The full Jacobian norm: √(Fx,x² + Fx,y² + Fy,x² + Fy,y²). The old
// version used only ∂Fx/∂x and ∂Fy/∂y — i.e. the two terms that make
// up the divergence — so it reported zero gradient for pure shear,
// which is exactly the motion boundary it is meant to find.
export function gradientMagnitude(fdx, fdy, cols, rows, { mask = null } = {}) {
  resolveGrid([fdx, fdy], cols, rows);
  const grad = new Float64Array(cols * rows).fill(NaN);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      if (!stencilOk(mask, cols, i)) continue;
      const dxx = (fdx[i + 1] - fdx[i - 1]) / 2;
      const dxy = (fdx[i + cols] - fdx[i - cols]) / 2;
      const dyx = (fdy[i + 1] - fdy[i - 1]) / 2;
      const dyy = (fdy[i + cols] - fdy[i - cols]) / 2;
      grad[i] = Math.sqrt(dxx * dxx + dxy * dxy + dyx * dyx + dyy * dyy);
    }
  }
  const { mean, samples, dropped } = interiorMean(grad, cols, rows, mask);
  return { field: grad, mean, samples, dropped, cols, rows };
}

// ── Full physics summary for one frame ────────────────────────
// Grid dimensions come from the flow result (blockFlow reports them)
// or from the caller — never from a hardcoded 20×15. `mask` defaults
// to the flow's own `valid` mask, so border blocks whose search window
// was truncated are excluded from every statistic.
export function analyzeFlowPhysics(flowResult, { cols, rows, mask } = {}) {
  const v = flowResult?.vectors;
  if (!v) throw new TypeError('analyzeFlowPhysics: expected a blockFlow() result');
  const { dx, dy } = v;
  const c = cols ?? flowResult.cols ?? v.cols;
  const r = rows ?? flowResult.rows ?? v.rows;
  resolveGrid([dx, dy], c, r);
  const m = mask === undefined ? v.valid ?? null : mask;

  const n = c * r;
  const magnitude = new Float64Array(n);
  for (let i = 0; i < n; i++) magnitude[i] = Math.hypot(dx[i], dy[i]);

  const curl = curlField(dx, dy, c, r, { mask: m });
  const div = divergenceField(dx, dy, c, r, { mask: m });
  const current = currentDensity(dx, dy, magnitude, c, r, { mask: m });
  const lap = laplacianField(dx, dy, c, r, { mask: m });
  const grad = gradientMagnitude(dx, dy, c, r, { mask: m });

  const curlX = interiorExtrema(curl.field, c, r, m);
  const divX = interiorExtrema(div.field, c, r, m);
  const curlE = interiorEnergy(curl.field, c, r, m);
  const divE = interiorEnergy(div.field, c, r, m);

  return {
    curl: curl.mean,
    divergence: div.mean,
    currentDensity: current.total,
    currentCoherence: current.coherence,
    netCurrent: current.net,
    laplacian: lap.mean,
    gradient: grad.mean,
    maxCurl: curlX.max,
    minCurl: curlX.min,
    maxDiv: divX.max,
    minDiv: divX.min,
    // Activity metrics derived from physics
    rotationalEnergy: curlE.energy,   // Σ(curl²) over the interior
    expansiveEnergy: divE.energy,     // Σ(div²) over the interior
    totalAction: current.total,
    // Provenance: how many blocks each statistic actually saw. A mean
    // of 0 with samples: 0 means "nothing measurable", not "no motion".
    grid: { cols: c, rows: r },
    samples: {
      interior: curl.samples,
      dropped: curl.dropped,
      current: current.samples,
    },
  };
}

// ── Scalar time series from a sequence of frames ──────────────
// The bridge into the modality-blind layer: physics per frame becomes
// one scalar series per observable, which emergence/chapters can run
// DEF over exactly as it would over audio chroma flux or text moment
// scores. Non-finite frames are carried as null rather than dropped,
// so indices stay aligned with the frame axis.
export const PHYSICS_OBSERVABLES = Object.freeze([
  'curl',
  'divergence',
  'currentDensity',
  'currentCoherence',
  'laplacian',
  'gradient',
  'rotationalEnergy',
  'expansiveEnergy',
]);

export function physicsSeries(summaries, { observables = PHYSICS_OBSERVABLES } = {}) {
  const series = {};
  for (const key of observables) {
    series[key] = summaries.map((s) => {
      const v = s?.[key];
      return Number.isFinite(v) ? v : null;
    });
  }
  return series;
}
