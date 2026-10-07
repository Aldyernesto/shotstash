// Entry point. Live player by default; `?render=1` exposes a frame-exact hook
// for render.mjs (no UI, no wall clock).

import { createStory, W, H } from './story.js';
import { createCompositor } from './compositor.js';
import { DURATION, FPS, FAST } from './timeline.js';

const params = new URLSearchParams(location.search);
const renderMode = params.has('render');
const canvas = document.getElementById('c');
const stage = document.getElementById('stage');

function loadImage(url) {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

async function loadFonts() {
  const faces = [
    ['Inter Tight', 'inter-tight-500', '500'],
    ['Inter Tight', 'inter-tight-600', '600'],
    ['Inter Tight', 'inter-tight-700', '700'],
    ['Inter', 'inter-400', '400'],
    ['Inter', 'inter-500', '500'],
    ['JetBrains Mono', 'jetbrains-mono-400', '400'],
    ['JetBrains Mono', 'jetbrains-mono-500', '500'],
  ];
  for (const [family, file, weight] of faces) {
    const f = new FontFace(family, `url(assets/fonts/${file}.woff2)`, { weight });
    await f.load();
    document.fonts.add(f);
  }
  for (const spec of ['600 40px "Inter Tight"', '500 40px "Inter"', '500 40px "JetBrains Mono"']) {
    if (!document.fonts.check(spec)) throw new Error(`font not loaded: ${spec}`);
  }
}

/** The exact brand wordmark, cut from logo-on-dark.svg (words start at x 230). */
async function loadWordmark() {
  const img = await loadImage('assets/logo-on-dark.svg');
  const sx = 230;
  const sw = 1314.2 - sx;
  const scale = 3;
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = 250 * scale;
  c.getContext('2d').drawImage(img, sx, 0, sw, 250, 0, 0, c.width, c.height);
  return c;
}

async function createTrailer({ preserve }) {
  await loadFonts();
  const [projects, viewer, sharepage, wordmark] = await Promise.all([
    loadImage('assets/projects-1280.webp'),
    loadImage('assets/jobs-1280.webp'), // the viewer playing a portrait video
    loadImage('assets/sharepage-1280.webp'),
    loadWordmark(),
  ]);
  const layer = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c.getContext('2d');
  };
  const L = { c: layer(), g: layer(), scratch: { c: layer(), g: layer() } };
  const story = createStory({ projects, viewer, sharepage, wordmark });
  const comp = createCompositor(canvas, L.c.canvas, L.g.canvas, { width: W, height: H, preserve });
  const samplesFor = (t) => (FAST.some(([a, b]) => t >= a && t <= b) ? 12 : 3);
  /** Renders time t with motion blur over a 180 degree shutter (half a 24 fps frame). */
  function render(t, { samples = 'auto' } = {}) {
    t = Math.min(DURATION, Math.max(0, t));
    const n = samples === 'auto' ? samplesFor(t) : samples;
    const shutter = 0.5 / FPS;
    comp.frame(n, (k) => {
      const ts = n === 1 ? t : Math.max(0, t + ((k + 0.5) / n - 0.5) * shutter);
      return story.draw(L, ts);
    });
  }
  /** The 8 s README loop at loop time u (seam: a scale match, see story.drawLoop). */
  function renderLoop(u) {
    const n = u > 7.45 ? 12 : samplesFor(u + 7.04);
    const shutter = 0.5 / FPS;
    comp.frame(n, (k) => story.drawLoop(L, Math.max(0, u + ((k + 0.5) / n - 0.5) * shutter)));
  }
  return { render, renderLoop, L, story, comp, assets: { projects, viewer, sharepage, wordmark } };
}

if (renderMode) {
  document.body.classList.add('render');
  window.__trailer = {
    ready: (async () => {
      const tr = await createTrailer({ preserve: true });
      const { composeThumb } = await import('./thumbnail.js');
      Object.assign(window.__trailer, {
        frame(t, { samples = 'auto', type = 'image/jpeg', quality = 0.96 } = {}) {
          tr.render(t, { samples });
          return canvas.toDataURL(type, quality);
        },
        loopFrame(u, { type = 'image/jpeg', quality = 0.97 } = {}) {
          tr.renderLoop(u);
          return canvas.toDataURL(type, quality);
        },
        thumb(variant, { type = 'image/png', quality = 0.95 } = {}) {
          composeThumb(tr, variant);
          return canvas.toDataURL(type, quality);
        },
        gl: 'canvas2d + WebGL compositor',
      });
      window.__tr = tr;
      return true;
    })(),
  };
} else {
  startPlayer();
}

async function startPlayer() {
  const tr = await createTrailer({ preserve: false });
  document.getElementById('loading').remove();
  const play = document.getElementById('play');
  const playIcon = document.getElementById('play-icon');
  const replay = document.getElementById('replay');
  const scrub = document.getElementById('scrub');
  const time = document.getElementById('time');
  const sound = document.getElementById('sound');
  const soundIcon = document.getElementById('sound-icon');

  const PLAY = '<path d="M8 5v14l11-7z"/>';
  const PAUSE = '<path d="M7 5h4v14H7zm6 0h4v14h-4z"/>';
  const MUTED = '<path d="M4 9v6h4l5 4V5L8 9zm12.5 3 2.5 2.5-1.4 1.4-2.5-2.5-2.5 2.5-1.4-1.4 2.5-2.5-2.5-2.5 1.4-1.4 2.5 2.5 2.5-2.5 1.4 1.4z"/>';
  const ON = '<path d="M4 9v6h4l5 4V5L8 9zm11.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>';

  let t = Number(params.get('t') ?? 0);
  let playing = false;
  let startWall = 0;
  let startT = 0;
  let soundOn = false;
  let audio = null;
  let needsDraw = true;
  let lastFrame = -1;

  const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  async function ensureAudio() {
    if (audio) return audio;
    // the page plays only the original procedural soundtrack (no licensed files)
    const { synthesize } = await import('./audio-synth.js');
    const ctx = new AudioContext({ sampleRate: 48000 });
    const { left, right, sampleRate } = synthesize({ sampleRate: 48000 });
    const buffer = ctx.createBuffer(2, left.length, sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    audio = { ctx, buffer, node: null };
    return audio;
  }
  function stopAudio() {
    if (audio?.node) {
      try {
        audio.node.stop();
      } catch {
        /* already stopped */
      }
      audio.node = null;
    }
  }
  function startAudio() {
    if (!soundOn || !audio || !playing) return;
    stopAudio();
    const node = audio.ctx.createBufferSource();
    node.buffer = audio.buffer;
    node.connect(audio.ctx.destination);
    node.start(0, Math.min(t, DURATION - 0.01));
    audio.node = node;
    startWall = audio.ctx.currentTime * 1000;
    startT = t;
  }
  const now = () => (soundOn && audio?.node ? audio.ctx.currentTime * 1000 : performance.now());

  function setPlaying(p) {
    playing = p;
    stage.classList.toggle('playing', p);
    stage.classList.toggle('paused', !p);
    playIcon.innerHTML = p ? PAUSE : PLAY;
    play.setAttribute('aria-label', p ? 'Pause' : 'Play');
    if (p) {
      if (t >= DURATION) t = 0;
      startT = t;
      startWall = performance.now();
      startAudio();
    } else stopAudio();
    needsDraw = true;
  }
  play.addEventListener('click', () => setPlaying(!playing));
  replay.addEventListener('click', () => {
    t = 0;
    setPlaying(true);
  });
  scrub.addEventListener('input', () => {
    t = Number(scrub.value);
    startT = t;
    startWall = now();
    if (playing) startAudio();
    needsDraw = true;
  });
  sound.addEventListener('click', async () => {
    soundOn = !soundOn;
    sound.setAttribute('aria-pressed', String(soundOn));
    sound.setAttribute('aria-label', soundOn ? 'Mute' : 'Sound on');
    soundIcon.innerHTML = soundOn ? ON : MUTED;
    if (soundOn) {
      await ensureAudio();
      await audio.ctx.resume();
      startAudio();
    } else stopAudio();
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      setPlaying(!playing);
    }
  });
  canvas.addEventListener('click', () => setPlaying(!playing));

  function loop() {
    if (playing) {
      t = startT + (now() - startWall) / 1000;
      if (t >= DURATION) {
        t = DURATION;
        setPlaying(false);
      }
    }
    // the film runs at 24 fps: only draw when the frame changes
    const f = Math.floor(t * FPS);
    if (needsDraw || f !== lastFrame) {
      tr.render(f / FPS, { samples: 2 });
      scrub.value = String(t);
      time.textContent = `${fmt(t)} / 0:30`;
      needsDraw = false;
      lastFrame = f;
    }
    requestAnimationFrame(loop);
  }
  loop();
}
