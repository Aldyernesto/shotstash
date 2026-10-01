// The processing step of the reference worker: a 720p H.264/AAC MP4 proxy
// made with ffmpeg. Replace `makeProxy` (and the kind in main.mjs) to plug
// in your own model; the rest of the worker is the contract.
import { spawn } from 'node:child_process';

export const PROXY_KIND = 'shotstash/proxy-720p';
export const PROXY_MIME = 'video/mp4';
export const PROXY_EXT = 'mp4';

/** Video filter: at most 720 lines (never upscaled), even dimensions, 4:2:0 for every player. */
export const PROXY_FILTER = "scale=-2:'trunc(min(720,ih)/2)*2',format=yuv420p";

/** ffmpeg arguments of the proxy. The audio stream is optional. */
export function proxyArgs(input, output) {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i', input,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-vf', PROXY_FILTER,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    output,
  ];
}

/**
 * Reads the `-progress pipe:1` stream: key=value lines in blocks ending with
 * `progress=continue` or `progress=end`. Calls `onPercent` with whole
 * percents from `out_time_us` over `durationSeconds` (0 to 99 while running,
 * 100 at the end). Without a known duration only the end is reported.
 */
export function createProgressParser(durationSeconds, onPercent) {
  let buffer = '';
  let outTimeUs = 0;
  let last = -1;
  const report = (pct) => {
    if (pct !== last) {
      last = pct;
      onPercent(pct);
    }
  };
  const line = (raw) => {
    const eq = raw.indexOf('=');
    if (eq < 0) return;
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (key === 'out_time_us' || key === 'out_time_ms') {
      // ffmpeg prints out_time_ms in microseconds too (a long-standing quirk).
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) outTimeUs = n;
    } else if (key === 'progress') {
      if (value === 'end') report(100);
      else if (durationSeconds > 0) report(percentOf(outTimeUs, durationSeconds));
    }
  };
  return {
    push(chunk) {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    },
    get percent() {
      return last;
    },
  };
}

/** Whole percent of `outTimeUs` over `durationSeconds`, capped at 99 until ffmpeg says the end. */
export function percentOf(outTimeUs, durationSeconds) {
  if (!(durationSeconds > 0)) return 0;
  return Math.max(0, Math.min(99, Math.floor((outTimeUs / 1e6 / durationSeconds) * 100)));
}

function run(cmd, args, { signal, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      if (onStdout) onStdout(d);
      else stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(Object.assign(new Error(`${cmd} exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`), { exitCode: code }));
    });
  });
}

/** Duration (seconds) and whether the file has a video stream. */
export async function probe(input, { signal } = {}) {
  const out = await run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', input],
    { signal },
  );
  const info = JSON.parse(out || '{}');
  const duration = Number(info.format?.duration);
  return {
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    hasVideo: (info.streams ?? []).some((s) => s.codec_type === 'video'),
  };
}

/** Transcodes `input` to the proxy at `output`, reporting whole percents; `onActivity` fires on every progress block. */
export async function makeProxy(input, output, { durationSeconds, onPercent, onActivity = () => {}, signal }) {
  const parser = createProgressParser(durationSeconds, onPercent);
  await run('ffmpeg', proxyArgs(input, output), {
    signal,
    onStdout: (d) => {
      onActivity();
      parser.push(d);
    },
  });
}
