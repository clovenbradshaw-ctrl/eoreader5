// Stick-figure output organ: draw detected people, motion, and structure
// directly onto frames. Pure pixel operations, no dependencies.
// Encoding the annotated frames to a video file is the host's job
// (@eoreader/host/video produceAnnotatedVideo).

import { FRAME_WIDTH, FRAME_HEIGHT } from './reading.js';

// ── Pixel drawing primitives ────────────────────────────────────

export function setPixel(pixels, x, y, value = 255) {
  const ix = Math.round(x), iy = Math.round(y);
  if (ix >= 0 && ix < FRAME_WIDTH && iy >= 0 && iy < FRAME_HEIGHT) {
    pixels[iy * FRAME_WIDTH + ix] = value;
  }
}

export function drawLine(pixels, x1, y1, x2, y2, value = 255) {
  // Guard against NaN — NaN === NaN is always false, causing infinite loop
  if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;
  const dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx + dy, e2;
  let x = Math.round(x1), y = Math.round(y1);
  const ex = Math.round(x2) || 0, ey = Math.round(y2) || 0;

  while (true) {
    setPixel(pixels, x, y, value);
    if (x === ex && y === ey) break;
    e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

export function drawCircle(pixels, cx, cy, r, value = 255) {
  let x = Math.round(r), y = 0;
  let err = 0;
  while (x >= y) {
    setPixel(pixels, cx + x, cy + y, value);
    setPixel(pixels, cx + y, cy + x, value);
    setPixel(pixels, cx - y, cy + x, value);
    setPixel(pixels, cx - x, cy + y, value);
    setPixel(pixels, cx - x, cy - y, value);
    setPixel(pixels, cx - y, cy - x, value);
    setPixel(pixels, cx + y, cy - x, value);
    setPixel(pixels, cx + x, cy - y, value);
    y++;
    err += 1 + 2 * y;
    if (2 * (err - x) + 1 > 0) { x--; err += 1 - 2 * x; }
  }
}

export function drawRect(pixels, x1, y1, x2, y2, value = 255) {
  drawLine(pixels, x1, y1, x2, y1, value);
  drawLine(pixels, x2, y1, x2, y2, value);
  drawLine(pixels, x2, y2, x1, y2, value);
  drawLine(pixels, x1, y2, x1, y1, value);
}

// ── Stick figure ────────────────────────────────────────────────
// Draws a person as: head circle + spine + arms + legs
// Position: centroid (0-1 normalized to frame), height as fraction of frame

export function drawStickFigure(pixels, centroidX, centroidY, height = 0.3, confidence = 1, value = 255) {
  const h = height * FRAME_HEIGHT;
  const cx = centroidX * FRAME_WIDTH;
  const headY = centroidY * FRAME_HEIGHT - h * 0.4;
  const neckY = headY + h * 0.15;
  const torsoEndY = neckY + h * 0.35;
  const feetY = centroidY * FRAME_HEIGHT + h * 0.4;

  // Head (circle, radius proportional to height)
  const headR = Math.max(2, h * 0.08);
  drawCircle(pixels, cx, headY + headR, headR, value);

  // Spine (neck to groin)
  drawLine(pixels, cx, neckY, cx, torsoEndY, value);

  // Left arm (from shoulder at ~45° up)
  const shoulderY = neckY + h * 0.08;
  const armLen = h * 0.2;
  drawLine(pixels, cx, shoulderY, cx - armLen, shoulderY - armLen * 0.2, value);
  drawLine(pixels, cx, shoulderY, cx + armLen, shoulderY - armLen * 0.2, value);

  // Left leg
  const legLen = h * 0.35;
  drawLine(pixels, cx, torsoEndY, cx - legLen * 0.4, feetY, value);
  drawLine(pixels, cx, torsoEndY, cx + legLen * 0.4, feetY, value);

  // Confidence indicator: brighter = more confident
  // Already using `value` for brightness
}

// ── Motion arrow ────────────────────────────────────────────────
// Draws an arrow showing the dominant motion direction at a point

export function drawMotionArrow(pixels, x, y, dx, dy, magnitude, value = 200) {
  if (!Number.isFinite(magnitude) || magnitude < 0.5) return;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const scale = Math.min(magnitude * 2, 15);
  const ex = x + dx * scale, ey = y + dy * scale;
  drawLine(pixels, x, y, ex, ey, value);
  const angle = Math.atan2(dy, dx);
  const headLen = 4;
  if (Number.isFinite(angle)) {
    drawLine(pixels, ex, ey, ex - headLen * Math.cos(angle - 0.5), ey - headLen * Math.sin(angle - 0.5), value);
    drawLine(pixels, ex, ey, ex - headLen * Math.cos(angle + 0.5), ey - headLen * Math.sin(angle + 0.5), value);
  }
}

// ── Frame annotation ────────────────────────────────────────────
// Full annotation: shot boundary markers, text labels, detected people

export function annotateFrame(pixels, { time, shotBoundary, people, motionFlow } = {}) {
  const out = new Uint8Array(pixels);

  // Shot boundary marker (horizontal line across frame)
  if (shotBoundary) {
    for (let x = 0; x < FRAME_WIDTH; x++) {
      out[20 * FRAME_WIDTH + x] = 200;  // bright line at y=20
    }
  }

  // Draw detected people as stick figures
  if (people && people.length > 0) {
    for (const p of people) {
      const brightness = Math.round(180 + 75 * (p.personConfidence || 0.5));
      drawStickFigure(out, p.centroidX, p.centroidY, p.height || 0.3, p.personConfidence || 0.5, brightness);
    }
  }

  // Draw motion arrows from optical flow
  if (motionFlow && motionFlow.vectors) {
    const { dx, dy, confidence } = motionFlow.vectors;
    for (let by = 0; by < 15; by += 3) {
      for (let bx = 0; bx < 20; bx += 3) {
        const idx = by * 20 + bx;
        if (confidence[idx] > 0.3) {
          const px = (bx + 0.5) * 8;
          const py = (by + 0.5) * 8;
          drawMotionArrow(out, px, py, dx[idx], dy[idx], Math.sqrt(dx[idx] ** 2 + dy[idx] ** 2) / 4, 180);
        }
      }
    }
  }

  // Time code in top-left (simple horizontal bar)
  const timeStr = `${Math.floor(time / 60)}:${(time % 60).toFixed(0).padStart(2, '0')}`;
  // Just draw a few pixels for each character (crude but visible)
  for (let i = 0; i < FRAME_WIDTH; i += 4) {
    out[4 * FRAME_WIDTH + i] = 128;  // faint time bar
  }

  return out;
}

// Producing the annotated video file lives host-side:
// @eoreader/host/video produceAnnotatedVideo(annotatedFrames, outputPath).
