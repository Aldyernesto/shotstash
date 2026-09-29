/**
 * Storage keys (AD-3). Keys never encode hierarchy: a file's bytes live
 * under its own id, so renaming or moving a Project or Section never touches
 * storage. Every key is recorded on its row and never recomputed from names.
 *
 *   files/<fileId>/original.<ext>
 *   files/<fileId>/thumb-<version>.jpg
 *   files/<fileId>/proc/<versionId>.<ext>
 *   covers/<project|user>/<id>.jpg
 *
 * This file is the only place keys are built. Pure and alias-free.
 */
import { StorageError } from './errors.ts';

const ID_RE = /^[0-9A-Za-z-]{1,64}$/;
const EXT_RE = /^[a-z0-9]{1,10}$/;
/** A key segment: letters, digits, dot, dash, underscore; never "." or "..". */
const SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_KEY_LENGTH = 512;

export const COVER_KINDS = ['project', 'user'] as const;
export type CoverKind = (typeof COVER_KINDS)[number];

/**
 * Throws `INVALID_KEY` unless `key` is a relative key made of safe segments:
 * no absolute path, no backslash, no empty, "." or ".." segment.
 */
export function assertSafeKey(key: string): string {
  if (typeof key !== 'string' || !key || key.length > MAX_KEY_LENGTH) {
    throw new StorageError('INVALID_KEY', 'Storage key is empty or too long');
  }
  if (key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new StorageError('INVALID_KEY', 'Storage key must be relative');
  }
  for (const seg of key.split('/')) {
    if (!SEGMENT_RE.test(seg) || seg === '.' || seg === '..') {
      throw new StorageError('INVALID_KEY', 'Storage key has an unsafe segment');
    }
  }
  // Staging and temporary areas of the local backend are never addressable.
  if (key.startsWith('.')) throw new StorageError('INVALID_KEY', 'Storage key may not start with a dot');
  return key;
}

export function isSafeKey(key: string): boolean {
  try {
    assertSafeKey(key);
    return true;
  } catch {
    return false;
  }
}

function id(value: string, what: string): string {
  if (!ID_RE.test(value)) throw new StorageError('INVALID_KEY', `Invalid ${what}`);
  return value;
}

function ext(value: string): string {
  const e = value.replace(/^\./, '').toLowerCase();
  if (!EXT_RE.test(e)) throw new StorageError('INVALID_KEY', 'Invalid extension');
  return e;
}

export const storageKeys = {
  /** Prefix of every object that belongs to one file. */
  filePrefix: (fileId: string) => `files/${id(fileId, 'file id')}/`,
  original: (fileId: string, extension: string) => `files/${id(fileId, 'file id')}/original.${ext(extension)}`,
  thumbnail: (fileId: string, version: number) => {
    if (!Number.isInteger(version) || version < 1) throw new StorageError('INVALID_KEY', 'Invalid thumbnail version');
    return `files/${id(fileId, 'file id')}/thumb-${version}.jpg`;
  },
  processed: (fileId: string, versionId: string, extension: string) =>
    `files/${id(fileId, 'file id')}/proc/${id(versionId, 'version id')}.${ext(extension)}`,
  cover: (kind: CoverKind, coverId: string) => {
    if (!(COVER_KINDS as readonly string[]).includes(kind)) throw new StorageError('INVALID_KEY', 'Invalid cover kind');
    return `covers/${kind}/${id(coverId, 'cover id')}.jpg`;
  },
};
