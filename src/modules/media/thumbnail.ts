/**
 * Thumbnails through the storage backend (Story 4.4): 480 px on the long
 * edge with the source aspect ratio kept (cards crop with `object-fit`).
 *
 *   photos  sharp reads the object as a stream and applies the EXIF
 *           orientation (`.rotate()`) before resizing;
 *   videos  one ffmpeg frame at second 2 (the first frame for shorter
 *           clips), scaled inside 480x480. ffmpeg applies the display
 *           matrix (autorotate) by default, so portrait phone video comes
 *           out upright. ffmpeg reads the object through `withLocalInput`
 *           (a local path, or a short-lived signed GET URL on S3 that never
 *           leaves the server) and writes the frame to a pipe;
 *   HEIC    rendered from the preview JPEG the upload made (`from`).
 *
 * Stored at `files/<id>/thumb-<version>.jpg` with version = current + 1;
 * the caller records it on the row. A failure answers 0 (the UI keeps its
 * placeholder), never an error.
 */
import { Readable } from 'stream';
import { storage, storageKeys } from '@/modules/storage';
import { errMessage, logger } from '@/lib/logger';
import { ffmpegFrame, needsThumbnail, renderThumbnail } from './thumbRender.ts';

const log = logger('thumbnail');

export { THUMB_LONG_EDGE, needsThumbnail, renderThumbnail } from './thumbRender.ts';

/**
 * Renders and stores the thumbnail of `file`. Returns the stored version
 * (`file.thumbVersion + 1`), or 0 when no thumbnail could be made.
 */
export async function generateThumbnail(
  file: {
    id: string;
    storageKey: string;
    mimeType: string;
    /** Current version on the row (0 = none yet). */
    thumbVersion: number;
  },
  opts: { from?: Buffer } = {},
): Promise<number> {
  if (!opts.from && !needsThumbnail(file.mimeType)) return 0;
  const store = storage();
  try {
    let jpeg: Buffer;
    if (opts.from) {
      jpeg = await renderThumbnail(opts.from);
    } else if (file.mimeType.startsWith('video/')) {
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
      jpeg = await renderThumbnail(frame);
    } else {
      jpeg = await renderThumbnail(await store.getStream(file.storageKey));
    }
    if (!jpeg.length) return 0;
    const version = file.thumbVersion + 1;
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
