// Story 4.4: thumbnails keep the source aspect ratio (480 px long edge) and
// come out upright: a JPEG with EXIF orientation 6 and an MP4 with a 90
// degree display matrix. Fixtures are generated here (sharp, ffmpeg).
// ffmpeg is required in CI; locally the video case is skipped without it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const { renderThumbnail, ffmpegFrame, THUMB_LONG_EDGE, needsThumbnail } = await import('../src/modules/media/thumbRender.ts');
const { thumbnailCacheFor } = await import('../src/modules/media/thumbCache.ts');

const dir = mkdtempSync(path.join(tmpdir(), 'shotstash-thumbs-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Red left half, blue right half. */
async function halves(width, height) {
  const half = Math.floor(width / 2);
  return sharp({ create: { width, height, channels: 3, background: '#ff0000' } })
    .composite([{ input: { create: { width: width - half, height, channels: 3, background: '#0000ff' } }, left: half, top: 0 }])
    .png()
    .toBuffer();
}

async function pixel(jpeg, x, y) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

const isRed = ([r, g, b]) => r > 180 && g < 80 && b < 80;
const isBlue = ([r, g, b]) => b > 180 && r < 80 && g < 80;

test('thumbnail: landscape photo keeps its aspect ratio at 480 px long edge', async () => {
  const src = await sharp(await halves(1600, 900)).jpeg().toBuffer();
  const out = await renderThumbnail(src);
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, THUMB_LONG_EDGE);
  assert.equal(meta.height, 270);
  assert.equal(meta.format, 'jpeg');
});

test('thumbnail: EXIF orientation 6 comes out upright (portrait, rotated content)', async () => {
  // Stored 1200x600 landscape, displayed rotated 90 degrees clockwise:
  // the red left half ends up on top.
  const src = await sharp(await halves(1200, 600)).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.equal((await sharp(src).metadata()).orientation, 6);
  const out = await renderThumbnail(src);
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 240);
  assert.equal(meta.height, THUMB_LONG_EDGE);
  assert.ok(!meta.orientation || meta.orientation === 1);
  assert.ok(isRed(await pixel(out, 120, 20)), 'top is red');
  assert.ok(isBlue(await pixel(out, 120, 460)), 'bottom is blue');
});

test('thumbnail: small images are not enlarged', async () => {
  const out = await renderThumbnail(await sharp(await halves(200, 100)).jpeg().toBuffer());
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [200, 100]);
});

test('thumbnail: photos and videos get one, documents do not', () => {
  assert.equal(needsThumbnail('image/jpeg'), true);
  assert.equal(needsThumbnail('video/mp4'), true);
  assert.equal(needsThumbnail('application/pdf'), false);
});

test('thumbnail: an MP4 with a 90 degree display matrix comes out upright', { skip: !hasFfmpeg() && !process.env.CI && 'ffmpeg not installed' }, async () => {
  const plain = path.join(dir, 'plain.mp4');
  const rotated = path.join(dir, 'rotated.mp4');
  // 640x360, red left half and blue right half, 3 s.
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x360:d=3',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x360:d=3',
    '-filter_complex', 'hstack=inputs=2,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', plain,
  ]);
  // A display matrix (what phones write for portrait video), stream copied.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-display_rotation', '90', '-i', plain, '-c', 'copy', rotated]);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', rotated], { encoding: 'utf8' });
  assert.match(probe, /"rotation": -?90/);

  const frame = await ffmpegFrame(rotated, true);
  const meta = await sharp(frame).metadata();
  assert.ok(meta.height > meta.width, `portrait frame, got ${meta.width}x${meta.height}`);
  assert.equal(meta.height, THUMB_LONG_EDGE);
  assert.equal(meta.width % 2, 0);
  // Counter-clockwise display rotation: the red left half ends up at the bottom.
  const thumb = await renderThumbnail(frame);
  const t = await sharp(thumb).metadata();
  assert.deepEqual([t.width, t.height], [meta.width, meta.height]);
  const top = await pixel(thumb, Math.floor(t.width / 2), 20);
  const bottom = await pixel(thumb, Math.floor(t.width / 2), t.height - 20);
  assert.ok(isBlue(top) && isRed(bottom), `upright colours, top ${top} bottom ${bottom}`);

  // A clip shorter than two seconds still yields a frame (the first one).
  const short = path.join(dir, 'short.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', short]);
  await assert.rejects(ffmpegFrame(short, true));
  const first = await ffmpegFrame(short, false);
  assert.equal((await sharp(first).metadata()).width, THUMB_LONG_EDGE);
});

test('thumbnail cache: only the current version is immutable', () => {
  assert.equal(thumbnailCacheFor(3, '3'), 'immutable');
  assert.equal(thumbnailCacheFor(3, '2'), 'cookie');
  assert.equal(thumbnailCacheFor(3, null), 'cookie');
  assert.equal(thumbnailCacheFor(3, '3abc'), 'cookie');
  assert.equal(thumbnailCacheFor(0, '0'), 'cookie');
});
