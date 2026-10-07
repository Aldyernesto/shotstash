// v2 thumbnail / poster: a composed frame in the trailer's language (pure
// black, neon-edged app frame with the real Projects UI, glossy pill and
// cursor, Inter Tight headline with the key words in blue). Variants a, b, c.

import { clearGlow, rr, box, neonFrame, borderSweep, glossyPill, keyLine, cursor, dotMatrix, halo, BLUE_HI, DISPLAY, SANS } from './draw.js';

function chip(L, x, y, label) {
  const c = L.c;
  c.save();
  c.font = `500 30px ${SANS}`;
  const w = c.measureText(label).width + 56;
  const b = { x, y, w, h: 56, r: 28 };
  rr(c, b.x, b.y, b.w, b.h, b.r);
  c.fillStyle = 'rgba(61,108,255,0.14)';
  c.fill();
  c.restore();
  neonFrame(L, b, { fillAlpha: 0, intensity: 0.8, stroke: 1.5 });
  c.save();
  c.font = `500 30px ${SANS}`;
  c.fillStyle = '#e6ecff';
  c.textBaseline = 'middle';
  c.fillText(label, x + 28, y + 29);
  c.restore();
}

function appFrame(L, img, cx, cy, w, sweep) {
  const ih = ((w - 40) * img.height) / img.width;
  const f = box(cx, cy, w, ih + 40, 34);
  neonFrame(L, f, { intensity: 1, sweep, sweepLen: 0.22 });
  const c = L.c;
  c.save();
  rr(c, f.x + 20, f.y + 20, w - 40, ih, 22);
  c.clip();
  c.drawImage(img, f.x + 20, f.y + 20, w - 40, ih);
  c.restore();
  clearGlow(L, { x: f.x + 20, y: f.y + 20, w: w - 40, h: ih, r: 22 });
  return f;
}

const VARIANTS = {
  a: (L, A) => {
    dotMatrix(L, 0, 80, 360, 920, 1.3, { alpha: 0.35 });
    halo(L, 1330, 470, 700, 0.8);
    const f = appFrame(L, A.projects, 1330, 450, 840, 0.08);
    glossyPill(L, box(f.x + 200, f.y + f.h + 10, 360, 96, 48), { label: '+  New Project', size: 38, weight: 600, intensity: 1.2 });
    cursor(L, f.x + 330, f.y + f.h + 40, { ripple: 0.35, scale: 1.7 });
    chip(L, 120, 300, 'Open source · MIT');
    keyLine(L.c, [['Your own', false]], 112, 470, { size: 136, weight: 700, align: 'left', tracking: -0.035 });
    keyLine(L.c, [['media cloud', true]], 112, 610, { size: 136, weight: 700, align: 'left', tracking: -0.035 });
  },
  b: (L, A) => {
    halo(L, 960, 640, 800, 0.8);
    const f = appFrame(L, A.projects, 960, 760, 1180, 0.9);
    void f;
    chip(L, 960 - 160, 70, 'Open source · MIT');
    keyLine(L.c, [['Your own ', false], ['media cloud', true]], 960, 230, { size: 120, weight: 700, tracking: -0.035 });
  },
  c: (L, A) => {
    dotMatrix(L, 1500, 80, 420, 920, 2.1, { alpha: 0.3, from: 'right' });
    halo(L, 1300, 520, 600, 0.9);
    const f = appFrame(L, A.viewer, 1290, 470, 860, 0.3);
    void f;
    chip(L, 120, 300, 'Open source · MIT');
    keyLine(L.c, [['Self-host', false]], 112, 470, { size: 136, weight: 700, align: 'left', tracking: -0.035 });
    keyLine(L.c, [['your footage', true]], 112, 610, { size: 136, weight: 700, align: 'left', tracking: -0.035 });
  },
};

export function composeThumb(tr, key = 'a') {
  const { L, comp, assets } = tr;
  comp.frame(1, () => {
    for (const ctx of [L.c, L.g]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }
    L.c.fillStyle = '#010205';
    L.c.fillRect(0, 0, 1920, 1080);
    L.g.fillStyle = '#000';
    L.g.fillRect(0, 0, 1920, 1080);
    (VARIANTS[key] ?? VARIANTS.a)(L, assets);
    void borderSweep;
    void BLUE_HI;
    void DISPLAY;
    return { bloom: 0.75 };
  });
}
