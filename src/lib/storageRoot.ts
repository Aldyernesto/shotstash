/**
 * The storage root for originals, thumbnails, covers and temporary uploads
 * (`STORAGE_LOCAL_ROOT`, default `./data/media`), resolved to an absolute
 * path once per call. Every writer and reader of media bytes uses this.
 */
import path from 'path';

export function storageRoot(): string {
  return path.resolve(process.env.STORAGE_LOCAL_ROOT || './data/media');
}

/** True when `target` is the storage root or lies inside it (guards recursive deletes). */
export function isInsideStorageRoot(target: string, root: string = storageRoot()): boolean {
  const rel = path.relative(root, path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
