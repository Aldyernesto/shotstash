/**
 * Byte responses for `/media/**`: single objects with Range support and
 * streamed ZIP archives. Bytes come from the storage backend by key; this
 * module never sees a filesystem path.
 */

import { Readable } from 'stream';
import { isStorageError, storage } from '@/modules/storage';
import { errMessage, logger } from '@/lib/logger';
import { parseRange } from './range';
import { zipStream, type ZipEntry } from './zip';

const log = logger('media');

export const CACHE_COOKIE = 'private, max-age=3600';
export const CACHE_SIGNED = 'private, max-age=300';
/** A thumbnail addressed by its current version (`?v=<thumb_version>`) never changes. */
export const CACHE_IMMUTABLE = 'private, max-age=31536000, immutable';

/** `immutable` is for cookie-authorised, versioned URLs only. */
export type CachePolicy = 'cookie' | 'signed' | 'immutable';

function cacheHeaders(policy: CachePolicy): Record<string, string> {
  if (policy === 'cookie') return { 'Cache-Control': CACHE_COOKIE, Vary: 'Cookie' };
  if (policy === 'immutable') return { 'Cache-Control': CACHE_IMMUTABLE, Vary: 'Cookie' };
  return { 'Cache-Control': CACHE_SIGNED };
}

export function notFoundResponse() {
  return Response.json({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
}

export function forbiddenResponse() {
  return Response.json({ code: 'FORBIDDEN', message: 'Forbidden' }, { status: 403 });
}

export function storageUnavailableResponse() {
  return Response.json({ code: 'STORAGE_UNAVAILABLE', message: 'Storage is unavailable' }, { status: 503 });
}

/** `attachment; filename="..."; filename*=UTF-8''...` with an ASCII fallback. */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function toWeb(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

export type FileResponseInput = {
  req: Request;
  /** Storage key of the object. */
  key: string;
  mimeType: string;
  cache: CachePolicy;
  /** Omit for thumbnails and covers (no Content-Disposition). */
  disposition?: { kind: 'inline' | 'attachment'; filename: string };
};

/**
 * 200 / 206 / 416 object response; HEAD answers headers only. A missing
 * object answers 404, an unreachable backend 503. The body is pulled from
 * the backend only as fast as the client reads it.
 */
export async function fileResponse(input: FileResponseInput): Promise<Response> {
  const store = storage();
  let size: number;
  try {
    size = (await store.stat(input.key)).size;
  } catch (err) {
    if (isStorageError(err, 'NOT_FOUND') || isStorageError(err, 'INVALID_KEY')) return notFoundResponse();
    log.error('stat failed', { err: errMessage(err) });
    return storageUnavailableResponse();
  }

  const base: Record<string, string> = {
    'Content-Type': input.mimeType || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    ...cacheHeaders(input.cache),
  };
  if (input.disposition) base['Content-Disposition'] = contentDisposition(input.disposition.kind, input.disposition.filename);

  const head = input.req.method === 'HEAD';
  const range = parseRange(input.req.headers.get('range'), size);

  if (range.kind === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  }
  try {
    if (range.kind === 'ok') {
      const headers = {
        ...base,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(range.end - range.start + 1),
      };
      const body = head ? null : toWeb(await store.getStream(input.key, { start: range.start, end: range.end }));
      return new Response(body, { status: 206, headers });
    }
    const body = head || size === 0 ? null : toWeb(await store.getStream(input.key));
    return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  } catch (err) {
    if (isStorageError(err, 'NOT_FOUND')) return notFoundResponse();
    log.error('read failed', { err: errMessage(err) });
    return storageUnavailableResponse();
  }
}

export type { ZipEntry } from './zip';

/**
 * Streams a ZIP (STORE mode, ZIP64 where needed, see zip.ts). Objects are
 * checked while planning, so unreadable ones are listed in
 * `_MISSING_FILES.txt`; there is no `Content-Length` and no Range. A read
 * that fails mid-entry aborts the response.
 */
export async function zipResponse(input: {
  entries: ZipEntry[];
  emptyDirs?: string[];
  zipName: string;
  cache: CachePolicy;
}): Promise<Response> {
  const store = storage();
  const source = { stat: (key: string) => store.stat(key), getStream: (key: string) => store.getStream(key) };
  const stream = await zipStream(input.entries, source, {
    emptyDirs: input.emptyDirs,
    onError: (err) => log.warn('zip failed', { err: errMessage(err) }),
  });
  // Readable.toWeb pulls from the archive, so a slow client pauses zipping
  // instead of buffering the whole archive in memory.
  return new Response(toWeb(stream), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('attachment', input.zipName),
      'X-Content-Type-Options': 'nosniff',
      ...cacheHeaders(input.cache),
    },
  });
}
