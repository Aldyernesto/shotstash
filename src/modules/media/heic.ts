/**
 * HEIC/HEIF previews (Story 4.4). Originals are immutable: the HEIC stays
 * exactly as uploaded (its MD5 is the stored bytes' MD5). At upload
 * completion the app decodes it once and stores a `preview` processed
 * version (JPEG, 2048 px on the long edge, EXIF orientation applied); the
 * viewer shows that preview and the thumbnail is rendered from it.
 * Full-resolution conversion is the `shotstash/heic-to-jpeg` pipeline kind (Epic 5).
 *
 * libvips here has no HEVC decoder, so the pure-JS `heic-convert` (libheif
 * in WASM) decodes; sharp rotates, resizes and re-encodes.
 */
import { Readable } from 'stream';
import sharp from 'sharp';
import { v7 as uuidv7 } from 'uuid';
import prisma from '@/lib/prisma';
import { storage, storageKeys } from '@/modules/storage';
import { PROCESSED_KIND_PREVIEW } from './processed';

// heic-convert ships CJS only; require() avoids ESM interop issues.
type HeicConvert = (opts: { buffer: Buffer; format: 'JPEG' | 'PNG'; quality?: number }) => Promise<Buffer>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const heicConvert: HeicConvert = require('heic-convert');

/** Largest HEIC read into memory for a preview. */
export const MAX_HEIC_BYTES = 200 * 1024 * 1024;
/** Long edge of the HEIC preview, in pixels. */
export const HEIC_PREVIEW_LONG_EDGE = 2048;

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
      throw new Error('HEIC file is too large for a preview');
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/**
 * Decodes the HEIC original of `file` and stores its JPEG preview as a
 * processed version. The original is never touched. Answers the preview
 * bytes (for the thumbnail) and the new version's id; throws when the file
 * cannot be decoded (the caller keeps the HEIC and a placeholder).
 */
export async function createHeicPreview(file: { id: string; storageKey: string; size: number }) {
  if (file.size > MAX_HEIC_BYTES) throw new Error('HEIC file is too large for a preview');
  const store = storage();
  const input = await readAll(await store.getStream(file.storageKey), MAX_HEIC_BYTES);
  const decoded = await heicConvert({ buffer: input, format: 'JPEG', quality: 0.92 });
  const jpeg = await sharp(decoded)
    .rotate()
    .resize(HEIC_PREVIEW_LONG_EDGE, HEIC_PREVIEW_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  const versionId = uuidv7();
  const key = storageKeys.processed(file.id, versionId, 'jpg');
  await store.putStream(key, Readable.from(jpeg), { contentType: 'image/jpeg', size: jpeg.length });
  try {
    await prisma.processedVersion.create({
      data: {
        id: versionId,
        mediaFileId: file.id,
        kind: PROCESSED_KIND_PREVIEW,
        storageKey: key,
        mimeType: 'image/jpeg',
        size: BigInt(jpeg.length),
      },
    });
  } catch (err) {
    await store.delete(key).catch(() => {});
    throw err;
  }
  return { jpeg, versionId };
}
