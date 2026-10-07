// Procedural soundtrack: pure function, no samples, no licences. Runs in Node
// (audio.mjs writes a WAV) and in the browser (the playable page). Every event
// comes from timeline.js, so it follows the picture's beat grid.

import { DURATION, BEAT, GRID_ANCHOR, IMPACT, LOCK_HIT, cues } from './timeline.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  };
}

/** Biquad (RBJ) coefficients. */
function biquad(type, f, q, fs, gainDb = 0) {
  const w = (2 * Math.PI * f) / fs;
  const c = Math.cos(w);
  const s = Math.sin(w);
  const al = s / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else { // high shelf
    const sq = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) + (A - 1) * c + sq); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sq);
    a0 = (A + 1) - (A - 1) * c + sq; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sq;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function filter(x, co) {
  const [b0, b1, b2, a1, a2] = co;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** BS.1770 integrated loudness (K-weighting, 400 ms blocks, gating). */
export function loudness(left, right, fs) {
  const shelf = biquad('shelf', 1681.97, 0.7072, fs, 4.0);
  const hp = biquad('hp', 38.13, 0.5003, fs);
  const kl = filter(filter(left, shelf), hp);
  const kr = filter(filter(right, shelf), hp);
  const block = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  const z = [];
  for (let s = 0; s + block <= kl.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + block; i++) e += kl[i] * kl[i] + kr[i] * kr[i];
    z.push(e / block);
  }
  const L = (p) => -0.691 + 10 * Math.log10(p);
  const abs = z.filter((p) => L(p) > -70);
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((p) => L(p) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

export function synthesize({ sampleRate = 48000, targetLufs = -14, ceilingDb = -1.6 } = {}) {
  const fs = sampleRate;
  const N = Math.round(DURATION * fs);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const noise = rng(7);
  const cue = cues();
  const { whooshes } = cue;
  const hits = [...cue.hits, ...cue.clicks.map((t) => ({ t, kind: 'tick' })), ...cue.ticks.map((t) => ({ t, kind: 'tick' }))];
  const RISER = cue.riser;

  const add = (i, l, r = l) => {
    if (i >= 0 && i < N) { L[i] += l; R[i] += r; }
  };

  // ---- drone bed: low fifths, slow filter breathing, swells into the lock
  {
    const dr = new Float32Array(N);
    const notes = [36.71, 55.0, 73.42]; // D1, A1, D2
    for (let i = 0; i < N; i++) {
      const t = i / fs;
      let v = 0;
      for (let k = 0; k < notes.length; k++) {
        const f = notes[k] * (1 + 0.0015 * Math.sin(t * 0.3 + k));
        const ph = 2 * Math.PI * f * t;
        v += (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.18 * Math.sin(3 * ph)) / (k + 1.2);
      }
      const env = Math.min(1, t / 0.25) * (0.55 + 0.25 * Math.sin(t * 0.7)) * (t > 29 ? Math.max(0, 30 - t) : 1);
      dr[i] = v * env * 0.12;
    }
    const f = filter(dr, biquad('lp', 380, 0.7, fs));
    for (let i = 0; i < N; i++) add(i, f[i], f[i] * 0.97);
  }

  // ---- pulse: soft kick on the beat grid from the build on, stronger in the features
  {
    const first = GRID_ANCHOR - Math.floor((GRID_ANCHOR - 3) / BEAT) * BEAT;
    for (let t0 = first; t0 < LOCK_HIT; t0 += BEAT) {
      const inFeatures = t0 >= GRID_ANCHOR - 0.01 && t0 < 21.6;
      const amp = t0 < IMPACT ? 0.25 + 0.35 * ((t0 - 3) / (IMPACT - 3)) : inFeatures ? 0.55 : 0.4;
      if (t0 > IMPACT - 0.4 && t0 < IMPACT + BEAT * 1.5) continue; // the stillness after the slam
      const s0 = Math.round(t0 * fs);
      for (let j = 0; j < fs * 0.35; j++) {
        const t = j / fs;
        const f = 48 + 90 * Math.exp(-t * 28);
        const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * amp * 0.5;
        add(s0 + j, v);
      }
      // offbeat hat in the features
      if (inFeatures) {
        const h0 = Math.round((t0 + BEAT / 2) * fs);
        for (let j = 0; j < fs * 0.05; j++) add(h0 + j, noise() * Math.exp(-j / fs * 90) * 0.035, noise() * Math.exp(-j / fs * 90) * 0.035);
      }
    }
  }

  // ---- whooshes: band-passed noise sweeps peaking on the cut
  for (const w of whooshes) {
    const len = w.kind === 'suck' ? w.len : w.len;
    const start = w.kind === 'whip' ? w.t - len * 0.55 : w.t - (w.kind === 'suck' ? len : 0);
    const n = Math.round(len * fs);
    const buf = new Float32Array(n);
    for (let j = 0; j < n; j++) buf[j] = noise();
    const out = new Float32Array(n);
    // sweep a band-pass by processing short chunks with moving centre frequency
    const chunk = 256;
    let state = [0, 0, 0, 0];
    for (let c0 = 0; c0 < n; c0 += chunk) {
      const u = c0 / n;
      const peakU = w.kind === 'whip' ? 0.55 : w.kind === 'suck' ? 0.97 : 0.3;
      const fc = 300 + 4200 * Math.exp(-Math.pow((u - peakU) / 0.25, 2));
      const [b0, b1, b2, a1, a2] = biquad('bp', fc, 0.9, fs);
      let [x1, x2, y1, y2] = state;
      for (let j = c0; j < Math.min(n, c0 + chunk); j++) {
        const v = b0 * buf[j] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = buf[j]; y2 = y1; y1 = v; out[j] = v;
      }
      state = [x1, x2, y1, y2];
    }
    const s0 = Math.round(start * fs);
    const gain = w.kind === 'whip' ? 0.5 : 0.35;
    for (let j = 0; j < n; j++) {
      const u = j / n;
      const peakU = w.kind === 'whip' ? 0.55 : w.kind === 'suck' ? 0.97 : 0.3;
      const env = u < peakU ? Math.pow(u / peakU, 2.2) : Math.pow(1 - (u - peakU) / (1 - peakU), 1.6);
      const pan = w.kind === 'whip' ? (u - 0.5) * 1.2 : 0;
      add(s0 + j, out[j] * env * gain * (1 - pan * 0.5), out[j] * env * gain * (1 + pan * 0.5));
    }
  }

  // ---- hits
  for (const h of hits) {
    const s0 = Math.round(h.t * fs);
    if (h.kind === 'tick') {
      for (let j = 0; j < fs * 0.12; j++) {
        const t = j / fs;
        add(s0 + j, (Math.sin(2 * Math.PI * 1800 * t) * 0.3 + noise() * 0.2) * Math.exp(-t * 60) * 0.5);
      }
      continue;
    }
    const big = h.kind === 'impact';
    const len = big ? 3.2 : 1.6;
    for (let j = 0; j < fs * len; j++) {
      const t = j / fs;
      const f = (big ? 34 : 42) + (big ? 140 : 110) * Math.exp(-t * 14);
      const body = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * (big ? 2.2 : 4)) * (big ? 1.0 : 0.75);
      const crack = noise() * Math.exp(-t * (big ? 18 : 26)) * (big ? 0.55 : 0.4);
      const tail = noise() * Math.exp(-t * (big ? 1.4 : 2.5)) * 0.05;
      add(s0 + j, body + crack + tail, body + crack * 0.9 + tail);
    }
  }

  // ---- riser into the lock
  {
    const [a, b] = RISER;
    const s0 = Math.round(a * fs);
    const n = Math.round((b - a) * fs);
    for (let j = 0; j < n; j++) {
      const u = j / n;
      const t = j / fs;
      const f = 180 + 900 * u * u;
      const v = Math.sin(2 * Math.PI * f * t * (0.5 + u * 0.5)) * 0.12 + noise() * 0.1 * u;
      add(s0 + j, v * u * u, v * u * u);
    }
  }

  // ---- simple stereo reverb for space (feedback combs)
  {
    const taps = [[0.0297, 0.0371], [0.0411, 0.0437], [0.0533, 0.0479]];
    const wet = 0.18;
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    for (const [dl, drr] of taps) {
      const nl = Math.round(dl * fs);
      const nr = Math.round(drr * fs);
      const bl = new Float32Array(N);
      const br = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        bl[i] = L[i] + (i >= nl ? bl[i - nl] * 0.82 : 0);
        br[i] = R[i] + (i >= nr ? br[i - nr] * 0.82 : 0);
        outL[i] += bl[i];
        outR[i] += br[i];
      }
    }
    const lpL = filter(outL, biquad('lp', 3000, 0.7, fs));
    const lpR = filter(outR, biquad('lp', 3000, 0.7, fs));
    for (let i = 0; i < N; i++) {
      L[i] += lpL[i] * wet * 0.15;
      R[i] += lpR[i] * wet * 0.15;
    }
  }

  // ---- final fade, loudness normalisation, peak limit
  for (let i = 0; i < N; i++) {
    const t = i / fs;
    const g = t > 29 ? Math.max(0, 30 - t) : 1;
    L[i] *= g;
    R[i] *= g;
  }
  // gentle top-end roll-off keeps intersample peaks in check
  {
    const co = biquad('lp', 14000, 0.6, fs);
    L.set(filter(L, co));
    R.set(filter(R, co));
  }
  const lufs = loudness(L, R, fs);
  let gain = Math.pow(10, (targetLufs - lufs) / 20);
  const ceil = Math.pow(10, ceilingDb / 20);
  // soft-knee limiter: tanh above the knee keeps peaks under the ceiling
  for (let i = 0; i < N; i++) {
    L[i] = ceil * Math.tanh((L[i] * gain) / ceil);
    R[i] = ceil * Math.tanh((R[i] * gain) / ceil);
  }
  // one corrective pass after limiting
  const after = loudness(L, R, fs);
  gain = Math.pow(10, (targetLufs - after) / 20);
  if (gain > 1.001 || gain < 0.999) {
    for (let i = 0; i < N; i++) {
      L[i] = ceil * Math.tanh((L[i] * gain) / ceil);
      R[i] = ceil * Math.tanh((R[i] * gain) / ceil);
    }
  }
  return { left: L, right: R, sampleRate: fs, lufs: loudness(L, R, fs) };
}
