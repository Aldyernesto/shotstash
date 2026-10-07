// v2: the trailer as one deterministic function of time. draw(L, t) paints
// the picture into L.c and the light (for bloom) into L.g. Layout units are
// 1920 x 1080 pixels; a 2.5D camera (pan + zoom) moves over them.

import {
  BLUE, BLUE_HI, GREY, SANS, DISPLAY, MONO, viewfinder, withBlur, clearGlow, clamp, lerp, prog, smooth, inOutExpo, outExpo, inExpo, outCubic, inOutCubic, outBack,
  rr, box, mixBox, neonFrame, borderSweep, glossyPill, keyLine, typed, pixelBuild, dotMatrix, cursor, iconTile, mark, halo, hash,
} from './draw.js';
import { S, IMPACT, LOCK_HIT, BEAT } from './timeline.js';

export const W = 1920;
export const H = 1080;

// ---------------------------------------------------------------- camera
function camera(L, cx, cy, z) {
  for (const ctx of [L.c, L.g]) ctx.setTransform(z, 0, 0, z, W / 2 - cx * z, H / 2 - cy * z);
}
function screen(L) {
  for (const ctx of [L.c, L.g]) ctx.setTransform(1, 0, 0, 1, 0, 0);
}
/** Eased arc between two points (cursor paths curve, they never go straight). */
function arc(a, b, k, bend = 0.18) {
  const x = lerp(a[0], b[0], k);
  const y = lerp(a[1], b[1], k);
  const nx = -(b[1] - a[1]);
  const ny = b[0] - a[0];
  const s = Math.sin(k * Math.PI) * bend;
  return [x + nx * s, y + ny * s];
}
/** Cursor moving along keyed points [[t, x, y], ...] with expo easing per leg. */
function cursorPath(path, t) {
  let i = 0;
  while (i < path.length - 2 && t >= path[i + 1][0]) i++;
  const a = path[i];
  const b = path[Math.min(i + 1, path.length - 1)];
  const k = inOutExpo(prog(t, a[0], b[0]));
  return arc([a[1], a[2]], [b[1], b[2]], k, 0.12);
}
const press = (t, at) => Math.max(0, 1 - Math.abs(t - at) / 0.09);
const ripple = (t, at) => (t >= at ? prog(t, at, at + 0.5) : -1);
const caretOn = (t) => Math.floor(t * 2.4) % 2 === 0;

/** Screenshot box inside an app frame (keeps the image aspect). */
function fitBox(img, cx, cy, w) {
  const h = (w * img.height) / img.width;
  return { x: cx - w / 2, y: cy - h / 2, w, h, r: 22 };
}

export function createStory(assets) {
  const { projects: imgProjects, viewer, sharepage, wordmark } = assets;

  // ------------------------------------------------------------ layout
  const pillBox = box(960, 540, 820, 170, 85);
  const panel = box(960, 560, 1100, 600, 30);
  const rowY = [452, 572, 692];
  const rowX0 = panel.x + 60;
  const rowX1 = panel.x + panel.w - 60;
  const barY = (i) => rowY[i] + 30;
  const barX0 = rowX0 + 92;
  const barX1 = rowX1 - 110;
  const capR = 6; // progress bar end-cap radius
  // app frame for Projects (tall screenshot), its content box
  const frameP = box(960, 650, 1040, 880, 36);
  const shotP = { x: frameP.x + 20, y: frameP.y + 20, w: frameP.w - 40, h: ((frameP.w - 40) * 1060) / 1280, r: 22 };
  const frameV = box(960, 610, 1200, 780, 36);
  const shotV = fitBox(viewer, 960, 610, 1160);
  const shotS = fitBox(sharepage, 960, 610, 1160);

  // the intro's key word, measured once: it scales up and becomes the button
  const wordBox = (() => {
    const cv = document.createElement('canvas').getContext('2d');
    const size = 64;
    cv.font = `500 ${size}px ${DISPLAY}`;
    cv.letterSpacing = `${-0.025 * size}px`;
    const full = S.intro.text.map((p) => p[0]).join('');
    const total = cv.measureText(full).width;
    const pre = cv.measureText(S.intro.text[0][0]).width;
    const ww = cv.measureText(S.intro.text[1][0]).width;
    const x = 960 - total / 2 + pre;
    return { x: x - 14, y: 540 - size * 0.62, w: ww + 28, h: size * 1.24, r: size * 0.3, size, pre, total };
  })();

  // screenshot pixel -> layout point
  const inShot = (sb, img, px, py) => [sb.x + (px / img.width) * sb.w, sb.y + (py / img.height) * sb.h];

  // ------------------------------------------------------------ scenes
  function intro(L, t) {
    const { scan, type, done, out, text } = S.intro;
    const z = lerp(1, 1.05, smooth(prog(t, 0, 3.1)));
    camera(L, 960, 540, z);
    const a = 1;
    // dot-matrix sparkle at the edges
    dotMatrix(L, 0, 120, 560, 840, t, { alpha: 0.55 * smooth(prog(t, 0.2, 1.2)) * a, from: 'left' });
    dotMatrix(L, 1360, 120, 560, 840, t, { alpha: 0.25 * smooth(prog(t, 0.6, 1.6)) * a, from: 'right', seed: 9 });
    // the scan line: flashes on at frame 0 (the hook), sweeps, settles under the text
    const k = inOutExpo(prog(t, scan[0], scan[1]));
    const y = lerp(320, 600, k);
    const w = lerp(260, 900, outExpo(prog(t, 0, 0.6)));
    for (const [ctx, lw, col, al] of [
      [L.c, 1.6, '#9fb8ff', 0.9],
      [L.g, 6, BLUE, 0.9],
    ]) {
      const grad = ctx.createLinearGradient(960 - w / 2, 0, 960 + w / 2, 0);
      grad.addColorStop(0, 'rgba(61,108,255,0)');
      grad.addColorStop(0.5, col);
      grad.addColorStop(1, 'rgba(61,108,255,0)');
      ctx.save();
      ctx.globalAlpha = al * a * lerp(1, 0.45, prog(t, scan[1], scan[1] + 0.6));
      ctx.fillStyle = grad;
      ctx.fillRect(960 - w / 2, y - lw / 2, w, lw);
      ctx.restore();
    }
    // the claim, typed so the last letter lands on the swell
    const full = text.map((p) => p[0]).join('');
    const cps = full.length / (done - type);
    const n = typed(full, t, type, cps);
    keyLine(L.c, text, 960, 540, { size: wordBox.size, weight: 500, chars: n, alpha: a, caret: t < out, caretOn: caretOn(t) || n < full.length });
    halo(L, 960, 540, 420, 0.15 * a * smooth(prog(t, 0.5, 1.2)));
  }

  function upload(L, t) {
    const U = S.upload;
    // camera: gentle push, then the dive into the last bar's end cap
    const capX = barX1;
    const capY = barY(2);
    const dive = inExpo(prog(t, U.dive[0], U.dive[1]));
    const z = lerp(1.0, 46, dive) * lerp(1, 1.04, smooth(prog(t, 3, 6.2)));
    // the camera lines up on the end cap first, then the zoom explodes into it
    const aim = inOutCubic(prog(t, U.dive[0], U.dive[0] + 0.4));
    const cx = lerp(960, capX + capR * 0.3, aim);
    const cy = lerp(540, capY - capR * 0.3, aim);
    camera(L, cx, cy, z);
    const away = 1 - smooth(prog(t, U.dive[0], U.dive[0] + 0.3)); // all but the bar falls to black

    // type-to-object match cut: the key word "everywhere." swells into the button
    const I = S.intro;
    const grow = inOutExpo(prog(t, I.out + 0.05, I.out + 0.55));
    const m = inOutExpo(prog(t, U.morph[0], U.morph[1]));
    const pill = mixBox(wordBox, pillBox, grow);
    if (t < I.out + 0.5) {
      // the rest of the claim falls away; the word fades as the button fills
      const fall = smooth(prog(t, I.out, I.out + 0.14));
      L.c.save();
      L.c.translate(0, fall * 18);
      keyLine(L.c, [[I.text[0][0], false]], 960 - wordBox.total / 2, 540, { size: wordBox.size, weight: 500, align: 'left', alpha: 1 - fall });
      L.c.restore();
      dotMatrix(L, 0, 120, 560, 840, t, { alpha: 0.55 * (1 - fall) });
      const wa = 1 - smooth(prog(grow, 0.4, 0.75));
      L.c.save();
      const sc = pill.h / wordBox.h;
      L.c.translate(pill.x + pill.w / 2, pill.y + pill.h / 2);
      L.c.scale(sc, sc);
      keyLine(L.c, [[I.text[1][0], true]], 0, 0, { size: wordBox.size, weight: 500, alpha: wa });
      L.c.restore();
    }
    const b = mixBox(pill, panel, m);
    const pressK = press(t, U.click);
    if (m < 1) {
      glossyPill(L, b, {
        press: pressK,
        label: grow > 0.75 && m < 0.35 ? '+  New Project' : '',
        size: 72,
        weight: 600,
        alpha: smooth(prog(grow, 0.0, 0.3)) * (1 - smooth(prog(m, 0.05, 0.4))) * away,
      });
      halo(L, 960, 540, 420, 0.35 * (1 - m));
    }
    if (m > 0.1) {
      neonFrame(L, b, { intensity: smooth(prog(m, 0.1, 0.6)) * away, fillAlpha: smooth(prog(m, 0.1, 0.6)) * away, sweep: m >= 1 ? prog(t, 4.6, 6.1) * 1.2 : -1 });
    }
    if (m >= 1) {
      const c = L.c;
      c.save();
      c.globalAlpha = away;
      c.font = `600 32px ${SANS}`;
      c.textBaseline = 'middle';
      c.fillStyle = '#ffffff';
      c.fillText('Upload files', panel.x + 60, panel.y + 66);
      c.font = `400 22px ${SANS}`;
      c.fillStyle = GREY;
      c.fillText('to Harbor Lights campaign', panel.x + 60, panel.y + 104);
      c.restore();
      // three files drop in and race to 100%
      U.files.forEach(([name, kind], i) => {
        const land = outBack(prog(t, U.chips[i], U.chips[i] + 0.32), 1.6);
        if (land <= 0) return;
        const rowAlpha = i === 2 ? 1 : away;
        const y = rowY[i] - (1 - land) * 40;
        c.save();
        c.globalAlpha = clamp(land) * rowAlpha;
        rr(c, rowX0, y - 34, rowX1 - rowX0, 92, 18);
        c.fillStyle = 'rgba(20,26,42,0.9)';
        c.fill();
        c.lineWidth = 1.2;
        c.strokeStyle = 'rgba(111,149,255,0.35)';
        c.stroke();
        // file badge
        rr(c, rowX0 + 18, y - 18, 56, 56, 12);
        c.fillStyle = 'rgba(61,108,255,0.18)';
        c.fill();
        c.fillStyle = BLUE_HI;
        c.beginPath();
        c.moveTo(rowX0 + 38, y - 4);
        c.lineTo(rowX0 + 58, y + 10);
        c.lineTo(rowX0 + 38, y + 24);
        c.closePath();
        c.fill();
        c.font = `500 22px ${MONO}`;
        c.fillStyle = '#ffffff';
        c.textBaseline = 'middle';
        c.fillText(name, barX0, y - 6);
        c.font = `400 16px ${MONO}`;
        c.fillStyle = GREY;
        c.textAlign = 'right';
        c.fillText(kind, barX1, y - 6);
        c.textAlign = 'left';
        // progress bar
        const p = inOutCubic(prog(t, U.chips[i] + 0.12, U.done[i]));
        // in the dive the bar's fill falls away and only its edge light stays
        c.globalAlpha *= i === 2 ? 1 - smooth(prog(dive, 0, 0.25)) : 1;
        rr(c, barX0, barY(i) - capR, barX1 - barX0, capR * 2, capR);
        c.fillStyle = 'rgba(255,255,255,0.1)';
        c.fill();
        const xe = lerp(barX0 + capR * 2, barX1, p);
        rr(c, barX0, barY(i) - capR, xe - barX0, capR * 2, capR);
        const fillG = c.createLinearGradient(barX0, 0, barX1, 0);
        fillG.addColorStop(0, '#2f5ff0');
        fillG.addColorStop(1, '#7da0ff');
        c.fillStyle = fillG;
        c.fill();
        c.restore();
        L.g.save();
        L.g.globalAlpha = 0.9 * clamp(land) * rowAlpha * (i === 2 ? 1 - smooth(prog(dive, 0, 0.25)) : 1);
        rr(L.g, barX0, barY(i) - capR - 2, xe - barX0, capR * 2 + 4, capR + 2);
        L.g.fillStyle = BLUE;
        L.g.fill();
        L.g.restore();
        // percent, then a check
        const done = t >= U.done[i];
        c.save();
        c.globalAlpha = clamp(land) * rowAlpha;
        c.textAlign = 'right';
        c.font = `500 20px ${MONO}`;
        if (done) {
          const pop = outBack(prog(t, U.done[i], U.done[i] + 0.25), 2.2);
          const cx0 = rowX1 - 36;
          c.fillStyle = BLUE;
          c.beginPath();
          c.arc(cx0, y + 12, 18 * pop, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = '#fff';
          c.lineWidth = 3.5;
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(cx0 - 8 * pop, y + 12);
          c.lineTo(cx0 - 2 * pop, y + 18);
          c.lineTo(cx0 + 9 * pop, y + 5);
          c.stroke();
          halo(L, cx0, y + 12, 60, 0.6 * (1 - prog(t, U.done[i], U.done[i] + 0.5)));
        } else {
          c.fillStyle = '#c9d6ff';
          c.fillText(`${Math.round(p * 100)}%`, rowX1 - 18, y + 12);
        }
        c.restore();
      });
    }
    if (dive > 0) {
      neonFrame(L, { x: barX0, y: barY(2) - capR, w: barX1 - barX0, h: capR * 2, r: capR }, { fillAlpha: 0, intensity: smooth(prog(dive, 0, 0.2)), zoom: z, stroke: 1.6 });
    }
    // cursor: glides in on an arc, clicks the button, leaves
    const cp = cursorPath(
      [
        [U.cursorIn, 1560, 980],
        [U.click - 0.2, 1250, 580],
        [U.click + 0.35, 1250, 580],
        [U.chips[2], 1500, 940],
      ],
      t,
    );
    cursor(L, cp[0], cp[1], { press: pressK, ripple: ripple(t, U.click), alpha: (1 - prog(t, U.chips[1], U.chips[2])) });
    // small line under the panel
    screen(L);
    const n = typed(U.line.map((p) => p[0]).join(''), t, U.lineAt, 34);
    // the line rides the camera at half parallax
    L.c.save();
    L.c.translate((960 - cx) * 0.5 * (z - 1 < 0.2 ? 1 : 0), 0);
    keyLine(L.c, U.line, 960, 910, { size: 40, weight: 500, chars: n, alpha: away, caret: t < U.lineAt + 1.2, caretOn: caretOn(t) });
    L.c.restore();
    viewfinder(L, t, { label: 'harbor-lights / upload', alpha: away, res: '1920×1080 · 24p' });
  }

  /** The frame snaps open from the end cap's corner (7.04 s). */
  function frameOpen(t) {
    const kz = outExpo(prog(t, IMPACT, IMPACT + 0.6));
    const kc = inOutCubic(prog(t, IMPACT, IMPACT + 0.6));
    // the end cap's top-right arc (radius capR at zoom ~46) matches the frame's
    // top-right corner (radius 36): start zoom so both radii read the same on screen
    const z0 = (capR * 46) / frameP.r;
    const cx = lerp(frameP.x + frameP.w - frameP.r * 0.7, 960, kc);
    const cy = lerp(frameP.y + frameP.r * 0.7, 560, kc);
    return { cx, cy, z: lerp(z0, 1, kz) };
  }

  // the click pushes into the card; at HANDOFF the viewer takes over, growing
  // out of the card's on-screen rectangle (a scale match: one frame leads)
  const HANDOFF = S.projects.zoom[0] + 0.4;
  const cardA = () => inShot(shotP, imgProjects, 55, 735);
  const cardB = () => inShot(shotP, imgProjects, 405, 1030);
  function projCam(t) {
    const P = S.projects;
    const open = frameOpen(t);
    const zk = inOutCubic(prog(t, P.zoom[0], HANDOFF));
    const a = cardA();
    const b = cardB();
    const card = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const z0 = open.z * lerp(1, 1.03, smooth(prog(t, IMPACT + 0.6, P.zoom[0])));
    return { cx: lerp(open.cx, card[0], zk), cy: lerp(open.cy, card[1], zk), z: lerp(z0, 3.4, zk), zk };
  }

  function projects(L, t) {
    const P = S.projects;
    const card = inShot(shotP, imgProjects, 230, 880);
    const { cx, cy, z, zk } = projCam(t);
    const toViewer = t >= HANDOFF ? 1 : 0;
    // rack focus: the headline holds focus while the UI builds soft behind it,
    // then focus pulls to the UI and the headline goes soft
    const rack = inOutCubic(prog(t, P.build[1] - 0.1, P.build[1] + 0.35));
    const uiBlur = lerp(5, 0, rack) * smooth(prog(t, IMPACT + 0.4, IMPACT + 0.7));
    const headBlur = lerp(0, 3.5, rack);
    if (toViewer < 1) {
      withBlur(L, uiBlur, (Lx) => {
        camera(Lx, cx, cy, z);
        neonFrame(Lx, frameP, { intensity: 1, sweep: prog(t, IMPACT, IMPACT + 1.2), fillAlpha: 1, zoom: z });
        pixelBuild(Lx, imgProjects, shotP, t, P.build[0], P.build[1] - P.build[0], { cell: 26, radius: 22 });
        if (t > P.build[1]) clearGlow(Lx, shotP);
      });
      camera(L, cx, cy, z);
      // headline rises out from behind the frame's top edge (masked by the UI),
      // riding the camera at 0.85 parallax
      {
        const c = L.c;
        const words = P.headline;
        const rise = (i) => outExpo(prog(t, P.headlineAt + i * 0.12, P.headlineAt + 0.55 + i * 0.12));
        c.save();
        c.beginPath();
        c.rect(0, frameP.y - 200, 1920, 200 - 6); // everything above the frame edge
        c.clip();
        const fullW = (() => {
          c.font = `600 76px ${DISPLAY}`;
          c.letterSpacing = `${-0.03 * 76}px`;
          return c.measureText(words.map((w) => w[0]).join('')).width;
        })();
        let x = 960 - fullW / 2;
        words.forEach(([w, blue], i) => {
          c.font = `600 76px ${DISPLAY}`;
          c.letterSpacing = `${-0.03 * 76}px`;
          const yy = frameP.y - 66 + (1 - rise(i)) * 110;
          keyLine(c, [[w, blue]], x, yy, { size: 76, weight: 600, align: 'left', tracking: -0.03, alpha: lerp(1, 0.55, rack), blur: headBlur });
          x += c.measureText(w).width;
        });
        c.restore();
      }
      // highlight ring on the clicked card
      if (t > P.click - 0.3) {
        const c0 = inShot(shotP, imgProjects, 55, 735);
        const c1 = inShot(shotP, imgProjects, 405, 1030);
        const hb = { x: c0[0], y: c0[1], w: c1[0] - c0[0], h: c1[1] - c0[1], r: 18 };
        neonFrame(L, hb, { intensity: smooth(prog(t, P.click - 0.3, P.click)), fillAlpha: 0, stroke: 2, sweep: prog(t, P.click, P.click + 0.6) });
      }
      // the cursor finds the card
      const cp = cursorPath(
        [
          [P.cursorIn, 1500, 1000],
          [P.click - 0.15, card[0] + 10, card[1] + 6],
          [P.zoom[1], card[0] + 10, card[1] + 6],
        ],
        t,
      );
      cursor(L, cp[0], cp[1], { press: press(t, P.click), ripple: ripple(t, P.click), alpha: smooth(prog(t, P.cursorIn, P.cursorIn + 0.2)) * (1 - zk), scale: 1 / Math.max(1, z * 0.8) * 1.0 });
      // edge flash on the hit
      L.g.save();
      L.g.setTransform(1, 0, 0, 1, 0, 0);
      // edge flash on the hit: the frame's border flares, not the whole screen
      L.g.globalAlpha = 1;
      L.g.setTransform(1, 0, 0, 1, 0, 0);
      const fl = Math.exp(-Math.max(0, t - IMPACT) * 10) * (t >= IMPACT ? 1 : 0);
      if (fl > 0.01) {
        camera(L, cx, cy, z);
        L.g.globalAlpha = fl;
        rr(L.g, frameP.x, frameP.y, frameP.w, frameP.h, frameP.r);
        L.g.lineWidth = 40 / Math.max(1, z * 0.5);
        L.g.strokeStyle = '#9fb8ff';
        L.g.stroke();
      }
      L.g.restore();
    }
    if (toViewer > 0) {
      // the viewer, playing a portrait video (real screenshot), grows out of the card
      const pc = projCam(HANDOFF);
      const a = cardA();
      const b = cardB();
      const scr = (p) => [(p[0] - pc.cx) * pc.z + 960, (p[1] - pc.cy) * pc.z + 540];
      const sa = scr(a);
      const sb = scr(b);
      const s0 = (sb[0] - sa[0]) / frameV.w;
      const sc = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2];
      const fc = [frameV.x + frameV.w / 2, frameV.y + frameV.h / 2];
      const k = outExpo(prog(t, HANDOFF, HANDOFF + 0.5));
      const vz = lerp(s0, 1, k);
      const c0 = [fc[0] - (sc[0] - 960) / s0, fc[1] - (sc[1] - 540) / s0];
      camera(L, lerp(c0[0], 960, k), lerp(c0[1], 560, k), vz);
      neonFrame(L, frameV, { intensity: 1, sweep: prog(t, HANDOFF + 0.2, HANDOFF + 1.6), zoom: vz });
      L.c.save();
      rr(L.c, shotV.x, shotV.y, shotV.w, shotV.h, shotV.r);
      L.c.clip();
      L.c.drawImage(viewer, shotV.x, shotV.y, shotV.w, shotV.h);
      L.c.restore();
      clearGlow(L, shotV);
      playBar(L, t);
      L.c.globalAlpha = 1;
      L.g.globalAlpha = 1;
      // cursor presses play
      const play = inShot(shotV, viewer, 448, 388);
      const cp = cursorPath(
        [
          [P.zoom[1], 1300, 900],
          [P.play - 0.12, play[0] + 4, play[1] + 4],
          [P.play + 0.5, play[0] + 4, play[1] + 4],
          [S.share.pop - 0.25, 1500, 260],
        ],
        t,
      );
      if (t < S.share.pop) cursor(L, cp[0], cp[1], { press: press(t, P.play), ripple: ripple(t, P.play), alpha: toViewer });
    }
    screen(L);
    const hl = P.headline.map((p) => p[0]).join('');
    const vl = P.viewerLine.map((p) => p[0]).join('');
    void hl;
    if (toViewer >= 0.5) {
      keyLine(L.c, P.viewerLine, 960, 150, { size: 64, weight: 600, chars: typed(vl, t, P.viewerLineAt, 34), caret: t < P.viewerLineAt + 1.0, caretOn: caretOn(t) });
      viewfinder(L, t, { label: 'A001_C007_lake-vertical.mp4', res: '1080×1920 · 24p' });
    } else {
      viewfinder(L, t, { label: 'harbor-lights / projects', alpha: smooth(prog(t, IMPACT + 0.3, IMPACT + 0.6)), res: '1920×1080 · 24p' });
    }
  }

  function playBar(L, t) {
    const P = S.projects;
    const p = clamp((t - P.play) / 5);
    const playing = t >= P.play;
    const a = inShot(shotV, viewer, 446, 612);
    const b = box(a[0], a[1], 380, 64, 32);
    const c = L.c;
    c.save();
    rr(c, b.x, b.y, b.w, b.h, b.r);
    c.fillStyle = 'rgba(10,14,26,0.82)';
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(111,149,255,0.7)';
    c.stroke();
    c.fillStyle = '#ffffff';
    const px = b.x + 34;
    const py = b.y + b.h / 2;
    if (playing) {
      c.fillRect(px - 8, py - 11, 6, 22);
      c.fillRect(px + 4, py - 11, 6, 22);
    } else {
      c.beginPath();
      c.moveTo(px - 7, py - 12);
      c.lineTo(px + 11, py);
      c.lineTo(px - 7, py + 12);
      c.closePath();
      c.fill();
    }
    const secs = Math.floor(p * 5);
    c.font = `500 18px ${SANS}`;
    c.textBaseline = 'middle';
    c.fillText(`00:0${secs}`, px + 30, py + 1);
    c.fillStyle = GREY;
    c.fillText('/ 00:05', px + 84, py + 1);
    const x0 = px + 160;
    const x1 = b.x + b.w - 28;
    rr(c, x0, py - 3, x1 - x0, 6, 3);
    c.fillStyle = 'rgba(255,255,255,0.15)';
    c.fill();
    const xe = lerp(x0, x1, p);
    rr(c, x0, py - 3, Math.max(6, xe - x0), 6, 3);
    c.fillStyle = BLUE_HI;
    c.fill();
    c.beginPath();
    c.arc(xe, py, 8, 0, Math.PI * 2);
    c.fillStyle = '#fff';
    c.fill();
    c.restore();
    neonFrame(L, b, { fillAlpha: 0, intensity: 0.6, stroke: 1.5 });
  }

  function share(L, t) {
    const Sh = S.share;
    const slide = inOutExpo(prog(t, Sh.slide[0], Sh.slide[1]));
    // the viewer stays behind, then slides out left as the client page slides in
    // dive into the popover while the link is made, pull back for the client page
    const btn0 = inShot(shotV, viewer, 1034, 38);
    const dk = inOutExpo(prog(t, Sh.pop + 0.15, Sh.pop + 0.7)) * (1 - inOutExpo(prog(t, Sh.copyAt + 0.35, Sh.slide[0] + 0.1)));
    let camZ = lerp(1, 1.3, dk);
    let camX = lerp(960, btn0[0] - 100, dk) + slide * 1500;
    let camY = lerp(560, btn0[1] + 210, dk);
    if (loopDive > 0) {
      // loop seam: dive into the link pill's right end cap; its arc becomes the
      // app frame's corner at the start of the loop (the same scale match as 7.04 s)
      const pbx = btn0[0] - 330;
      const pby = btn0[1] + 40;
      const arcX = pbx + 28 + (460 - 56) - 26;
      const arcY = pby + 336 + 26;
      const zc = (capR * 46) / 26;
      const aim = inOutCubic(Math.min(1, loopDive * 1.6));
      camX = lerp(camX, arcX + 0.3 * 26, aim);
      camY = lerp(camY, arcY - 0.3 * 26, aim);
      camZ = camZ * Math.pow(zc / camZ, inExpo(loopDive));
    }
    camera(L, camX, camY, camZ);
    const diveAway = 1 - smooth(prog(loopDive, 0, 0.35));
    neonFrame(L, frameV, { intensity: 0.7 });
    L.c.save();
    rr(L.c, shotV.x, shotV.y, shotV.w, shotV.h, shotV.r);
    L.c.clip();
    L.c.drawImage(viewer, shotV.x, shotV.y, shotV.w, shotV.h);
    L.c.fillStyle = `rgba(0,0,0,${0.55 * smooth(prog(t, Sh.pop, Sh.pop + 0.3))})`;
    L.c.fillRect(shotV.x, shotV.y, shotV.w, shotV.h);
    L.c.restore();
    // the share popover, under the viewer's real Share button (wording from the real dialog)
    const shareBtn = inShot(shotV, viewer, 1034, 38);
    const pk = outBack(prog(t, Sh.pop, Sh.pop + 0.35), 1.4);
    const pb = { x: shareBtn[0] - 330, y: shareBtn[1] + 40, w: 460, h: 420, r: 24 };
    if (pk > 0) {
      const c = L.c;
      const s = clamp(pk, 0, 1.1);
      const ox = pb.x + pb.w - 60;
      const oy = pb.y;
      c.save();
      L.g.save();
      for (const ctx of [c, L.g]) {
        ctx.translate(ox, oy);
        ctx.scale(s, s);
        ctx.translate(-ox, -oy);
      }
      neonFrame(L, pb, { intensity: diveAway, sweep: prog(t, Sh.pop, Sh.pop + 1.0), fillAlpha: 1 });
      c.textBaseline = 'middle';
      c.font = `600 26px ${SANS}`;
      c.fillStyle = '#fff';
      c.fillText('Share file', pb.x + 28, pb.y + 42);
      c.font = `600 13px ${SANS}`;
      c.fillStyle = GREY;
      c.fillText('ACCESS MODE', pb.x + 28, pb.y + 86);
      const pubOn = t >= Sh.publicAt;
      const opt = (x, label, sub, on) => {
        rr(c, x, pb.y + 102, 192, 74, 14);
        c.fillStyle = on ? 'rgba(61,108,255,0.22)' : 'rgba(255,255,255,0.04)';
        c.fill();
        c.lineWidth = on ? 2 : 1;
        c.strokeStyle = on ? BLUE_HI : 'rgba(255,255,255,0.18)';
        c.stroke();
        c.font = `600 18px ${SANS}`;
        c.fillStyle = '#fff';
        c.fillText(label, x + 16, pb.y + 126);
        c.font = `400 12px ${SANS}`;
        c.fillStyle = GREY;
        c.fillText(sub, x + 16, pb.y + 152);
      };
      opt(pb.x + 28, 'Public', 'Anyone with the link', pubOn);
      opt(pb.x + 240, 'Private', 'Needs the access code', false);
      c.font = `600 13px ${SANS}`;
      c.fillStyle = GREY;
      c.fillText('EXPIRES', pb.x + 28, pb.y + 202);
      ['24 hours', '7 days', 'Never'].forEach((e, i) => {
        const x = pb.x + 28 + i * 136;
        rr(c, x, pb.y + 216, 124, 40, 20);
        c.fillStyle = i === 0 ? 'rgba(61,108,255,0.22)' : 'rgba(255,255,255,0.04)';
        c.fill();
        c.lineWidth = 1;
        c.strokeStyle = i === 0 ? BLUE_HI : 'rgba(255,255,255,0.18)';
        c.stroke();
        c.font = `500 16px ${SANS}`;
        c.fillStyle = '#fff';
        c.textAlign = 'center';
        c.fillText(e, x + 62, pb.y + 237);
        c.textAlign = 'left';
      });
      // Create link -> the link pill types out -> copied
      const created = t >= Sh.createAt;
      const btn = box(pb.x + pb.w - 110, pb.y + 300, 168, 48, 24);
      if (!created || t < Sh.createAt + 0.15) {
        glossyPill(L, btn, { label: 'Create link', size: 18, weight: 600, press: press(t, Sh.createAt), intensity: 0.7 });
      }
      if (created) {
        const lk = outExpo(prog(t, Sh.createAt + 0.05, Sh.createAt + 0.3));
        const lb = { x: pb.x + 28, y: pb.y + 336, w: (pb.w - 56) * lk, h: 52, r: 26 };
        rr(c, lb.x, lb.y, lb.w, lb.h, lb.r);
        c.fillStyle = 'rgba(14,20,36,0.95)';
        c.fill();
        neonFrame(L, lb, { fillAlpha: 0, intensity: 0.9, stroke: 1.6, zoom: camZ });
        const n = typed(Sh.link, t, Sh.linkType, 46);
        c.save();
        rr(c, lb.x, lb.y, lb.w, lb.h, lb.r);
        c.clip();
        c.globalAlpha = diveAway;
        // the full link must fit left of the copy button: shrink the type if needed
        c.font = `500 16px ${SANS}`;
        const room = pb.w - 56 - 20 - 62;
        const fs = Math.max(12, Math.min(16, (16 * room) / c.measureText(Sh.link).width));
        c.font = `500 ${fs.toFixed(2)}px ${SANS}`;
        c.fillStyle = '#dfe7ff';
        c.fillText(Sh.link.slice(0, n), lb.x + 20, lb.y + 27);
        c.restore();
        // copy button and the copied flash
        const copied = t >= Sh.copyAt;
        const cb = box(lb.x + (pb.w - 56) - 30, lb.y + 26, 40, 40, 12);
        c.save();
        c.globalAlpha = diveAway;
        rr(c, cb.x, cb.y, cb.w, cb.h, cb.r);
        c.fillStyle = copied ? BLUE : 'rgba(255,255,255,0.08)';
        c.fill();
        c.strokeStyle = '#fff';
        c.lineWidth = 2;
        rr(c, cb.x + 11, cb.y + 13, 14, 16, 3);
        c.stroke();
        rr(c, cb.x + 16, cb.y + 9, 14, 16, 3);
        c.stroke();
        if (copied) {
          const ck = outBack(prog(t, Sh.copyAt, Sh.copyAt + 0.3), 2);
          const tb = box(cb.x + 20, lb.y - 34, 120 * clamp(ck, 0, 1.2), 40, 20);
          glossyPill(L, tb, { label: ck > 0.6 ? 'Copied' : '', size: 18, weight: 600, alpha: diveAway });
        }
        c.restore();
      }
      c.restore();
      L.g.restore();
    }
    // the cursor: Share button, Public, Create link, copy
    const pubPt = [pb.x + 28 + 96, pb.y + 140];
    const createPt = [pb.x + pb.w - 110, pb.y + 300];
    const copyPt = [pb.x + pb.w - 58, pb.y + 362];
    const cp = cursorPath(
      [
        [Sh.pop - 0.25, 1500, 260],
        [Sh.pop - 0.05, shareBtn[0], shareBtn[1] + 4],
        [Sh.publicAt - 0.18, pubPt[0], pubPt[1]],
        [Sh.createAt - 0.18, createPt[0], createPt[1]],
        [Sh.copyAt - 0.15, copyPt[0], copyPt[1]],
        [Sh.slide[0], copyPt[0] + 160, copyPt[1] + 200],
      ],
      t,
    );
    const pr = Math.max(press(t, Sh.publicAt), press(t, Sh.createAt), press(t, Sh.copyAt), press(t, Sh.pop));
    const rp = [Sh.copyAt, Sh.createAt, Sh.publicAt, Sh.pop].find((a) => t >= a);
    cursor(L, cp[0], cp[1], { press: pr, ripple: rp ? ripple(t, rp) : -1, alpha: (1 - slide) * diveAway });
    // the client's view slides in: the real share page
    if (slide > 0) {
      const fx = 1500;
      const fb = { ...frameV, x: frameV.x + fx };
      const sb = { ...shotS, x: shotS.x + fx };
      neonFrame(L, fb, { intensity: 1, sweep: prog(t, Sh.slide[1], Sh.slide[1] + 0.9) });
      L.c.save();
      rr(L.c, sb.x, sb.y, sb.w, sb.h, sb.r);
      L.c.clip();
      L.c.drawImage(sharepage, sb.x, sb.y, sb.w, sb.h);
      L.c.restore();
      clearGlow(L, sb);
      // label chip
      L.c.save();
      L.c.globalAlpha = smooth(prog(t, Sh.slide[1], Sh.slide[1] + 0.3));
      const lb = box(fb.x + fb.w / 2, fb.y - 34, 210, 38, 19);
      rr(L.c, lb.x, lb.y, lb.w, lb.h, lb.r);
      L.c.fillStyle = 'rgba(61,108,255,0.2)';
      L.c.fill();
      L.c.strokeStyle = BLUE_HI;
      L.c.lineWidth = 1.2;
      L.c.stroke();
      L.c.font = `500 17px ${SANS}`;
      L.c.textAlign = 'center';
      L.c.textBaseline = 'middle';
      L.c.fillStyle = '#e4ebff';
      L.c.fillText('Your client’s view', lb.x + lb.w / 2, lb.y + lb.h / 2 + 1);
      L.c.restore();
    }
    screen(L);
    const full = Sh.line.map((p) => p[0]).join('');
    keyLine(L.c, Sh.line, 960 - slide * 120, 150, { size: 64, weight: 600, chars: typed(full, t, Sh.lineAt, 34), caret: t < Sh.lineAt + 1.1, caretOn: caretOn(t), alpha: diveAway });
    viewfinder(L, t, { label: slide > 0.5 ? 'share / client page' : 'share / public link', res: '1920×1080 · 24p', alpha: diveAway });
  }

  function pills(L, t) {
    const Pl = S.pills;
    let idx = 0;
    while (idx < Pl.words.length - 1 && t >= Pl.words[idx + 1][1]) idx++;
    const [word, at] = Pl.words[idx];
    const pop = outBack(prog(t, at, at + 0.35), 2.0);
    // each pill arrives with a small tilt of the camera, alternating
    const drift = idx % 2 === 0 ? 1 : -1;
    camera(L, 960 + drift * 30 * (1 - outExpo(prog(t, at, at + 0.6))), 540, lerp(1.06, 1, outExpo(prog(t, at, at + 0.6))));
    const w = 240 + word.length * 100;
    const b = box(960, 540, w * clamp(pop, 0.2, 1.2), 250 * clamp(pop, 0.3, 1.1), 54);
    const clicked = idx === 2 && t >= Pl.click;
    if (clicked) {
      // an outline grows around the pressed pill
      const ok = outExpo(prog(t, Pl.click, Pl.click + 0.5));
      const ob = box(960, 540, w + 140 * ok, 250 + 120 * ok, 54 + 30 * ok);
      neonFrame(L, ob, { fillAlpha: 0.6 * ok, intensity: ok, stroke: 2 });
    }
    glossyPill(L, b, { label: word, size: 150, weight: 700, press: press(t, Pl.click), intensity: 1 });
    halo(L, 960, 540, 520, 0.3);
    if (idx === 2) {
      const cp = cursorPath(
        [
          [at, 1500, 900],
          [Pl.click - 0.15, 960 + w / 2 - 50, 580],
          [S.ring.toRect[0], 960 + w / 2 - 50, 580],
        ],
        t,
      );
      cursor(L, cp[0], cp[1], { press: press(t, Pl.click), ripple: ripple(t, Pl.click), scale: 1.6 });
    }
  }

  function ring(L, t) {
    const R = S.ring;
    camera(L, 960, 540, lerp(1, 1.04, smooth(prog(t, R.toRect[0], R.out))));
    const w0 = 240 + 'Share'.length * 100;
    const pill = box(960, 540, w0 + 140, 370, 84);
    const rect = box(960, 540, 1000, 380, 70);
    const circ = box(960, 540, 840, 840, 420);
    const k1 = inOutExpo(prog(t, R.toRect[0], R.toRect[1]));
    const k2 = inOutExpo(prog(t, R.toRing[0], R.toRing[1]));
    const b = k2 > 0 ? mixBox(rect, circ, k2) : mixBox(pill, rect, k1);
    const out = smooth(prog(t, R.out - 0.2, R.out + 0.15));
    // the ring is drawn as glowing arcs with gaps, slowly turning
    if (k2 >= 1) {
      const rot = (t - R.toRing[1]) * 0.5;
      const r = 420 * (1 - out * 0.4);
      for (const [ctx, lw, col, a] of [
        [L.c, 3, '#7ea0ff', 1],
        [L.g, 12, BLUE, 0.9],
      ]) {
        ctx.save();
        ctx.globalAlpha = a * (1 - out);
        ctx.lineWidth = lw;
        ctx.strokeStyle = col;
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const s0 = rot + (i * Math.PI) / 3 + 0.12;
          ctx.beginPath();
          ctx.arc(960, 540, r, s0, s0 + (Math.PI / 3) * (0.72 + 0.1 * Math.sin(t * 2 + i)));
          ctx.stroke();
        }
        ctx.restore();
      }
    } else {
      neonFrame(L, b, { fillAlpha: 0.5, intensity: 1, stroke: 3, sweep: prog(t, R.toRect[1], R.toRect[1] + 1.2) });
    }
    halo(L, 960, 540, 600, 0.2 * (1 - out));
    screen(L);
    const a = 1 - out;
    if (k2 < 0.4) {
      const ta = smooth(prog(t, R.toRect[1] - 0.1, R.toRect[1] + 0.25)) * (1 - smooth(prog(k2, 0, 0.4)));
      keyLine(L.c, R.rect, 960, 540, { size: 88, weight: 600, alpha: ta });
    } else {
      keyLine(L.c, R.line1, 960, 476, { size: 76, weight: 500, alpha: smooth(prog(k2, 0.5, 1)) * a });
      const l2 = smooth(prog(t, R.line2At, R.line2At + 0.3));
      L.c.save();
      L.c.translate(0, (1 - l2) * 16);
      keyLine(L.c, R.line2, 960, 574, { size: 76, weight: 600, alpha: l2 * a });
      L.c.restore();
      // small cycling text: where it runs
      const c = L.c;
      c.save();
      c.font = `500 28px ${MONO}`;
      c.textBaseline = 'middle';
      const parts = R.cycle;
      const sep = '  ·  ';
      const total = c.measureText(parts.join(sep)).width;
      let x = 960 - total / 2;
      const active = Math.floor((t - R.cycleAt) / (BEAT / 2));
      parts.forEach((p, i) => {
        const on = t >= R.cycleAt && active % parts.length === i;
        c.globalAlpha = a * smooth(prog(t, R.cycleAt - 0.3, R.cycleAt));
        c.fillStyle = on ? BLUE_HI : GREY;
        c.fillText(p, x, 690);
        x += c.measureText(p).width;
        if (i < parts.length - 1) {
          c.fillStyle = GREY;
          c.fillText(sep, x, 690);
          x += c.measureText(sep).width;
        }
      });
      c.restore();
    }
  }

  function tiles(L, t) {
    const T = S.tiles;
    camera(L, 960, 540, 1);
    const n = T.kinds.length;
    const sw = inExpo(prog(t, T.swirl[0], T.swirl[1]));
    const col = inExpo(prog(t, T.collapse[0], T.collapse[1]));
    T.kinds.forEach((kind, i) => {
      const enter = outExpo(prog(t, T.in + i * 0.06, T.in + 0.5 + i * 0.06));
      const base = (i / n) * Math.PI * 2 + 0.4;
      const ang = base + sw * Math.PI * 2.2 + (t - T.in) * 0.35;
      const rad = lerp(lerp(420, 250, enter), 0, col) * (1 + 0.08 * Math.sin(t * 1.3 + i));
      const depth = 0.75 + 0.35 * hash(i * 3.3);
      const x = 960 + Math.cos(ang) * rad * 1.2;
      const y = 540 + Math.sin(ang) * rad * 0.62 + (1 - enter) * 120;
      const size = lerp(220 * depth, 80, col);
      iconTile(L, x, y, size, kind, { alpha: enter * (1 - smooth(prog(col, 0.85, 1))) });
    });
    halo(L, 960, 540, 380, 0.5 * col);
    if (t > T.collapse[1] - 0.08) {
      mark(L, 960, 540, 200, { glow: 1 });
    }
  }

  function lock(L, t) {
    const K = S.lock;
    screen(L);
    // dot-matrix echo of the intro on the sides, fading
    const dm = 1 - smooth(prog(t, K.glow[0], K.shrink[1] + 0.4));
    dotMatrix(L, 0, 160, 520, 760, t, { alpha: 0.5 * dm });
    dotMatrix(L, 1400, 160, 520, 760, t, { alpha: 0.5 * dm, from: 'right', seed: 7 });
    const gk = Math.exp(-Math.max(0, t - K.glow[0]) * 3.2);
    const sh = inOutExpo(prog(t, K.shrink[0], K.shrink[1]));
    // final lockup: mark + wordmark (exact proportions of logo-on-dark.svg), centred
    const mSize = lerp(240, 128, sh);
    const wmH = (250 / 180) * mSize; // wordmark slice height in mark units
    const wmW = (wordmark.width / wordmark.height) * wmH;
    const gap = (236 - 200) / 180 * mSize; // svg gap between mark and words
    const total = mSize + gap + wmW * ((1294 - 236) / (1314.2 - 230));
    const markX = lerp(960, 960 - total / 2 + mSize / 2, sh);
    const markY = lerp(540, 470, sh);
    mark(L, markX, markY, mSize, { glow: 0.25 + 0.75 * gk });
    halo(L, markX, markY, 260, 0.6 * gk);
    // wordmark slides out from behind the mark
    const wk = outExpo(prog(t, K.wordmark[0], K.wordmark[1]));
    if (wk > 0) {
      const c = L.c;
      const x0 = markX + mSize / 2 + gap - ((236 - 230) / 180) * mSize;
      const reveal = wmW * wk;
      c.save();
      c.beginPath();
      c.rect(markX + mSize / 2 + 2, markY - wmH, reveal + gap + 40, wmH * 2);
      c.clip();
      c.globalAlpha = smooth(wk);
      c.drawImage(wordmark, x0 - (1 - wk) * 60, markY - wmH / 2, wmW, wmH);
      c.restore();
    }
    const full = K.line.map((p) => p[0]).join('');
    const cps = full.length / Math.max(0.3, K.still - 0.05 - K.lineAt);
    keyLine(L.c, K.line, 960, 610, { size: 40, weight: 500, chars: typed(full, t, K.lineAt, cps) });
    L.c.save();
    L.c.globalAlpha = smooth(prog(t, K.urlAt, K.urlAt + 0.2));
    L.c.font = `500 26px ${SANS}`;
    L.c.textAlign = 'center';
    L.c.textBaseline = 'middle';
    L.c.fillStyle = GREY;
    L.c.fillText(K.url, 960, 676);
    L.c.restore();
  }

  // ------------------------------------------------------------ frame
  /** Paints time t. Returns compositor settings for this frame. */
  let loopDive = 0;
  /**
   * The README loop (8 s): the film from 7.04 s, ending in a dive into the
   * link pill's end cap whose arc matches the frame corner the loop starts on.
   */
  function drawLoop(L, u) {
    const DIVE = 0.5;
    const LEN = 8;
    const start = IMPACT;
    if (u < LEN - DIVE) {
      loopDive = 0;
      return draw(L, start + u);
    }
    loopDive = clamp((u - (LEN - DIVE)) / (DIVE - 1 / 24)); // reaches 1 on the last frame
    const r = draw(L, start + (LEN - DIVE) + (u - (LEN - DIVE)) * 0.25);
    loopDive = 0;
    return r;
  }

  function draw(L, t) {
    for (const ctx of [L.c, L.g]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    L.c.fillStyle = '#010205';
    L.c.fillRect(0, 0, W, H);
    L.g.clearRect(0, 0, W, H);
    L.g.fillStyle = '#000';
    L.g.fillRect(0, 0, W, H);

    let flash = 0;
    if (t < S.intro.out) intro(L, t);
    else if (t < IMPACT) upload(L, t);
    else if (t < S.share.pop) projects(L, t);
    else if (t < S.pills.words[0][1]) share(L, t);
    else if (t < S.ring.toRect[0]) pills(L, t);
    else if (t < S.ring.out) ring(L, t);
    else if (t < LOCK_HIT) tiles(L, t);
    else lock(L, t);
    // the viewfinder frames the quieter scenes too; it bows out for the logo hold
    const vfQuiet = t < S.intro.out || t >= S.pills.words[0][1];
    if (vfQuiet) viewfinder(L, t, { alpha: t >= LOCK_HIT ? 1 - smooth(prog(t, LOCK_HIT, LOCK_HIT + 0.5)) : 0.85, res: '1920×1080 · 24p' });
    if (t >= IMPACT) flash += 0.12 * Math.exp(-(t - IMPACT) * 12);
    if (t >= LOCK_HIT) flash += 0.08 * Math.exp(-(t - LOCK_HIT) * 10);
    // pixel dissolve texture on the two hard cuts
    for (const cut of [S.pills.words[0][1], S.ring.out]) {
      const k = 0.62 * (1 - prog(Math.abs(t - cut), 0, 0.2));
      if (k > 0) pixelDissolve(L, t, k);
    }
    // the hook: never a black first frame
    const fade = lerp(0.6, 1, outCubic(prog(t, 0, 0.15)));
    return { flash, fade };
  }

  function pixelDissolve(L, t, k) {
    const cell = 24;
    const c = L.c;
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const n = hash(x * 0.37 + y * 1.91 + Math.floor(t * 30));
        if (n > k) continue;
        c.fillStyle = n < k * 0.12 ? 'rgba(61,108,255,0.8)' : 'rgba(0,0,0,0.95)';
        c.fillRect(x, y, cell - 2, cell - 2);
      }
    }
  }

  return { draw, drawLoop };
}
