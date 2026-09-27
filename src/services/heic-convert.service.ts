// Auto-convert HEIC/HEIF uploads to JPEG so they're viewable everywhere.
// libvips on the server doesn't bundle HEVC decoders, so we use the
// pure-JS `heic-convert` package (libheif via WASM) — no system deps.

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
// heic-convert ships CJS only; require() avoids ESM interop issues
type HeicConvert = (opts: { buffer: Buffer; format: 'JPEG' | 'PNG'; quality?: number }) => Promise<Buffer>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const heicConvert: HeicConvert = require('heic-convert');

export interface ConvertedFile {
  storagePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  converted: boolean;
}

function isHeic(filename: string, mimeType?: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.heic' || ext === '.heif') return true;
  if (mimeType?.toLowerCase().includes('heic') || mimeType?.toLowerCase().includes('heif')) return true;
  return false;
}

// Reads HEIC at storagePath, writes JPEG next to it with same UUID basename,
// removes the original HEIC, returns the new path + adjusted filename + size.
export async function maybeConvertHeicToJpg(
  storagePath: string,
  originalName: string,
  mimeType: string,
): Promise<ConvertedFile> {
  if (!isHeic(originalName, mimeType)) {
    return { storagePath, originalName, mimeType, converted: false, size: 0 };
  }

  const dir = path.dirname(storagePath);
  const base = path.basename(storagePath, path.extname(storagePath));
  const jpgPath = path.join(dir, `${base}.jpg`);

  const inputBuffer = await fs.readFile(storagePath);
  const jpgBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.92 });

  // sharp doesn't decode HEVC here but it's still useful for EXIF rotation
  // and re-encoding with mozjpeg-quality settings on the already-decoded JPEG.
  const rotated = await sharp(jpgBuffer).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  await fs.writeFile(jpgPath, rotated);

  // Remove the source HEIC so we don't pay double storage
  await fs.unlink(storagePath).catch(() => {});

  const stat = await fs.stat(jpgPath);

  // Rewrite originalName extension to .jpg so downloads pick the right suffix
  const newOriginalName = originalName.replace(/\.(heic|heif)$/i, '.jpg');

  return {
    storagePath: jpgPath,
    originalName: newOriginalName,
    mimeType: 'image/jpeg',
    size: stat.size,
    converted: true,
  };
}
