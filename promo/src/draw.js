// 2D drawing kit for the v2 look: pure black, neon blue edge light, glossy
// pills, typed text, pixel-block reveals, dot-matrix texture, a glossy cursor.
// Every function draws into two layers: `c` (the picture) and `g` (light that
// is bloomed by the compositor). Nothing reads the clock.

export const BLUE = '#3d6cff';
export const BLUE_HI = '#5b86ff';
export const BLUE_LO = '#2a4fd6';
export const INK = '#ffffff';
export const GREY = '#8a93a6';
// Type system (all bundled, SIL OFL): Inter Tight for display lines (tight
// tracking), Inter for small UI text, JetBrains Mono for the technical labels
// of the video world (timecode, frame counter, file names, resolution tags).
export const DISPLAY = '"Inter Tight"';
export const SANS = '"Inter"';
export const MONO = '"JetBrains Mono"';
export const RED = '#ff4d4d';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = (x) => x * x * (3 - 2 * x);
export const inOutExpo = (x) =>
  x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
export const outExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const inExpo = (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10));
export const outCubic = (x) => 1 - Math.pow(1 - x, 3);
export const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const outBack = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Rounded rectangle path (r clamps to a pill / circle). */
export function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A box (x, y, w, h, r) eased between two boxes: the basis of every morph. */
export const mixBox = (a, b, k) => ({
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k),
  h: lerp(a.h, b.h, k),
  r: lerp(a.r, b.r, k),
});
export const box = (cx, cy, w, h, r) => ({ x: cx - w / 2, y: cy - h / 2, w, h, r });

/**
 * Neon-edged frame: dark glass fill, thin bright stroke, bloom on the glow
 * layer, and an optional light that travels along the border (sweep 0..1).
 */
export function neonFrame(L, b, { intensity = 1, fill = 'rgba(6,9,18,0.94)', stroke = 1.25, sweep = -1, sweepLen = 0.16, fillAlpha = 1, edge = 1, zoom = 1 } = {}) {
  // line widths stay in screen pixels when the camera zooms in
  const px = 1 / Math.max(1, zoom);
  const { c, g } = L;
  if (fillAlpha > 0) {
    c.save();
    c.globalAlpha = fillAlpha;
    rr(c, b.x, b.y, b.w, b.h, b.r);
    const grad = c.createLinearGradient(0, b.y, 0, b.y + b.h);
    grad.addColorStop(0, fill);
    grad.addColorStop(1, 'rgba(3,5,12,0.96)');
    c.fillStyle = grad;
    c.fill();
    c.restore();
  }
  if (edge <= 0) return;
  // the edge: bright core stroke on the picture...
  c.save();
  c.globalAlpha = clamp(intensity * edge);
  rr(c, b.x, b.y, b.w, b.h, b.r);
  c.lineWidth = stroke * px;
  c.strokeStyle = '#8eaaff';
  c.stroke();
  c.restore();
  // ...and its light on the bloom layer
  g.save();
  g.globalAlpha = clamp(0.7 * intensity * edge);
  rr(g, b.x, b.y, b.w, b.h, b.r);
  g.lineWidth = 5 * px;
  g.strokeStyle = BLUE;
  g.stroke();
  g.restore();
  if (sweep >= 0) borderSweep(L, b, sweep, sweepLen, intensity * edge, px);
}

/** A bright comet of light travelling along a rounded-rect border. */
export function borderSweep(L, b, pos, len = 0.18, intensity = 1, px = 1) {
  const per = 2 * (b.w + b.h);
  const seg = per * len;
  const start = (((pos % 1) + 1) % 1) * per;
  for (const [ctx, lw, col, a] of [
    [L.c, 2, '#eef3ff', 0.95],
    [L.g, 9, '#7ea0ff', 1],
  ]) {
    ctx.save();
    rr(ctx, b.x, b.y, b.w, b.h, b.r);
    ctx.setLineDash([seg, per - seg]);
    ctx.lineDashOffset = -start;
    ctx.lineWidth = lw * px;
    ctx.lineCap = 'round';
    ctx.strokeStyle = col;
    ctx.globalAlpha = clamp(a * intensity);
    ctx.stroke();
    ctx.restore();
  }
}

/** Glossy blue pill (Design / Animate / Publish style) with an inner glow. */
export function glossyPill(L, b, { intensity = 1, press = 0, label = '', size = 0, weight = 700, alpha = 1 } = {}) {
  const { c, g } = L;
  const s = 1 - press * 0.06;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const w = b.w * s;
  const h = b.h * s;
  const x = cx - w / 2;
  const y = cy - h / 2;
  c.save();
  c.globalAlpha = alpha;
  rr(c, x, y, w, h, b.r * s);
  const body = c.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, '#4a86ff');
  body.addColorStop(0.55, '#2c62f4');
  body.addColorStop(1, '#1c46d6');
  c.fillStyle = body;
  c.fill();
  // inner glow and top gloss
  c.save();
  rr(c, x, y, w, h, b.r * s);
  c.clip();
  const inner = c.createRadialGradient(cx, y + h * 1.1, h * 0.1, cx, y + h * 0.9, w * 0.7);
  inner.addColorStop(0, 'rgba(140,180,255,0.55)');
  inner.addColorStop(1, 'rgba(140,180,255,0)');
  c.fillStyle = inner;
  c.fillRect(x, y, w, h);
  const gloss = c.createLinearGradient(0, y, 0, y + h * 0.5);
  gloss.addColorStop(0, 'rgba(255,255,255,0.32)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gloss;
  rr(c, x + 3, y + 3, w - 6, h * 0.5, Math.max(0, b.r * s - 3));
  c.fill();
  c.restore();
  rr(c, x, y, w, h, b.r * s);
  c.lineWidth = 2;
  c.strokeStyle = 'rgba(170,200,255,0.85)';
  c.stroke();
  if (label) {
    c.font = `${weight} ${size || h * 0.5}px ${DISPLAY}`;
    c.letterSpacing = `${-0.03 * (size || h * 0.5)}px`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.fillText(label, cx, cy + (size || h * 0.5) * 0.04);
  }
  c.restore();
  // light: a rim on the bloom layer, not a filled slab (keeps the label readable)
  g.save();
  g.globalAlpha = clamp(0.55 * intensity * alpha);
  rr(g, x - 2, y - 2, w + 4, h + 4, b.r * s + 2);
  g.lineWidth = 8;
  g.strokeStyle = BLUE;
  g.stroke();
  g.globalAlpha = clamp(0.08 * intensity * alpha);
  g.fillStyle = BLUE;
  g.fill();
  g.restore();
}

/** Centred line with one key word in blue; returns its width. */
export function keyLine(ctx, parts, x, y, { size = 44, weight = 500, align = 'center', alpha = 1, chars = Infinity, caret = false, caretOn = true, font = DISPLAY, tracking = -0.025, blur = 0 } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.letterSpacing = `${tracking * size}px`;
  if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.textBaseline = 'middle';
  const full = parts.map((p) => p[0]).join('');
  const total = ctx.measureText(full).width;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  let left = chars;
  ctx.globalAlpha = alpha;
  for (const [text, blue] of parts) {
    if (left <= 0) break;
    const shown = text.slice(0, Math.max(0, left));
    left -= text.length;
    ctx.fillStyle = blue ? BLUE_HI : INK;
    ctx.textAlign = 'left';
    ctx.fillText(shown, cx, y);
    cx += ctx.measureText(shown).width;
  }
  if (caret && caretOn && chars > 0) {
    ctx.fillStyle = BLUE_HI;
    ctx.fillRect(cx + 4, y - size * 0.55, Math.max(2, size * 0.06), size * 1.1);
  }
  ctx.restore();
  return total;
}

/** Characters typed by time t (steady cadence with tiny human jitter). */
export function typed(text, t, t0, cps = 28) {
  if (t < t0) return 0;
  const n = Math.floor((t - t0) * cps + hash(Math.floor((t - t0) * cps)) * 0.4);
  return Math.min(text.length, n);
}

/**
 * Pixel-block build: grid cells light up as blue squares in a scattered order,
 * then resolve into the real image.
 */
export function pixelBuild(L, img, b, t, t0, dur, { cell = 28, seed = 1, radius = 14 } = {}) {
  const { c, g } = L;
  const cols = Math.ceil(b.w / cell);
  const rows = Math.ceil(b.h / cell);
  const k = (t - t0) / dur;
  if (k >= 1.2) {
    c.save();
    rr(c, b.x, b.y, b.w, b.h, radius);
    c.clip();
    c.drawImage(img, b.x, b.y, b.w, b.h);
    c.restore();
    return;
  }
  if (k <= 0) return;
  const sx = img.width / b.w;
  const sy = img.height / b.h;
  c.save();
  rr(c, b.x, b.y, b.w, b.h, radius);
  c.clip();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // sweep from top-left with scatter
      const order = (i / cols) * 0.45 + (j / rows) * 0.35 + hash(i * 7.13 + j * 3.71 + seed) * 0.35;
      const on = (k - order * 0.75) / 0.18;
      if (on <= 0) continue;
      const x = b.x + i * cell;
      const y = b.y + j * cell;
      const w = Math.min(cell, b.x + b.w - x);
      const h = Math.min(cell, b.y + b.h - y);
      if (on < 1) {
        // blue block flash
        c.fillStyle = on < 0.5 ? BLUE : '#2b56e0';
        c.globalAlpha = 0.95;
        c.fillRect(x + 1, y + 1, w - 2, h - 2);
        g.save();
        g.globalAlpha = 0.6 * (1 - on);
        g.fillStyle = BLUE;
        g.fillRect(x, y, w, h);
        g.restore();
        c.globalAlpha = 1;
      } else {
        c.drawImage(img, (x - b.x) * sx, (y - b.y) * sy, w * sx, h * sy, x, y, w, h);
      }
    }
  }
  c.restore();
}

/** Dot-matrix sparkle texture (fades in from one side). */
export function dotMatrix(L, x, y, w, h, t, { pitch = 14, alpha = 1, seed = 3, from = 'left' } = {}) {
  const { c, g } = L;
  const cols = Math.floor(w / pitch);
  const rows = Math.floor(h / pitch);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = from === 'left' ? 1 - i / cols : i / cols;
      const n = hash(i * 13.1 + j * 7.7 + seed + Math.floor(t * 8 + hash(i + j * 31) * 8) * 0.37);
      const a = alpha * u * u * (n > 0.55 ? (n - 0.55) * 2.2 : 0.06);
      if (a < 0.02) continue;
      c.globalAlpha = Math.min(1, a);
      c.fillStyle = n > 0.93 ? '#cfe0ff' : '#3d6cff';
      c.beginPath();
      c.arc(x + i * pitch + pitch / 2, y + j * pitch + pitch / 2, pitch * 0.22, 0, Math.PI * 2);
      c.fill();
      if (n > 0.9) {
        g.globalAlpha = Math.min(1, a);
        g.fillStyle = BLUE;
        g.fillRect(x + i * pitch, y + j * pitch, pitch, pitch);
      }
    }
  }
  c.globalAlpha = 1;
  g.globalAlpha = 1;
}

/** Glossy brand-blue cursor arrow; hot spot at (x, y). press 0..1, ripple 0..1. */
export function cursor(L, x, y, { press = 0, ripple = -1, scale = 1, alpha = 1 } = {}) {
  const { c, g } = L;
  if (alpha <= 0) return;
  if (ripple >= 0 && ripple < 1) {
    for (const [ctx, lw, a] of [
      [c, 2.5, 0.9],
      [g, 8, 0.8],
    ]) {
      ctx.save();
      ctx.globalAlpha = a * (1 - ripple) * alpha;
      ctx.strokeStyle = BLUE_HI;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(x, y, 10 + ripple * 60 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  const s = scale * (1 - press * 0.18);
  c.save();
  c.globalAlpha = alpha;
  c.translate(x, y);
  c.scale(s, s);
  c.rotate(-0.05);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(34, 13);
  c.lineTo(17, 18);
  c.lineTo(11, 35);
  c.closePath();
  const body = c.createLinearGradient(0, 0, 30, 30);
  body.addColorStop(0, '#9fbaff');
  body.addColorStop(0.45, '#4a7bff');
  body.addColorStop(1, '#2350d8');
  c.fillStyle = body;
  c.fill();
  c.lineJoin = 'round';
  c.lineWidth = 1.6;
  c.strokeStyle = 'rgba(220,232,255,0.9)';
  c.stroke();
  c.restore();
  g.save();
  g.globalAlpha = 0.7 * alpha;
  g.translate(x, y);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(34, 13);
  g.lineTo(17, 18);
  g.lineTo(11, 35);
  g.closePath();
  g.fillStyle = BLUE;
  g.fill();
  g.restore();
}

/** Simple line icons for the floating tiles (stroke-only, 64 px box). */
export function icon(ctx, kind, x, y, s, color = '#ffffff') {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 64, s / 64);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (kind) {
    case 'folder':
      ctx.moveTo(-24, -14);
      ctx.lineTo(-8, -14);
      ctx.lineTo(-3, -8);
      ctx.lineTo(24, -8);
      ctx.lineTo(24, 18);
      ctx.lineTo(-24, 18);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'upload':
      ctx.moveTo(0, 16);
      ctx.lineTo(0, -16);
      ctx.moveTo(-13, -4);
      ctx.lineTo(0, -17);
      ctx.lineTo(13, -4);
      ctx.moveTo(-20, 22);
      ctx.lineTo(20, 22);
      ctx.stroke();
      break;
    case 'play':
      ctx.moveTo(-10, -16);
      ctx.lineTo(16, 0);
      ctx.lineTo(-10, 16);
      ctx.closePath();
      ctx.fill();
      break;
    case 'link':
      ctx.save();
      ctx.rotate(-Math.PI / 4);
      rr(ctx, -24, -9, 26, 18, 9);
      ctx.stroke();
      rr(ctx, -2, -9, 26, 18, 9);
      ctx.stroke();
      ctx.restore();
      break;
    case 'users':
      ctx.arc(-8, -8, 8, 0, Math.PI * 2);
      ctx.moveTo(-22, 18);
      ctx.quadraticCurveTo(-8, -2, 6, 18);
      ctx.moveTo(17, -6);
      ctx.arc(12, -6, 6, 0, Math.PI * 2);
      ctx.moveTo(8, 8);
      ctx.quadraticCurveTo(18, 4, 24, 16);
      ctx.stroke();
      break;
    case 'spark':
      for (const [cx, cy, r] of [
        [-4, 2, 15],
        [15, -14, 6],
      ]) {
        ctx.moveTo(cx, cy - r);
        ctx.quadraticCurveTo(cx, cy, cx + r, cy);
        ctx.quadraticCurveTo(cx, cy, cx, cy + r);
        ctx.quadraticCurveTo(cx, cy, cx - r, cy);
        ctx.quadraticCurveTo(cx, cy, cx, cy - r);
      }
      ctx.fill();
      break;
    default:
  }
  ctx.restore();
}

/** Dark rounded icon tile with blue edge glow (the floating cluster). */
export function iconTile(L, cx, cy, size, kind, { alpha = 1, glow = 1 } = {}) {
  const { c, g } = L;
  const b = box(cx, cy, size, size, size * 0.24);
  c.save();
  c.globalAlpha = alpha;
  rr(c, b.x, b.y, b.w, b.h, b.r);
  const fill = c.createLinearGradient(0, b.y, 0, b.y + b.h);
  fill.addColorStop(0, '#1b1f2a');
  fill.addColorStop(1, '#0b0d13');
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = 'rgba(111,149,255,0.9)';
  c.stroke();
  icon(c, kind, cx, cy, size * 0.62);
  c.restore();
  g.save();
  g.globalAlpha = 0.75 * alpha * glow;
  rr(g, b.x - 3, b.y - 3, b.w + 6, b.h + 6, b.r + 3);
  g.lineWidth = 10;
  g.strokeStyle = BLUE;
  g.stroke();
  g.globalAlpha = 0.3 * alpha * glow;
  g.fillStyle = BLUE;
  g.fill();
  g.restore();
  clearGlow(L, b, 4);
}

/** The Shotstash three-bar mark, flat brand colours (tile #3d6cff, bars 100/70/40% white). */
export function mark(L, cx, cy, size, { glow = 0, alpha = 1, bars = 1 } = {}) {
  const { c, g } = L;
  const s = size / 512;
  c.save();
  c.globalAlpha = alpha;
  c.translate(cx - size / 2, cy - size / 2);
  c.scale(s, s);
  rr(c, 0, 0, 512, 512, 112);
  c.fillStyle = BLUE;
  c.fill();
  const ys = [150, 226, 302];
  const op = [1, 0.7, 0.4];
  for (let i = 0; i < 3; i++) {
    const k = clamp(bars * 3 - i);
    if (k <= 0) continue;
    c.globalAlpha = alpha * op[i] * k;
    rr(c, 112, ys[i], 288, 60, 30);
    c.fillStyle = '#ffffff';
    c.fill();
  }
  c.restore();
  if (glow > 0) {
    g.save();
    g.globalAlpha = clamp(glow) * alpha * 0.8;
    g.translate(cx - size / 2, cy - size / 2);
    g.scale(s, s);
    rr(g, -6, -6, 524, 524, 116);
    g.lineWidth = 26;
    g.strokeStyle = BLUE;
    g.stroke();
    g.globalAlpha = clamp(glow) * alpha * 0.25;
    g.fillStyle = BLUE;
    g.fill();
    g.restore();
  }
}

/** Soft radial halo on the glow layer (spotlight on the active element). */
export function halo(L, cx, cy, r, a = 1) {
  const { g } = L;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, `rgba(61,108,255,${0.22 * a})`);
  grad.addColorStop(1, 'rgba(61,108,255,0)');
  g.fillStyle = grad;
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** SMPTE-style timecode at a given frame rate: 00:00:07:04 */
export function timecode(t, fps = 24) {
  const f = Math.floor(t * fps + 1e-6);
  const ff = f % fps;
  const s = Math.floor(f / fps);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
}

/**
 * Camera viewfinder dressing in screen space: safe-area corner brackets,
 * REC dot, running timecode, frame counter, a resolution tag and the current
 * clip / page label, all in mono, quiet grey.
 */
export function viewfinder(L, t, { label = '', alpha = 1, fps = 24, res = '3840×2160 · 24p' } = {}) {
  if (alpha <= 0.01) return;
  const c = L.c;
  const W = 1920;
  const H = 1080;
  const m = 54; // safe-area margin
  const arm = 34;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = alpha;
  c.strokeStyle = 'rgba(200,212,235,0.42)';
  c.lineWidth = 1.5;
  for (const [x, y, sx, sy] of [
    [m, m, 1, 1],
    [W - m, m, -1, 1],
    [m, H - m, 1, -1],
    [W - m, H - m, -1, -1],
  ]) {
    c.beginPath();
    c.moveTo(x, y + sy * arm);
    c.lineTo(x, y);
    c.lineTo(x + sx * arm, y);
    c.stroke();
  }
  // centre cross, very faint
  c.strokeStyle = 'rgba(200,212,235,0.12)';
  c.beginPath();
  c.moveTo(W / 2 - 10, H / 2);
  c.lineTo(W / 2 + 10, H / 2);
  c.moveTo(W / 2, H / 2 - 10);
  c.lineTo(W / 2, H / 2 + 10);
  c.stroke();
  c.font = `500 17px ${MONO}`;
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(200,212,235,0.62)';
  // REC dot (blinks once a second)
  const rec = Math.floor(t * 2) % 2 === 0;
  c.fillStyle = rec ? RED : 'rgba(255,77,77,0.25)';
  c.beginPath();
  c.arc(m + 18, m + 26, 6, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(200,212,235,0.62)';
  c.textAlign = 'left';
  c.fillText('REC', m + 32, m + 27);
  c.textAlign = 'right';
  c.fillText(timecode(t, fps), W - m - 6, m + 27);
  c.fillText(`F ${String(Math.floor(t * fps)).padStart(4, '0')}`, W - m - 6, m + 50);
  c.textAlign = 'left';
  c.fillText(res, m + 6, H - m - 22);
  if (label) {
    c.textAlign = 'right';
    c.fillText(label, W - m - 6, H - m - 22);
  }
  c.restore();
}

/**
 * Depth of field for a layer: paints `fn` into scratch canvases and lays it
 * down blurred (blur in px). Sharp layers draw straight through.
 */
export function withBlur(L, blur, fn) {
  if (blur < 0.3) {
    fn(L);
    return;
  }
  const S = L.scratch;
  for (const ctx of [S.c, S.g]) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1;
  }
  fn(S);
  for (const [dst, src] of [
    [L.c, S.c],
    [L.g, S.g],
  ]) {
    dst.save();
    dst.setTransform(1, 0, 0, 1, 0, 0);
    dst.filter = `blur(${blur.toFixed(1)}px)`;
    dst.drawImage(src.canvas, 0, 0);
    dst.restore();
  }
}

/** Keeps a UI surface clean: removes light from the bloom layer inside it. */
export function clearGlow(L, b, inset = 6) {
  const g = L.g;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  rr(g, b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2, Math.max(0, b.r - inset));
  g.fillStyle = '#000';
  g.fill();
  g.restore();
}
