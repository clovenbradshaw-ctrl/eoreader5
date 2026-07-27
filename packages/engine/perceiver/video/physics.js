// Physics analogs from optical flow vector fields.
// Every quantity computed from the flow already in flow.js:14.
// No new data — just new math on the same vectors.

// ── Curl ∇×F = ∂Fy/∂x − ∂Fx/∂y ──────────────────────────────
// Measures rotation in the motion field. A person walking has
// rotating limbs; a crowd milling has local curl; flowing water
// has none. Positive = counterclockwise, negative = clockwise.
export function curlField(fdx, fdy, cols, rows) {
  const curl = new Float64Array(cols * rows);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      // ∂Fy/∂x ≈ (Fy[x+1] - Fy[x-1]) / 2
      const dFy_dx = (fdy[y * cols + (x + 1)] - fdy[y * cols + (x - 1)]) / 2;
      // ∂Fx/∂y ≈ (Fx[y+1] - Fx[y-1]) / 2
      const dFx_dy = (fdx[(y + 1) * cols + x] - fdx[(y - 1) * cols + x]) / 2;
      curl[i] = dFy_dx - dFx_dy;
    }
  }
  return { field: curl, mean: curl.reduce((a, v) => a + v, 0) / (cols * rows) || 0 };
}

// ── Divergence ∇·F = ∂Fx/∂x + ∂Fy/∂y ─────────────────────────
// Measures expansion (+) or contraction (-). Crowd scattering =
// positive divergence. Crowd converging = negative divergence.
export function divergenceField(fdx, fdy, cols, rows) {
  const div = new Float64Array(cols * rows);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      const dFx_dx = (fdx[y * cols + (x + 1)] - fdx[y * cols + (x - 1)]) / 2;
      const dFy_dy = (fdy[(y + 1) * cols + x] - fdy[(y - 1) * cols + x]) / 2;
      div[i] = dFx_dx + dFy_dy;
    }
  }
  return { field: div, mean: div.reduce((a, v) => a + v, 0) / (cols * rows) || 0 };
}

// ── Current density J = ρv ────────────────────────────────────
// ρ = motion magnitude (density of moving stuff), v = direction.
// High J = lots of stuff moving fast in one direction.
export function currentDensity(fdx, fdy, magnitude, cols, rows) {
  const Jx = new Float64Array(cols * rows);
  const Jy = new Float64Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    Jx[i] = magnitude[i] * fdx[i];
    Jy[i] = magnitude[i] * fdy[i];
  }
  const totalJ = Jx.reduce((a, v) => a + Math.abs(v), 0) + Jy.reduce((a, v) => a + Math.abs(v), 0);
  return { Jx, Jy, total: totalJ };
}

// ── Potential energy U = -∫F·dr (line integral of flow) ───────
// Accumulated work along a trajectory. High = forced motion.
export function potentialEnergy(trajectory) {
  if (trajectory.length < 2) return 0;
  let work = 0;
  for (let i = 1; i < trajectory.length; i++) {
    const dx = trajectory[i].cx - trajectory[i - 1].cx;
    const dy = trajectory[i].cy - trajectory[i - 1].cy;
    const fx = trajectory[i].dx || 0;
    const fy = trajectory[i].dy || 0;
    work += fx * dx + fy * dy;
  }
  return work;
}

// ── Vorticity: integral of curl over area ─────────────────────
// Total rotation in a region. High = eddy / rotational flow.
export function vorticity(curlField, regionBlocks) {
  let total = 0;
  for (const b of regionBlocks) total += curlField[b.y * 20 + b.x];
  return total;
}

// ── Dipole moment: two opposite-motion blobs ──────────────────
// Finds pairs of blobs moving in opposite directions (e.g., 
// two people walking toward each other, or arms swinging).
export function findDipoles(blobs) {
  const dipoles = [];
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const dot = blobs[i].dx * blobs[j].dx + blobs[i].dy * blobs[j].dy;
      // Opposite motion: dot product is negative
      if (dot < -0.5) {
        const sep = Math.sqrt(
          (blobs[i].cx - blobs[j].cx) ** 2 + (blobs[i].cy - blobs[j].cy) ** 2
        );
        dipoles.push({ a: i, b: j, separation: sep, dot });
      }
    }
  }
  return dipoles.sort((a, b) => b.separation - a.separation);
}

// ── Laplacian ∇²F = ∂²F/∂x² + ∂²F/∂y² ───────────────────────
// Second derivative of flow. High = abrupt change (boundaries,
// edges of moving objects, shot transitions).
export function laplacianField(fdx, fdy, cols, rows) {
  const lap = new Float64Array(cols * rows);
  for (let y = 2; y < rows - 2; y++) {
    for (let x = 2; x < cols - 2; x++) {
      const i = y * cols + x;
      const d2Fx = fdx[y * cols + (x + 1)] - 2 * fdx[i] + fdx[y * cols + (x - 1)];
      const d2Fy = fdy[(y + 1) * cols + x] - 2 * fdy[i] + fdy[(y - 1) * cols + x];
      lap[i] = d2Fx + d2Fy;
    }
  }
  return { field: lap, mean: lap.reduce((a, v) => a + v, 0) / (cols * rows) || 0 };
}

// ── Gradient magnitude |∇F| ───────────────────────────────────
// First derivative magnitude. High = motion boundaries.
export function gradientMagnitude(fdx, fdy, cols, rows) {
  const grad = new Float64Array(cols * rows);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      const dfx = (fdx[y * cols + (x + 1)] - fdx[y * cols + (x - 1)]) / 2;
      const dfy = (fdy[(y + 1) * cols + x] - fdy[(y - 1) * cols + x]) / 2;
      grad[i] = Math.sqrt(dfx * dfx + dfy * dfy);
    }
  }
  return { field: grad, mean: grad.reduce((a, v) => a + v, 0) / (cols * rows) || 0 };
}

// ── Full physics summary for one frame ────────────────────────
export function analyzeFlowPhysics(flowResult) {
  const { dx, dy, confidence } = flowResult.vectors;
  const cols = 20, rows = 15;

  // Magnitude per block
  const mag = new Float64Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) mag[i] = Math.sqrt(dx[i] ** 2 + dy[i] ** 2);

  const curl = curlField(dx, dy, cols, rows);
  const div = divergenceField(dx, dy, cols, rows);
  const current = currentDensity(dx, dy, mag, cols, rows);
  const lap = laplacianField(dx, dy, cols, rows);
  const grad = gradientMagnitude(dx, dy, cols, rows);

  return {
    curl: curl.mean,
    divergence: div.mean,
    currentDensity: current.total,
    laplacian: lap.mean,
    gradient: grad.mean,
    maxCurl: Math.max(...curl.field),
    minCurl: Math.min(...curl.field),
    maxDiv: Math.max(...div.field),
    minDiv: Math.min(...div.field),
    // Activity metrics derived from physics
    rotationalEnergy: curl.field.reduce((a, v) => a + v * v, 0),  // Σ(curl²)
    expansiveEnergy: div.field.reduce((a, v) => a + v * v, 0),   // Σ(div²)
    totalAction: current.total,
  };
}
