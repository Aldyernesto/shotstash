// Reference worker: ffmpeg progress parsing and the proxy command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROXY_FILTER, createProgressParser, makeProxy, percentOf, probe, proxyArgs } from '../src/transcode.mjs';

test('percent from out_time_us over the duration, capped at 99 until the end', () => {
  assert.equal(percentOf(0, 10), 0);
  assert.equal(percentOf(2_500_000, 10), 25);
  assert.equal(percentOf(9_999_999, 10), 99);
  assert.equal(percentOf(12_000_000, 10), 99);
  assert.equal(percentOf(5_000_000, 0), 0);
  assert.equal(percentOf(-5, 10), 0);
});

test('the parser reads key=value blocks split across chunks and reports each percent once', () => {
  const seen = [];
  const p = createProgressParser(10, (pct) => seen.push(pct));
  p.push('frame=10\nout_time_us=1000000\nout_ti');
  p.push('me=00:00:01.000000\nprogress=continue\n');
  p.push('out_time_us=1000000\nprogress=continue\n'); // same percent: not repeated
  p.push('out_time_ms=5500000\nprogress=continue\nout_time_us=N/A\nprogress=continue\n');
  p.push('out_time_us=10000000\nprogress=end\n');
  assert.deepEqual(seen, [10, 55, 100]);
  assert.equal(p.percent, 100);
});

test('without a duration only the end is reported', () => {
  const seen = [];
  const p = createProgressParser(0, (pct) => seen.push(pct));
  p.push('out_time_us=4000000\nprogress=continue\nprogress=end\n');
  assert.deepEqual(seen, [100]);
});

test('proxy command: 720p at most, even sizes, H.264 veryfast CRF 23, AAC 128k, faststart, optional audio', () => {
  const args = proxyArgs('/tmp/in', '/tmp/out.mp4');
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(PROXY_FILTER, "scale=-2:'trunc(min(720,ih)/2)*2',format=yuv420p");
  assert.equal(after('-vf'), PROXY_FILTER);
  assert.equal(after('-c:v'), 'libx264');
  assert.equal(after('-preset'), 'veryfast');
  assert.equal(after('-crf'), '23');
  assert.equal(after('-c:a'), 'aac');
  assert.equal(after('-b:a'), '128k');
  assert.equal(after('-movflags'), '+faststart');
  assert.equal(after('-progress'), 'pipe:1');
  assert.ok(args.includes('0:a:0?'), 'audio is optional');
  assert.equal(args.at(-1), '/tmp/out.mp4');
  assert.equal(after('-i'), '/tmp/in');
});

// A real transcode when ffmpeg is installed (CI installs it; the Docker job
// proves the same inside the worker image).

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

function streams(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', file], { encoding: 'utf8' });
  return JSON.parse(r.stdout).streams;
}

test('makeProxy: 1080p with audio becomes 720p H.264/AAC; a 360p clip is never upscaled', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shotstash-worker-test-'));
  try {
    const src = join(dir, 'src.mp4');
    const gen = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
    assert.equal(gen.status, 0, String(gen.stderr));
    const info = await probe(src);
    assert.ok(info.hasVideo && info.durationSeconds > 1.5, JSON.stringify(info));
    const seen = [];
    const out = join(dir, 'out.mp4');
    await makeProxy(src, out, { durationSeconds: info.durationSeconds, onPercent: (p) => seen.push(p) });
    const s = streams(out);
    const v = s.find((x) => x.codec_type === 'video');
    assert.equal(v.codec_name, 'h264');
    assert.equal(v.height, 720);
    assert.equal(v.width, 1280);
    assert.equal(v.pix_fmt, 'yuv420p');
    assert.equal(s.find((x) => x.codec_type === 'audio')?.codec_name, 'aac');
    assert.equal(seen.at(-1), 100);

    const small = join(dir, 'small.mp4');
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=641x361:rate=25', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv444p', small]).status, 0);
    const out2 = join(dir, 'out2.mp4');
    await makeProxy(small, out2, { durationSeconds: 1, onPercent: () => {} });
    const v2 = streams(out2).find((x) => x.codec_type === 'video');
    assert.equal(v2.height, 360, 'odd height rounded down to even, never upscaled');
    assert.equal(v2.width % 2, 0);
    assert.equal(streams(out2).some((x) => x.codec_type === 'audio'), false, 'no audio in, none out');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
