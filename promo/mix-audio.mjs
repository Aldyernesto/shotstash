#!/usr/bin/env node
// Licensed soundtrack mix for the 30 s MP4: the two-segment music cut from
// assets/audio/CREDITS.md plus the SFX cue sheet below, music ducked under the
// big impacts, then a two-pass loudnorm to -14 LUFS with true peak at most -1.5 dBTP.
//
// Most of these files may not be redistributed (see assets/audio/.gitignore),
// so they never ship in the repo or the playable page; only the mixed MP4 does.
// Without them, render.mjs falls back to the procedural audio.mjs.
//
//   node promo/mix-audio.mjs          writes promo/out/mix.wav

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cues, IMPACT, LOCK_HIT, DURATION } from './src/timeline.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const AUDIO = path.join(ROOT, 'assets', 'audio');
const OUT = path.join(ROOT, 'out');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
mkdirSync(OUT, { recursive: true });

// Each cue lands the file's loudest moment (`peak`, seconds into the file,
// measured from the envelope) exactly on `at`.
const PEAK = {
  'sfx-whoosh-1.wav': 1.07,
  'sfx-whoosh-2.wav': 0.72,
  'sfx-whoosh-cc0.wav': 0.39,
  'sfx-whoosh-vortex.wav': 0.45,
  'sfx-whoosh-heavy.mp3': 0.46,
  'sfx-impact-1.mp3': 0.12,
  'sfx-impact-2.wav': 0.15,
  'sfx-impact-big.mp3': 0.38,
  'sfx-sub-drop.mp3': 0.04,
  'sfx-riser-2.wav': 2.53,
  'sfx-ui-click-1.wav': 0.01,
  'sfx-ui-click-2.wav': 0.0,
  'sfx-ui-tick-cc0.wav': 0.0,
  'sfx-glitch.wav': 1.32,
};

/** SFX cue sheet: [file, at (s), gain (dB), max length (s)], all derived from the picture. */
const C = cues();
const CUES = [
  // soft UI clicks on every cursor click
  ...C.clicks.map((t) => ['sfx-ui-click-2.wav', t, -13, 0.2]),
  // ticks on progress completes and pill pops
  ...C.ticks.map((t) => ['sfx-ui-tick-cc0.wav', t, -9, 0.1]),
  // digital glitch ticks on the pixel reveals
  ...C.glitches.map((t) => ['sfx-glitch.wav', t + 0.25, -20, 0.55]),
  // airy whooshes on morphs, sucks on the dive and the collapse
  ...C.whooshes.map((w, i) =>
    w.kind === 'suck' ? ['sfx-whoosh-vortex.wav', w.t - 0.08, -12, 1.27] : [i % 2 ? 'sfx-whoosh-2.wav' : 'sfx-whoosh-cc0.wav', w.t, -16, 1.2],
  ),
  // impacts only on the two hits
  ['sfx-impact-big.mp3', IMPACT, -8, 3.0],
  ['sfx-sub-drop.mp3', IMPACT, -11, 2.2],
  ['sfx-riser-2.wav', LOCK_HIT - 0.02, -13, 2.6],
  ['sfx-impact-big.mp3', LOCK_HIT, -7, 3.6],
  ['sfx-sub-drop.mp3', LOCK_HIT, -10, 2.4],
];
const DUCK = [IMPACT, LOCK_HIT];

function run(args, { capture = false } = {}) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 1e8 });
  if (r.status !== 0) {
    console.error(r.stderr);
    throw new Error('ffmpeg failed');
  }
  return capture ? r.stderr : '';
}

const music = path.join(AUDIO, 'bgm-main.mp3');
for (const f of [music, ...new Set(CUES.map((c) => path.join(AUDIO, c[0])))]) {
  if (!existsSync(f)) {
    console.error(`missing ${path.relative(ROOT, f)}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- graph
const files = [...new Set(CUES.map((c) => c[0]))];
const inputs = ['-i', music, ...files.flatMap((f) => ['-i', path.join(AUDIO, f)])];
const parts = [];
// music: two segments, one splice at 21.60 s (CREDITS.md), ducked under impacts
const duck = DUCK.map((t) => `0.5*gte(t,${t - 0.02})*exp(-(t-${t})/0.55)`).join('+');
parts.push(
  `[0:a]atrim=13.00:34.64,asetpts=PTS-STARTPTS,afade=t=in:d=0.4[m1]`,
  `[0:a]atrim=73.03:81.43,asetpts=PTS-STARTPTS[m2]`,
  `[m1][m2]acrossfade=d=0.04:c1=tri:c2=tri,afade=t=out:st=29.0:d=1.0,aformat=sample_rates=48000:channel_layouts=stereo,` +
    `volume='1-min(0.62,${duck})':eval=frame[music]`,
);
// each cue: split its file, trim, fade, gain, delay
const uses = files.map(() => 0);
const counts = files.map((f) => CUES.filter((c) => c[0] === f).length);
files.forEach((f, i) => {
  const outs = Array.from({ length: counts[i] }, (_, k) => `[s${i}_${k}]`).join('');
  parts.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=${counts[i]}${outs}`);
});
const cueLabels = CUES.map(([file, at, gain, len], n) => {
  const i = files.indexOf(file);
  const k = uses[i]++;
  const start = at - (PEAK[file] ?? 0);
  const skip = Math.max(0, -start);
  const delay = Math.max(0, Math.round(start * 1000));
  const l = Math.max(0.05, len - skip);
  parts.push(
    `[s${i}_${k}]atrim=${skip.toFixed(3)}:${(skip + l).toFixed(3)},asetpts=PTS-STARTPTS,` +
      `afade=t=out:st=${Math.max(0, l - Math.min(0.6, l * 0.4)).toFixed(3)}:d=${Math.min(0.6, l * 0.4).toFixed(3)},` +
      `volume=${gain}dB,adelay=${delay}|${delay}[c${n}]`,
  );
  return `[c${n}]`;
});
parts.push(
  `[music]${cueLabels.join('')}amix=inputs=${cueLabels.length + 1}:normalize=0:duration=first,` +
    `atrim=0:${DURATION},asetpts=PTS-STARTPTS[pre]`,
);
const graph = parts.join(';');

const pre = path.join(OUT, 'mix-pre.wav');
run([...inputs, '-filter_complex', graph, '-map', '[pre]', '-c:a', 'pcm_f32le', '-y', pre]);

// ---------------------------------------------------------------- loudness
// one true-peak target everywhere: -1.5 dBTP. The limiter sits about 0.7 dB lower so
// the AAC encode's overshoot still lands at or under -1.5 dBTP.
const target = 'I=-14:TP=-1.5:LRA=11';
const measured = run(['-i', pre, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { capture: true });
const m = JSON.parse(measured.slice(measured.lastIndexOf('{'), measured.lastIndexOf('}') + 1));
const out = path.join(OUT, 'mix.wav');
run([
  '-i', pre,
  '-af',
  `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,` +
    `alimiter=limit=0.78:level=false:attack=1:release=60,aresample=48000`,
  '-c:a', 'pcm_s24le', '-y', out,
]);
const check = run(['-i', out, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { capture: true });
const I = /I:\s+(-?[\d.]+) LUFS/.exec(check.slice(check.lastIndexOf('Summary')))?.[1];
const TP = /Peak:\s+(-?[\d.]+) dBFS/.exec(check.slice(check.lastIndexOf('Summary')))?.[1];
console.log(`  mix.wav: ${I} LUFS integrated, true peak ${TP} dBTP`);
