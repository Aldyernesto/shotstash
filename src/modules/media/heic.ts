/**
 * HEIC/HEIF uploads converted to JPEG (today's behaviour, now through the
 * storage backend). libvips here has no HEVC decoder, so the pure-JS
 * `heic-convert` (libheif in WASM) decodes; sharp applies EXIF rotation and
 * re-encodes. Story 4.4 turns this into a processed version so originals
 * stay immutable.
 */
import { Readable } from 'stream';
import sharp from 'sharp';
import { storage, storageKeys } from '@/modules/storage';

// heic-convert ships CJS only; require() avoids ESM interop issues.
type HeicConvert = (opts: { buffer: Buffer; format: 'JPEG' | 'PNG'; quality?: number }) => Promise<Buffer>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const heicConvert: HeicConvert = require('heic-convert');

/** Largest HEIC read into memory for conversion. */
const MAX_HEIC_BYTES = 200 * 1024 * 1024;

export function isHeicMime(mimeType: string): boolean {
  return mimeType === 'image/heic' || mimeType === 'image/heif';
}

async function readAll(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of stream) {
    const b = c as Buffer;
    n += b.length;
    if (n > limit) {
      stream.destroy();
      throw new Error('HEIC file is too large to convert');
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/**
 * Converts the HEIC object at `key` of file `fileId` to JPEG at
 * `files/<id>/original.jpg`, deletes the HEIC object and answers the new
 * key, display name, type and size.
 */
export async function convertHeicToJpeg(file: { id: string; storageKey: string; originalName: string }) {
  const store = storage();
  const input = await readAll(await store.getStream(file.storageKey), MAX_HEIC_BYTES);
  const decoded = await heicConvert({ buffer: input, format: 'JPEG', quality: 0.92 });
  const jpeg = await sharp(decoded).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  const key = storageKeys.original(file.id, 'jpg');
  await store.putStream(key, Readable.from(jpeg), { contentType: 'image/jpeg', size: jpeg.length });
  if (key !== file.storageKey) await store.delete(file.storageKey);
  return {
    storageKey: key,
    originalName: file.originalName.replace(/\.(heic|heif)$/i, '.jpg'),
    mimeType: 'image/jpeg',
    size: jpeg.length,
  };
}
