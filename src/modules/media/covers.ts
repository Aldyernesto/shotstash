/**
 * Project covers and user avatars: re-encoded to JPEG (at most 2048 px on
 * the long edge, EXIF rotation applied) and stored at
 * `covers/<kind>/<id>.jpg` through the storage backend.
 */
import { Readable } from 'stream';
import sharp from 'sharp';
import { sniffMime, storage, storageKeys, type CoverKind } from '@/modules/storage';

export const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_COVER_EDGE = 2048;

/** Image types a cover may be uploaded as (sniffed from the bytes). */
const COVER_INPUT = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff']);

export type SaveCoverResult = { ok: true } | { ok: false; code: 'UNSUPPORTED_TYPE' };

export async function saveCover(kind: CoverKind, id: string, input: Buffer): Promise<SaveCoverResult> {
  if (!COVER_INPUT.has(sniffMime(input.subarray(0, 4100)))) return { ok: false, code: 'UNSUPPORTED_TYPE' };
  let jpeg: Buffer;
  try {
    jpeg = await sharp(input, { failOnError: false, animated: false })
      .rotate()
      .resize(MAX_COVER_EDGE, MAX_COVER_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    return { ok: false, code: 'UNSUPPORTED_TYPE' };
  }
  await storage().putStream(storageKeys.cover(kind, id), Readable.from(jpeg), { contentType: 'image/jpeg', size: jpeg.length });
  return { ok: true };
}

export async function deleteCover(kind: CoverKind, id: string): Promise<void> {
  await storage().delete(storageKeys.cover(kind, id));
}
