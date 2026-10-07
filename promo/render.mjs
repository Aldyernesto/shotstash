#!/usr/bin/env node
// Frame-exact renderer for the Shotstash trailer.
//
// Serves promo/ on a local port, opens index.html?render=1 in headless Chrome
// over the DevTools protocol (Node's built-in WebSocket, no extra packages),
// seeks t = frame / 60 for every frame and pipes the frames into ffmpeg.
//
//   node promo/render.mjs --version v3    everything into out/v3: master, trailer, loop, key frames, thumbnails
//                                         (without --version the folder is out/dev)
//   node promo/render.mjs --keyframes     only the review stills
//   node promo/render.mjs --thumbs        only the thumbnails and poster
//   node promo/render.mjs --encode        re-encode trailer + loop from the existing master (no Chrome)
//   node promo/render.mjs --from 9 --to 12   render a slice to out/frames/slice.mp4
//
// CHROME_PATH and FFMPEG_PATH override the binaries.

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Every render goes to its own versioned folder (out/v2, out/v3, ...) so
// nothing a reviewer may be watching is ever overwritten.
const VERSION = (() => {
  const i = process.argv.indexOf('--version');
  return i >= 0 ? process.argv[i + 1] : 'dev';
})();
const OUT = path.join(ROOT, 'out', VERSION);
const FRAMES = path.join(ROOT, 'out', 'frames');
const KEYS = path.join(OUT, 'keyframes');
const FPS = 24;
const DURATION = 30;
const KEY_TIMES = Array.from({ length: 16 }, (_, i) => i * 2); // t00 .. t30

const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : 'google-chrome');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

mkdirSync(FRAMES, { recursive: true });
mkdirSync(KEYS, { recursive: true });

// ------------------------------------------------------------ static server
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.css': 'text/css',
};
function serve() {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------ CDP
async function launchChrome() {
  const profile = mkdtempSync(path.join(tmpdir(), 'shotstash-render-'));
  const gl = process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--use-angle=default'];
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      ...gl,
      '--window-size=1920,1080',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
  if (!existsSync(portFile)) throw new Error(`Chrome did not start (${CHROME}). Set CHROME_PATH.`);
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((p) => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.error('page exception:', msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      console.error(`page ${msg.params.type}:`, msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async function close() {
    try {
      await send('Browser.close');
    } catch {
      /* closing */
    }
    ws.close();
    await new Promise((r) => setTimeout(r, 500));
    if (proc.exitCode === null) proc.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Chrome may still hold a lock on Windows */
    }
  }
  return { send, evaluate, close, proc };
}

async function openTrailer() {
  const server = await serve();
  const { port } = server.address();
  const chrome = await launchChrome();
  await chrome.send('Runtime.enable');
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await chrome.send('Page.enable');
  await chrome.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?render=1` });
  for (let i = 0; i < 300; i++) {
    const ok = await chrome.evaluate('!!(window.__trailer && window.__trailer.ready)').catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await chrome.evaluate('window.__trailer.ready');
  console.log('WebGL:', await chrome.evaluate('window.__trailer.gl'));
  const renderer = await chrome.evaluate(`(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
  console.log('GPU:', renderer);
  return {
    chrome,
    async done() {
      await chrome.close();
      server.close();
    },
  };
}

const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

// ------------------------------------------------------------ ffmpeg
function ffmpeg(argv, { input } = {}) {
  const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  return { p, done };
}

async function renderRange(t0, t1, file, samples = 'auto') {
  const { chrome, done } = await openTrailer();
  const f0 = Math.round(t0 * FPS);
  const f1 = Math.round(t1 * FPS);
  // near-lossless master; the delivery encodes are made from it
  const enc = ffmpeg(
    ['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv420p', file],
    { input: true },
  );
  const start = Date.now();
  for (let f = f0; f < f1; f++) {
    const t = f / FPS;
    const data = await chrome.evaluate(`window.__trailer.frame(${t}, { samples: ${JSON.stringify(samples)}, quality: 0.97 })`);
    const buf = decode(data);
    if (!enc.p.stdin.write(buf)) await new Promise((r) => enc.p.stdin.once('drain', r));
    if ((f - f0) % 60 === 0) {
      const el = (Date.now() - start) / 1000;
      const rate = (f - f0 + 1) / el;
      process.stdout.write(`\r  frame ${f - f0 + 1}/${f1 - f0}  ${rate.toFixed(1)} fps  eta ${((f1 - f) / rate).toFixed(0)} s   `);
    }
  }
  enc.p.stdin.end();
  await enc.done;
  await done();
  const secs = (Date.now() - start) / 1000;
  console.log(`\n  rendered ${f1 - f0} frames in ${secs.toFixed(1)} s`);
  return secs;
}

async function keyframes() {
  const { chrome, done } = await openTrailer();
  if (val('--eval', null)) console.log('eval:', await chrome.evaluate(val('--eval', null)));
  for (const t of flag('--only-at') ? [] : KEY_TIMES) {
    const data = await chrome.evaluate(`window.__trailer.frame(${t}, { samples: 'auto', type: 'image/png' })`);
    const name = `t${String(t).padStart(2, '0')}.png`;
    writeFileSync(path.join(KEYS, name), decode(data));
    console.log('  key frame', name);
  }
  const extra = val('--at', null);
  if (extra) {
    for (const t of extra.split(',').map(Number)) {
      const data = await chrome.evaluate(`window.__trailer.frame(${t}, { samples: 'auto', type: 'image/png' })`);
      writeFileSync(path.join(KEYS, `at-${String(t).replace('.', '_')}.png`), decode(data));
      console.log('  extra frame', t);
    }
  }
  await done();
}

async function thumbs() {
  const { chrome, done } = await openTrailer();
  const variants = ['a', 'b', 'c'];
  const chosen = 'a';
  for (const v of variants) {
    const data = await chrome.evaluate(`window.__trailer.thumb(${JSON.stringify(v)}, { type: 'image/png' })`);
    const file = v === chosen ? path.join(OUT, 'thumbnail-1920x1080.png') : path.join(OUT, `thumbnail-alt-${v}.png`);
    writeFileSync(file, decode(data));
    console.log('  thumbnail', path.basename(file));
  }
  await done();
  const src = path.join(OUT, 'thumbnail-1920x1080.png');
  await ffmpeg(['-i', src, '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '2', path.join(OUT, 'thumbnail-1280x720.jpg')]).done;
  await ffmpeg(['-i', src, '-q:v', '3', path.join(OUT, 'poster.jpg')]).done;
  for (const v of variants.filter((x) => x !== chosen)) {
    await ffmpeg(['-i', path.join(OUT, `thumbnail-alt-${v}.png`), '-vf', 'scale=320:-1:flags=lanczos', path.join(KEYS, `thumb-320-${v}.png`)]).done;
  }
  await ffmpeg(['-i', src, '-vf', 'scale=320:-1:flags=lanczos', path.join(KEYS, `thumb-320-${chosen}.png`)]).done;
}

// ------------------------------------------------------------ audio
function soundtrack() {
  // Licensed music, when present (see assets/audio/CREDITS.md), is mixed by mix-audio.mjs.
  const mixed = path.join(ROOT, 'out', 'mix.wav');
  // the licensed files are not in git: a fresh clone has no bgm-main.mp3 and quietly uses the procedural track
  if (existsSync(path.join(ROOT, 'assets', 'audio', 'bgm-main.mp3')) && !flag('--procedural')) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'mix-audio.mjs')], { stdio: 'inherit' });
    if (r.status === 0 && existsSync(mixed)) return mixed;
    console.warn('  licensed mix failed, using the procedural soundtrack');
  }
  const wav = path.join(ROOT, 'out', 'soundtrack.wav');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'audio.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('audio.mjs failed');
  return wav;
}

const size = (f) => statSync(f).size / 1e6; // decimal MB, the stricter reading of the limits

async function encodeDeliverables(master) {
  const audio = soundtrack();
  const trailer = path.join(OUT, 'shotstash-trailer-30s.mp4');
  for (const crf of [16, 17, 18, 19, 20, 21, 22, 23]) {
    await ffmpeg([
      '-i', master, '-i', audio,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-tune', 'grain', '-x264-params', 'keyint=120:min-keyint=60',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-t', String(DURATION), '-movflags', '+faststart', trailer,
    ]).done;
    console.log(`  trailer crf ${crf}: ${size(trailer).toFixed(2)} MB`);
    if (size(trailer) <= 20) break;
  }
  // The 8 s loop is rendered on its own (story.drawLoop): it starts on the
  // frame corner at 7.04 s and ends diving into the link pill's end cap, whose
  // arc is that same corner, so the seam is a scale match, not a dissolve.
  const loopMaster = path.join(FRAMES, `loop-${VERSION}.mp4`);
  await renderLoopMaster(loopMaster);
  const loop = path.join(OUT, 'shotstash-loop-8s.mp4');
  for (const crf of [18, 20, 22, 24, 26, 28]) {
    await ffmpeg([
      '-i', loopMaster, '-an',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-tune', 'grain', '-movflags', '+faststart', loop,
    ]).done;
    console.log(`  loop crf ${crf}: ${size(loop).toFixed(2)} MB`);
    if (size(loop) <= 4) break;
  }
}

async function renderLoopMaster(file) {
  const { chrome, done } = await openTrailer();
  const enc = ffmpeg(
    ['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv420p', file],
    { input: true },
  );
  for (let f = 0; f < 8 * FPS; f++) {
    const data = await chrome.evaluate(`window.__trailer.loopFrame(${f / FPS})`);
    const buf = decode(data);
    if (!enc.p.stdin.write(buf)) await new Promise((r) => enc.p.stdin.once('drain', r));
  }
  enc.p.stdin.end();
  await enc.done;
  await done();
}

// ------------------------------------------------------------ main
const t0 = Date.now();
const master = path.join(FRAMES, `master-${VERSION}.mp4`);
if (flag('--keyframes')) await keyframes();
else if (flag('--thumbs')) await thumbs();
else if (flag('--encode')) await encodeDeliverables(master);
else if (args.includes('--from')) {
  await renderRange(Number(val('--from', 0)), Number(val('--to', 30)), path.join(FRAMES, 'slice.mp4'), val('--samples', 'auto'));
} else {
  await renderRange(0, DURATION, master, val('--samples', 'auto'));
  await encodeDeliverables(master);
  await keyframes();
  await thumbs();
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
