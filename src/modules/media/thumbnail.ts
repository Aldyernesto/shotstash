/**
 * Thumbnails through the storage backend: photos with sharp (read as a
 * stream), videos with one ffmpeg frame at second 2 (first frame for short
 * clips). ffmpeg reads the object through `withLocalInput` (a local path,
 * or a short-lived signed GET URL on S3 that never leaves the server) and
 * writes the frame to a pipe, so no temporary file is created.
 *
 * Stored at `files/<id>/thumb-<version>.jpg`; the caller records the
 * version on the row. A failure answers 0 (no thumbnail, the UI shows a
 * placeholder), never an error.
 */
import { execFile } from 'child_process';
import { Readable } from 'stream';
import { storage, storageKeys } from '@/modules/storage';
import { errMessage, logger } from '@/lib/logger';

const log = logger('thumbnail');

const THUMB_WIDTH = 480;
const THUMB_HEIGHT = 360;
const JPEG_QUALITY = 75;
const FFMPEG_TIMEOUT_MS = 30_000;

/** Photos and videos get a thumbnail; everything else shows a placeholder. */
export function needsThumbnail(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('video/');
}

function ffmpegFrame(input: string, seek: boolean): Promise<Buffer> {
  const args = [
    ...(seek ? ['-ss', '2'] : []),
    '-i', input,
    '-frames:v', '1',
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

async function resize(input: Buffer | Readable): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const transform = sharp({ failOnError: false })
    .rotate() // EXIF orientation (ffmpeg frames are already upright)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: JPEG_QUALITY });
  if (Buffer.isBuffer(input)) return transform.end(input).toBuffer();
  input.on('error', (e) => transform.destroy(e));
  input.pipe(transform);
  return transform.toBuffer();
}

/**
 * Renders and stores the thumbnail of `file`. Returns the stored version
 * (`file.thumbVersion + 1`), or 0 when no thumbnail could be made.
 */
export async function generateThumbnail(file: {
  id: string;
  storageKey: string;
  mimeType: string;
  thumbVersion?: number;
}): Promise<number> {
  if (!needsThumbnail(file.mimeType)) return 0;
  const store = storage();
  try {
    let jpeg: Buffer;
    if (file.mimeType.startsWith('video/')) {
      const frame = await store.withLocalInput(
        file.storageKey,
        async (input) => {
          try {
            return await ffmpegFrame(input, true);
          } catch {
            // Shorter than two seconds: the first frame.
            return ffmpegFrame(input, false);
          }
        },
        { ttlSeconds: 300 },
      );
      jpeg = await resize(frame);
    } else {
      jpeg = await resize(await store.getStream(file.storageKey));
    }
    if (!jpeg.length) return 0;
    const version = (file.thumbVersion ?? 0) + 1;
    await store.putStream(storageKeys.thumbnail(file.id, version), Readable.from(jpeg), {
      contentType: 'image/jpeg',
      size: jpeg.length,
    });
    return version;
  } catch (err) {
    log.warn('failed', { fileId: file.id, err: errMessage(err) });
    return 0;
  }
}
