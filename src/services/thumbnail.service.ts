// Shotstash — Thumbnail Generation Service
// Generates real thumbnails for photos (sharp) and videos (ffmpeg frame extract)

import path from 'path';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { storageRoot } from '../lib/storageRoot';

const execFileAsync = promisify(execFile);

const THUMB_DIR = path.join(storageRoot(), 'thumbnails');

const THUMB_WIDTH = 480;
const THUMB_HEIGHT = 360;
const JPEG_QUALITY = 75;

// All supported image extensions
const IMAGE_EXTS = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp',
  '.heic', '.heif', '.tiff', '.tif',
  '.dng', '.cr2', '.nef', '.arw', '.orf', '.rw2',
];

// All supported video extensions
const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv'];

/**
 * Check if a file needs a thumbnail generated
 * Now returns true for ALL images and videos
 */
export function needsThumbnail(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTS.includes(ext) || VIDEO_EXTS.includes(ext);
}

/**
 * Generate a thumbnail for an image or video file
 * - Images: resized with sharp
 * - Videos: frame extracted with ffmpeg at ~2s, then resized with sharp
 */
export async function generateThumbnail(filePath: string, fileId: string): Promise<string | null> {
  try {
    await fs.mkdir(THUMB_DIR, { recursive: true });
    const thumbPath = path.join(THUMB_DIR, `${fileId}.jpg`);
    const ext = path.extname(filePath).toLowerCase();

    if (VIDEO_EXTS.includes(ext)) {
      return await generateVideoThumbnail(filePath, thumbPath);
    } else {
      return await generateImageThumbnail(filePath, thumbPath);
    }
  } catch (err) {
    console.warn(`[Thumbnail] Failed for ${filePath}:`, (err as Error).message);
    return null;
  }
}

/**
 * Generate image thumbnail using sharp
 */
async function generateImageThumbnail(filePath: string, thumbPath: string): Promise<string | null> {
  const sharp = (await import('sharp')).default;

  await sharp(filePath, { failOnError: false })
    .rotate() // auto-rotate based on EXIF
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(thumbPath);

  const stat = await fs.stat(thumbPath);
  return stat.size > 0 ? thumbPath : null;
}

/**
 * Generate video thumbnail by extracting a frame with ffmpeg
 * Extracts frame at 2 seconds (or first frame if video is shorter)
 */
async function generateVideoThumbnail(filePath: string, thumbPath: string): Promise<string | null> {
  const tempFrame = thumbPath.replace('.jpg', '_frame.jpg');

  try {
    // Extract a frame at 2s with ffmpeg
    await execFileAsync('ffmpeg', [
      '-ss', '2',           // seek to 2 seconds
      '-i', filePath,
      '-frames:v', '1',     // extract 1 frame
      '-q:v', '3',          // quality (lower = better, 2-5 is good)
      '-y',                 // overwrite
      tempFrame,
    ], { timeout: 30000 }); // 30s timeout

    // Resize the extracted frame with sharp
    const sharp = (await import('sharp')).default;
    await sharp(tempFrame, { failOnError: false })
      .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: JPEG_QUALITY })
      .toFile(thumbPath);

    // Cleanup temp frame
    await fs.unlink(tempFrame).catch(() => {});

    const stat = await fs.stat(thumbPath);
    return stat.size > 0 ? thumbPath : null;
  } catch (err) {
    // If seeking to 2s fails (video too short), try first frame
    try {
      await execFileAsync('ffmpeg', [
        '-i', filePath,
        '-frames:v', '1',
        '-q:v', '3',
        '-y',
        tempFrame,
      ], { timeout: 30000 });

      const sharp = (await import('sharp')).default;
      await sharp(tempFrame, { failOnError: false })
        .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(thumbPath);

      await fs.unlink(tempFrame).catch(() => {});

      const stat = await fs.stat(thumbPath);
      return stat.size > 0 ? thumbPath : null;
    } catch {
      await fs.unlink(tempFrame).catch(() => {});
      console.warn(`[Thumbnail] Video frame extract failed for ${filePath}:`, (err as Error).message);
      return null;
    }
  }
}

export function getThumbnailUrl(fileId: string): string {
  return `/media/t/${fileId}`;
}
