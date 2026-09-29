/**
 * Thumbnail rendering (Story 4.4), free of storage and path aliases so the
 * orientation tests can import it directly.
 *
 *   renderThumbnail  sharp: EXIF orientation applied (`.rotate()`), then
 *                    inside a 480x480 box (aspect ratio kept, never enlarged)
 *   ffmpegFrame      one frame of a video, autorotated (ffmpeg applies the
 *                    display matrix by default) and scaled inside 480x480
 */
import { execFile } from 'child_process';
import type { Readable } from 'stream';

/** Long edge of a thumbnail, in pixels. */
export const THUMB_LONG_EDGE = 480;
const JPEG_QUALITY = 75;
const FFMPEG_TIMEOUT_MS = 30_000;

/** Photos and videos get a thumbnail; everything else shows a placeholder. */
export function needsThumbnail(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('video/');
}

/** One JPEG frame of `input` (a path or URL), at second 2 when `seek`. */
export function ffmpegFrame(input: string, seek: boolean): Promise<Buffer> {
  const args = [
    ...(seek ? ['-ss', '2'] : []),
    '-i', input,
    '-frames:v', '1',
    '-vf', `scale=${THUMB_LONG_EDGE}:${THUMB_LONG_EDGE}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-q:v', '3',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', ...args],
      { encoding: 'buffer', timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        if (!stdout?.length) return reject(new Error('ffmpeg wrote no frame'));
        resolve(stdout);
      },
    );
  });
}

/** Upright JPEG inside a 480x480 box (aspect ratio kept, never enlarged). */
export async function renderThumbnail(input: Buffer | Readable): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const transform = sharp({ failOnError: false })
    .rotate() // EXIF orientation (ffmpeg frames carry none: already upright)
    .resize(THUMB_LONG_EDGE, THUMB_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY });
  if (Buffer.isBuffer(input)) return transform.end(input).toBuffer();
  input.on('error', (e) => transform.destroy(e));
  input.pipe(transform);
  return transform.toBuffer();
}

