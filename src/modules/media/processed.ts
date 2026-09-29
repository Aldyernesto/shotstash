/**
 * Processed versions (Story 4.4): outputs derived from a file, stored under
 * `files/<id>/proc/<versionId>.<ext>` and recorded in `processed_versions`.
 * The original never changes. Listed in the viewer info panel and served
 * by `/media/p/:versionId` (cookie session, the parent file's permission,
 * Range, attachment). Share pages never expose them.
 *
 * Kept free of path aliases so tests can import it directly.
 */

/** Made by the app at upload completion: a JPEG preview of a HEIC original. */
export const PROCESSED_KIND_PREVIEW = 'preview';

export type ProcessedVersionRow = {
  id: string;
  mediaFileId: string;
  kind: string;
  mimeType: string;
  size: bigint | number;
  storageKey: string;
  createdAt: Date;
};

/** File name offered for a processed version download: `<stem>.<kind>.<ext>`. */
export function processedFileName(originalName: string, kind: string, mimeType: string): string {
  const dot = originalName.lastIndexOf('.');
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const safeKind = kind.replace(/[^a-z0-9-]/gi, '') || 'version';
  return `${stem}.${safeKind}.${ext}`;
}

/** The preview the viewer shows instead of the original, when one exists. */
export function previewOf<T extends { kind: string; mimeType: string }>(versions: T[]): T | null {
  return versions.find((v) => v.kind === PROCESSED_KIND_PREVIEW && v.mimeType.startsWith('image/')) ?? null;
}
